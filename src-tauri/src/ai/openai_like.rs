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

    let content = json.get("choices")
        .and_then(|c| c.get(0))
        .and_then(|m| m.get("message"))
        .and_then(|msg| msg.get("content"))
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();

    Ok(content)
}
