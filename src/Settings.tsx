import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { IconType } from "react-icons";
import { useNavigate } from "react-router-dom";
import {
  IoArrowBack,
  IoAnalyticsOutline,
  IoCheckmarkCircle,
  IoCloudUploadOutline,
  IoCubeOutline,
  IoDownloadOutline,
  IoEyeOffOutline,
  IoEyeOutline,
  IoInformationCircleOutline,
  IoMicOutline,
  IoPersonOutline,
  IoRefresh,
  IoSave,
} from "react-icons/io5";

import "./styles/base.css";
import "./styles/Settings.css";

import { CustomSelect } from "./components/CustomSelect";
import { DatePicker } from "./components/DatePicker";
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
  createEmptyAppConfig,
  getModelChoices,
  getModelConfig,
  getModelMeta,
  getModelOptions,
  isBuiltInModel,
  loadPreferredModel,
  normalizeRetentionDays,
  normalizeAppConfig,
  savePreferredModel,
  updateModelConfig,
} from "./modelConfig";

const TENCENT_ASR_ENGINE_OPTIONS = [
  { value: "16k_zh-PY", label: "16k_zh-PY（中英粤）" },
  { value: "16k_zh", label: "16k_zh（中文普通话）" },
  { value: "16k_en", label: "16k_en（英语）" },
  { value: "16k_yue", label: "16k_yue（粤语）" },
  { value: "8k_zh", label: "8k_zh（电话中文）" },
  { value: "8k_en", label: "8k_en（电话英语）" },
];

type SettingsSection = "user" | "model" | "speech" | "usage";

type TokenUsageTotal = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  request_count: number;
  precise_count: number;
};

type TokenUsageModelStats = TokenUsageTotal & {
  provider: string;
  model: string;
};

type TokenUsageDailyPoint = TokenUsageTotal & {
  usage_date: string;
};

type TokenUsageStats = {
  today: TokenUsageTotal;
  month: TokenUsageTotal;
  range: TokenUsageTotal;
  daily: TokenUsageDailyPoint[];
  by_model: TokenUsageModelStats[];
  detail_count: number;
};

const SETTINGS_SECTIONS: Array<{
  id: SettingsSection;
  title: string;
  meta: string;
  icon: IconType;
}> = [
  { id: "user", title: "基础配置", meta: "用户、默认模型与备份同步", icon: IoPersonOutline },
  { id: "model", title: "模型配置", meta: "供应商、密钥与模型名称", icon: IoCubeOutline },
  { id: "speech", title: "ASR / TTS 配置", meta: "语音识别与语音合成", icon: IoMicOutline },
  { id: "usage", title: "用量统计", meta: "Token 消耗、趋势图与模型占比", icon: IoAnalyticsOutline },
];

/* =========================
   页面职责说明
   1. 从 Rust 后端读取 config.json，并映射到表单。
   2. 支持切换不同模型进行配置，这是本页最核心的交互。
   3. 保存配置到后端，同时记录聊天页默认使用的模型。
   ========================= */

function Settings() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<SettingsSection>("user");

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
  const [settingsAlertClosing, setSettingsAlertClosing] = useState(false);
  const [exportedConfigPath, setExportedConfigPath] = useState("");
  const [transferDialog, setTransferDialog] = useState<"export" | "import" | null>(null);
  const [customProviderDialogOpen, setCustomProviderDialogOpen] = useState(false);
  const [deleteProviderDialogOpen, setDeleteProviderDialogOpen] = useState(false);
  const [visiblePasswordFields, setVisiblePasswordFields] = useState<string[]>([]);
  const [customModelName, setCustomModelName] = useState("");
  const [customProviderName, setCustomProviderName] = useState("");
  const [tokenUsageStats, setTokenUsageStats] = useState<TokenUsageStats | null>(null);
  const [tokenUsageError, setTokenUsageError] = useState("");
  const [usageStartDate, setUsageStartDate] = useState("");
  const [usageEndDate, setUsageEndDate] = useState("");
  const importInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * 当前右侧表单绑定的模型配置。
   * 用 useMemo 保持写法简洁，也能让 JSX 更聚焦于布局本身。
   */
  const modelOptions = useMemo(() => getModelOptions(config), [config]);
  const selectedConfig = useMemo(() => getModelConfig(config, selectedModel), [config, selectedModel]);
  const selectedMeta = useMemo(() => getModelMeta(config, selectedModel), [config, selectedModel]);
  const isCustomProviderSelected = !isBuiltInModel(selectedModel);
  const selectedModelChoices = useMemo(() => {
    return getModelChoices(config, selectedModel);
  }, [config, selectedModel]);
  const usageDailyPoints = useMemo(
    () => tokenUsageStats?.daily ?? [],
    [tokenUsageStats]
  );
  const usageChartPoints = useMemo(
    () => usageDailyPoints.slice(-24),
    [usageDailyPoints]
  );

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
        await loadTokenUsageStats();
      } catch (loadError) {
        setError(`配置读取失败：${String(loadError)}`);
      } finally {
        setLoading(false);
      }
    };

    void loadConfig();
  }, []);

  const loadTokenUsageStats = async (
    startDate = usageStartDate,
    endDate = usageEndDate
  ) => {
    try {
      setTokenUsageError("");
      setTokenUsageStats(
        await invoke<TokenUsageStats>("load_token_usage_stats", {
          startDate: startDate || null,
          endDate: endDate || null,
        })
      );
    } catch (usageError) {
      setTokenUsageError(`用量统计读取失败：${String(usageError)}`);
    }
  };

  useEffect(() => {
    if (!error && !message) {
      return;
    }

    setSettingsAlertClosing(false);
    const closeTimer = window.setTimeout(() => {
      setSettingsAlertClosing(true);
    }, 5000);
    const clearTimer = window.setTimeout(() => {
      setError("");
      setMessage("");
      setExportedConfigPath("");
      setSettingsAlertClosing(false);
    }, 5240);

    return () => {
      window.clearTimeout(closeTimer);
      window.clearTimeout(clearTimer);
    };
  }, [error, message]);

  /**
   * 统一处理当前模型表单字段的写入。
   * 这样模型切换再频繁，也不会因为闭包拿错值而更新到别的模型上。
   */
  const updateSelectedModelField = (
    field: "base_url" | "api_key" | "model" | "is_multimodal",
    value: string | boolean
  ) => {
    setConfig((previous) => updateModelConfig(previous, selectedModel, { [field]: value }));
  };

  const updateCustomProviderField = (
    field: "label" | "provider",
    value: string
  ) => {
    setConfig((previous) => ({
      ...previous,
      custom_providers: previous.custom_providers.map((provider) =>
        provider.id === selectedModel ? { ...provider, [field]: value } : provider
      ),
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

  const updateUsername = (username: string) => {
    setConfig((previous) => ({
      ...previous,
      persona: {
        ...previous.persona,
        username,
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

  const updateUsageRetentionDays = (value: string) => {
    const days = value === "" ? 0 : normalizeRetentionDays(Number(value));

    setConfig((previous) => ({
      ...previous,
      usage: {
        ...previous.usage,
        detail_retention_days: days,
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
    setConfig((previous) =>
      updateModelConfig(previous, selectedModel, {
        base_url: "",
        api_key: "",
        model: "",
        is_multimodal: false,
      })
    );
    setExportedConfigPath("");
    setMessage(`${selectedMeta.label} 配置已清空，保存后才会写入文件。`);
  };

  const addCustomProvider = () => {
    setCustomProviderName("");
    setCustomProviderDialogOpen(true);
  };

  const confirmAddCustomProvider = () => {
    const trimmedLabel = customProviderName.trim();

    if (!trimmedLabel) {
      setError("请输入自定义供应商名称。");
      return;
    }

    const baseId = `custom-${trimmedLabel
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "") || Date.now()}`;
    let nextId = baseId;
    let index = 2;

    while (config.custom_providers.some((provider) => provider.id === nextId)) {
      nextId = `${baseId}-${index}`;
      index += 1;
    }

    setConfig((previous) => ({
      ...previous,
      custom_providers: [
        ...previous.custom_providers,
        {
          id: nextId,
          label: trimmedLabel,
          provider: "自定义供应商",
          base_url: "",
          api_key: "",
          model: "",
          is_multimodal: false,
          custom_models: [],
        },
      ],
    }));
    setSelectedModel(nextId);
    setCustomProviderDialogOpen(false);
    setCustomProviderName("");
    setMessage("已添加自定义供应商，填写配置后点击保存设置。");
    setError("");
  };

  const removeCustomProvider = () => {
    if (isBuiltInModel(selectedModel)) {
      return;
    }

    setDeleteProviderDialogOpen(true);
  };

  const confirmRemoveCustomProvider = () => {
    if (isBuiltInModel(selectedModel)) {
      return;
    }

    setConfig((previous) => ({
      ...previous,
      custom_providers: previous.custom_providers.filter(
        (provider) => provider.id !== selectedModel
      ),
    }));
    setSelectedModel("openai");
    if (preferredModel === selectedModel) {
      setPreferredModel("openai");
    }
    setDeleteProviderDialogOpen(false);
    setMessage("自定义供应商已删除，保存后写入配置文件。");
  };

  const addCustomModel = () => {
    const nextModelName = customModelName.trim();

    if (!nextModelName) {
      setError("请输入要添加的模型名称。");
      return;
    }

    setConfig((previous) => {
      if (!isBuiltInModel(selectedModel)) {
        return {
          ...previous,
          custom_providers: previous.custom_providers.map((provider) =>
            provider.id === selectedModel
              ? {
                  ...provider,
                  model: nextModelName,
                  custom_models: Array.from(
                    new Set([...provider.custom_models, nextModelName])
                  ),
                }
              : provider
          ),
        };
      }

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
    setMessage(`${selectedMeta.label} 已添加自定义模型，保存后写入配置文件。`);
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
        </div>

        <div className="settings-header__actions">
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="settings-file-input"
            onChange={(event) => void importSettings(event.target.files?.[0])}
          />

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

      {/* 全局反馈统一悬浮展示，避免弹出时挤压正文布局。 */}
      {(error || message) && (
        <div
          className={`floating-alerts floating-alerts--settings ${
            settingsAlertClosing ? "is-leaving" : ""
          }`}
          aria-live="polite"
        >
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
        </div>
      )}

      <div className="settings-layout">
        {/* 左栏只负责设置分类导航，具体配置放到右侧内容区。 */}
        <aside className="settings-sidebar glass-panel">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Settings</p>
              <h2>设置分类</h2>
            </div>
          </div>

          <div className="settings-category-list">
            {SETTINGS_SECTIONS.map((section) => {
              const SectionIcon = section.icon;

              return (
                <button
                  key={section.id}
                  type="button"
                  className={`settings-category-card ${
                    activeSection === section.id ? "is-active" : ""
                  }`}
                  onClick={() => {
                    setActiveSection(section.id);
                    setMessage("");
                    setError("");
                  }}
                >
                  <span className="settings-category-card__icon" aria-hidden="true">
                    <SectionIcon size={18} />
                  </span>
                  <span className="settings-category-card__content">
                    <span className="settings-model-card__title">{section.title}</span>
                    <span className="settings-model-card__meta">{section.meta}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* 右侧表单区专门编辑当前模型，避免全部模型挤在同一页难以维护。 */}
        <main className="settings-main glass-panel">
          <div className="settings-main__header">
            <div>
              <p className="section-kicker">当前编辑</p>
              <h2>{SETTINGS_SECTIONS.find((section) => section.id === activeSection)?.title}</h2>
              <p className="settings-main__subtitle">
                {SETTINGS_SECTIONS.find((section) => section.id === activeSection)?.meta}
              </p>
            </div>

            {activeSection === "model" && (
              <div className="settings-main__actions">
                {isCustomProviderSelected && (
                  <button type="button" className="ghost-button danger-button" onClick={removeCustomProvider}>
                    删除供应商
                  </button>
                )}
                <button type="button" className="ghost-button danger-button" onClick={clearSelectedModel}>
                  清空当前模型
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="empty-card settings-loading-card">
              <p>正在读取配置文件...</p>
              <span>稍等一下，表单会自动填充现有配置。</span>
            </div>
          ) : (
            <>
              {activeSection === "user" && (
                <div className="settings-form">
                  <div className="settings-field">
                    <div>
                      <p className="section-kicker">Profile</p>
                      <h3>用户信息</h3>
                    </div>

                    <label htmlFor="persona-username">用户名</label>
                    <input
                      id="persona-username"
                      className="settings-input"
                      type="text"
                      value={config.persona.username}
                      placeholder="例如：木南"
                      onChange={(event) => updateUsername(event.target.value)}
                    />
                    <p className="settings-help-text">
                      用户名会在每次对话时告知 AI，用来帮助模型理解称呼与上下文。
                    </p>
                  </div>

                  <div className="settings-field">
                    <div>
                      <p className="section-kicker">Default Model</p>
                      <h3>聊天页默认打开</h3>
                    </div>

                    <label htmlFor="preferred-model">默认模型</label>
                    <CustomSelect
                      id="preferred-model"
                      className="settings-input"
                      value={preferredModel}
                      options={modelOptions.map((option) => ({
                        value: option.id,
                        label: `${option.label} · ${option.provider}`,
                      }))}
                      onChange={(value) => setPreferredModel(value as ModelType)}
                    />
                    <p className="settings-help-text">
                      保存设置后，聊天页下次打开会优先使用这个模型。
                    </p>
                  </div>

                  <div className="settings-field settings-field--wide">
                    <div>
                      <p className="section-kicker">WebDAV</p>
                      <h3>WebDAV 备份配置</h3>
                    </div>

                    <p className="settings-help-text">
                      WebDAV 配置只保存在本机配置中，不会出现在导入/导出的备份内容里。
                    </p>

                    <div className="webdav-settings-grid">
                      <div className="webdav-settings-field">
                        <label htmlFor="webdav-url">WebDAV 地址</label>
                        <input
                          id="webdav-url"
                          className="settings-input"
                          type="text"
                          value={config.webdav.url}
                          placeholder="例如 https://example.com/dav/backups"
                          onChange={(event) => updateWebDavField("url", event.target.value)}
                        />
                      </div>

                      <div className="webdav-settings-field">
                        <label htmlFor="webdav-path">备份文件路径</label>
                        <input
                          id="webdav-path"
                          className="settings-input"
                          type="text"
                          value={config.webdav.path}
                          placeholder="munan-ai-settings.json"
                          onChange={(event) => updateWebDavField("path", event.target.value)}
                        />
                      </div>

                      <div className="webdav-settings-field">
                        <label htmlFor="webdav-username">用户名</label>
                        <input
                          id="webdav-username"
                          className="settings-input"
                          type="text"
                          value={config.webdav.username}
                          placeholder="WebDAV 用户名，可留空"
                          onChange={(event) => updateWebDavField("username", event.target.value)}
                        />
                      </div>

                      <div className="webdav-settings-field">
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
                    </div>
                  </div>

                  <div className="settings-field settings-field--wide">
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
                </div>
              )}

              {activeSection === "usage" && (
                <div className="settings-form usage-settings-form">
                  <div className="settings-field settings-field--wide">
                    <div className="settings-field__header">
                      <div>
                        <p className="section-kicker">Usage</p>
                        <h3>Token 用量统计</h3>
                      </div>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => void loadTokenUsageStats()}
                      >
                        刷新统计
                      </button>
                    </div>

                    <div className="usage-filter-grid">
                      <div>
                        <label htmlFor="usage-start-date">开始日期</label>
                        <DatePicker
                          id="usage-start-date"
                          className="settings-input"
                          value={usageStartDate}
                          placeholder="选择开始日期"
                          onChange={setUsageStartDate}
                        />
                      </div>
                      <div>
                        <label htmlFor="usage-end-date">结束日期</label>
                        <DatePicker
                          id="usage-end-date"
                          className="settings-input"
                          value={usageEndDate}
                          placeholder="选择结束日期"
                          onChange={setUsageEndDate}
                        />
                      </div>
                      <div className="usage-filter-actions">
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => void loadTokenUsageStats()}
                        >
                          应用筛选
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => {
                            setUsageStartDate("");
                            setUsageEndDate("");
                            void loadTokenUsageStats("", "");
                          }}
                        >
                          清空日期
                        </button>
                      </div>
                    </div>

                    <label htmlFor="usage-retention-days">明细保存时间</label>
                    <input
                      id="usage-retention-days"
                      className="settings-input"
                      type="number"
                      min={0}
                      max={3650}
                      step={1}
                      value={config.usage.detail_retention_days}
                      onChange={(event) => updateUsageRetentionDays(event.target.value)}
                    />
                    <p className="settings-help-text">
                      0 表示永久保存明细；填写 7-3650 会在后续成功请求时自动清理更早明细。日汇总始终长期保留。
                    </p>
                  </div>

                  {tokenUsageError ? (
                    <div className="settings-field settings-field--wide">
                      <p className="settings-help-text">{tokenUsageError}</p>
                    </div>
                  ) : (
                    <>
                      <div className="usage-stats-panel settings-field--wide">
                        <div className="usage-stat-card">
                          <span>筛选范围</span>
                          <strong>{formatTokenCount(tokenUsageStats?.range.total_tokens ?? 0)}</strong>
                          <small>
                            {tokenUsageStats?.range.request_count ?? 0} 次请求 · 精确{" "}
                            {tokenUsageStats?.range.precise_count ?? 0} 次
                          </small>
                        </div>
                        <div className="usage-stat-card">
                          <span>今日</span>
                          <strong>{formatTokenCount(tokenUsageStats?.today.total_tokens ?? 0)}</strong>
                          <small>{tokenUsageStats?.today.request_count ?? 0} 次请求</small>
                        </div>
                        <div className="usage-stat-card">
                          <span>本月</span>
                          <strong>{formatTokenCount(tokenUsageStats?.month.total_tokens ?? 0)}</strong>
                          <small>{tokenUsageStats?.month.request_count ?? 0} 次请求</small>
                        </div>
                        <div className="usage-stat-card">
                          <span>明细记录</span>
                          <strong>{formatTokenCount(tokenUsageStats?.detail_count ?? 0)}</strong>
                          <small>
                            {config.usage.detail_retention_days === 0
                              ? "永久保存"
                              : `保留 ${config.usage.detail_retention_days} 天`}
                          </small>
                        </div>
                      </div>

                      <div className="settings-field usage-chart-card">
                        <div>
                          <p className="section-kicker">Line</p>
                          <h3>Token 趋势</h3>
                        </div>
                        <svg className="usage-line-chart" viewBox="0 0 320 120" role="img">
                          <polyline points={buildLineChartPoints(usageChartPoints)} />
                        </svg>
                        <p className="settings-help-text">
                          显示筛选范围内最近 {usageChartPoints.length || 0} 天的总 token 走势。
                        </p>
                      </div>

                      <div className="settings-field usage-chart-card">
                        <div>
                          <p className="section-kicker">Bar</p>
                          <h3>每日消耗</h3>
                        </div>
                        <div className="usage-bar-chart">
                          {usageChartPoints.length ? (
                            usageChartPoints.map((point) => (
                              <div className="usage-bar-column" key={point.usage_date}>
                                <span
                                  style={{
                                    height: `${buildBarHeight(point, usageChartPoints)}%`,
                                  }}
                                />
                                <small>{point.usage_date.slice(5)}</small>
                              </div>
                            ))
                          ) : (
                            <p className="settings-help-text">暂无可展示的数据。</p>
                          )}
                        </div>
                      </div>

                      <div className="settings-field settings-field--wide usage-pie-card">
                        <div>
                          <p className="section-kicker">Share</p>
                          <h3>各模型消耗占比</h3>
                        </div>
                        {tokenUsageStats?.by_model.length ? (
                          <div className="usage-pie-layout">
                            <div
                              className="usage-pie-chart"
                              style={{
                                background: buildPieGradient(tokenUsageStats.by_model),
                              }}
                              aria-label="各模型 token 消耗占比"
                            />
                            <div className="usage-model-list">
                              {tokenUsageStats.by_model.map((item, index) => (
                                <div
                                  className="usage-model-row"
                                  key={`${item.provider}-${item.model}`}
                                >
                                  <div>
                                    <strong>
                                      <i style={{ background: USAGE_CHART_COLORS[index % USAGE_CHART_COLORS.length] }} />
                                      {item.model || item.provider}
                                    </strong>
                                    <span>
                                      {item.provider} · {formatPercent(item, tokenUsageStats.by_model)}
                                    </span>
                                  </div>
                                  <span>{formatTokenCount(getUsageModelValue(item))}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className="settings-help-text">
                            暂无 token 用量。供应商返回 usage 后会自动记录；未返回 usage 的请求只计次数。
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeSection === "model" && (
                <div className="settings-form">
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

                  <div className="settings-field settings-field--wide">
                    <div className="settings-field__header">
                      <div>
                        <p className="section-kicker">Provider</p>
                        <h3>选择模型供应商</h3>
                      </div>
                      <button type="button" className="ghost-button" onClick={addCustomProvider}>
                        添加供应商
                      </button>
                    </div>

                    <label htmlFor="settings-model-provider">当前供应商</label>
                    <CustomSelect
                      id="settings-model-provider"
                      className="settings-input"
                      value={selectedModel}
                      options={modelOptions.map((option) => ({
                        value: option.id,
                        label: `${option.label} · ${option.provider}`,
                      }))}
                      onChange={(value) => {
                        setSelectedModel(value as ModelType);
                        setMessage("");
                        setError("");
                      }}
                    />

                    <p className="settings-help-text">
                      当前正在编辑：{selectedMeta.label}，{selectedMeta.description}
                    </p>
                  </div>

              {isCustomProviderSelected && (
                <div className="settings-field settings-field--wide">
                  <label htmlFor="custom-provider-label">供应商名称</label>
                  <input
                    id="custom-provider-label"
                    className="settings-input"
                    type="text"
                    value={selectedMeta.label}
                    placeholder="例如 OpenRouter / Moonshot / 本地模型"
                    onChange={(event) => updateCustomProviderField("label", event.target.value)}
                  />

                  <label htmlFor="custom-provider-subtitle">供应商说明</label>
                  <input
                    id="custom-provider-subtitle"
                    className="settings-input"
                    type="text"
                    value={selectedMeta.provider}
                    placeholder="例如 OpenAI-compatible"
                    onChange={(event) => updateCustomProviderField("provider", event.target.value)}
                  />
                </div>
              )}

              <div className="settings-field">
                <label htmlFor="base-url">Base URL</label>
                <input
                  id="base-url"
                  className="settings-input"
                  type="text"
                  value={selectedConfig.base_url}
                  placeholder={selectedMeta.baseUrlPlaceholder}
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
                <div className="settings-field__header">
                  <div>
                    <p className="section-kicker">Vision</p>
                    <h3>多模态能力</h3>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={selectedConfig.is_multimodal}
                      onChange={(event) =>
                        updateSelectedModelField("is_multimodal", event.target.checked)
                      }
                    />
                    <span />
                  </label>
                </div>
                <p className="settings-help-text">
                  开启后聊天输入区允许附加图片，并按 OpenAI-compatible 视觉消息格式发送。
                </p>
              </div>

              <div className="settings-field settings-field--wide">
                <label htmlFor="model-name">模型名称</label>
                <CustomSelect
                  id="model-name"
                  className="settings-input"
                  value={selectedConfig.model}
                  placeholder="请选择模型"
                  options={selectedModelChoices.map((modelName) => ({
                    value: modelName,
                    label: modelName,
                  }))}
                  onChange={(value) => updateSelectedModelField("model", value)}
                />

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

                </div>
              )}
            </>
          )}
          {!loading && activeSection === "speech" && (
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
                  <CustomSelect
                    id="asr-provider-current"
                    className="settings-input"
                    value={config.speech.asr.provider}
                    options={[
                      { value: "openai_like", label: "OpenAI-like / MIMO" },
                      { value: "tencent", label: "腾讯云语音识别" },
                    ]}
                    onChange={(value) => switchAsrProvider(value as AsrProvider)}
                  />

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
                      <CustomSelect
                        id="asr-engine-type-current"
                        className="settings-input"
                        value={config.speech.asr.tencent_engine_type}
                        options={TENCENT_ASR_ENGINE_OPTIONS}
                        onChange={(value) =>
                          updateSpeechField(
                            "asr",
                            "tencent_engine_type",
                            value
                          )
                        }
                      />
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
        </main>
      </div>

      {customProviderDialogOpen && (
        <div className="settings-modal-backdrop" role="presentation">
          <div className="settings-modal" role="dialog" aria-modal="true">
            <div>
              <p className="section-kicker">Custom Provider</p>
              <h2>添加模型供应商</h2>
              <p className="settings-help-text">
                适合 OpenAI-compatible 接口，例如 OpenRouter、Moonshot 或本地模型服务。
              </p>
            </div>

            <div className="settings-modal-form">
              <label htmlFor="custom-provider-name">供应商名称</label>
              <input
                id="custom-provider-name"
                className="settings-input"
                type="text"
                value={customProviderName}
                placeholder="例如 OpenRouter / Moonshot / 本地模型"
                autoFocus
                onChange={(event) => setCustomProviderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    confirmAddCustomProvider();
                  }
                }}
              />
            </div>

            <div className="settings-modal-footer settings-modal-footer--split">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setCustomProviderDialogOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={confirmAddCustomProvider}
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteProviderDialogOpen && (
        <div className="settings-modal-backdrop" role="presentation">
          <div className="settings-modal" role="dialog" aria-modal="true">
            <div>
              <p className="section-kicker">Delete Provider</p>
              <h2>删除供应商</h2>
              <p className="settings-help-text">
                确认删除“{selectedMeta.label}”吗？删除后需要点击保存设置才会写入配置文件。
              </p>
            </div>

            <div className="settings-modal-footer settings-modal-footer--split">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setDeleteProviderDialogOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="ghost-button danger-button"
                onClick={confirmRemoveCustomProvider}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

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

    </div>
  );
}

export default Settings;

const USAGE_CHART_COLORS = [
  "#1d72f3",
  "#15a06d",
  "#f59e0b",
  "#e14f73",
  "#7c3aed",
  "#0891b2",
  "#ef4444",
  "#64748b",
];

const formatTokenCount = (value: number): string => {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return String(value);
};

const getUsagePointValue = (point: TokenUsageDailyPoint): number => {
  return point.total_tokens || point.request_count;
};

const getUsageModelValue = (item: TokenUsageModelStats): number => {
  return item.total_tokens || item.request_count;
};

const buildLineChartPoints = (points: TokenUsageDailyPoint[]): string => {
  if (!points.length) {
    return "";
  }

  const values = points.map(getUsagePointValue);
  const max = Math.max(...values, 1);
  const width = 300;
  const height = 92;

  return points
    .map((point, index) => {
      const x = 10 + (points.length === 1 ? width / 2 : (index / (points.length - 1)) * width);
      const y = 104 - (getUsagePointValue(point) / max) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
};

const buildBarHeight = (
  point: TokenUsageDailyPoint,
  points: TokenUsageDailyPoint[]
): number => {
  const max = Math.max(...points.map(getUsagePointValue), 1);
  return Math.max((getUsagePointValue(point) / max) * 100, 4);
};

const buildPieGradient = (items: TokenUsageModelStats[]): string => {
  const total = items.reduce((sum, item) => sum + getUsageModelValue(item), 0);
  if (total <= 0) {
    return "conic-gradient(#dbe4ef 0deg 360deg)";
  }

  let cursor = 0;
  const stops = items.map((item, index) => {
    const start = cursor;
    const size = (getUsageModelValue(item) / total) * 360;
    cursor += size;
    const color = USAGE_CHART_COLORS[index % USAGE_CHART_COLORS.length];
    return `${color} ${start.toFixed(2)}deg ${cursor.toFixed(2)}deg`;
  });

  return `conic-gradient(${stops.join(", ")})`;
};

const formatPercent = (
  item: TokenUsageModelStats,
  items: TokenUsageModelStats[]
): string => {
  const total = items.reduce((sum, current) => sum + getUsageModelValue(current), 0);
  if (total <= 0) {
    return "0%";
  }

  return `${((getUsageModelValue(item) / total) * 100).toFixed(1)}%`;
};
