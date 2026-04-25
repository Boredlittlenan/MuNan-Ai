use crate::config::{load_config, save_config, AppConfig};
use chrono::Local;
use reqwest::Method;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

const DEFAULT_WEBDAV_BACKUP_PATH: &str = "munan-ai-settings.json";

#[tauri::command]
pub fn load_app_config() -> Result<AppConfig, String> {
    load_config()
}

#[tauri::command]
pub fn save_app_config(config: AppConfig) -> Result<(), String> {
    save_config(&config)
}

#[tauri::command]
pub fn export_app_config(config: AppConfig) -> Result<String, String> {
    let export_dir = downloads_dir()?;
    fs::create_dir_all(&export_dir)
        .map_err(|error| format!("创建导出目录失败 ({}): {}", export_dir.display(), error))?;

    let timestamp = Local::now().format("%Y%m%d-%H%M%S");
    let export_path = export_dir.join(format!("munan-ai-settings-{}.json", timestamp));
    let content = backup_config_json(&config)?;

    fs::write(&export_path, content)
        .map_err(|error| format!("导出配置失败 ({}): {}", export_path.display(), error))?;

    Ok(export_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn export_app_config_to_webdav(config: AppConfig) -> Result<(), String> {
    let webdav = config.webdav.clone();
    let url = webdav_target_url(&webdav.url, &webdav.path)?;
    let content = backup_config_json(&config)?;
    let client = reqwest::Client::new();
    let mut request = client
        .request(Method::PUT, url)
        .header("Content-Type", "application/json;charset=utf-8")
        .body(content);

    if !webdav.username.trim().is_empty() {
        request = request.basic_auth(webdav.username.trim(), Some(webdav.password.as_str()));
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("WebDAV 导出请求失败: {}", error))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!(
            "WebDAV 导出失败\nHTTP 状态: {}\n响应内容: {}",
            status, text
        ));
    }

    Ok(())
}

#[tauri::command]
pub async fn import_app_config_from_webdav(config: AppConfig) -> Result<AppConfig, String> {
    let webdav = config.webdav.clone();
    let url = webdav_target_url(&webdav.url, &webdav.path)?;
    let client = reqwest::Client::new();
    let mut request = client.request(Method::GET, url);

    if !webdav.username.trim().is_empty() {
        request = request.basic_auth(webdav.username.trim(), Some(webdav.password.as_str()));
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("WebDAV 导入请求失败: {}", error))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取 WebDAV 响应失败: {}", error))?;

    if !status.is_success() {
        return Err(format!(
            "WebDAV 导入失败\nHTTP 状态: {}\n响应内容: {}",
            status, text
        ));
    }

    let mut imported: AppConfig = serde_json::from_str(&text)
        .map_err(|error| format!("WebDAV 配置 JSON 解析失败: {}", error))?;
    imported.webdav = webdav;

    Ok(imported)
}

fn backup_config_json(config: &AppConfig) -> Result<String, String> {
    let mut value =
        serde_json::to_value(config).map_err(|error| format!("配置序列化失败: {}", error))?;

    if let Value::Object(ref mut object) = value {
        object.remove("webdav");
    }

    serde_json::to_string_pretty(&value).map_err(|error| format!("配置序列化失败: {}", error))
}

fn webdav_target_url(base_url: &str, path: &str) -> Result<String, String> {
    let base = base_url.trim();
    let target_path = path.trim();

    if base.is_empty() {
        return Err("请先填写 WebDAV 地址。".into());
    }

    let target_path = if target_path.is_empty() {
        DEFAULT_WEBDAV_BACKUP_PATH
    } else {
        target_path
    };

    let mut url =
        reqwest::Url::parse(base).map_err(|error| format!("WebDAV 地址格式错误: {}", error))?;
    let mut segments: Vec<String> = url
        .path_segments()
        .map(|items| {
            items
                .filter(|item| !item.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    segments.extend(
        target_path
            .split('/')
            .filter(|item| !item.trim().is_empty())
            .map(|item| item.trim().to_string()),
    );
    url.set_path(&segments.join("/"));

    Ok(url.to_string())
}

fn downloads_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| "无法定位用户目录，导出配置失败。".to_string())?;

    Ok(home.join("Downloads"))
}
