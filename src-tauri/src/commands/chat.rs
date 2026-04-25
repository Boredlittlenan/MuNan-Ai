use crate::ai::types::ChatMessage;
use crate::config::load_config;
use serde::Serialize;

const RESPONSE_GUIDE: &str = include_str!("../../prompts/chat_response_guide.md");

#[derive(Debug, Serialize)]
pub struct ChatReply {
    pub content: String,
    pub tts_text: String,
    pub original_content: String,
}

#[tauri::command]
pub async fn chat_with_ai(messages: Vec<ChatMessage>, model: String) -> Result<ChatReply, String> {
    let config = load_config()?;
    let guided_messages = with_response_guidance(messages, config.persona.prompt);

    let reply = match model.as_str() {
        "openai" => crate::ai::openai::call_openai(guided_messages, config.openai).await,
        "deepseek" => crate::ai::deepseek::call_deepseek(guided_messages, config.deepseek).await,
        "qwen" => crate::ai::qwen::call_qwen(guided_messages, config.qwen).await,
        "mimo" => crate::ai::mimo::call_mimo(guided_messages, config.mimo).await,
        "nvidia" => crate::ai::nvidia::call_nvidia(guided_messages, config.nvidia).await,
        _ => Err(format!("未知模型: {}", model)),
    }?;

    Ok(parse_chat_reply(&reply))
}

fn with_response_guidance(messages: Vec<ChatMessage>, persona_prompt: String) -> Vec<ChatMessage> {
    let mut guided_messages = Vec::with_capacity(messages.len() + 2);

    let trimmed_persona = persona_prompt.trim();
    if !trimmed_persona.is_empty() {
        guided_messages.push(ChatMessage {
            role: "system".into(),
            content: format!("人设与行为要求：\n{}", trimmed_persona),
        });
    }

    guided_messages.push(ChatMessage {
        role: "system".into(),
        content: RESPONSE_GUIDE.trim().into(),
    });
    guided_messages.extend(messages);
    guided_messages
}

fn parse_chat_reply(raw: &str) -> ChatReply {
    let display_text = extract_tag(raw, "display_text")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| raw.trim().to_string());
    let tts_text = extract_tag(raw, "tts_text").unwrap_or_default();

    ChatReply {
        content: display_text.trim().to_string(),
        tts_text: tts_text.trim().to_string(),
        original_content: display_text.trim().to_string(),
    }
}

fn extract_tag(raw: &str, tag: &str) -> Option<String> {
    let start_tag = format!("<{}>", tag);
    let end_tag = format!("</{}>", tag);
    let start = raw.find(&start_tag)? + start_tag.len();
    let end = raw[start..].find(&end_tag)? + start;

    Some(raw[start..end].trim().to_string())
}
