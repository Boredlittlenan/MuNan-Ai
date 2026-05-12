use crate::ai::types::ChatMessage;
use crate::config::{load_config, AgentConfig};
use chrono::Local;
use serde::de::Error as DeError;
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
    #[serde(alias = "userText")]
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
    #[serde(alias = "userText")]
    pub user_text: String,
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Deserialize)]
pub struct AgentScheduledTaskPlanRequest {
    pub model: String,
    #[serde(alias = "userText")]
    pub user_text: String,
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
    #[serde(default, alias = "existingTasks")]
    pub existing_tasks: Vec<AgentScheduledTaskExistingTask>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentScheduledTaskPlan {
    #[serde(default)]
    pub should_create: bool,
    #[serde(default)]
    pub tasks: Vec<AgentScheduledTaskPlanItem>,
    #[serde(default)]
    pub should_update: bool,
    #[serde(default)]
    pub updates: Vec<AgentScheduledTaskPlanItem>,
    #[serde(default)]
    pub should_delete: bool,
    #[serde(default)]
    pub delete_ids: Vec<String>,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct AgentScheduledTaskPlanItem {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub schedule_mode: String,
    #[serde(default, deserialize_with = "deserialize_string_or_number")]
    pub scheduled_at: String,
    #[serde(default)]
    pub time_of_day: String,
    #[serde(default)]
    pub weekdays: Vec<u8>,
    #[serde(default)]
    pub month_day: Option<u8>,
    #[serde(default)]
    pub year_month: Option<u8>,
    #[serde(default)]
    pub year_month_day: Option<u8>,
    #[serde(default)]
    pub custom_interval_days: Option<u32>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub model: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct AgentScheduledTaskExistingTask {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub schedule_mode: String,
    #[serde(default)]
    pub scheduled_at: i64,
    #[serde(default)]
    pub time_of_day: String,
    #[serde(default)]
    pub weekdays: Vec<u8>,
    #[serde(default)]
    pub month_days: Vec<u8>,
    #[serde(default)]
    pub year_month: Option<u8>,
    #[serde(default)]
    pub year_month_day: Option<u8>,
    #[serde(default)]
    pub custom_interval_days: Option<u32>,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
    #[serde(default)]
    pub last_run_at: Option<i64>,
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
    #[serde(default)]
    pub confirmed: bool,
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
    if !agent_skill_active(&config.agent, "system.shell") {
        return Ok(AgentShellPlan {
            should_run: false,
            command: String::new(),
            reason: "Shell Agent 尚未开启。".into(),
        });
    }

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
    if !agent_skill_active(&config.agent, "search.tavily") {
        return Ok(AgentTavilyPlan {
            should_search: false,
            query: String::new(),
            reason: "Tavily Agent 搜索尚未开启。".into(),
        });
    }

    if config.agent.tavily_api_key.trim().is_empty() {
        return Ok(AgentTavilyPlan {
            should_search: false,
            query: String::new(),
            reason: "Tavily API Key 为空。".into(),
        });
    }

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
pub async fn agent_plan_scheduled_tasks(
    app: AppHandle,
    request: AgentScheduledTaskPlanRequest,
) -> Result<AgentScheduledTaskPlan, String> {
    let user_text = request.user_text.trim();

    if user_text.is_empty() {
        return Ok(AgentScheduledTaskPlan {
            should_create: false,
            tasks: Vec::new(),
            should_update: false,
            updates: Vec::new(),
            should_delete: false,
            delete_ids: Vec::new(),
            reason: "用户输入为空。".into(),
        });
    }

    let config = load_config(&app)?;
    let now = Local::now();
    let recent_context = compact_agent_context(&request.messages, 12);
    let existing_tasks =
        serde_json::to_string_pretty(&request.existing_tasks).unwrap_or_else(|_| "[]".to_string());
    let planner_messages = vec![
        ChatMessage::text(
            "system",
            format!(
                "你是 MuNan AI 的计划任务变更规划器。你只负责把用户关于未来提醒、闹钟、日程提醒、周期任务、到点自动查询或到点自动执行的请求，转换成结构化 JSON。\n\
当前本地时间：{}；ISO：{}。\n\
输出必须是纯 JSON，不能有 Markdown，格式：{{\"should_create\":true|false,\"tasks\":[...],\"should_update\":true|false,\"updates\":[...],\"should_delete\":true|false,\"delete_ids\":[...],\"reason\":\"...\"}}。\n\
如果用户不是在创建、修改、暂停、恢复或删除计划任务，三个 should_* 都为 false，数组都为空。\n\
如果用户要求新增未来某个时间提醒、告诉、通知、叫醒、执行、查询、播报、汇报、总结、整理，就 should_create=true。\n\
如果用户要求修改已有任务，比如改时间、改周期、改内容、改模型、暂停或恢复，就 should_update=true，updates 里必须写匹配到的已有任务 id，并输出修改后的完整任务字段。暂停任务时 enabled=false；恢复/启用任务时 enabled=true。\n\
如果用户要求删除或取消已有任务，就 should_delete=true，delete_ids 里只写匹配到的已有任务 id。\n\
如果用户使用省略表达，比如“改成每周一到周六”“换成每周一到周五”“改到早上8点”，要结合最近对话和现有计划任务判断用户是在修改刚创建或刚提到的任务；如果只有一个强相关任务，直接 update 它，不要新建替代任务。\n\
当存在多个同名或同类任务时，优先选择最近对话刚创建/刚提到的任务；其次选择 updated_at 或 created_at 最大的任务。不确定时不要创建新任务，reason 说明需要用户指定任务。\n\
每个 task/update 字段：id、title、prompt、kind、schedule_mode、scheduled_at、time_of_day、weekdays、month_day、year_month、year_month_day、custom_interval_days、enabled、model。\n\
新建任务的 model 可以留空，表示沿用当前聊天模型；修改任务时如果用户没要求改模型，就沿用现有任务 model。\n\
kind 只能是 reminder 或 ai_prompt。普通提醒/闹钟用 reminder；需要到点后查询天气、联网搜索、总结、整理、生成内容、执行 AI 判断的任务用 ai_prompt。\n\
schedule_mode 只能是 once、daily、weekly、monthly、yearly、custom_days。\n\
once 必须写 scheduled_at，使用带本地时区的 ISO 时间；daily 只写 time_of_day；weekly 写 weekdays 和 time_of_day，weekdays 用 1-7 表示周一到周日；monthly 写 month_day 和 time_of_day；yearly 写 year_month、year_month_day 和 time_of_day；custom_days 写 custom_interval_days 和 time_of_day。\n\
中文时间要按当前本地时间换算：一分钟后、三小时后、明早、今晚、以后每天早晨 9 点、每周一三五下午 6 点、每月 1 号、每年 5 月 1 日、每隔 3 天等都要转换。\n\
不要编造用户没说的地点、联系人或细节；可以把缺失细节保留在 prompt 里让到点执行时再根据上下文处理。\n\
选择已有任务时要根据 id、title、prompt、schedule_mode、time_of_day、source 等综合匹配；不确定是哪一个任务时不要更新或删除，reason 说明需要用户说清楚。\n\
示例：用户说“以后每天早晨9告诉我当天天气”，输出 create daily、time_of_day=09:00、kind=ai_prompt、prompt=到点后查询当天天气并告知用户。\n\
示例：用户说“把天气提醒改到早上8点”，从已有任务中找到天气提醒，输出 update，保留原 id，time_of_day=08:00。",
                now.format("%Y-%m-%d %H:%M:%S %:z"),
                now.to_rfc3339()
            ),
        ),
        ChatMessage::text(
            "user",
            format!(
                "最近对话：\n{}\n\n现有计划任务 JSON：\n{}\n\n用户最新需求：\n{}\n\n请规划计划任务变更并返回 JSON。",
                recent_context, existing_tasks, user_text
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

    parse_scheduled_task_plan(&reply.content)
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

    ensure_agent_skill(&config.agent, "search.tavily", "Tavily Agent 搜索")?;

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
pub async fn agent_fetch_url_text(app: AppHandle, url: String) -> Result<AgentFetchedPage, String> {
    let config = load_config(&app)?;
    ensure_agent_skill(&config.agent, "browser.extract_text", "网页文本读取")?;

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
pub async fn agent_run_shell(
    app: AppHandle,
    request: AgentShellRequest,
) -> Result<AgentShellResult, String> {
    let config = load_config(&app)?;
    ensure_agent_skill(&config.agent, "system.shell", "Shell Agent 执行")?;

    if config.agent.require_confirmation && !request.confirmed {
        return Err("Shell 命令需要用户确认后才能执行。".into());
    }

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

fn parse_scheduled_task_plan(raw: &str) -> Result<AgentScheduledTaskPlan, String> {
    let json_text = extract_json_object(raw).unwrap_or_else(|| raw.trim().to_string());
    let mut plan: AgentScheduledTaskPlan = serde_json::from_str(&json_text)
        .map_err(|error| format!("计划任务规划解析失败: {}。原始响应: {}", error, raw))?;

    plan.reason = plan.reason.trim().to_string();
    for task in &mut plan.tasks {
        task.id = task.id.trim().to_string();
        task.title = task.title.trim().to_string();
        task.prompt = task.prompt.trim().to_string();
        task.kind = task.kind.trim().to_lowercase();
        task.schedule_mode = task.schedule_mode.trim().to_lowercase();
        task.scheduled_at = task.scheduled_at.trim().to_string();
        task.time_of_day = task.time_of_day.trim().to_string();
        task.model = task.model.trim().to_string();
    }
    for task in &mut plan.updates {
        task.id = task.id.trim().to_string();
        task.title = task.title.trim().to_string();
        task.prompt = task.prompt.trim().to_string();
        task.kind = task.kind.trim().to_lowercase();
        task.schedule_mode = task.schedule_mode.trim().to_lowercase();
        task.scheduled_at = task.scheduled_at.trim().to_string();
        task.time_of_day = task.time_of_day.trim().to_string();
        task.model = task.model.trim().to_string();
    }
    plan.delete_ids = plan
        .delete_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();

    plan.tasks.retain(|task| {
        !task.title.is_empty() && !task.prompt.is_empty() && !task.schedule_mode.is_empty()
    });
    plan.updates.retain(|task| {
        !task.id.is_empty()
            && !task.title.is_empty()
            && !task.prompt.is_empty()
            && !task.schedule_mode.is_empty()
    });

    if plan.should_create && plan.tasks.is_empty() {
        plan.should_create = false;
        plan.reason = "模型判断需要创建计划任务，但没有给出有效新任务。".into();
    }
    if plan.should_update && plan.updates.is_empty() {
        plan.should_update = false;
        if plan.reason.is_empty() {
            plan.reason = "模型判断需要修改计划任务，但没有给出有效更新。".into();
        }
    }
    if plan.should_delete && plan.delete_ids.is_empty() {
        plan.should_delete = false;
        if plan.reason.is_empty() {
            plan.reason = "模型判断需要删除计划任务，但没有给出任务 id。".into();
        }
    }

    Ok(plan)
}

fn deserialize_string_or_number<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    match value {
        Value::String(text) => Ok(text),
        Value::Number(number) => Ok(number.to_string()),
        Value::Null => Ok(String::new()),
        other => Err(D::Error::custom(format!(
            "expected string, number, or null, got {}",
            other
        ))),
    }
}

fn normalize_tavily_max_results(value: u32) -> u32 {
    value.clamp(1, 10)
}

fn agent_skill_enabled(agent: &AgentConfig, skill_id: &str) -> bool {
    agent.enabled_skills.iter().any(|skill| skill == skill_id)
}

fn agent_skill_active(agent: &AgentConfig, skill_id: &str) -> bool {
    agent.enabled && agent_skill_enabled(agent, skill_id)
}

fn ensure_agent_skill(agent: &AgentConfig, skill_id: &str, label: &str) -> Result<(), String> {
    if !agent.enabled {
        return Err(format!("{}失败：Agent 总开关未开启。", label));
    }

    if !agent_skill_enabled(agent, skill_id) {
        return Err(format!("{}失败：{} 工具未开启。", label, skill_id));
    }

    Ok(())
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
