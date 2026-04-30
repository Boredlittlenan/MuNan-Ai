use crate::ai::types::ChatMessage;
use crate::config::{load_config, AgentConfig};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;
use tauri::AppHandle;
use tokio::process::Command;
use tokio::time::timeout;

#[derive(Debug, Serialize)]
pub struct AgentCapabilityPreview {
    pub enabled: bool,
    pub browser_enabled: bool,
    pub system_enabled: bool,
    pub shell_enabled: bool,
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
当用户只是闲聊、解释概念、写作、翻译、普通问答，或者没有明确需要本地信息时，should_run=false。\n\
命令使用 PowerShell 语法，并尽量选择能直接推进任务的一条命令。",
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
pub fn preview_agent_capabilities(agent: AgentConfig) -> AgentCapabilityPreview {
    let active_skills = agent
        .enabled_skills
        .iter()
        .filter(|skill| {
            agent.enabled
                && ((agent.browser_enabled && skill.starts_with("browser."))
                    || (agent.system_enabled
                        && skill.starts_with("system.")
                        && skill.as_str() != "system.shell")
                    || (agent.shell_enabled && skill.as_str() == "system.shell"))
        })
        .cloned()
        .collect::<Vec<_>>();

    let message = if !agent.enabled {
        "Agent 总开关未开启，所有技能都会保持待命。".to_string()
    } else if active_skills.is_empty() {
        "Agent 已开启，但当前没有可执行技能。请至少开启浏览器或系统操作。".to_string()
    } else {
        format!(
            "Agent 已开启，当前可用 {} 个技能；单次任务最多执行 {} 步。",
            active_skills.len(),
            agent.max_steps
        )
    };

    AgentCapabilityPreview {
        enabled: agent.enabled,
        browser_enabled: agent.browser_enabled,
        system_enabled: agent.system_enabled,
        shell_enabled: agent.shell_enabled,
        require_confirmation: agent.require_confirmation,
        max_steps: agent.max_steps,
        enabled_skills: agent.enabled_skills,
        active_skills,
        message,
    }
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
