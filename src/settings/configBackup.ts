import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import { type AppConfig, normalizeAppConfig } from "../modelConfig";

export const exportAppConfigBackup = (config: AppConfig): Promise<string> => {
  return invoke<string>("export_app_config", { config });
};

export const exportAppConfigToWebDav = (config: AppConfig): Promise<void> => {
  return invoke("export_app_config_to_webdav", { config });
};

export const importAppConfigFromWebDav = (config: AppConfig): Promise<AppConfig> => {
  return invoke<AppConfig>("import_app_config_from_webdav", { config });
};

export const revealConfigBackup = (path: string): Promise<void> => {
  return revealItemInDir(path);
};

export const readConfigBackup = async (file: File): Promise<AppConfig> => {
  const text = await file.text();
  const parsed = JSON.parse(text) as Partial<AppConfig> & { webdav?: unknown };
  delete parsed.webdav;

  return normalizeAppConfig(parsed);
};
