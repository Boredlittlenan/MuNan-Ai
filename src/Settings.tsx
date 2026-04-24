import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import {
  IoArrowBack,
  IoCheckmarkCircle,
  IoInformationCircleOutline,
  IoRefresh,
  IoSave,
} from "react-icons/io5";

import "./styles/base.css";
import "./styles/Settings.css";

import {
  type AppConfig,
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
  const [customModelName, setCustomModelName] = useState("");

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

  /**
   * 当用户怀疑表单和磁盘内容不一致时，可以重新从后端拉取。
   */
  const reloadSettings = async () => {
    setLoading(true);
    setError("");
    setMessage("");

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
          {message}
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
                <input
                  id="api-key"
                  className="settings-input"
                  type="password"
                  value={selectedConfig.api_key}
                  placeholder="请输入该模型对应的 API Key"
                  onChange={(event) => updateSelectedModelField("api_key", event.target.value)}
                />
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
                    <h3>语音识别模型</h3>
                  </div>

                  <label htmlFor="asr-provider">识别服务</label>
                  <select
                    id="asr-provider"
                    className="settings-input"
                    value={config.speech.asr.provider}
                    onChange={(event) =>
                      updateSpeechField("asr", "provider", event.target.value)
                    }
                  >
                    <option value="openai_like">OpenAI-like / MIMO</option>
                    <option value="tencent">腾讯云语音识别</option>
                  </select>

                  <label htmlFor="asr-base-url">Base URL</label>
                  <input
                    id="asr-base-url"
                    className="settings-input"
                    type="text"
                    value={config.speech.asr.base_url}
                    placeholder={
                      config.speech.asr.provider === "tencent"
                        ? "默认 https://asr.tencentcloudapi.com"
                        : "例如 https://api.example.com/v1/audio/transcriptions"
                    }
                    onChange={(event) => updateSpeechField("asr", "base_url", event.target.value)}
                  />

                  {config.speech.asr.provider === "tencent" ? (
                    <>
                      <label htmlFor="asr-app-id">腾讯云 AppId</label>
                      <input
                        id="asr-app-id"
                        className="settings-input"
                        type="text"
                        value={config.speech.asr.app_id}
                        placeholder="请输入腾讯云 AppId"
                        onChange={(event) =>
                          updateSpeechField("asr", "app_id", event.target.value)
                        }
                      />

                      <label htmlFor="asr-secret-id">SecretId</label>
                      <input
                        id="asr-secret-id"
                        className="settings-input"
                        type="password"
                        value={config.speech.asr.secret_id}
                        placeholder="请输入腾讯云 SecretId"
                        onChange={(event) =>
                          updateSpeechField("asr", "secret_id", event.target.value)
                        }
                      />

                      <label htmlFor="asr-secret-key">SecretKey</label>
                      <input
                        id="asr-secret-key"
                        className="settings-input"
                        type="password"
                        value={config.speech.asr.secret_key}
                        placeholder="请输入腾讯云 SecretKey"
                        onChange={(event) =>
                          updateSpeechField("asr", "secret_key", event.target.value)
                        }
                      />

                      <label htmlFor="asr-region">地域</label>
                      <input
                        id="asr-region"
                        className="settings-input"
                        type="text"
                        value={config.speech.asr.region}
                        placeholder="ap-shanghai"
                        onChange={(event) =>
                          updateSpeechField("asr", "region", event.target.value)
                        }
                      />
                    </>
                  ) : (
                    <>
                      <label htmlFor="asr-api-key">API Key</label>
                      <input
                        id="asr-api-key"
                        className="settings-input"
                        type="password"
                        value={config.speech.asr.api_key}
                        placeholder="请输入 ASR 服务 API Key"
                        onChange={(event) =>
                          updateSpeechField("asr", "api_key", event.target.value)
                        }
                      />
                    </>
                  )}

                  <label htmlFor="asr-model">
                    {config.speech.asr.provider === "tencent" ? "识别引擎类型" : "模型名称"}
                  </label>
                  <input
                    id="asr-model"
                    className="settings-input"
                    type="text"
                    value={
                      config.speech.asr.provider === "tencent"
                        ? config.speech.asr.tencent_engine_type
                        : config.speech.asr.model
                    }
                    placeholder={
                      config.speech.asr.provider === "tencent"
                        ? "默认 16k_zh_en，对应 EngSerViceType"
                        : "例如 whisper-1 / paraformer-realtime"
                    }
                    onChange={(event) =>
                      updateSpeechField(
                        "asr",
                        config.speech.asr.provider === "tencent"
                          ? "tencent_engine_type"
                          : "model",
                        event.target.value
                      )
                    }
                  />
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
                  <input
                    id="tts-api-key"
                    className="settings-input"
                    type="password"
                    value={config.speech.tts.api_key}
                    placeholder="请输入 TTS 服务 API Key"
                    onChange={(event) => updateSpeechField("tts", "api_key", event.target.value)}
                  />

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
        </main>
      </div>
    </div>
  );
}

export default Settings;
