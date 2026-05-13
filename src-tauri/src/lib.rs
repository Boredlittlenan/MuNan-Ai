pub mod ai;
pub mod commands;
pub mod config;
pub mod speech;
pub mod storage;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_SHOW_MAIN_ID: &str = "tray-show-main";
const TRAY_OPEN_SETTINGS_ID: &str = "tray-open-settings";
const TRAY_EXIT_ID: &str = "tray-exit";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::agent::agent_fetch_url_text,
            commands::agent::agent_plan_shell_action,
            commands::agent::agent_plan_scheduled_tasks,
            commands::agent::agent_plan_tavily_search,
            commands::agent::agent_run_shell,
            commands::agent::agent_tavily_search,
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

fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show_main = MenuItem::with_id(app, TRAY_SHOW_MAIN_ID, "显示主界面", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, TRAY_OPEN_SETTINGS_ID, "设置", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, TRAY_EXIT_ID, "退出", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show_main, &settings, &separator, &exit])?;

    let mut tray = TrayIconBuilder::with_id("munan-ai-tray")
        .menu(&menu)
        .tooltip("MuNan AI")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_SHOW_MAIN_ID => show_main_window(app, "/"),
            TRAY_OPEN_SETTINGS_ID => show_main_window(app, "/settings"),
            TRAY_EXIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                show_main_window(tray.app_handle(), "/");
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>, route: &str) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.eval(format!(
            "window.history.pushState(null, '', '{route}'); window.dispatchEvent(new PopStateEvent('popstate'));"
        ));
    }
}
