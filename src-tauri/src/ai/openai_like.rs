use crate::ai::types::ChatMessage;
use serde_json::json;

/// 调用 mimo OpenAI、豆包或千问 API
pub async fn chat_api(
    url: &str,
    api_key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    // 构造请求体
    let body = json!({
        "model": model,
        "messages": messages,
    });

    // 创建 HTTP 客户端
    let client = reqwest::Client::new();

    // 发送 POST 请求
    let res = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key)) // ✅ 关键改动
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP 请求失败: {}", e))?;

    let status = res.status();
    let text = res
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "API 调用失败\nHTTP 状态: {}\n响应内容: {}",
            status, text
        ));
    }

    // 安全解析 JSON
    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("JSON 解析失败: {}\n原始响应: {}", e, text))?;

    let message = json
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|m| m.get("message"))
        .ok_or_else(|| format!("响应中没有找到 message\n原始响应: {}", text))?;
    let content = extract_message_content(message);

    Ok(content)
}

fn extract_message_content(message: &serde_json::Value) -> String {
    let Some(content) = message.get("content") else {
        return String::new();
    };

    if let Some(text) = content.as_str() {
        return text.to_string();
    }

    let Some(parts) = content.as_array() else {
        return String::new();
    };

    parts
        .iter()
        .filter_map(|part| {
            let part_type = part
                .get("type")
                .and_then(|item| item.as_str())
                .unwrap_or_default();

            match part_type {
                "text" | "output_text" => part
                    .get("text")
                    .and_then(|item| item.as_str())
                    .map(str::to_string),
                "image_url" => part
                    .get("image_url")
                    .and_then(|item| {
                        item.get("url")
                            .and_then(|url| url.as_str())
                            .or_else(|| item.as_str())
                    })
                    .map(|url| format!("![AI 图片]({})", url)),
                _ => None,
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}
