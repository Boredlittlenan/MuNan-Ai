use crate::ai::{openai_like::chat_api, types::ChatMessage};
use crate::config::ModelConfig;

pub async fn call_openai(
    messages: Vec<ChatMessage>,
    cfg: ModelConfig
) -> Result<String, String> {
    chat_api(
        &cfg.base_url,
        &cfg.api_key,
        &cfg.model,
        messages,
    )
    .await
}
