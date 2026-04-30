use crate::ai::types::ChatMessage;
use crate::config::load_config;
use serde::Serialize;
use tauri::AppHandle;

const RESPONSE_GUIDE: &str = include_str!("../../prompts/chat_response_guide.md");
const MAX_CONTEXT_MESSAGES: usize = 80;

#[derive(Debug, Serialize)]
pub struct ChatReply {
    pub content: String,
    pub tts_text: String,
    pub original_content: String,
}

#[tauri::command]
pub async fn chat_with_ai(
    app: AppHandle,
    messages: Vec<ChatMessage>,
    model: String,
) -> Result<ChatReply, String> {
    let config = load_config(&app)?;
    let guided_messages =
        with_response_guidance(messages, config.persona.username, config.persona.prompt);

    let reply = match model.as_str() {
        "openai" => crate::ai::openai::call_openai(guided_messages, config.openai).await,
        "deepseek" => crate::ai::deepseek::call_deepseek(guided_messages, config.deepseek).await,
        "qwen" => crate::ai::qwen::call_qwen(guided_messages, config.qwen).await,
        "mimo" => crate::ai::mimo::call_mimo(guided_messages, config.mimo).await,
        "nvidia" => crate::ai::nvidia::call_nvidia(guided_messages, config.nvidia).await,
        _ => {
            let provider = config
                .custom_providers
                .into_iter()
                .find(|provider| provider.id == model)
                .ok_or_else(|| format!("未知模型: {}", model))?;
            crate::ai::openai_like::chat_api(
                &provider.base_url,
                &provider.api_key,
                &provider.model,
                guided_messages,
            )
            .await
        }
    }?;

    Ok(parse_chat_reply(&reply))
}

fn with_response_guidance(
    messages: Vec<ChatMessage>,
    username: String,
    persona_prompt: String,
) -> Vec<ChatMessage> {
    let mut guided_messages = Vec::with_capacity(messages.len() + 3);

    let trimmed_username = username.trim();
    if !trimmed_username.is_empty() {
        guided_messages.push(ChatMessage {
            role: "system".into(),
            content: serde_json::Value::String(format!(
                "用户信息：当前用户的用户名是「{}」。回复时可据此理解称呼与上下文，但不要无意义地反复称呼用户。",
                trimmed_username
            )),
        });
    }

    let trimmed_persona = persona_prompt.trim();
    if !trimmed_persona.is_empty() {
        guided_messages.push(ChatMessage {
            role: "system".into(),
            content: serde_json::Value::String(format!("人设与行为要求：\n{}", trimmed_persona)),
        });
    }

    guided_messages.push(ChatMessage {
        role: "system".into(),
        content: serde_json::Value::String(RESPONSE_GUIDE.trim().into()),
    });
    let context_start = messages.len().saturating_sub(MAX_CONTEXT_MESSAGES);
    guided_messages.extend(messages.into_iter().skip(context_start));
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
        original_content: raw.trim().to_string(),
    }
}

fn extract_tag(raw: &str, tag: &str) -> Option<String> {
    let start_tag = format!("<{}>", tag);
    let end_tag = format!("</{}>", tag);
    let start = raw.find(&start_tag)? + start_tag.len();
    let end = raw[start..].find(&end_tag)? + start;

    Some(raw[start..end].trim().to_string())
}
