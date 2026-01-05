use crate::ai::types::ChatMessage;
use serde_json::json;

/// 调用 OpenAI、豆包或千问 API 进行调试聊天
/// 
/// # 参数
/// - `url`: API 的 URL 地址
/// - `api_key`: API 的密钥
/// - `model`: 使用的模型名称
/// - `messages`: 聊天消息的历史记录
/// 
/// # 返回
/// 成功时返回聊天响应内容，失败时返回错误信息
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
        .header("api-key", api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP 请求失败: {}", e))?;

    // 获取 HTTP 响应状态码
    let status = res.status();

    // 读取响应内容
    let text = res
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    // 如果状态码不是成功状态，返回错误信息
    if !status.is_success()  {
        return Err(format!(
            "API 调用失败\nHTTP 状态: {}\n响应内容: {}",
            status, text
        ));
    }

    // 尝试解析 JSON 响应
    let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
        format!("JSON 解析失败: {}\n原始响应: {}", e, text)
    })?;

    // 提取聊天响应内容
    Ok(json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string())
}
