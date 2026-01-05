use crate::ai::{openai_like, types::ChatMessage};
use crate::config::ModelConfig;

pub async fn call_mimo(
    messages: Vec<ChatMessage>,
    cfg: ModelConfig,
) -> Result<String, String> {
    openai_like::chat_mimo_debug(
        &cfg.base_url,
        &cfg.api_key,
        &cfg.model,
        messages,
    )
    .await
}
