use crate::ai::types::{ChatMessage, TokenUsage};
use crate::config::load_config;
use crate::storage::{record_token_usage, TokenUsageRecord};
use chrono::Local;
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
    conversation_id: Option<String>,
) -> Result<ChatReply, String> {
    let config = load_config(&app)?;
    let guided_messages = with_response_guidance(
        messages,
        config.persona.username,
        config.persona.enabled,
        config.persona.prompt,
    );

    let (reply, provider, provider_model) = match model.as_str() {
        "openai" => {
            let provider_model = config.openai.model.clone();
            (
                crate::ai::openai::call_openai(guided_messages, config.openai).await?,
                "openai".to_string(),
                provider_model,
            )
        }
        "deepseek" => {
            let provider_model = config.deepseek.model.clone();
            (
                crate::ai::deepseek::call_deepseek(guided_messages, config.deepseek).await?,
                "deepseek".to_string(),
                provider_model,
            )
        }
        "qwen" => {
            let provider_model = config.qwen.model.clone();
            (
                crate::ai::qwen::call_qwen(guided_messages, config.qwen).await?,
                "qwen".to_string(),
                provider_model,
            )
        }
        "mimo" => {
            let provider_model = config.mimo.model.clone();
            (
                crate::ai::mimo::call_mimo(guided_messages, config.mimo).await?,
                "mimo".to_string(),
                provider_model,
            )
        }
        "nvidia" => {
            let provider_model = config.nvidia.model.clone();
            (
                crate::ai::nvidia::call_nvidia(guided_messages, config.nvidia).await?,
                "nvidia".to_string(),
                provider_model,
            )
        }
        _ => {
            let provider = config
                .custom_providers
                .into_iter()
                .find(|provider| provider.id == model)
                .ok_or_else(|| format!("未知模型: {}", model))?;
            (
                crate::ai::openai_like::chat_api(
                    &provider.base_url,
                    &provider.api_key,
                    &provider.model,
                    guided_messages,
                )
                .await?,
                provider.id,
                provider.model,
            )
        }
    };

    let usage = reply.usage.unwrap_or(TokenUsage {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        is_precise: false,
    });
    let _ = record_token_usage(
        &app,
        TokenUsageRecord {
            provider,
            model: provider_model,
            conversation_id: conversation_id.unwrap_or_default(),
            usage,
        },
    );

    Ok(parse_chat_reply(&reply.content))
}

fn with_response_guidance(
    messages: Vec<ChatMessage>,
    username: String,
    persona_enabled: bool,
    persona_prompt: String,
) -> Vec<ChatMessage> {
    let mut guided_messages = Vec::with_capacity(messages.len() + 4);

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
    if persona_enabled && !trimmed_persona.is_empty() {
        guided_messages.push(ChatMessage {
            role: "system".into(),
            content: serde_json::Value::String(format!("人设与行为要求：\n{}", trimmed_persona)),
        });
    }

    let now = Local::now();
    guided_messages.push(ChatMessage {
        role: "system".into(),
        content: serde_json::Value::String(format!(
            "当前本地时间（应用系统时间，计划任务必须以此为准）：{}；ISO：{}。当用户使用今天、明天、下周、今晚、明早、几分钟后等相对时间时，必须按这个时间换算成具体日期和时间，不要凭空猜测。",
            now.format("%Y-%m-%d %H:%M:%S %:z"),
            now.to_rfc3339()
        )),
    });

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
    let tts_text = extract_tag(raw, "tts_text")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| build_tts_fallback(&display_text));

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

fn build_tts_fallback(display_text: &str) -> String {
    let mut output = String::new();
    let mut in_code_block = false;
    let without_cards = strip_tag_blocks(display_text, "ai_card");
    let readable_display_text = strip_tag_blocks(&without_cards, "scheduled_task");

    for line in readable_display_text.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("```") {
            if !in_code_block {
                push_sentence(&mut output, "这里有一段代码，已经显示在屏幕上。");
            }
            in_code_block = !in_code_block;
            continue;
        }

        if in_code_block || trimmed.is_empty() {
            continue;
        }

        let readable = trimmed
            .trim_start_matches('#')
            .trim_start_matches(['-', '*', '>', ' '])
            .replace("**", "")
            .replace("__", "")
            .replace('`', "")
            .replace("[", "")
            .replace("]", "")
            .replace("(", "，")
            .replace(")", "，");

        if !readable.trim().is_empty() {
            push_sentence(&mut output, readable.trim());
        }
    }

    let compact = output
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();

    if compact.is_empty() {
        "(平静)这条回复没有可朗读的正文。".into()
    } else {
        format!("(平静 清晰){}", truncate_chars(&compact, 1_500))
    }
}

fn strip_tag_blocks(raw: &str, tag: &str) -> String {
    let start_tag = format!("<{}>", tag);
    let end_tag = format!("</{}>", tag);
    let mut output = String::new();
    let mut remaining = raw;

    while let Some(start) = remaining.find(&start_tag) {
        output.push_str(&remaining[..start]);
        let after_start = &remaining[start + start_tag.len()..];

        if let Some(end) = after_start.find(&end_tag) {
            remaining = &after_start[end + end_tag.len()..];
        } else {
            remaining = "";
            break;
        }
    }

    output.push_str(remaining);
    output
}

fn push_sentence(output: &mut String, sentence: &str) {
    if !output.is_empty() {
        output.push(' ');
    }
    output.push_str(sentence);
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    let mut output = text.chars().take(max_chars).collect::<String>();

    if text.chars().count() > max_chars {
        output.push_str("。后续内容请查看屏幕文本。");
    }

    output
}
