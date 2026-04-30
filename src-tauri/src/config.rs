use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const CONFIG_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ModelConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    #[serde(default)]
    pub is_multimodal: bool,
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
    pub is_multimodal: bool,
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
    #[serde(default)]
    pub username: String,
    #[serde(default = "default_persona_prompt")]
    pub prompt: String,
}

impl Default for PersonaConfig {
    fn default() -> Self {
        Self {
            username: String::new(),
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UsageConfig {
    #[serde(default = "default_usage_retention_days")]
    pub detail_retention_days: i64,
}

impl Default for UsageConfig {
    fn default() -> Self {
        Self {
            detail_retention_days: default_usage_retention_days(),
        }
    }
}

fn default_usage_retention_days() -> i64 {
    0
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub browser_enabled: bool,
    #[serde(default)]
    pub system_enabled: bool,
    #[serde(default)]
    pub shell_enabled: bool,
    #[serde(default = "default_agent_require_confirmation")]
    pub require_confirmation: bool,
    #[serde(default = "default_agent_max_steps")]
    pub max_steps: u32,
    #[serde(default = "default_agent_enabled_skills")]
    pub enabled_skills: Vec<String>,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            browser_enabled: false,
            system_enabled: false,
            shell_enabled: false,
            require_confirmation: default_agent_require_confirmation(),
            max_steps: default_agent_max_steps(),
            enabled_skills: default_agent_enabled_skills(),
        }
    }
}

fn default_agent_require_confirmation() -> bool {
    true
}

fn default_agent_max_steps() -> u32 {
    8
}

fn default_agent_enabled_skills() -> Vec<String> {
    vec![
        "browser.open".into(),
        "browser.extract_text".into(),
        "system.open_path".into(),
        "system.copy_text".into(),
        "system.shell".into(),
    ]
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub openai: ModelConfig,
    #[serde(default)]
    pub deepseek: ModelConfig,
    #[serde(default)]
    pub qwen: ModelConfig,
    #[serde(default)]
    pub mimo: ModelConfig,
    #[serde(default = "default_nvidia_config")]
    pub nvidia: ModelConfig,
    #[serde(default)]
    pub speech: SpeechConfig,
    #[serde(default)]
    pub persona: PersonaConfig,
    #[serde(default)]
    pub webdav: WebDavConfig,
    #[serde(default)]
    pub usage: UsageConfig,
    #[serde(default)]
    pub agent: AgentConfig,
    #[serde(default)]
    pub custom_models: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub custom_providers: Vec<CustomProviderConfig>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: CONFIG_SCHEMA_VERSION,
            openai: ModelConfig::default(),
            deepseek: ModelConfig::default(),
            qwen: ModelConfig::default(),
            mimo: ModelConfig::default(),
            nvidia: default_nvidia_config(),
            speech: SpeechConfig::default(),
            persona: PersonaConfig::default(),
            webdav: WebDavConfig::default(),
            usage: UsageConfig::default(),
            agent: AgentConfig::default(),
            custom_models: HashMap::new(),
            custom_providers: Vec::new(),
        }
    }
}

fn default_schema_version() -> u32 {
    CONFIG_SCHEMA_VERSION
}

fn default_nvidia_config() -> ModelConfig {
    ModelConfig {
        base_url: "https://integrate.api.nvidia.com/v1/chat/completions".into(),
        api_key: String::new(),
        model: String::new(),
        is_multimodal: false,
    }
}

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .or_else(|_| app.path().app_config_dir())
        .map_err(|error| format!("无法定位应用数据目录: {}", error))?;

    fs::create_dir_all(&dir)
        .map_err(|error| format!("创建应用数据目录失败 ({}): {}", dir.display(), error))?;

    Ok(dir)
}

fn config_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("config.json"))
}

fn legacy_config_path_candidates() -> Vec<PathBuf> {
    let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    vec![
        current_dir.join("config.local.json"),
        current_dir.join("src-tauri").join("config.local.json"),
        current_dir.join("config.json"),
        current_dir.join("src-tauri").join("config.json"),
    ]
}

pub fn load_config(app: &AppHandle) -> Result<AppConfig, String> {
    let path = config_file_path(app)?;
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return load_legacy_config(app, &path);
        }
        Err(error) => {
            return Err(format!("读取配置文件失败 ({}): {}", path.display(), error));
        }
    };

    serde_json::from_str(&text)
        .map_err(|error| format!("配置文件解析失败 ({}): {}", path.display(), error))
}

fn load_legacy_config(app: &AppHandle, target_path: &Path) -> Result<AppConfig, String> {
    let Some(legacy_path) = legacy_config_path_candidates()
        .into_iter()
        .find(|path| path.exists())
    else {
        return Ok(AppConfig::default());
    };

    let text = fs::read_to_string(&legacy_path)
        .map_err(|error| format!("读取旧配置文件失败 ({}): {}", legacy_path.display(), error))?;
    let config: AppConfig = serde_json::from_str(&text)
        .map_err(|error| format!("旧配置文件解析失败 ({}): {}", legacy_path.display(), error))?;

    save_config(app, &config)?;
    if !target_path.exists() {
        return Err(format!(
            "旧配置迁移失败，目标配置未生成: {}",
            target_path.display()
        ));
    }

    Ok(config)
}

pub fn save_config(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_file_path(app)?;
    let content = serde_json::to_string_pretty(config)
        .map_err(|error| format!("配置序列化失败: {}", error))?;

    if path.exists() {
        let backup_path = path.with_extension("json.bak");
        let _ = fs::copy(&path, backup_path);
    }

    fs::write(&path, content)
        .map_err(|error| format!("写入配置文件失败 ({}): {}", path.display(), error))
}
