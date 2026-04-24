use crate::config::AsrConfig;
use crate::speech::types::{TranscribeAudioRequest, TranscribeAudioResponse};
use base64::prelude::*;
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

const TENCENT_ASR_ENDPOINT: &str = "https://asr.tencentcloudapi.com";
const TENCENT_ASR_SERVICE: &str = "asr";
const TENCENT_ASR_ACTION: &str = "SentenceRecognition";
const TENCENT_ASR_VERSION: &str = "2019-06-14";
const TENCENT_CONTENT_TYPE: &str = "application/json; charset=utf-8";

#[tauri::command]
pub async fn transcribe_audio(
    request: TranscribeAudioRequest,
) -> Result<TranscribeAudioResponse, String> {
    let cfg = crate::config::load_config()?.speech.asr;

    match cfg.provider.trim() {
        "tencent" => transcribe_with_tencent(&cfg, request).await,
        _ => transcribe_with_openai_like(&cfg, request).await,
    }
}

async fn transcribe_with_openai_like(
    cfg: &AsrConfig,
    request: TranscribeAudioRequest,
) -> Result<TranscribeAudioResponse, String> {
    let base_url = cfg.base_url.trim();
    let api_key = cfg.api_key.trim();
    let model = cfg.model.trim();
    let mime_type = request.mime_type.trim();
    let audio_base64 = request.audio_base64.trim();

    if base_url.is_empty() || api_key.is_empty() || model.is_empty() {
        return Err("ASR 配置不完整，请先在设置页填写 Base URL、API Key 和模型名称。".into());
    }

    if audio_base64.is_empty() {
        return Err("录音数据为空。".into());
    }

    if mime_type.is_empty() {
        return Err("录音 MIME 类型为空。".into());
    }

    let audio_data = if audio_base64.starts_with("data:") {
        audio_base64.to_string()
    } else {
        format!("data:{};base64,{}", mime_type, audio_base64)
    };
    let language_hint = request
        .language
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("原语言");
    let prompt = format!(
        "请将这段音频转写成{}文本。只输出转写结果，不要解释，不要总结，不要添加标点以外的额外内容。",
        language_hint
    );
    let body = json!({
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": audio_data,
                        },
                    },
                    {
                        "type": "text",
                        "text": prompt,
                    },
                ],
            },
        ],
        "max_completion_tokens": 1024,
    });

    let client = reqwest::Client::new();
    let res = client
        .post(base_url)
        .header("Content-Type", "application/json")
        .header("api-key", api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("ASR 请求失败: {}", error))?;

    let status = res.status();
    let text = res
        .text()
        .await
        .map_err(|error| format!("读取 ASR 响应失败: {}", error))?;

    if !status.is_success() {
        return Err(format!(
            "ASR 调用失败\nHTTP 状态: {}\n响应内容: {}",
            status, text
        ));
    }

    let json: Value = serde_json::from_str(&text)
        .map_err(|error| format!("ASR 响应 JSON 解析失败: {}\n原始响应: {}", error, text))?;
    let message = json
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .ok_or_else(|| format!("ASR 响应中没有找到 message\n原始响应: {}", text))?;
    let transcript = message
        .get("content")
        .and_then(|content| content.as_str())
        .filter(|content| !content.trim().is_empty())
        .or_else(|| {
            message
                .get("reasoning_content")
                .and_then(|content| content.as_str())
                .filter(|content| !content.trim().is_empty())
        })
        .ok_or_else(|| format!("ASR 响应中没有找到转写文本\n原始响应: {}", text))?
        .trim()
        .to_string();

    Ok(TranscribeAudioResponse { text: transcript })
}

async fn transcribe_with_tencent(
    cfg: &AsrConfig,
    request: TranscribeAudioRequest,
) -> Result<TranscribeAudioResponse, String> {
    let app_id = cfg.app_id.trim();
    let secret_id = cfg.secret_id.trim();
    let secret_key = cfg.secret_key.trim();
    let engine_type = cfg.tencent_engine_type.trim();
    let engine_type = if engine_type.is_empty() {
        cfg.model.trim()
    } else {
        engine_type
    };
    let region = cfg.region.trim();
    let audio_base64 = strip_data_url(request.audio_base64.trim());

    if app_id.is_empty() || secret_id.is_empty() || secret_key.is_empty() || engine_type.is_empty()
    {
        return Err(
            "腾讯云 ASR 配置不完整，请填写 AppId、SecretId、SecretKey 和识别引擎类型。".into(),
        );
    }

    if audio_base64.is_empty() {
        return Err("录音数据为空。".into());
    }

    let audio_bytes = BASE64_STANDARD
        .decode(audio_base64)
        .map_err(|error| format!("录音 Base64 解码失败: {}", error))?;
    let voice_format = voice_format_from_mime(&request.mime_type);
    let endpoint = if cfg.base_url.trim().is_empty() {
        TENCENT_ASR_ENDPOINT
    } else {
        cfg.base_url.trim()
    };
    let url = reqwest::Url::parse(endpoint)
        .map_err(|error| format!("腾讯云 ASR Endpoint 格式错误: {}", error))?;
    let host = url
        .host_str()
        .ok_or_else(|| "腾讯云 ASR Endpoint 缺少 Host。".to_string())?
        .to_string();
    let canonical_uri = if url.path().is_empty() {
        "/".to_string()
    } else {
        url.path().to_string()
    };
    let canonical_querystring = url.query().unwrap_or("").to_string();
    let timestamp = Utc::now().timestamp();
    let date = Utc::now().format("%Y-%m-%d").to_string();
    let body = json!({
        "ProjectId": 0,
        "SubServiceType": 2,
        "EngSerViceType": engine_type,
        "SourceType": 1,
        "VoiceFormat": voice_format,
        "UsrAudioKey": format!("{}-{}", app_id, timestamp),
        "Data": audio_base64,
        "DataLen": audio_bytes.len() as u64,
    });
    let payload = serde_json::to_string(&body)
        .map_err(|error| format!("腾讯云 ASR 请求序列化失败: {}", error))?;
    let authorization = tencent_authorization(
        secret_id,
        secret_key,
        &host,
        &canonical_uri,
        &canonical_querystring,
        &payload,
        timestamp,
        &date,
    )?;

    let client = reqwest::Client::new();
    let mut request_builder = client
        .post(url)
        .header("Authorization", authorization)
        .header("Content-Type", TENCENT_CONTENT_TYPE)
        .header("Host", host)
        .header("X-TC-Action", TENCENT_ASR_ACTION)
        .header("X-TC-Timestamp", timestamp.to_string())
        .header("X-TC-Version", TENCENT_ASR_VERSION);

    if !region.is_empty() {
        request_builder = request_builder.header("X-TC-Region", region);
    }

    let res = request_builder
        .body(payload)
        .send()
        .await
        .map_err(|error| format!("腾讯云 ASR 请求失败: {}", error))?;
    let status = res.status();
    let text = res
        .text()
        .await
        .map_err(|error| format!("读取腾讯云 ASR 响应失败: {}", error))?;

    if !status.is_success() {
        return Err(format!(
            "腾讯云 ASR 调用失败\nHTTP 状态: {}\n响应内容: {}",
            status, text
        ));
    }

    parse_tencent_transcript(&text).map(|text| TranscribeAudioResponse { text })
}

fn strip_data_url(audio_base64: &str) -> &str {
    audio_base64
        .split_once(',')
        .map(|(_, data)| data.trim())
        .unwrap_or(audio_base64)
}

fn voice_format_from_mime(mime_type: &str) -> &'static str {
    if mime_type.contains("mp3") || mime_type.contains("mpeg") {
        "mp3"
    } else if mime_type.contains("m4a") {
        "m4a"
    } else if mime_type.contains("pcm") {
        "pcm"
    } else {
        "wav"
    }
}

fn tencent_authorization(
    secret_id: &str,
    secret_key: &str,
    host: &str,
    canonical_uri: &str,
    canonical_querystring: &str,
    payload: &str,
    timestamp: i64,
    date: &str,
) -> Result<String, String> {
    let http_request_method = "POST";
    let canonical_headers = format!("content-type:{}\nhost:{}\n", TENCENT_CONTENT_TYPE, host);
    let signed_headers = "content-type;host";
    let hashed_request_payload = sha256_hex(payload.as_bytes());
    let canonical_request = format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        http_request_method,
        canonical_uri,
        canonical_querystring,
        canonical_headers,
        signed_headers,
        hashed_request_payload
    );
    let credential_scope = format!("{}/{}/tc3_request", date, TENCENT_ASR_SERVICE);
    let string_to_sign = format!(
        "TC3-HMAC-SHA256\n{}\n{}\n{}",
        timestamp,
        credential_scope,
        sha256_hex(canonical_request.as_bytes())
    );
    let secret_date = hmac_sha256(format!("TC3{}", secret_key).as_bytes(), date.as_bytes())?;
    let secret_service = hmac_sha256(&secret_date, TENCENT_ASR_SERVICE.as_bytes())?;
    let secret_signing = hmac_sha256(&secret_service, b"tc3_request")?;
    let signature = hex::encode(hmac_sha256(&secret_signing, string_to_sign.as_bytes())?);

    Ok(format!(
        "TC3-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        secret_id, credential_scope, signed_headers, signature
    ))
}

fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    let mut mac = HmacSha256::new_from_slice(key)
        .map_err(|error| format!("腾讯云签名初始化失败: {}", error))?;
    mac.update(data);
    Ok(mac.finalize().into_bytes().to_vec())
}

fn parse_tencent_transcript(text: &str) -> Result<String, String> {
    let json: Value = serde_json::from_str(text).map_err(|error| {
        format!(
            "腾讯云 ASR 响应 JSON 解析失败: {}\n原始响应: {}",
            error, text
        )
    })?;
    let response = json
        .get("Response")
        .ok_or_else(|| format!("腾讯云 ASR 响应中没有 Response\n原始响应: {}", text))?;

    if let Some(error) = response.get("Error") {
        let code = error
            .get("Code")
            .and_then(Value::as_str)
            .unwrap_or("UnknownError");
        let message = error
            .get("Message")
            .and_then(Value::as_str)
            .unwrap_or("腾讯云未返回错误详情");
        return Err(format!("腾讯云 ASR 调用失败: {} - {}", code, message));
    }

    response
        .get("Result")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("腾讯云 ASR 响应中没有找到识别文本\n原始响应: {}", text))
}
