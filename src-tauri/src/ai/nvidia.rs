use crate::ai::types::ChatMessage;
use crate::config::ModelConfig;
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::time::Duration;

pub async fn call_nvidia(messages: Vec<ChatMessage>, cfg: ModelConfig) -> Result<String, String> {
    let body = json!({
        "model": cfg.model,
        "messages": messages,
        "max_tokens": 16384,
        "temperature": 1.0,
        "top_p": 1.0,
        "stream": true,
        "chat_template_kwargs": {
            "thinking": true,
        },
    });

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| format!("创建 NVIDIA HTTP 客户端失败: {}", error))?;
    let response = client
        .post(normalize_chat_url(&cfg.base_url))
        .header("Authorization", format!("Bearer {}", cfg.api_key))
        .header("Accept", "text/event-stream")
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("HTTP 请求失败: {}", error))?;

    let status = response.status();
    let mut stream = response.bytes_stream();
    let mut pending = String::new();
    let mut content = String::new();
    let mut error_body = String::new();
    let mut is_done = false;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("读取 NVIDIA 流式响应失败: {}", error))?;
        let text = String::from_utf8_lossy(&chunk);

        if !status.is_success() {
            error_body.push_str(&text);
            continue;
        }

        pending.push_str(&text);

        while let Some(line_end) = pending.find('\n') {
            let line: String = pending.drain(..=line_end).collect();
            let line = line.trim();

            if line.is_empty() || !line.starts_with("data:") {
                continue;
            }

            let data = line.trim_start_matches("data:").trim();

            if data == "[DONE]" {
                is_done = true;
                break;
            }

            append_stream_content(data, &mut content)?;
        }

        if is_done {
            break;
        }
    }

    if !status.is_success() {
        return Err(format!(
            "NVIDIA API 调用失败\nHTTP 状态: {}\n响应内容: {}",
            status, error_body
        ));
    }

    if !pending.trim().is_empty() {
        for line in pending.lines() {
            let line = line.trim();

            if let Some(data) = line.strip_prefix("data:") {
                let data = data.trim();

                if data != "[DONE]" {
                    append_stream_content(data, &mut content)?;
                }
            }
        }
    }

    if content.trim().is_empty() {
        return Err("NVIDIA 返回了空内容，请检查模型名、API Key 或输入内容。".into());
    }

    Ok(content)
}

fn normalize_chat_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');

    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{}/chat/completions", trimmed)
    }
}

fn append_stream_content(data: &str, content: &mut String) -> Result<(), String> {
    let value: Value = serde_json::from_str(data)
        .map_err(|error| format!("解析 NVIDIA 流式片段失败: {}\n片段: {}", error, data))?;

    let Some(delta) = value
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("delta"))
    else {
        return Ok(());
    };

    if let Some(text) = delta
        .get("reasoning_content")
        .and_then(|item| item.as_str())
    {
        content.push_str(text);
    }

    if let Some(text) = delta.get("content").and_then(|item| item.as_str()) {
        content.push_str(text);
    }

    Ok(())
}
