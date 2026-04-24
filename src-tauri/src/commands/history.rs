use std::sync::Mutex;
use tauri::State;

#[derive(Default)]
pub struct ChatState {
    history: Mutex<Vec<Message>>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct Message {
    role: String,
    content: String,
}

#[tauri::command]
pub fn save_chat_history(state: State<ChatState>, messages: Vec<Message>) {
    let mut history = state.history.lock().unwrap();
    *history = messages;
}

#[tauri::command]
pub fn load_chat_history(state: State<ChatState>) -> Vec<Message> {
    let history = state.history.lock().unwrap();
    history.clone()
}
