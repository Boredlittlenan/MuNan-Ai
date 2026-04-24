pub mod ai;
pub mod commands;
pub mod config;
pub mod speech;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::history::ChatState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::chat::chat_with_ai,
            commands::config::load_app_config,
            commands::config::save_app_config,
            commands::history::save_chat_history,
            commands::history::load_chat_history,
            speech::asr::transcribe_audio,
            speech::tts::synthesize_speech,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
