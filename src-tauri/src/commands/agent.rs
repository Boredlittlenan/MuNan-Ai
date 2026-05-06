use crate::ai::types::ChatMessage;
use crate::config::{load_config, AgentConfig};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::Duration;
use tauri::AppHandle;
use tokio::process::Command;
use tokio::time::timeout;

#[derive(Debug, Serialize)]
pub struct AgentCapabilityPreview {
    pub enabled: bool,
    pub tavily_max_results: u32,
    pub require_confirmation: bool,
    pub max_steps: u32,
    pub enabled_skills: Vec<String>,
    pub active_skills: Vec<String>,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct AgentFetchedPage {
    pub url: String,
    pub title: String,
    pub text: String,
}

#[derive(Debug, Deserialize)]
pub struct AgentShellPlanRequest {
    pub model: String,
    pub user_text: String,
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentShellPlan {
    pub should_run: bool,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Deserialize)]
pub struct AgentTavilyPlanRequest {
    pub model: String,
    pub user_text: String,
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentTavilyPlan {
    pub should_search: bool,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Deserialize)]
pub struct AgentShellRequest {
    pub command: String,
    #[serde(default)]
    pub cwd: String,
}

#[derive(Debug, Serialize)]
pub struct AgentShellResult {
    pub command: String,
    pub cwd: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

#[derive(Debug, Deserialize)]
pub struct AgentTavilySearchRequest {
    pub query: String,
    #[serde(default)]
    pub max_results: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct AgentTavilySearchResult {
    pub query: String,
    pub answer: String,
    pub results: Vec<AgentTavilySearchItem>,
}

#[derive(Debug, Serialize)]
pub struct AgentTavilySearchItem {
    pub title: String,
    pub url: String,
    pub content: String,
    pub score: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct TavilyApiResponse {
    #[serde(default)]
    query: String,
    #[serde(default)]
    answer: Option<String>,
    #[serde(default)]
    results: Vec<TavilyApiResult>,
}

#[derive(Debug, Deserialize)]
struct TavilyApiResult {
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    score: Option<f64>,
}

#[tauri::command]
pub async fn agent_plan_shell_action(
    app: AppHandle,
    request: AgentShellPlanRequest,
) -> Result<AgentShellPlan, String> {
    let user_text = request.user_text.trim();

    if user_text.is_empty() {
        return Ok(AgentShellPlan {
            should_run: false,
            command: String::new(),
            reason: "用户输入为空。".into(),
        });
    }

    let config = load_config(&app)?;
    let current_dir = std::env::current_dir()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| ".".into());
    let recent_context = compact_agent_context(&request.messages, 12);
    let planner_messages = vec![
        ChatMessage::text(
            "system",
            format!(
                "你是 MuNan AI 的本地 Shell Agent 规划器。你只负责判断用户这次对话是否需要调用本机 PowerShell，并给出一条可执行命令。\n\
当前工作目录：{}\n\
输出必须是纯 JSON，不能有 Markdown，格式：{{\"should_run\":true|false,\"command\":\"...\",\"reason\":\"...\"}}。\n\
当用户需要你检查项目、查看文件、运行构建/测试/格式化、查看 Git 状态、定位报错、读取本地环境信息时，should_run=true。\n\
当用户要求创建、移动、复制、重命名文件或文件夹等明确本地操作时，should_run=true，并生成实际执行该操作的命令，不要只生成查看命令。\n\
当用户的需求包含多个本地步骤时，可以把多个 PowerShell 语句用分号组合成一条命令，按顺序完成。\n\
如果用户要求的是 Windows Explorer 桌面图标排序、窗口操作等 PowerShell 难以可靠控制的 GUI 行为，命令中只完成能可靠执行的部分，并在 reason 里说明剩余部分需要用户手动完成。\n\
当用户只是闲聊、解释概念、写作、翻译、普通问答，或者没有明确需要本地信息/本地操作时，should_run=false。\n\
命令使用 PowerShell 语法，并尽量选择能直接完成或推进任务的一条命令。",
                current_dir
            ),
        ),
        ChatMessage::text(
            "user",
            format!(
                "最近对话：\n{}\n\n用户最新需求：\n{}\n\n请判断是否需要执行 Shell，并返回 JSON。",
                recent_context, user_text
            ),
        ),
    ];

    let reply = match request.model.as_str() {
        "openai" => crate::ai::openai::call_openai(planner_messages, config.openai).await?,
        "deepseek" => crate::ai::deepseek::call_deepseek(planner_messages, config.deepseek).await?,
        "qwen" => crate::ai::qwen::call_qwen(planner_messages, config.qwen).await?,
        "mimo" => crate::ai::mimo::call_mimo(planner_messages, config.mimo).await?,
        "nvidia" => crate::ai::nvidia::call_nvidia(planner_messages, config.nvidia).await?,
        _ => {
            let provider = config
                .custom_providers
                .into_iter()
                .find(|provider| provider.id == request.model)
                .ok_or_else(|| format!("未知模型: {}", request.model))?;
            crate::ai::openai_like::chat_api(
                &provider.base_url,
                &provider.api_key,
                &provider.model,
                planner_messages,
            )
            .await?
        }
    };

    parse_shell_plan(&reply.content)
}

#[tauri::command]
pub async fn agent_plan_tavily_search(
    app: AppHandle,
    request: AgentTavilyPlanRequest,
) -> Result<AgentTavilyPlan, String> {
    let user_text = request.user_text.trim();

    if user_text.is_empty() {
        return Ok(AgentTavilyPlan {
            should_search: false,
            query: String::new(),
            reason: "用户输入为空。".into(),
        });
    }

    let config = load_config(&app)?;
    let recent_context = compact_agent_context(&request.messages, 12);
    let planner_messages = vec![
        ChatMessage::text(
            "system",
            "你是 MuNan AI 的 Tavily 联网搜索规划器。你只负责判断用户这次对话是否需要联网搜索，并给出一条适合 Tavily Search API 的搜索 query。\n\
输出必须是纯 JSON，不能有 Markdown，格式：{\"should_search\":true|false,\"query\":\"...\",\"reason\":\"...\"}。\n\
当用户需要最新信息、实时资料、新闻、价格、版本、政策、网站资料、外部事实核验、网络搜索或引用来源时，should_search=true。\n\
当用户只是闲聊、写作、改代码、本地项目排错、普通常识或不需要外部实时信息时，should_search=false。\n\
query 要简短具体，保留关键实体、时间和限定词。"
                .to_string(),
        ),
        ChatMessage::text(
            "user",
            format!(
                "最近对话：\n{}\n\n用户最新需求：\n{}\n\n请判断是否需要 Tavily 搜索，并返回 JSON。",
                recent_context, user_text
            ),
        ),
    ];

    let reply = match request.model.as_str() {
        "openai" => crate::ai::openai::call_openai(planner_messages, config.openai).await?,
        "deepseek" => crate::ai::deepseek::call_deepseek(planner_messages, config.deepseek).await?,
        "qwen" => crate::ai::qwen::call_qwen(planner_messages, config.qwen).await?,
        "mimo" => crate::ai::mimo::call_mimo(planner_messages, config.mimo).await?,
        "nvidia" => crate::ai::nvidia::call_nvidia(planner_messages, config.nvidia).await?,
        _ => {
            let provider = config
                .custom_providers
                .into_iter()
                .find(|provider| provider.id == request.model)
                .ok_or_else(|| format!("未知模型: {}", request.model))?;
            crate::ai::openai_like::chat_api(
                &provider.base_url,
                &provider.api_key,
                &provider.model,
                planner_messages,
            )
            .await?
        }
    };

    parse_tavily_plan(&reply.content)
}

#[tauri::command]
pub fn preview_agent_capabilities(agent: AgentConfig) -> AgentCapabilityPreview {
    let active_skills = if agent.enabled {
        agent.enabled_skills.clone()
    } else {
        Vec::new()
    };

    let message = if !agent.enabled {
        "Agent 总开关未开启，所有技能都会保持待命。".to_string()
    } else if active_skills.is_empty() {
        "Agent 已开启，但当前没有可用工具。请至少打开一个工具。".to_string()
    } else {
        format!(
            "Agent 已开启，当前可用 {} 个工具；单次任务最多执行 {} 步。",
            active_skills.len(),
            agent.max_steps
        )
    };

    AgentCapabilityPreview {
        enabled: agent.enabled,
        tavily_max_results: normalize_tavily_max_results(agent.tavily_max_results),
        require_confirmation: agent.require_confirmation,
        max_steps: agent.max_steps,
        enabled_skills: agent.enabled_skills,
        active_skills,
        message,
    }
}

#[tauri::command]
pub async fn agent_tavily_search(
    app: AppHandle,
    request: AgentTavilySearchRequest,
) -> Result<AgentTavilySearchResult, String> {
    let config = load_config(&app)?;
    let query = request.query.trim().to_string();

    if query.is_empty() {
        return Err("Tavily 搜索关键词不能为空。".into());
    }

    if !config.agent.enabled || !agent_skill_enabled(&config.agent, "search.tavily") {
        return Err("Tavily Agent 搜索尚未开启。".into());
    }

    let api_key = config.agent.tavily_api_key.trim();
    if api_key.is_empty() {
        return Err("请先在 Agent 设置中填写 Tavily API Key。".into());
    }

    let max_results = normalize_tavily_max_results(
        request
            .max_results
            .unwrap_or(config.agent.tavily_max_results),
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("创建 Tavily HTTP 客户端失败: {}", error))?;
    let response = client
        .post("https://api.tavily.com/search")
        .bearer_auth(api_key)
        .json(&json!({
            "query": query,
            "search_depth": "basic",
            "max_results": max_results,
            "include_answer": true
        }))
        .send()
        .await
        .map_err(|error| format!("Tavily 搜索请求失败: {}", error))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取 Tavily 响应失败: {}", error))?;

    if !status.is_success() {
        return Err(format!(
            "Tavily 搜索失败，HTTP 状态: {}，响应: {}",
            status, text
        ));
    }

    let parsed: TavilyApiResponse = serde_json::from_str(&text)
        .map_err(|error| format!("Tavily 响应解析失败: {}。原始响应: {}", error, text))?;
    let items = parsed
        .results
        .into_iter()
        .take(max_results as usize)
        .map(|item| AgentTavilySearchItem {
            title: item.title,
            url: item.url,
            content: truncate_chars(&item.content, 1_200),
            score: item.score,
        })
        .collect::<Vec<_>>();

    Ok(AgentTavilySearchResult {
        query: if parsed.query.trim().is_empty() {
            query
        } else {
            parsed.query
        },
        answer: parsed.answer.unwrap_or_default(),
        results: items,
    })
}

#[tauri::command]
pub async fn agent_fetch_url_text(url: String) -> Result<AgentFetchedPage, String> {
    let parsed_url =
        reqwest::Url::parse(url.trim()).map_err(|error| format!("URL 格式不正确: {}", error))?;

    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err("只支持读取 http/https 网页。".into());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("MuNan-AI-Agent/0.1")
        .build()
        .map_err(|error| format!("创建 Agent HTTP 客户端失败: {}", error))?;
    let response = client
        .get(parsed_url.clone())
        .send()
        .await
        .map_err(|error| format!("网页读取失败: {}", error))?;
    let status = response.status();

    if !status.is_success() {
        return Err(format!("网页读取失败，HTTP 状态: {}", status));
    }

    let html = response
        .text()
        .await
        .map_err(|error| format!("读取网页内容失败: {}", error))?;
    let title = extract_title(&html);
    let text = compact_text(&strip_html(&html));

    if text.is_empty() {
        return Err("已打开网页响应，但没有提取到可读文本。".into());
    }

    Ok(AgentFetchedPage {
        url: parsed_url.to_string(),
        title,
        text: truncate_chars(&text, 6_000),
    })
}

#[tauri::command]
pub async fn agent_run_shell(request: AgentShellRequest) -> Result<AgentShellResult, String> {
    let command_text = request.command.trim().to_string();

    if command_text.is_empty() {
        return Err("Shell 命令不能为空。".into());
    }

    let cwd = resolve_shell_cwd(&request.cwd)?;
    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoLogo")
        .arg("-NoProfile")
        .arg("-Command")
        .arg(&command_text)
        .current_dir(&cwd)
        .kill_on_drop(true);

    let output = timeout(Duration::from_secs(60), command.output())
        .await
        .map_err(|_| "Shell 命令执行超时，已停止等待输出。".to_string())?
        .map_err(|error| format!("Shell 命令启动失败: {}", error))?;

    Ok(AgentShellResult {
        command: command_text,
        cwd: cwd.display().to_string(),
        exit_code: output.status.code(),
        stdout: truncate_chars(&String::from_utf8_lossy(&output.stdout), 12_000),
        stderr: truncate_chars(&String::from_utf8_lossy(&output.stderr), 12_000),
        timed_out: false,
    })
}

fn extract_title(html: &str) -> String {
    let lower = html.to_lowercase();
    let Some(start_tag) = lower.find("<title") else {
        return String::new();
    };
    let Some(start_offset) = lower[start_tag..].find('>') else {
        return String::new();
    };
    let start = start_tag + start_offset + 1;
    let Some(end_offset) = lower[start..].find("</title>") else {
        return String::new();
    };

    compact_text(&decode_html_entities(&html[start..start + end_offset]))
}

fn strip_html(html: &str) -> String {
    let mut output = String::with_capacity(html.len().min(16_384));
    let mut inside_tag = false;
    let mut tag_buffer = String::new();
    let mut skip_until: Option<&'static str> = None;

    for character in html.chars() {
        if let Some(end_tag) = skip_until {
            tag_buffer.push(character.to_ascii_lowercase());
            if tag_buffer.ends_with(end_tag) {
                skip_until = None;
                tag_buffer.clear();
                inside_tag = false;
            }
            continue;
        }

        if inside_tag {
            if character == '>' {
                let tag = tag_buffer.trim().to_ascii_lowercase();
                if tag.starts_with("script") {
                    skip_until = Some("</script>");
                } else if tag.starts_with("style") {
                    skip_until = Some("</style>");
                } else if matches!(
                    tag.as_str(),
                    "p" | "/p" | "br" | "br/" | "div" | "/div" | "li" | "/li" | "tr" | "/tr"
                ) {
                    output.push('\n');
                }

                tag_buffer.clear();
                inside_tag = false;
            } else {
                tag_buffer.push(character);
            }
            continue;
        }

        if character == '<' {
            inside_tag = true;
            tag_buffer.clear();
            continue;
        }

        output.push(character);
    }

    decode_html_entities(&output)
}

fn compact_text(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn decode_html_entities(text: &str) -> String {
    text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    let mut output = text.chars().take(max_chars).collect::<String>();

    if text.chars().count() > max_chars {
        output.push_str("\n...");
    }

    output
}

fn compact_agent_context(messages: &[ChatMessage], max_messages: usize) -> String {
    let context_start = messages.len().saturating_sub(max_messages);

    messages
        .iter()
        .skip(context_start)
        .map(|message| {
            format!(
                "{}: {}",
                message.role,
                compact_json_content(&message.content)
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn compact_json_content(content: &Value) -> String {
    let text = match content {
        Value::String(value) => value.clone(),
        _ => content.to_string(),
    };

    truncate_chars(&compact_text(&text), 1_200)
}

fn parse_shell_plan(raw: &str) -> Result<AgentShellPlan, String> {
    let json_text = extract_json_object(raw).unwrap_or_else(|| raw.trim().to_string());
    let mut plan: AgentShellPlan = serde_json::from_str(&json_text)
        .map_err(|error| format!("Agent Shell 规划解析失败: {}。原始响应: {}", error, raw))?;

    plan.command = plan.command.trim().to_string();
    plan.reason = plan.reason.trim().to_string();

    if plan.should_run && plan.command.is_empty() {
        plan.should_run = false;
        plan.reason = "模型判断需要 Shell，但没有给出命令。".into();
    }

    Ok(plan)
}

fn parse_tavily_plan(raw: &str) -> Result<AgentTavilyPlan, String> {
    let json_text = extract_json_object(raw).unwrap_or_else(|| raw.trim().to_string());
    let mut plan: AgentTavilyPlan = serde_json::from_str(&json_text)
        .map_err(|error| format!("Agent Tavily 规划解析失败: {}。原始响应: {}", error, raw))?;

    plan.query = plan.query.trim().to_string();
    plan.reason = plan.reason.trim().to_string();

    if plan.should_search && plan.query.is_empty() {
        plan.should_search = false;
        plan.reason = "模型判断需要 Tavily 搜索，但没有给出 query。".into();
    }

    Ok(plan)
}

fn normalize_tavily_max_results(value: u32) -> u32 {
    value.clamp(1, 10)
}

fn agent_skill_enabled(agent: &AgentConfig, skill_id: &str) -> bool {
    agent.enabled_skills.iter().any(|skill| skill == skill_id)
}

fn extract_json_object(raw: &str) -> Option<String> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;

    if end <= start {
        return None;
    }

    Some(raw[start..=end].to_string())
}

fn resolve_shell_cwd(value: &str) -> Result<PathBuf, String> {
    let cwd = if value.trim().is_empty() {
        std::env::current_dir().map_err(|error| format!("无法定位当前目录: {}", error))?
    } else {
        PathBuf::from(value.trim())
    };

    if !cwd.exists() {
        return Err(format!("工作目录不存在: {}", cwd.display()));
    }

    if !cwd.is_dir() {
        return Err(format!("工作目录不是文件夹: {}", cwd.display()));
    }

    Ok(cwd)
}
