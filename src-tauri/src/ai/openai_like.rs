use crate::ai::types::ChatMessage;
use serde_json::json;

pub async fn chat_mimo_debug(
    url: &str,
    api_key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    let body = json!({
        "model": model,
        "messages": messages,
    });

    let client = reqwest::Client::new();
    let res = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("api-key", api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP 请求失败: {}", e))?;

    let status = res.status();
    let text = res
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    // 🔥 核心：直接把原始返回打出来
    if !status.is_success() {
        return Err(format!(
            "MIMO API 调用失败\nHTTP 状态: {}\n响应内容: {}",
            status, text
        ));
    }

    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| {
            format!("JSON 解析失败: {}\n原始响应: {}", e, text)
        })?;

    Ok(json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string())
}
