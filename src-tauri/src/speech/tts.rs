use crate::speech::types::{SynthesizeSpeechRequest, SynthesizeSpeechResponse};
use serde_json::{json, Value};
use tauri::AppHandle;

#[tauri::command]
pub async fn synthesize_speech(
    app: AppHandle,
    request: SynthesizeSpeechRequest,
) -> Result<SynthesizeSpeechResponse, String> {
    let cfg = crate::config::load_config(&app)?.speech.tts;
    let model = cfg.model.trim();
    let is_voice_design = model.to_ascii_lowercase().contains("voicedesign");
    let format = request
        .format
        .unwrap_or_else(|| "wav".to_string())
        .trim()
        .to_ascii_lowercase();
    let voice_description = request
        .voice_description
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            let trimmed = cfg.voice_description.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        });

    if cfg.base_url.trim().is_empty() || cfg.api_key.trim().is_empty() || model.is_empty() {
        return Err("TTS 配置不完整，请先在设置页填写 Base URL、API Key 和模型名称。".into());
    }

    if request.text.trim().is_empty() {
        return Err("朗读文本不能为空。".into());
    }

    if is_voice_design && voice_description.is_none() {
        return Err("mimo-v2.5-tts-voicedesign 需要先在设置页填写音色描述。".into());
    }

    let mut audio = json!({
        "format": format,
    });

    let requested_voice = request.voice.as_deref().unwrap_or_default().trim();
    let configured_voice = cfg.voice.trim();
    let voice = if requested_voice.is_empty() {
        configured_voice
    } else {
        requested_voice
    };

    if !is_voice_design && !voice.is_empty() {
        audio["voice"] = json!(voice);
    }

    let body = json!({
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": voice_description.unwrap_or_default(),
            },
            {
                "role": "assistant",
                "content": request.text,
            }
        ],
        "audio": audio,
    });

    let client = reqwest::Client::new();
    let res = client
        .post(cfg.base_url.trim())
        .header("Content-Type", "application/json")
        .header("api-key", cfg.api_key.trim())
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("TTS 请求失败: {}", error))?;

    let status = res.status();
    let text = res
        .text()
        .await
        .map_err(|error| format!("读取 TTS 响应失败: {}", error))?;

    if !status.is_success() {
        return Err(format!(
            "TTS 调用失败\nHTTP 状态: {}\n响应内容: {}",
            status, text
        ));
    }

    let json: Value = serde_json::from_str(&text)
        .map_err(|error| format!("TTS 响应 JSON 解析失败: {}\n原始响应: {}", error, text))?;

    let audio_base64 = json
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("audio"))
        .and_then(|audio| audio.get("data"))
        .and_then(|data| data.as_str())
        .ok_or_else(|| format!("TTS 响应中没有找到 audio.data\n原始响应: {}", text))?
        .to_string();

    let mime_type = match format.as_str() {
        "mp3" => "audio/mpeg",
        "pcm16" => "audio/pcm",
        _ => "audio/wav",
    }
    .to_string();

    Ok(SynthesizeSpeechResponse {
        audio_base64,
        mime_type,
    })
}
