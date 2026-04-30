use crate::ai::types::TokenUsage;
use crate::config::app_data_dir;
use crate::config::load_config;
use chrono::{Duration, NaiveDate, Utc};
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

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TokenUsageRecord {
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub conversation_id: String,
    #[serde(default)]
    pub usage: TokenUsage,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TokenUsageTotal {
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub request_count: i64,
    pub precise_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TokenUsageModelStats {
    pub provider: String,
    pub model: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub request_count: i64,
    pub precise_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TokenUsageDailyPoint {
    pub usage_date: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub request_count: i64,
    pub precise_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TokenUsageStats {
    pub today: TokenUsageTotal,
    pub month: TokenUsageTotal,
    pub range: TokenUsageTotal,
    pub daily: Vec<TokenUsageDailyPoint>,
    pub by_model: Vec<TokenUsageModelStats>,
    pub detail_count: i64,
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
pub fn load_token_usage_stats(
    app: AppHandle,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<TokenUsageStats, String> {
    let conn = open_conversation_db(&app)?;
    load_token_usage_stats_from_conn(&conn, start_date, end_date)
}

pub fn record_token_usage(app: &AppHandle, record: TokenUsageRecord) -> Result<(), String> {
    if record.provider.trim().is_empty() || record.model.trim().is_empty() {
        return Ok(());
    }

    let mut conn = open_conversation_db(app)?;
    let tx = conn
        .transaction()
        .map_err(|error| format!("打开用量统计事务失败: {}", error))?;
    let now = Utc::now();
    let created_at = now.timestamp_millis();
    let usage_date = now.format("%Y-%m-%d").to_string();
    let is_precise = i64::from(record.usage.is_precise);

    tx.execute(
        "INSERT INTO token_usage_events
         (created_at, usage_date, provider, model, conversation_id, prompt_tokens, completion_tokens, total_tokens, is_precise)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            created_at,
            usage_date,
            record.provider,
            record.model,
            record.conversation_id,
            record.usage.prompt_tokens,
            record.usage.completion_tokens,
            record.usage.total_tokens,
            is_precise
        ],
    )
    .map_err(|error| format!("记录 token 用量失败: {}", error))?;

    tx.execute(
        "INSERT INTO token_usage_daily
         (usage_date, provider, model, prompt_tokens, completion_tokens, total_tokens, request_count, precise_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)
         ON CONFLICT(usage_date, provider, model) DO UPDATE SET
           prompt_tokens = prompt_tokens + excluded.prompt_tokens,
           completion_tokens = completion_tokens + excluded.completion_tokens,
           total_tokens = total_tokens + excluded.total_tokens,
           request_count = request_count + 1,
           precise_count = precise_count + excluded.precise_count",
        params![
            usage_date,
            record.provider,
            record.model,
            record.usage.prompt_tokens,
            record.usage.completion_tokens,
            record.usage.total_tokens,
            is_precise
        ],
    )
    .map_err(|error| format!("更新 token 日汇总失败: {}", error))?;

    tx.commit()
        .map_err(|error| format!("提交 token 用量统计失败: {}", error))?;

    let retention_days = load_config(app)
        .map(|config| config.usage.detail_retention_days)
        .unwrap_or(180);
    prune_token_usage_events(&conn, retention_days)
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
        CREATE TABLE IF NOT EXISTS token_usage_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at INTEGER NOT NULL,
            usage_date TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            conversation_id TEXT NOT NULL DEFAULT '',
            prompt_tokens INTEGER NOT NULL DEFAULT 0,
            completion_tokens INTEGER NOT NULL DEFAULT 0,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            is_precise INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_token_usage_events_created
            ON token_usage_events(created_at);
        CREATE INDEX IF NOT EXISTS idx_token_usage_events_date_model
            ON token_usage_events(usage_date, provider, model);
        CREATE TABLE IF NOT EXISTS token_usage_daily (
            usage_date TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            prompt_tokens INTEGER NOT NULL DEFAULT 0,
            completion_tokens INTEGER NOT NULL DEFAULT 0,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            request_count INTEGER NOT NULL DEFAULT 0,
            precise_count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (usage_date, provider, model)
        );
        CREATE INDEX IF NOT EXISTS idx_token_usage_daily_date
            ON token_usage_daily(usage_date);
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

fn load_token_usage_stats_from_conn(
    conn: &Connection,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<TokenUsageStats, String> {
    let now = Utc::now();
    let today = now.format("%Y-%m-%d").to_string();
    let month_prefix = now.format("%Y-%m").to_string();
    let (start_date, end_date) = normalize_usage_date_range(start_date, end_date);

    Ok(TokenUsageStats {
        today: load_token_usage_total(conn, "usage_date = ?1", [&today])?,
        month: load_token_usage_total(conn, "usage_date LIKE ?1", [format!("{}%", month_prefix)])?,
        range: load_token_usage_range_total(conn, start_date.as_deref(), end_date.as_deref())?,
        daily: load_token_usage_daily(conn, start_date.as_deref(), end_date.as_deref())?,
        by_model: load_token_usage_by_model(conn, start_date.as_deref(), end_date.as_deref())?,
        detail_count: conn
            .query_row("SELECT COUNT(*) FROM token_usage_events", [], |row| {
                row.get(0)
            })
            .map_err(|error| format!("读取 token 明细数量失败: {}", error))?,
    })
}

fn load_token_usage_total<const N: usize>(
    conn: &Connection,
    condition: &str,
    values: [impl rusqlite::ToSql; N],
) -> Result<TokenUsageTotal, String> {
    let sql = format!(
        "SELECT
           COALESCE(SUM(prompt_tokens), 0),
           COALESCE(SUM(completion_tokens), 0),
           COALESCE(SUM(total_tokens), 0),
           COALESCE(SUM(request_count), 0),
           COALESCE(SUM(precise_count), 0)
         FROM token_usage_daily
         WHERE {}",
        condition
    );
    conn.query_row(&sql, rusqlite::params_from_iter(values), |row| {
        Ok(TokenUsageTotal {
            prompt_tokens: row.get(0)?,
            completion_tokens: row.get(1)?,
            total_tokens: row.get(2)?,
            request_count: row.get(3)?,
            precise_count: row.get(4)?,
        })
    })
    .map_err(|error| format!("读取 token 汇总失败: {}", error))
}

fn load_token_usage_range_total(
    conn: &Connection,
    start_date: Option<&str>,
    end_date: Option<&str>,
) -> Result<TokenUsageTotal, String> {
    conn.query_row(
        "SELECT
           COALESCE(SUM(prompt_tokens), 0),
           COALESCE(SUM(completion_tokens), 0),
           COALESCE(SUM(total_tokens), 0),
           COALESCE(SUM(request_count), 0),
           COALESCE(SUM(precise_count), 0)
         FROM token_usage_daily
         WHERE (?1 IS NULL OR usage_date >= ?1)
           AND (?2 IS NULL OR usage_date <= ?2)",
        params![start_date, end_date],
        |row| {
            Ok(TokenUsageTotal {
                prompt_tokens: row.get(0)?,
                completion_tokens: row.get(1)?,
                total_tokens: row.get(2)?,
                request_count: row.get(3)?,
                precise_count: row.get(4)?,
            })
        },
    )
    .map_err(|error| format!("读取 token 日期范围汇总失败: {}", error))
}

fn load_token_usage_daily(
    conn: &Connection,
    start_date: Option<&str>,
    end_date: Option<&str>,
) -> Result<Vec<TokenUsageDailyPoint>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT usage_date,
                    COALESCE(SUM(prompt_tokens), 0),
                    COALESCE(SUM(completion_tokens), 0),
                    COALESCE(SUM(total_tokens), 0),
                    COALESCE(SUM(request_count), 0),
                    COALESCE(SUM(precise_count), 0)
             FROM token_usage_daily
             WHERE (?1 IS NULL OR usage_date >= ?1)
               AND (?2 IS NULL OR usage_date <= ?2)
             GROUP BY usage_date
             ORDER BY usage_date ASC",
        )
        .map_err(|error| format!("准备 token 日趋势失败: {}", error))?;
    let rows = stmt
        .query_map(params![start_date, end_date], |row| {
            Ok(TokenUsageDailyPoint {
                usage_date: row.get(0)?,
                prompt_tokens: row.get(1)?,
                completion_tokens: row.get(2)?,
                total_tokens: row.get(3)?,
                request_count: row.get(4)?,
                precise_count: row.get(5)?,
            })
        })
        .map_err(|error| format!("查询 token 日趋势失败: {}", error))?;
    let mut points = Vec::new();

    for row in rows {
        points.push(row.map_err(|error| format!("解析 token 日趋势失败: {}", error))?);
    }

    Ok(points)
}

fn load_token_usage_by_model(
    conn: &Connection,
    start_date: Option<&str>,
    end_date: Option<&str>,
) -> Result<Vec<TokenUsageModelStats>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT provider, model,
                    COALESCE(SUM(prompt_tokens), 0),
                    COALESCE(SUM(completion_tokens), 0),
                    COALESCE(SUM(total_tokens), 0),
                    COALESCE(SUM(request_count), 0),
                    COALESCE(SUM(precise_count), 0)
             FROM token_usage_daily
             WHERE (?1 IS NULL OR usage_date >= ?1)
               AND (?2 IS NULL OR usage_date <= ?2)
             GROUP BY provider, model
             ORDER BY COALESCE(SUM(total_tokens), 0) DESC, COALESCE(SUM(request_count), 0) DESC
             LIMIT 8",
        )
        .map_err(|error| format!("准备 token 模型统计失败: {}", error))?;
    let rows = stmt
        .query_map(params![start_date, end_date], |row| {
            Ok(TokenUsageModelStats {
                provider: row.get(0)?,
                model: row.get(1)?,
                prompt_tokens: row.get(2)?,
                completion_tokens: row.get(3)?,
                total_tokens: row.get(4)?,
                request_count: row.get(5)?,
                precise_count: row.get(6)?,
            })
        })
        .map_err(|error| format!("查询 token 模型统计失败: {}", error))?;
    let mut stats = Vec::new();

    for row in rows {
        stats.push(row.map_err(|error| format!("解析 token 模型统计失败: {}", error))?);
    }

    Ok(stats)
}

fn prune_token_usage_events(conn: &Connection, retention_days: i64) -> Result<(), String> {
    if retention_days <= 0 {
        return Ok(());
    }

    let retention_days = retention_days.clamp(7, 3650);
    let cutoff = (Utc::now() - Duration::days(retention_days)).timestamp_millis();

    conn.execute(
        "DELETE FROM token_usage_events WHERE created_at < ?1",
        params![cutoff],
    )
    .map_err(|error| format!("清理 token 明细失败: {}", error))?;

    Ok(())
}

fn normalize_usage_date_range(
    start_date: Option<String>,
    end_date: Option<String>,
) -> (Option<String>, Option<String>) {
    fn normalize(value: Option<String>) -> Option<String> {
        let value = value?.trim().to_string();
        if NaiveDate::parse_from_str(&value, "%Y-%m-%d").is_ok() {
            Some(value)
        } else {
            None
        }
    }

    let start = normalize(start_date);
    let end = normalize(end_date);

    match (&start, &end) {
        (Some(start), Some(end)) if start > end => (Some(end.clone()), Some(start.clone())),
        _ => (start, end),
    }
}
