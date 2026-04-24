/**
 * 统一维护前后端都会用到的模型元数据、页面类型和本地存储工具。
 * 这样聊天页和设置页就不会各自写一套字符串常量，后续扩展模型时也更稳。
 */

export const MODEL_OPTIONS = [
  { id: "openai", label: "OpenAI", provider: "GPT 系列", accent: "sky" },
  { id: "deepseek", label: "DeepSeek", provider: "深度求索", accent: "emerald" },
  { id: "qwen", label: "Qwen", provider: "通义千问", accent: "amber" },
  { id: "mimo", label: "MIMO", provider: "小米大模型", accent: "rose" },
  { id: "nvidia", label: "NVIDIA", provider: "Kimi / NIM", accent: "violet" },
] as const;

export type ModelType = (typeof MODEL_OPTIONS)[number]["id"];

export type Message = {
  role: "user" | "ai";
  content: string;
};

export type Conversation = {
  id: string;
  name: string;
  messages: Message[];
};

export type ModelConfig = {
  base_url: string;
  api_key: string;
  model: string;
};

export type AsrProvider = "openai_like" | "tencent";

export type AsrConfig = ModelConfig & {
  provider: AsrProvider;
  tencent_engine_type: string;
  app_id: string;
  secret_id: string;
  secret_key: string;
  region: string;
};

export type TtsConfig = ModelConfig & {
  voice: string;
  voice_description: string;
};

export type SpeechConfig = {
  asr: AsrConfig;
  tts: TtsConfig;
};

export type AppConfig = Record<ModelType, ModelConfig> & {
  speech: SpeechConfig;
  custom_models: Record<ModelType, string[]>;
};

export const MODEL_CATALOG: Record<ModelType, string[]> = {
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  qwen: ["qwen-max", "qwen-plus", "qwen-turbo", "qwen3-max"],
  mimo: ["mimo-v2-flash"],
  nvidia: [
    "moonshotai/kimi-k2.5",
    "nvidia/llama-3.1-nemotron-ultra-253b-v1",
    "meta/llama-3.1-405b-instruct",
    "mistralai/mixtral-8x22b-instruct-v0.1",
  ],
};

export const MODEL_META: Record<
  ModelType,
  {
    label: string;
    provider: string;
    accent: string;
    description: string;
    baseUrlPlaceholder: string;
    modelPlaceholder: string;
  }
> = {
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
    provider: "NIM / Kimi",
    accent: "violet",
    description: "可以接 NVIDIA 集成服务，适合扩展第三方兼容模型。",
    baseUrlPlaceholder: "https://integrate.api.nvidia.com/v1/chat/completions",
    modelPlaceholder: "moonshotai/kimi-k2.5",
  },
};

const CONVERSATIONS_STORAGE_KEY = "chatConversations";
const USER_STATE_STORAGE_KEY = "userState";
const PREFERRED_MODEL_STORAGE_KEY = "preferredModel";

/**
 * 为所有模型生成一份完整的空配置。
 * 后端缺字段或者新增模型时，前端可以先用这份结构兜底。
 */
export const createEmptyAppConfig = (): AppConfig => ({
  openai: { base_url: "", api_key: "", model: "" },
  deepseek: { base_url: "", api_key: "", model: "" },
  qwen: { base_url: "", api_key: "", model: "" },
  mimo: { base_url: "", api_key: "", model: "" },
  nvidia: { base_url: "https://integrate.api.nvidia.com/v1", api_key: "", model: "" },
  speech: {
    asr: {
      provider: "openai_like",
      base_url: "",
      api_key: "",
      model: "",
      tencent_engine_type: "16k_zh_en",
      app_id: "",
      secret_id: "",
      secret_key: "",
      region: "ap-shanghai",
    },
    tts: { base_url: "", api_key: "", model: "", voice: "", voice_description: "" },
  },
  custom_models: {
    openai: [],
    deepseek: [],
    qwen: [],
    mimo: [],
    nvidia: [],
  },
});

/**
 * 对后端返回的数据做一次归一化，避免出现 undefined 字段导致表单受控报错。
 */
export const normalizeAppConfig = (
  value:
    | (Partial<Record<ModelType, Partial<ModelConfig>>> & {
        speech?: Partial<{
          asr: Partial<AsrConfig>;
          tts: Partial<TtsConfig>;
        }>;
        custom_models?: Partial<Record<ModelType, string[]>>;
      })
    | null
    | undefined
): AppConfig => {
  const fallback = createEmptyAppConfig();

  for (const option of MODEL_OPTIONS) {
    const current = value?.[option.id];
    fallback[option.id] = {
      base_url: current?.base_url ?? "",
      api_key: current?.api_key ?? "",
      model: current?.model ?? "",
    };
  }

  fallback.speech = {
    asr: {
      provider: value?.speech?.asr?.provider === "tencent" ? "tencent" : "openai_like",
      base_url: value?.speech?.asr?.base_url ?? "",
      api_key: value?.speech?.asr?.api_key ?? "",
      model: value?.speech?.asr?.model ?? "",
      tencent_engine_type: value?.speech?.asr?.tencent_engine_type ?? "16k_zh_en",
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

  for (const option of MODEL_OPTIONS) {
    fallback.custom_models[option.id] = Array.isArray(value?.custom_models?.[option.id])
      ? Array.from(new Set(value.custom_models[option.id]!.filter(Boolean)))
      : [];
  }

  return fallback;
};

export const createEmptyConversations = (): Record<ModelType, Conversation[]> => ({
  openai: [],
  deepseek: [],
  qwen: [],
  mimo: [],
  nvidia: [],
});

export const normalizeModelType = (
  value: string | null | undefined
): ModelType => {
  return MODEL_OPTIONS.some((option) => option.id === value)
    ? (value as ModelType)
    : "openai";
};

export const loadConversationsFromStorage = (): Record<ModelType, Conversation[]> => {
  const raw = localStorage.getItem(CONVERSATIONS_STORAGE_KEY);

  if (!raw) {
    return createEmptyConversations();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Record<ModelType, Conversation[]>>;
    const fallback = createEmptyConversations();

    for (const option of MODEL_OPTIONS) {
      fallback[option.id] = Array.isArray(parsed?.[option.id]) ? parsed[option.id]! : [];
    }

    return fallback;
  } catch {
    return createEmptyConversations();
  }
};

export const saveConversationsToStorage = (
  conversations: Record<ModelType, Conversation[]>
): void => {
  localStorage.setItem(CONVERSATIONS_STORAGE_KEY, JSON.stringify(conversations));
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
  const target = config[model];
  return Boolean(
    target.base_url.trim() && target.api_key.trim() && target.model.trim()
  );
};
