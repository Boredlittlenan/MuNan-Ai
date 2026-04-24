use crate::config::{load_config, save_config, AppConfig};

#[tauri::command]
pub fn load_app_config() -> Result<AppConfig, String> {
    load_config()
}

#[tauri::command]
pub fn save_app_config(config: AppConfig) -> Result<(), String> {
    save_config(&config)
}
