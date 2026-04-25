use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ModelConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CustomProviderConfig {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub custom_models: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct SpeechConfig {
    #[serde(default)]
    pub asr: AsrConfig,
    #[serde(default)]
    pub tts: TtsConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AsrConfig {
    #[serde(default = "default_asr_provider")]
    pub provider: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub model: String,
    #[serde(default = "default_tencent_engine_type")]
    pub tencent_engine_type: String,
    #[serde(default)]
    pub app_id: String,
    #[serde(default)]
    pub secret_id: String,
    #[serde(default)]
    pub secret_key: String,
    #[serde(default = "default_tencent_region")]
    pub region: String,
}

impl Default for AsrConfig {
    fn default() -> Self {
        Self {
            provider: default_asr_provider(),
            base_url: String::new(),
            api_key: String::new(),
            model: String::new(),
            tencent_engine_type: default_tencent_engine_type(),
            app_id: String::new(),
            secret_id: String::new(),
            secret_key: String::new(),
            region: default_tencent_region(),
        }
    }
}

fn default_asr_provider() -> String {
    "openai_like".into()
}

fn default_tencent_region() -> String {
    "ap-shanghai".into()
}

fn default_tencent_engine_type() -> String {
    "16k_zh-PY".into()
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TtsConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    #[serde(default)]
    pub voice: String,
    #[serde(default)]
    pub voice_description: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PersonaConfig {
    #[serde(default = "default_persona_prompt")]
    pub prompt: String,
}

impl Default for PersonaConfig {
    fn default() -> Self {
        Self {
            prompt: default_persona_prompt(),
        }
    }
}

fn default_persona_prompt() -> String {
    "你是 MuNan AI，一个温和、清晰、可靠的桌面 AI 助手。你会优先理解用户真实意图，回答时直接、有条理，并在需要时给出可执行步骤。".into()
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct WebDavConfig {
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default = "default_webdav_path")]
    pub path: String,
}

fn default_webdav_path() -> String {
    "munan-ai-settings.json".into()
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AppConfig {
    #[serde(default)]
    pub openai: ModelConfig,
    #[serde(default)]
    pub deepseek: ModelConfig,
    #[serde(default)]
    pub qwen: ModelConfig,
    #[serde(default)]
    pub mimo: ModelConfig,
    #[serde(default)]
    pub nvidia: ModelConfig,
    #[serde(default)]
    pub speech: SpeechConfig,
    #[serde(default)]
    pub persona: PersonaConfig,
    #[serde(default)]
    pub webdav: WebDavConfig,
    #[serde(default)]
    pub custom_models: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub custom_providers: Vec<CustomProviderConfig>,
}

fn config_path_candidates() -> Vec<PathBuf> {
    let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    vec![
        current_dir.join("config.local.json"),
        current_dir.join("src-tauri").join("config.local.json"),
        current_dir.join("config.json"),
        current_dir.join("src-tauri").join("config.json"),
    ]
}

fn default_config_path() -> PathBuf {
    let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    if current_dir.join("src-tauri").exists() {
        current_dir.join("src-tauri").join("config.local.json")
    } else {
        current_dir.join("config.local.json")
    }
}

fn resolve_config_path() -> PathBuf {
    config_path_candidates()
        .into_iter()
        .find(|path| path.exists())
        .unwrap_or_else(default_config_path)
}

pub fn load_config() -> Result<AppConfig, String> {
    let path = resolve_config_path();
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(AppConfig::default()),
        Err(error) => {
            return Err(format!("读取配置文件失败 ({}): {}", path.display(), error));
        }
    };

    serde_json::from_str(&text)
        .map_err(|error| format!("配置文件解析失败 ({}): {}", path.display(), error))
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = resolve_config_path();
    let content = serde_json::to_string_pretty(config)
        .map_err(|error| format!("配置序列化失败: {}", error))?;

    fs::write(&path, content)
        .map_err(|error| format!("写入配置文件失败 ({}): {}", path.display(), error))
}
