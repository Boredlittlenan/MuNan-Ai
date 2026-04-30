use crate::ai::{
    openai_like,
    types::{AiResponse, ChatMessage},
};
use crate::config::ModelConfig;

pub async fn call_mimo(messages: Vec<ChatMessage>, cfg: ModelConfig) -> Result<AiResponse, String> {
    openai_like::chat_api(&cfg.base_url, &cfg.api_key, &cfg.model, messages).await
}
