pub mod ai;
pub mod commands;
pub mod config;
pub mod speech;
pub mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::agent::agent_fetch_url_text,
            commands::agent::agent_plan_shell_action,
            commands::agent::agent_run_shell,
            commands::agent::preview_agent_capabilities,
            commands::chat::chat_with_ai,
            commands::config::export_app_config,
            commands::config::export_app_config_to_webdav,
            commands::config::import_app_config_from_webdav,
            commands::config::load_app_config,
            commands::config::save_app_config,
            storage::load_conversations,
            storage::load_token_usage_stats,
            storage::save_conversations,
            speech::asr::transcribe_audio,
            speech::tts::synthesize_speech,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
