import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import {
  IoArrowBack,
  IoCheckmarkCircle,
  IoCloudUploadOutline,
  IoDownloadOutline,
  IoEyeOffOutline,
  IoEyeOutline,
  IoInformationCircleOutline,
  IoRefresh,
  IoSave,
  IoServerOutline,
} from "react-icons/io5";

import "./styles/base.css";
import "./styles/Settings.css";

import {
  exportAppConfigBackup,
  exportAppConfigToWebDav,
  importAppConfigFromWebDav,
  readConfigBackup,
  revealConfigBackup,
} from "./settings/configBackup";
import {
  type AppConfig,
  type AsrProvider,
  type ModelType,
  MODEL_CATALOG,
  MODEL_META,
  MODEL_OPTIONS,
  createEmptyAppConfig,
  isModelConfigured,
  loadPreferredModel,
  normalizeAppConfig,
  savePreferredModel,
} from "./modelConfig";

const TENCENT_ASR_ENGINE_OPTIONS = [
  { value: "16k_zh-PY", label: "16k_zh-PY（中英粤）" },
  { value: "16k_zh", label: "16k_zh（中文普通话）" },
  { value: "16k_en", label: "16k_en（英语）" },
  { value: "16k_yue", label: "16k_yue（粤语）" },
  { value: "8k_zh", label: "8k_zh（电话中文）" },
  { value: "8k_en", label: "8k_en（电话英语）" },
];

/* =========================
   页面职责说明
   1. 从 Rust 后端读取 config.json，并映射到表单。
   2. 支持切换不同模型进行配置，这是本页最核心的交互。
   3. 保存配置到后端，同时记录聊天页默认使用的模型。
   ========================= */

function Settings() {
  const navigate = useNavigate();

  /**
   * selectedModel 表示“当前正在编辑哪个模型”。
   * 这是设置页模型选择体验的核心，切换后右侧表单会立刻同步到对应配置。
   */
  const [selectedModel, setSelectedModel] = useState<ModelType>(loadPreferredModel);

  /**
   * preferredModel 表示“聊天页默认优先打开哪个模型”。
   * 这样设置页除了编辑配置，也能决定用户下次进入应用时的默认工作模型。
   */
  const [preferredModel, setPreferredModel] = useState<ModelType>(loadPreferredModel);

  /**
   * config 保存整份应用配置，右侧表单只是其中一个模型的映射视图。
   */
  const [config, setConfig] = useState<AppConfig>(createEmptyAppConfig);

  /**
   * 页面状态：加载、保存和消息反馈拆开管理，方便精确展示。
   */
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [exportedConfigPath, setExportedConfigPath] = useState("");
  const [transferDialog, setTransferDialog] = useState<"export" | "import" | null>(null);
  const [webDavDialogOpen, setWebDavDialogOpen] = useState(false);
  const [visiblePasswordFields, setVisiblePasswordFields] = useState<string[]>([]);
  const [customModelName, setCustomModelName] = useState("");
  const importInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * 当前右侧表单绑定的模型配置。
   * 用 useMemo 保持写法简洁，也能让 JSX 更聚焦于布局本身。
   */
  const selectedConfig = useMemo(() => config[selectedModel], [config, selectedModel]);
  const selectedModelChoices = useMemo(() => {
    const builtInModels = MODEL_CATALOG[selectedModel] ?? [];
    const customModels = config.custom_models[selectedModel] ?? [];

    return Array.from(new Set([...builtInModels, ...customModels, selectedConfig.model].filter(Boolean)));
  }, [config.custom_models, selectedConfig.model, selectedModel]);

  /**
   * 页面加载时从后端读取最新配置。
   * 设置页每次进入都重新拉一次，避免用户改了 config.json 后界面仍显示旧数据。
   */
  useEffect(() => {
    const loadConfig = async () => {
      setLoading(true);
      setError("");

      try {
        const nextConfig = await invoke<AppConfig>("load_app_config");
        setConfig(normalizeAppConfig(nextConfig));
      } catch (loadError) {
        setError(`配置读取失败：${String(loadError)}`);
      } finally {
        setLoading(false);
      }
    };

    void loadConfig();
  }, []);

  /**
   * 统一处理当前模型表单字段的写入。
   * 这样模型切换再频繁，也不会因为闭包拿错值而更新到别的模型上。
   */
  const updateSelectedModelField = (
    field: "base_url" | "api_key" | "model",
    value: string
  ) => {
    setConfig((previous) => ({
      ...previous,
      [selectedModel]: {
        ...previous[selectedModel],
        [field]: value,
      },
    }));
  };

  const updateSpeechField = (
    section: "asr" | "tts",
    field:
      | "provider"
      | "base_url"
      | "api_key"
      | "model"
      | "tencent_engine_type"
      | "voice"
      | "voice_description"
      | "app_id"
      | "secret_id"
      | "secret_key"
      | "region",
    value: string
  ) => {
    setConfig((previous) => ({
      ...previous,
      speech: {
        ...previous.speech,
        [section]: {
          ...previous.speech[section],
          [field]: value,
        },
      },
    }));
  };

  const updatePersonaPrompt = (prompt: string) => {
    setConfig((previous) => ({
      ...previous,
      persona: {
        ...previous.persona,
        prompt,
      },
    }));
  };

  const updateWebDavField = (
    field: "url" | "username" | "password" | "path",
    value: string
  ) => {
    setConfig((previous) => ({
      ...previous,
      webdav: {
        ...previous.webdav,
        [field]: value,
      },
    }));
  };

  const isPasswordVisible = (field: string) => visiblePasswordFields.includes(field);

  const togglePasswordVisibility = (field: string) => {
    setVisiblePasswordFields((current) =>
      current.includes(field)
        ? current.filter((item) => item !== field)
        : [...current, field]
    );
  };

  const passwordInputType = (field: string) =>
    isPasswordVisible(field) ? "text" : "password";

  const switchAsrProvider = (provider: AsrProvider) => {
    setConfig((previous) => ({
      ...previous,
      speech: {
        ...previous.speech,
        asr: {
          ...previous.speech.asr,
          provider,
          tencent_engine_type:
            previous.speech.asr.tencent_engine_type.trim() || "16k_zh-PY",
          region: previous.speech.asr.region.trim() || "ap-shanghai",
        },
      },
    }));
  };

  /**
   * 把当前选中模型的字段一键清空。
   * 仅影响当前卡片，不会误删其他模型配置。
   */
  const clearSelectedModel = () => {
    setConfig((previous) => ({
      ...previous,
      [selectedModel]: {
        base_url: "",
        api_key: "",
        model: "",
      },
    }));
    setExportedConfigPath("");
    setMessage(`${MODEL_META[selectedModel].label} 配置已清空，保存后才会写入文件。`);
  };

  const addCustomModel = () => {
    const nextModelName = customModelName.trim();

    if (!nextModelName) {
      setError("请输入要添加的模型名称。");
      return;
    }

    setConfig((previous) => {
      const previousCustomModels = previous.custom_models[selectedModel] ?? [];
      const nextCustomModels = Array.from(new Set([...previousCustomModels, nextModelName]));

      return {
        ...previous,
        [selectedModel]: {
          ...previous[selectedModel],
          model: nextModelName,
        },
        custom_models: {
          ...previous.custom_models,
          [selectedModel]: nextCustomModels,
        },
      };
    });

    setCustomModelName("");
    setError("");
    setExportedConfigPath("");
    setMessage(`${MODEL_META[selectedModel].label} 已添加自定义模型，保存后写入配置文件。`);
  };

  /**
   * 保存时把整份配置一次性提交给后端。
   * 这样模型间切换编辑后，不需要分别点很多次“单独保存”。
   */
  const saveSettings = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    setExportedConfigPath("");

    try {
      await invoke("save_app_config", { config });
      savePreferredModel(preferredModel);
      setMessage("配置已保存，聊天页会自动使用最新设置。");
    } catch (saveError) {
      setError(`配置保存失败：${String(saveError)}`);
    } finally {
      setSaving(false);
    }
  };

  const exportSettingsToLocal = async () => {
    try {
      const exportPath = await exportAppConfigBackup(config);
      setExportedConfigPath(exportPath);
      setError("");
      setMessage("配置已导出为 JSON 备份文件。");
      setTransferDialog(null);
    } catch (exportError) {
      setExportedConfigPath("");
      setMessage("");
      setError(`配置导出失败：${String(exportError)}`);
    }
  };

  const exportSettingsToWebDav = async () => {
    try {
      await exportAppConfigToWebDav(config);
      setExportedConfigPath("");
      setError("");
      setMessage("配置已导出到 WebDAV。");
      setTransferDialog(null);
    } catch (exportError) {
      setExportedConfigPath("");
      setMessage("");
      setError(`WebDAV 导出失败：${String(exportError)}`);
    }
  };

  const openExportedConfigDir = async () => {
    if (!exportedConfigPath) {
      return;
    }

    try {
      await revealConfigBackup(exportedConfigPath);
    } catch (openError) {
      setError(`打开导出目录失败：${String(openError)}`);
    }
  };

  const requestImportSettings = () => {
    setTransferDialog(null);
    importInputRef.current?.click();
  };

  const importSettings = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    try {
      const importedConfig = await readConfigBackup(file);
      setConfig((previous) => ({
        ...importedConfig,
        webdav: previous.webdav,
      }));
      setExportedConfigPath("");
      setError("");
      setMessage("配置已导入到表单。确认无误后点击“保存设置”写入配置文件。");
    } catch (importError) {
      setMessage("");
      setError(`配置导入失败：${String(importError)}`);
    } finally {
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
    }
  };

  const importSettingsFromWebDav = async () => {
    try {
      const importedConfig = normalizeAppConfig(await importAppConfigFromWebDav(config));
      setConfig((previous) => ({
        ...importedConfig,
        webdav: previous.webdav,
      }));
      setExportedConfigPath("");
      setError("");
      setMessage("已从 WebDAV 导入配置到表单。确认无误后点击“保存设置”写入配置文件。");
      setTransferDialog(null);
    } catch (importError) {
      setMessage("");
      setError(`WebDAV 导入失败：${String(importError)}`);
    }
  };

  /**
   * 当用户怀疑表单和磁盘内容不一致时，可以重新从后端拉取。
   */
  const reloadSettings = async () => {
    setLoading(true);
    setError("");
    setMessage("");
    setExportedConfigPath("");

    try {
      const latestConfig = await invoke<AppConfig>("load_app_config");
      setConfig(normalizeAppConfig(latestConfig));
      setMessage("已重新加载磁盘中的配置。");
    } catch (reloadError) {
      setError(`重新加载失败：${String(reloadError)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-shell settings-page">
      {/* 顶部栏负责导航、状态反馈和保存动作，保证桌面端操作路径足够清晰。 */}
      <header className="page-header settings-header">
        <div className="settings-header__intro">
          <button type="button" className="ghost-button back-button" onClick={() => navigate("/")}>
            <IoArrowBack size={18} />
            返回聊天
          </button>

          <div>
            <p className="page-eyebrow">Model Settings</p>
            <h1 className="page-title">模型配置中心</h1>
            <p className="page-description">
              左侧选模型，右侧改配置。保存后聊天页会直接读取这份后端配置。
            </p>
          </div>
        </div>

        <div className="settings-header__actions">
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="settings-file-input"
            onChange={(event) => void importSettings(event.target.files?.[0])}
          />

          <button type="button" className="ghost-button" onClick={() => setWebDavDialogOpen(true)}>
            <IoServerOutline size={18} />
            WebDAV 配置
          </button>

          <button type="button" className="ghost-button" onClick={() => setTransferDialog("export")}>
            <IoDownloadOutline size={18} />
            导出设置
          </button>

          <button type="button" className="ghost-button" onClick={() => setTransferDialog("import")}>
            <IoCloudUploadOutline size={18} />
            导入设置
          </button>

          <button type="button" className="ghost-button" onClick={() => void reloadSettings()}>
            <IoRefresh size={18} />
            重新加载
          </button>

          <button type="button" className="primary-button" onClick={() => void saveSettings()}>
            <IoSave size={18} />
            {saving ? "保存中..." : "保存设置"}
          </button>
        </div>
      </header>

      {/* 全局反馈统一放在正文前，避免用户保存后找不到结果提示。 */}
      {error && <div className="alert-banner alert-banner--error">{error}</div>}
      {message && (
        <div className="alert-banner alert-banner--success">
          <IoCheckmarkCircle size={18} />
          <span>{message}</span>
          {exportedConfigPath && (
            <button
              type="button"
              className="alert-action-button"
              onClick={() => void openExportedConfigDir()}
            >
              打开文件所在目录
            </button>
          )}
        </div>
      )}

      <div className="settings-layout">
        {/* 左栏用于模型选择和总体概览，是本次重点优化的交互区域。 */}
        <aside className="settings-sidebar glass-panel">
          <div className="section-heading">
            <div>
              <p className="section-kicker">模型导航</p>
              <h2>选择要编辑的模型</h2>
            </div>
            <span className="section-badge">{MODEL_OPTIONS.length} 个模型</span>
          </div>

          <div className="settings-model-list">
            {MODEL_OPTIONS.map((option) => {
              const ready = isModelConfigured(config, option.id);

              return (
                <button
                  key={option.id}
                  type="button"
                  className={`settings-model-card ${
                    selectedModel === option.id ? "is-active" : ""
                  }`}
                  onClick={() => {
                    setSelectedModel(option.id);
                    setMessage("");
                    setError("");
                  }}
                >
                  <div>
                    <span className="settings-model-card__title">{MODEL_META[option.id].label}</span>
                    <span className="settings-model-card__meta">{MODEL_META[option.id].provider}</span>
                  </div>

                  <span className={`status-chip ${ready ? "is-ready" : "is-warning"}`}>
                    {ready ? "已配置" : "待完善"}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="settings-summary-card">
            <p className="section-kicker">默认模型</p>
            <h3>聊天页默认打开</h3>
            <select
              className="settings-select"
              value={preferredModel}
              onChange={(event) => setPreferredModel(event.target.value as ModelType)}
            >
              {MODEL_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {MODEL_META[option.id].label} · {MODEL_META[option.id].provider}
                </option>
              ))}
            </select>
            <p className="settings-help-text">
              这个设置会写入本地状态，下次回到聊天页时会优先切到这里。
            </p>
          </div>
        </aside>

        {/* 右侧表单区专门编辑当前模型，避免全部模型挤在同一页难以维护。 */}
        <main className="settings-main glass-panel">
          <div className="settings-main__header">
            <div>
              <p className="section-kicker">当前编辑</p>
              <h2>{MODEL_META[selectedModel].label}</h2>
              <p className="settings-main__subtitle">{MODEL_META[selectedModel].description}</p>
            </div>

            <div className="settings-main__actions">
              <button type="button" className="ghost-button danger-button" onClick={clearSelectedModel}>
                清空当前模型
              </button>
            </div>
          </div>

          {loading ? (
            <div className="empty-card settings-loading-card">
              <p>正在读取配置文件...</p>
              <span>稍等一下，表单会自动填充现有配置。</span>
            </div>
          ) : (
            <div className="settings-form">
              <div className="settings-field">
                <label htmlFor="base-url">Base URL</label>
                <input
                  id="base-url"
                  className="settings-input"
                  type="text"
                  value={selectedConfig.base_url}
                  placeholder={MODEL_META[selectedModel].baseUrlPlaceholder}
                  onChange={(event) => updateSelectedModelField("base_url", event.target.value)}
                />
                <p className="settings-help-text">
                  这里填写完整接口地址。若是 OpenAI 兼容接口，通常以
                  <code>/chat/completions</code> 结尾。
                </p>
              </div>

              <div className="settings-field">
                <label htmlFor="api-key">API Key</label>
                <div className="password-input-row">
                  <input
                    id="api-key"
                    className="settings-input"
                    type={passwordInputType("model-api-key")}
                    value={selectedConfig.api_key}
                    placeholder="请输入该模型对应的 API Key"
                    onChange={(event) => updateSelectedModelField("api_key", event.target.value)}
                  />
                  <button
                    type="button"
                    className="password-toggle-button"
                    onClick={() => togglePasswordVisibility("model-api-key")}
                    aria-label={isPasswordVisible("model-api-key") ? "隐藏 API Key" : "显示 API Key"}
                    title={isPasswordVisible("model-api-key") ? "隐藏" : "显示"}
                  >
                    {isPasswordVisible("model-api-key") ? (
                      <IoEyeOffOutline size={17} />
                    ) : (
                      <IoEyeOutline size={17} />
                    )}
                  </button>
                </div>
                <p className="settings-help-text">
                  已改为密码输入框，避免在桌面环境里直接把密钥裸露在页面上。
                </p>
              </div>

              <div className="settings-field">
                <label htmlFor="model-name">模型名称</label>
                <select
                  id="model-name"
                  className="settings-input"
                  value={selectedConfig.model}
                  onChange={(event) => updateSelectedModelField("model", event.target.value)}
                >
                  <option value="">请选择模型</option>
                  {selectedModelChoices.map((modelName) => (
                    <option key={modelName} value={modelName}>
                      {modelName}
                    </option>
                  ))}
                </select>

                <div className="custom-model-row">
                  <input
                    className="settings-input"
                    type="text"
                    value={customModelName}
                    placeholder="输入自定义模型 ID，例如 vendor/model-name"
                    onChange={(event) => setCustomModelName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addCustomModel();
                      }
                    }}
                  />
                  <button type="button" className="ghost-button" onClick={addCustomModel}>
                    添加模型
                  </button>
                </div>
                <p className="settings-help-text">
                  这里填供应商要求的模型 ID，例如 <code>gpt-4o-mini</code> 或
                  <code>deepseek-chat</code>。
                </p>
              </div>

              <div className="settings-checklist">
                <div className={`check-item ${selectedConfig.base_url.trim() ? "is-done" : ""}`}>
                  1. 已填写请求地址
                </div>
                <div className={`check-item ${selectedConfig.api_key.trim() ? "is-done" : ""}`}>
                  2. 已填写 API Key
                </div>
                <div className={`check-item ${selectedConfig.model.trim() ? "is-done" : ""}`}>
                  3. 已填写模型名称
                </div>
              </div>
            </div>
          )}
          {!loading && (
            <section className="speech-settings-panel">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Voice Models</p>
                  <h2>ASR / TTS 配置</h2>
                </div>
              </div>

              <div className="speech-settings-grid">
                <div className="settings-field speech-settings-card">
                  <div>
                    <p className="section-kicker">ASR</p>
                    <h3>语音识别</h3>
                  </div>

                  <label htmlFor="asr-provider-current">识别服务</label>
                  <select
                    id="asr-provider-current"
                    className="settings-input"
                    value={config.speech.asr.provider}
                    onChange={(event) => switchAsrProvider(event.target.value as AsrProvider)}
                  >
                    <option value="openai_like">OpenAI-like / MIMO</option>
                    <option value="tencent">腾讯云语音识别</option>
                  </select>

                  {config.speech.asr.provider === "tencent" ? (
                    <>
                      <p className="settings-help-text">
                        腾讯云模式固定调用 https://asr.tencentcloudapi.com，不使用 OpenAI-like 的 Base URL、API Key 和模型名称。
                      </p>

                      <label htmlFor="asr-app-id-current">腾讯云 AppId</label>
                      <input
                        id="asr-app-id-current"
                        className="settings-input"
                        type="text"
                        value={config.speech.asr.app_id}
                        placeholder="请输入腾讯云 AppId"
                        onChange={(event) =>
                          updateSpeechField("asr", "app_id", event.target.value)
                        }
                      />

                      <label htmlFor="asr-secret-id-current">SecretId</label>
                      <div className="password-input-row">
                        <input
                          id="asr-secret-id-current"
                          className="settings-input"
                          type={passwordInputType("asr-secret-id")}
                          value={config.speech.asr.secret_id}
                          placeholder="请输入腾讯云 SecretId"
                          onChange={(event) =>
                            updateSpeechField("asr", "secret_id", event.target.value)
                          }
                        />
                        <button
                          type="button"
                          className="password-toggle-button"
                          onClick={() => togglePasswordVisibility("asr-secret-id")}
                          aria-label={isPasswordVisible("asr-secret-id") ? "隐藏 SecretId" : "显示 SecretId"}
                          title={isPasswordVisible("asr-secret-id") ? "隐藏" : "显示"}
                        >
                          {isPasswordVisible("asr-secret-id") ? (
                            <IoEyeOffOutline size={17} />
                          ) : (
                            <IoEyeOutline size={17} />
                          )}
                        </button>
                      </div>

                      <label htmlFor="asr-secret-key-current">SecretKey</label>
                      <div className="password-input-row">
                        <input
                          id="asr-secret-key-current"
                          className="settings-input"
                          type={passwordInputType("asr-secret-key")}
                          value={config.speech.asr.secret_key}
                          placeholder="请输入腾讯云 SecretKey"
                          onChange={(event) =>
                            updateSpeechField("asr", "secret_key", event.target.value)
                          }
                        />
                        <button
                          type="button"
                          className="password-toggle-button"
                          onClick={() => togglePasswordVisibility("asr-secret-key")}
                          aria-label={isPasswordVisible("asr-secret-key") ? "隐藏 SecretKey" : "显示 SecretKey"}
                          title={isPasswordVisible("asr-secret-key") ? "隐藏" : "显示"}
                        >
                          {isPasswordVisible("asr-secret-key") ? (
                            <IoEyeOffOutline size={17} />
                          ) : (
                            <IoEyeOutline size={17} />
                          )}
                        </button>
                      </div>

                      <label htmlFor="asr-region-current">地域</label>
                      <input
                        id="asr-region-current"
                        className="settings-input"
                        type="text"
                        value={config.speech.asr.region}
                        placeholder="ap-shanghai"
                        onChange={(event) =>
                          updateSpeechField("asr", "region", event.target.value)
                        }
                      />

                      <label htmlFor="asr-engine-type-current">识别引擎类型</label>
                      <select
                        id="asr-engine-type-current"
                        className="settings-input"
                        value={config.speech.asr.tencent_engine_type}
                        onChange={(event) =>
                          updateSpeechField(
                            "asr",
                            "tencent_engine_type",
                            event.target.value
                          )
                        }
                      >
                        {TENCENT_ASR_ENGINE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <>
                      <label htmlFor="asr-base-url-current">Base URL</label>
                      <input
                        id="asr-base-url-current"
                        className="settings-input"
                        type="text"
                        value={config.speech.asr.base_url}
                        placeholder="例如 https://api.example.com/v1/audio/transcriptions"
                        onChange={(event) =>
                          updateSpeechField("asr", "base_url", event.target.value)
                        }
                      />

                      <label htmlFor="asr-api-key-current">API Key</label>
                      <div className="password-input-row">
                        <input
                          id="asr-api-key-current"
                          className="settings-input"
                          type={passwordInputType("asr-api-key")}
                          value={config.speech.asr.api_key}
                          placeholder="请输入 ASR 服务 API Key"
                          onChange={(event) =>
                            updateSpeechField("asr", "api_key", event.target.value)
                          }
                        />
                        <button
                          type="button"
                          className="password-toggle-button"
                          onClick={() => togglePasswordVisibility("asr-api-key")}
                          aria-label={isPasswordVisible("asr-api-key") ? "隐藏 ASR API Key" : "显示 ASR API Key"}
                          title={isPasswordVisible("asr-api-key") ? "隐藏" : "显示"}
                        >
                          {isPasswordVisible("asr-api-key") ? (
                            <IoEyeOffOutline size={17} />
                          ) : (
                            <IoEyeOutline size={17} />
                          )}
                        </button>
                      </div>

                      <label htmlFor="asr-model-current">模型名称</label>
                      <input
                        id="asr-model-current"
                        className="settings-input"
                        type="text"
                        value={config.speech.asr.model}
                        placeholder="例如 mimo-v2.5 / whisper-1 / paraformer-realtime"
                        onChange={(event) =>
                          updateSpeechField("asr", "model", event.target.value)
                        }
                      />
                    </>
                  )}
                </div>

                <div className="settings-field speech-settings-card">
                  <div>
                    <p className="section-kicker">TTS</p>
                    <h3>语音合成模型</h3>
                  </div>

                  <label htmlFor="tts-base-url">Base URL</label>
                  <input
                    id="tts-base-url"
                    className="settings-input"
                    type="text"
                    value={config.speech.tts.base_url}
                    placeholder="例如 https://api.xiaomimimo.com/v1/chat/completions"
                    onChange={(event) => updateSpeechField("tts", "base_url", event.target.value)}
                  />

                  <label htmlFor="tts-api-key">API Key</label>
                  <div className="password-input-row">
                    <input
                      id="tts-api-key"
                      className="settings-input"
                      type={passwordInputType("tts-api-key")}
                      value={config.speech.tts.api_key}
                      placeholder="请输入 TTS 服务 API Key"
                      onChange={(event) => updateSpeechField("tts", "api_key", event.target.value)}
                    />
                    <button
                      type="button"
                      className="password-toggle-button"
                      onClick={() => togglePasswordVisibility("tts-api-key")}
                      aria-label={isPasswordVisible("tts-api-key") ? "隐藏 TTS API Key" : "显示 TTS API Key"}
                      title={isPasswordVisible("tts-api-key") ? "隐藏" : "显示"}
                    >
                      {isPasswordVisible("tts-api-key") ? (
                        <IoEyeOffOutline size={17} />
                      ) : (
                        <IoEyeOutline size={17} />
                      )}
                    </button>
                  </div>

                  <label htmlFor="tts-model">模型名称</label>
                  <input
                    id="tts-model"
                    className="settings-input"
                    type="text"
                    value={config.speech.tts.model}
                    placeholder="例如 mimo-v2.5-tts-voicedesign"
                    onChange={(event) => updateSpeechField("tts", "model", event.target.value)}
                  />

                  <label htmlFor="tts-voice">Voice</label>
                  <input
                    id="tts-voice"
                    className="settings-input"
                    type="text"
                    value={config.speech.tts.voice}
                    placeholder="例如 alloy / longxiaochun"
                    onChange={(event) => updateSpeechField("tts", "voice", event.target.value)}
                  />

                  <div className="settings-label-row">
                    <label htmlFor="tts-voice-description">音色描述</label>
                    <span
                      className="settings-info-icon"
                      title="mimo-v2.5-tts-voicedesign 需要在这里手动描述想要的音色，例如：温柔清澈的年轻女声，语速稍慢，语气自然亲切。"
                      aria-label="音色描述提示"
                    >
                      <IoInformationCircleOutline size={16} />
                    </span>
                  </div>
                  <textarea
                    id="tts-voice-description"
                    className="settings-input settings-textarea"
                    value={config.speech.tts.voice_description}
                    placeholder="例如：温柔清澈的年轻女声，语速稍慢，语气自然亲切"
                    onChange={(event) =>
                      updateSpeechField("tts", "voice_description", event.target.value)
                    }
                  />
                </div>
              </div>
            </section>
          )}

          {!loading && (
            <section className="persona-settings-panel">
              <div className="settings-field">
                <div>
                  <p className="section-kicker">Persona</p>
                  <h3>AI 人设</h3>
                </div>

                <label htmlFor="persona-prompt">后台人设提示词</label>
                <textarea
                  id="persona-prompt"
                  className="settings-input settings-textarea persona-textarea"
                  value={config.persona.prompt}
                  placeholder="例如：你是一个温和、清晰、可靠的桌面 AI 助手，回答直接、有条理。"
                  onChange={(event) => updatePersonaPrompt(event.target.value)}
                />
                <p className="settings-help-text">
                  这段内容会作为 system message 注入每次聊天请求。语气、身份、回答边界都可以在这里手动调整。
                </p>
              </div>
            </section>
          )}
        </main>
      </div>

      {transferDialog && (
        <div className="settings-modal-backdrop" role="presentation">
          <div className="settings-modal" role="dialog" aria-modal="true">
            <div>
              <p className="section-kicker">
                {transferDialog === "export" ? "Export" : "Import"}
              </p>
              <h2>{transferDialog === "export" ? "选择导出位置" : "选择导入来源"}</h2>
              <p className="settings-help-text">
                备份内容不会包含 WebDAV 配置，避免同步凭据被写进备份文件。
              </p>
            </div>

            <div className="settings-modal-actions">
              {transferDialog === "export" ? (
                <>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void exportSettingsToLocal()}
                  >
                    本地 Downloads
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void exportSettingsToWebDav()}
                  >
                    WebDAV
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="ghost-button" onClick={requestImportSettings}>
                    本地 JSON
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void importSettingsFromWebDav()}
                  >
                    WebDAV
                  </button>
                </>
              )}
            </div>

            <div className="settings-modal-footer">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setTransferDialog(null)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {webDavDialogOpen && (
        <div className="settings-modal-backdrop" role="presentation">
          <div className="settings-modal settings-modal--wide" role="dialog" aria-modal="true">
            <div>
              <p className="section-kicker">WebDAV</p>
              <h2>WebDAV 配置</h2>
              <p className="settings-help-text">
                WebDAV 配置只保存在本机配置中，不会出现在导入/导出的备份内容里。
              </p>
            </div>

            <div className="settings-modal-form">
              <label htmlFor="webdav-url">WebDAV 地址</label>
              <input
                id="webdav-url"
                className="settings-input"
                type="text"
                value={config.webdav.url}
                placeholder="例如 https://example.com/dav/backups"
                onChange={(event) => updateWebDavField("url", event.target.value)}
              />

              <label htmlFor="webdav-path">备份文件路径</label>
              <input
                id="webdav-path"
                className="settings-input"
                type="text"
                value={config.webdav.path}
                placeholder="munan-ai-settings.json"
                onChange={(event) => updateWebDavField("path", event.target.value)}
              />

              <label htmlFor="webdav-username">用户名</label>
              <input
                id="webdav-username"
                className="settings-input"
                type="text"
                value={config.webdav.username}
                placeholder="WebDAV 用户名，可留空"
                onChange={(event) => updateWebDavField("username", event.target.value)}
              />

              <label htmlFor="webdav-password">密码</label>
              <div className="password-input-row">
                <input
                  id="webdav-password"
                  className="settings-input"
                  type={passwordInputType("webdav-password")}
                  value={config.webdav.password}
                  placeholder="WebDAV 密码或应用专用密码"
                  onChange={(event) => updateWebDavField("password", event.target.value)}
                />
                <button
                  type="button"
                  className="password-toggle-button"
                  onClick={() => togglePasswordVisibility("webdav-password")}
                  aria-label={isPasswordVisible("webdav-password") ? "隐藏 WebDAV 密码" : "显示 WebDAV 密码"}
                  title={isPasswordVisible("webdav-password") ? "隐藏" : "显示"}
                >
                  {isPasswordVisible("webdav-password") ? (
                    <IoEyeOffOutline size={17} />
                  ) : (
                    <IoEyeOutline size={17} />
                  )}
                </button>
              </div>
            </div>

            <div className="settings-modal-footer">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setWebDavDialogOpen(false)}
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Settings;
