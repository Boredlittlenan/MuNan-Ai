use serde::Deserialize;

#[derive(Debug, Deserialize, Clone)]
pub struct ModelConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Debug, Deserialize)]
pub struct AppConfig {
    pub openai: ModelConfig,
    pub deepseek: ModelConfig,
    pub qwen: ModelConfig,
    pub mimo: ModelConfig,
}
