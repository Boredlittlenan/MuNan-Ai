/**
 * 统一维护模型元数据、页面类型和本地存储工具。
 * 内置供应商走固定后端适配器，自定义供应商统一按 OpenAI-compatible 接口调用。
 */

export const MODEL_OPTIONS = [
  { id: "openai", label: "OpenAI", provider: "GPT 系列", accent: "sky" },
  { id: "deepseek", label: "DeepSeek", provider: "深度求索", accent: "emerald" },
  { id: "qwen", label: "Qwen", provider: "通义千问", accent: "amber" },
  { id: "mimo", label: "MIMO", provider: "小米大模型", accent: "rose" },
  { id: "nvidia", label: "NVIDIA", provider: "NVIDIA 开放平台", accent: "violet" },
] as const;

export type BuiltInModelType = (typeof MODEL_OPTIONS)[number]["id"];
export type ModelType = string;

export type Message = {
  role: "user" | "ai";
  content: string;
  tts_text?: string;
  original_content?: string;
  attachments?: MessageAttachment[];
};

export type MessageAttachment = {
  id: string;
  type: "image";
  name: string;
  mime_type: string;
  data_url: string;
};

export type Conversation = {
  id: string;
  model?: ModelType;
  provider_model?: string;
  name: string;
  created_at?: number;
  updated_at?: number;
  messages: Message[];
};

export type ApiEndpointConfig = {
  base_url: string;
  api_key: string;
  model: string;
};

export type ModelConfig = ApiEndpointConfig & {
  is_multimodal: boolean;
};

export type CustomProviderConfig = ModelConfig & {
  id: string;
  label: string;
  provider: string;
  custom_models: string[];
};

export type AsrProvider = "openai_like" | "tencent";

export type AsrConfig = ApiEndpointConfig & {
  provider: AsrProvider;
  tencent_engine_type: string;
  app_id: string;
  secret_id: string;
  secret_key: string;
  region: string;
};

export type TtsConfig = ApiEndpointConfig & {
  voice: string;
  voice_description: string;
};

export type SpeechConfig = {
  asr: AsrConfig;
  tts: TtsConfig;
};

export type PersonaConfig = {
  username: string;
  prompt: string;
};

export type WebDavConfig = {
  url: string;
  username: string;
  password: string;
  path: string;
};

export type UsageConfig = {
  detail_retention_days: number;
};

export type AppConfig = Record<BuiltInModelType, ModelConfig> & {
  schema_version: number;
  speech: SpeechConfig;
  persona: PersonaConfig;
  webdav: WebDavConfig;
  usage: UsageConfig;
  custom_models: Record<BuiltInModelType, string[]>;
  custom_providers: CustomProviderConfig[];
};

export type ModelOption = {
  id: ModelType;
  label: string;
  provider: string;
  accent: string;
};

export type ModelMeta = {
  label: string;
  provider: string;
  accent: string;
  description: string;
  baseUrlPlaceholder: string;
  modelPlaceholder: string;
};

export const MODEL_CATALOG: Record<BuiltInModelType, string[]> = {
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  qwen: ["qwen-max", "qwen-plus", "qwen-turbo", "qwen3-max"],
  mimo: ["mimo-v2-flash"],
  nvidia: ["moonshotai/kimi-k2.5"],
};

export const MODEL_META: Record<BuiltInModelType, ModelMeta> = {
  openai: {
    label: "OpenAI",
    provider: "GPT 系列",
    accent: "sky",
    description: "适合通用问答、代码辅助和稳定的多轮对话。",
    baseUrlPlaceholder: "https://api.openai.com/v1/chat/completions",
    modelPlaceholder: "gpt-4o-mini",
  },
  deepseek: {
    label: "DeepSeek",
    provider: "深度求索",
    accent: "emerald",
    description: "更偏推理和中文场景，也适合成本敏感的配置。",
    baseUrlPlaceholder: "https://api.deepseek.com/v1/chat/completions",
    modelPlaceholder: "deepseek-chat",
  },
  qwen: {
    label: "Qwen",
    provider: "通义千问",
    accent: "amber",
    description: "阿里系兼容接口，中文体验和工具类任务都比较稳。",
    baseUrlPlaceholder:
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    modelPlaceholder: "qwen-max",
  },
  mimo: {
    label: "MIMO",
    provider: "小米大模型",
    accent: "rose",
    description: "适合接入小米兼容接口，便于做多模型备用路由。",
    baseUrlPlaceholder: "https://api.xiaomimimo.com/v1/chat/completions",
    modelPlaceholder: "mimo-v2-flash",
  },
  nvidia: {
    label: "NVIDIA",
    provider: "NVIDIA 开放平台",
    accent: "violet",
    description: "可以接 NVIDIA 集成服务，适合扩展第三方兼容模型。",
    baseUrlPlaceholder: "https://integrate.api.nvidia.com/v1/chat/completions",
    modelPlaceholder: "moonshotai/kimi-k2.5",
  },
};

const CONVERSATIONS_STORAGE_KEY = "chatConversations";
const USER_STATE_STORAGE_KEY = "userState";
const PREFERRED_MODEL_STORAGE_KEY = "preferredModel";

export const createEmptyAppConfig = (): AppConfig => ({
  schema_version: 1,
  openai: { base_url: "", api_key: "", model: "", is_multimodal: false },
  deepseek: { base_url: "", api_key: "", model: "", is_multimodal: false },
  qwen: { base_url: "", api_key: "", model: "", is_multimodal: false },
  mimo: { base_url: "", api_key: "", model: "", is_multimodal: false },
  nvidia: {
    base_url: "https://integrate.api.nvidia.com/v1/chat/completions",
    api_key: "",
    model: "",
    is_multimodal: false,
  },
  speech: {
    asr: {
      provider: "openai_like",
      base_url: "",
      api_key: "",
      model: "",
      tencent_engine_type: "16k_zh-PY",
      app_id: "",
      secret_id: "",
      secret_key: "",
      region: "ap-shanghai",
    },
    tts: {
      base_url: "",
      api_key: "",
      model: "",
      voice: "",
      voice_description: "",
    },
  },
  persona: {
    username: "",
    prompt:
      "你是 MuNan AI，一个温和、清晰、可靠的桌面 AI 助手。你会优先理解用户真实意图，回答时直接、有条理，并在需要时给出可执行步骤。",
  },
  webdav: {
    url: "",
    username: "",
    password: "",
    path: "munan-ai-settings.json",
  },
  usage: {
    detail_retention_days: 0,
  },
  custom_models: {
    openai: [],
    deepseek: [],
    qwen: [],
    mimo: [],
    nvidia: [],
  },
  custom_providers: [],
});

export const isBuiltInModel = (model: string | null | undefined): model is BuiltInModelType => {
  return MODEL_OPTIONS.some((option) => option.id === model);
};

export const getModelOptions = (config: AppConfig): ModelOption[] => [
  ...MODEL_OPTIONS,
  ...config.custom_providers.map((provider) => ({
    id: provider.id,
    label: provider.label || provider.id,
    provider: provider.provider || "自定义供应商",
    accent: "slate",
  })),
];

export const getModelMeta = (config: AppConfig, model: ModelType): ModelMeta => {
  if (isBuiltInModel(model)) {
    return MODEL_META[model];
  }

  const provider = config.custom_providers.find((item) => item.id === model);
  return {
    label: provider?.label || model,
    provider: provider?.provider || "自定义供应商",
    accent: "slate",
    description: "用户手动添加的 OpenAI-compatible 模型供应商。",
    baseUrlPlaceholder: "https://api.example.com/v1/chat/completions",
    modelPlaceholder: provider?.model || "model-name",
  };
};

export const getModelConfig = (config: AppConfig, model: ModelType): ModelConfig => {
  if (isBuiltInModel(model)) {
    return config[model];
  }

  const provider = config.custom_providers.find((item) => item.id === model);
  return {
    base_url: provider?.base_url ?? "",
    api_key: provider?.api_key ?? "",
    model: provider?.model ?? "",
    is_multimodal: provider?.is_multimodal ?? false,
  };
};

export const getModelChoices = (config: AppConfig, model: ModelType): string[] => {
  const currentModelName = getModelConfig(config, model).model;

  if (isBuiltInModel(model)) {
    return Array.from(
      new Set([
        ...(MODEL_CATALOG[model] ?? []),
        ...(config.custom_models?.[model] ?? []),
        currentModelName,
      ].filter(Boolean))
    );
  }

  const provider = config.custom_providers.find((item) => item.id === model);
  return Array.from(new Set([...(provider?.custom_models ?? []), currentModelName].filter(Boolean)));
};

export const updateModelConfig = (
  config: AppConfig,
  model: ModelType,
  patch: Partial<ModelConfig>
): AppConfig => {
  if (isBuiltInModel(model)) {
    return {
      ...config,
      [model]: {
        ...config[model],
        ...patch,
      },
    };
  }

  return {
    ...config,
    custom_providers: config.custom_providers.map((provider) =>
      provider.id === model ? { ...provider, ...patch } : provider
    ),
  };
};

export const normalizeAppConfig = (
  value:
    | (Partial<Record<BuiltInModelType, Partial<ModelConfig>>> & {
        speech?: Partial<{
          asr: Partial<AsrConfig>;
          tts: Partial<TtsConfig>;
        }>;
        persona?: Partial<PersonaConfig>;
        webdav?: Partial<WebDavConfig>;
        usage?: Partial<UsageConfig>;
        custom_models?: Partial<Record<BuiltInModelType, string[]>>;
        custom_providers?: Partial<CustomProviderConfig>[];
        schema_version?: number;
      })
    | null
    | undefined
): AppConfig => {
  const fallback = createEmptyAppConfig();
  fallback.schema_version = value?.schema_version ?? fallback.schema_version;

  for (const option of MODEL_OPTIONS) {
    const current = value?.[option.id];
    fallback[option.id] = {
      base_url: current?.base_url ?? "",
      api_key: current?.api_key ?? "",
      model: current?.model ?? "",
      is_multimodal: current?.is_multimodal ?? false,
    };
  }

  fallback.speech = {
    asr: {
      provider: value?.speech?.asr?.provider === "tencent" ? "tencent" : "openai_like",
      base_url: value?.speech?.asr?.base_url ?? "",
      api_key: value?.speech?.asr?.api_key ?? "",
      model: value?.speech?.asr?.model ?? "",
      tencent_engine_type: value?.speech?.asr?.tencent_engine_type ?? "16k_zh-PY",
      app_id: value?.speech?.asr?.app_id ?? "",
      secret_id: value?.speech?.asr?.secret_id ?? "",
      secret_key: value?.speech?.asr?.secret_key ?? "",
      region: value?.speech?.asr?.region ?? "ap-shanghai",
    },
    tts: {
      base_url: value?.speech?.tts?.base_url ?? "",
      api_key: value?.speech?.tts?.api_key ?? "",
      model: value?.speech?.tts?.model ?? "",
      voice: value?.speech?.tts?.voice ?? "",
      voice_description: value?.speech?.tts?.voice_description ?? "",
    },
  };
  fallback.persona = {
    username: value?.persona?.username ?? fallback.persona.username,
    prompt: value?.persona?.prompt ?? fallback.persona.prompt,
  };
  fallback.webdav = {
    url: value?.webdav?.url ?? "",
    username: value?.webdav?.username ?? "",
    password: value?.webdav?.password ?? "",
    path: value?.webdav?.path ?? "munan-ai-settings.json",
  };
  fallback.usage = {
    detail_retention_days: normalizeRetentionDays(
      value?.usage?.detail_retention_days ?? fallback.usage.detail_retention_days
    ),
  };

  for (const option of MODEL_OPTIONS) {
    fallback.custom_models[option.id] = Array.isArray(value?.custom_models?.[option.id])
      ? Array.from(new Set(value.custom_models[option.id]!.filter(Boolean)))
      : [];
  }

  fallback.custom_providers = Array.isArray(value?.custom_providers)
    ? value.custom_providers.map((provider, index) => {
        const id = provider.id?.trim() || `custom-${index + 1}`;
        return {
          id,
          label: provider.label?.trim() || id,
          provider: provider.provider?.trim() || "自定义供应商",
          base_url: provider.base_url ?? "",
          api_key: provider.api_key ?? "",
          model: provider.model ?? "",
          is_multimodal: provider.is_multimodal ?? false,
          custom_models: Array.isArray(provider.custom_models)
            ? Array.from(new Set(provider.custom_models.filter(Boolean)))
            : [],
        };
      })
    : [];

  return fallback;
};

export const normalizeRetentionDays = (value: number): number => {
  const days = Math.round(Number(value));
  if (!Number.isFinite(days)) {
    return 0;
  }

  if (days <= 0) {
    return 0;
  }

  return Math.min(Math.max(days, 7), 3650);
};

export const createEmptyConversations = (): Record<ModelType, Conversation[]> => ({
  openai: [],
  deepseek: [],
  qwen: [],
  mimo: [],
  nvidia: [],
});

export const normalizeConversations = (
  value: Partial<Record<ModelType, Array<Partial<Conversation>>>> | null | undefined
): Record<ModelType, Conversation[]> => {
  const fallback = createEmptyConversations();
  const now = Date.now();

  for (const [modelId, modelConversations] of Object.entries(value ?? {})) {
    fallback[modelId] = Array.isArray(modelConversations)
      ? modelConversations
          .filter((conversation) => typeof conversation.id === "string" && conversation.id.trim())
          .map((conversation) => {
            const createdAt = Number(conversation.created_at) || now;
            const updatedAt = Number(conversation.updated_at) || createdAt;

            return {
              id: conversation.id!.trim(),
              model: conversation.model?.trim() || modelId,
              provider_model: conversation.provider_model ?? "",
              name: conversation.name?.trim() || "未命名会话",
              created_at: createdAt,
              updated_at: updatedAt,
              messages: Array.isArray(conversation.messages)
                ? conversation.messages
                    .filter((message) => message.role === "user" || message.role === "ai")
                    .map((message) => ({
                      role: message.role,
                      content: message.content ?? "",
                      tts_text: message.tts_text,
                      original_content: message.original_content,
                      attachments: normalizeAttachments(message.attachments),
                    }))
                : [],
            };
          })
      : [];
  }

  return fallback;
};

export const normalizeAttachments = (
  attachments: MessageAttachment[] | undefined
): MessageAttachment[] => {
  return Array.isArray(attachments)
    ? attachments
        .filter(
          (attachment) =>
            attachment?.type === "image" &&
            typeof attachment.data_url === "string" &&
            (attachment.data_url.startsWith("data:image/") ||
              attachment.data_url.startsWith("https://") ||
              attachment.data_url.startsWith("http://"))
        )
        .map((attachment) => ({
          id: attachment.id || `image-${Date.now()}`,
          type: "image",
          name: attachment.name || "image",
          mime_type: attachment.mime_type || "image/png",
          data_url: attachment.data_url,
        }))
    : [];
};

export const hasAnyConversations = (
  conversations: Record<ModelType, Conversation[]>
): boolean => {
  return Object.values(conversations).some((items) => items.length > 0);
};

export const normalizeModelType = (value: string | null | undefined): ModelType => {
  return value?.trim() || "openai";
};

export const loadConversationsFromStorage = (): Record<ModelType, Conversation[]> => {
  const raw = localStorage.getItem(CONVERSATIONS_STORAGE_KEY);

  if (!raw) {
    return createEmptyConversations();
  }

  try {
    return normalizeConversations(JSON.parse(raw));
  } catch {
    return createEmptyConversations();
  }
};

export const clearLegacyConversationsStorage = (): void => {
  localStorage.removeItem(CONVERSATIONS_STORAGE_KEY);
};

export const loadPreferredModel = (): ModelType => {
  return normalizeModelType(localStorage.getItem(PREFERRED_MODEL_STORAGE_KEY));
};

export const savePreferredModel = (model: ModelType): void => {
  localStorage.setItem(PREFERRED_MODEL_STORAGE_KEY, model);
};

export const loadUserState = (): {
  model: ModelType;
  conversationId: string | null;
} => {
  const fallback = {
    model: loadPreferredModel(),
    conversationId: null,
  };

  const raw = localStorage.getItem(USER_STATE_STORAGE_KEY);

  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as {
      model?: string;
      conversationId?: string | null;
    };

    return {
      model: normalizeModelType(parsed.model),
      conversationId: parsed.conversationId ?? null,
    };
  } catch {
    return fallback;
  }
};

export const saveUserState = (
  model: ModelType,
  conversationId: string | null
): void => {
  localStorage.setItem(
    USER_STATE_STORAGE_KEY,
    JSON.stringify({ model, conversationId })
  );
};

export const isModelConfigured = (
  config: AppConfig,
  model: ModelType
): boolean => {
  const target = getModelConfig(config, model);
  return Boolean(target.base_url.trim() && target.api_key.trim() && target.model.trim());
};
