use crate::ai::types::ChatMessage;
use crate::config::load_config;

#[tauri::command]
pub async fn chat_with_ai(messages: Vec<ChatMessage>, model: String) -> Result<String, String> {
    let config = load_config()?;

    let reply = match model.as_str() {
        "openai" => crate::ai::openai::call_openai(messages.clone(), config.openai).await,
        "deepseek" => crate::ai::deepseek::call_deepseek(messages.clone(), config.deepseek).await,
        "qwen" => crate::ai::qwen::call_qwen(messages.clone(), config.qwen).await,
        "mimo" => crate::ai::mimo::call_mimo(messages.clone(), config.mimo).await,
        "nvidia" => crate::ai::nvidia::call_nvidia(messages.clone(), config.nvidia).await,
        _ => Err(format!("未知模型: {}", model)),
    }?;

    Ok(reply)
}
