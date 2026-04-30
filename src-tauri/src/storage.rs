use crate::config::app_data_dir;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct StoredMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub tts_text: Option<String>,
    #[serde(default)]
    pub original_content: Option<String>,
    #[serde(default)]
    pub attachments: Vec<StoredAttachment>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct StoredAttachment {
    pub id: String,
    pub r#type: String,
    pub name: String,
    pub mime_type: String,
    pub data_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct StoredConversation {
    pub id: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub provider_model: String,
    pub name: String,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
    #[serde(default)]
    pub messages: Vec<StoredMessage>,
}

#[tauri::command]
pub fn load_conversations(
    app: AppHandle,
) -> Result<HashMap<String, Vec<StoredConversation>>, String> {
    let conn = open_conversation_db(&app)?;
    let mut grouped: HashMap<String, Vec<StoredConversation>> = HashMap::new();
    let mut stmt = conn
        .prepare(
            "SELECT id, model, provider_model, name, created_at, updated_at
             FROM conversations
             ORDER BY updated_at DESC, created_at DESC",
        )
        .map_err(|error| format!("读取会话列表失败: {}", error))?;
    let conversations = stmt
        .query_map([], |row| {
            Ok(StoredConversation {
                id: row.get(0)?,
                model: row.get(1)?,
                provider_model: row.get(2)?,
                name: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                messages: Vec::new(),
            })
        })
        .map_err(|error| format!("查询会话列表失败: {}", error))?;

    for conversation in conversations {
        let mut conversation =
            conversation.map_err(|error| format!("解析会话列表失败: {}", error))?;
        conversation.messages = load_messages(&conn, &conversation.id)?;
        grouped
            .entry(conversation.model.clone())
            .or_default()
            .push(conversation);
    }

    Ok(grouped)
}

#[tauri::command]
pub fn save_conversations(
    app: AppHandle,
    conversations: HashMap<String, Vec<StoredConversation>>,
) -> Result<(), String> {
    let mut conn = open_conversation_db(&app)?;
    let tx = conn
        .transaction()
        .map_err(|error| format!("打开会话保存事务失败: {}", error))?;

    tx.execute("DELETE FROM messages", [])
        .map_err(|error| format!("清理旧消息失败: {}", error))?;
    tx.execute("DELETE FROM conversations", [])
        .map_err(|error| format!("清理旧会话失败: {}", error))?;

    let now = chrono::Utc::now().timestamp_millis();

    for (model, items) in conversations {
        for conversation in items {
            if conversation.id.trim().is_empty() {
                continue;
            }

            let created_at = if conversation.created_at > 0 {
                conversation.created_at
            } else {
                now
            };
            let updated_at = if conversation.updated_at > 0 {
                conversation.updated_at
            } else {
                created_at
            };
            let conversation_model = if conversation.model.trim().is_empty() {
                model.as_str()
            } else {
                conversation.model.as_str()
            };

            tx.execute(
                "INSERT INTO conversations
                 (id, model, provider_model, name, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    conversation.id,
                    conversation_model,
                    conversation.provider_model,
                    conversation.name,
                    created_at,
                    updated_at
                ],
            )
            .map_err(|error| format!("保存会话失败: {}", error))?;

            for (index, message) in conversation.messages.into_iter().enumerate() {
                if message.role != "user" && message.role != "ai" {
                    continue;
                }

                tx.execute(
                    "INSERT INTO messages
                     (conversation_id, message_index, role, content, tts_text, original_content, attachments)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        conversation.id,
                        index as i64,
                        message.role,
                        message.content,
                        message.tts_text,
                        message.original_content,
                        serialize_attachments(&message.attachments)?
                    ],
                )
                .map_err(|error| format!("保存会话消息失败: {}", error))?;
            }
        }
    }

    tx.commit()
        .map_err(|error| format!("提交会话保存事务失败: {}", error))
}

fn open_conversation_db(app: &AppHandle) -> Result<Connection, String> {
    let db_path = app_data_dir(app)?.join("conversations.sqlite");
    let conn = Connection::open(&db_path)
        .map_err(|error| format!("打开会话数据库失败 ({}): {}", db_path.display(), error))?;
    init_conversation_db(&conn)?;
    Ok(conn)
}

fn init_conversation_db(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            model TEXT NOT NULL,
            provider_model TEXT NOT NULL DEFAULT '',
            name TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            conversation_id TEXT NOT NULL,
            message_index INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            tts_text TEXT,
            original_content TEXT,
            attachments TEXT NOT NULL DEFAULT '[]',
            PRIMARY KEY (conversation_id, message_index),
            FOREIGN KEY (conversation_id)
                REFERENCES conversations(id)
                ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_conversations_model_updated
            ON conversations(model, updated_at DESC);
        ",
    )
    .map_err(|error| format!("初始化会话数据库失败: {}", error))?;
    ensure_messages_attachments_column(conn)
}

fn load_messages(conn: &Connection, conversation_id: &str) -> Result<Vec<StoredMessage>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT role, content, tts_text, original_content, attachments
             FROM messages
             WHERE conversation_id = ?1
             ORDER BY message_index ASC",
        )
        .map_err(|error| format!("读取会话消息失败: {}", error))?;
    let rows = stmt
        .query_map(params![conversation_id], |row| {
            Ok(StoredMessage {
                role: row.get(0)?,
                content: row.get(1)?,
                tts_text: row.get(2)?,
                original_content: row.get(3)?,
                attachments: deserialize_attachments(row.get::<_, String>(4)?.as_str()),
            })
        })
        .map_err(|error| format!("查询会话消息失败: {}", error))?;
    let mut messages = Vec::new();

    for row in rows {
        messages.push(row.map_err(|error| format!("解析会话消息失败: {}", error))?);
    }

    Ok(messages)
}

fn ensure_messages_attachments_column(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(messages)")
        .map_err(|error| format!("检查消息表结构失败: {}", error))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("读取消息表结构失败: {}", error))?;

    for column in columns {
        if column.map_err(|error| format!("解析消息表结构失败: {}", error))? == "attachments"
        {
            return Ok(());
        }
    }

    conn.execute(
        "ALTER TABLE messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'",
        [],
    )
    .map_err(|error| format!("升级消息表结构失败: {}", error))?;

    Ok(())
}

fn serialize_attachments(attachments: &[StoredAttachment]) -> Result<String, String> {
    serde_json::to_string(attachments).map_err(|error| format!("序列化消息附件失败: {}", error))
}

fn deserialize_attachments(value: &str) -> Vec<StoredAttachment> {
    serde_json::from_str::<Vec<StoredAttachment>>(value)
        .or_else(|_| {
            serde_json::from_str::<Value>(value).map(|value| {
                value
                    .as_array()
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|item| serde_json::from_value(item.clone()).ok())
                            .collect()
                    })
                    .unwrap_or_default()
            })
        })
        .unwrap_or_default()
}
