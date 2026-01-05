mod ai;
mod config;

use ai::types::ChatMessage;
use config::AppConfig;
use std::fs;
use tauri::command;

fn load_config() -> Result<AppConfig, String> {
    let text = fs::read_to_string("config.json").map_err(|_| "未找到 config.json")?;

    serde_json::from_str(&text).map_err(|e| format!("配置文件解析失败: {}", e))
}

#[command]
async fn chat_with_ai(
    messages: Vec<ChatMessage>,
    model: String,
) -> Result<String, String> {
    // 🔥 捕获配置加载错误
    let cfg = match load_config() {
        Ok(c) => c,
        Err(e) => return Ok(format!("❌ 配置加载失败: {}", e)),
    };

    // 🔥 捕获 API 调用错误
    let reply = match model.as_str() {
        "openai" => ai::openai::call_openai(messages.clone(), cfg.openai).await,
        "mimo" => ai::mimo::call_mimo(messages.clone(), cfg.mimo).await,
        _ => Err("未知模型".into()),
    };

    match reply {
        Ok(r) => Ok(r),
        Err(e) => Ok(format!("❌ 调用失败：{}", e)), // 总是返回 Ok，前端不会卡住
    }
}



fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![chat_with_ai])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
