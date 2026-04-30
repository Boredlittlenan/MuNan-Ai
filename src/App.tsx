import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { Link } from "react-router-dom";
import {
  IoChatbubbleEllipses,
  IoClose,
  IoCreateOutline,
  IoMenu,
  IoMic,
  IoImageOutline,
  IoSettingsSharp,
  IoStopCircleOutline,
  IoTrashOutline,
} from "react-icons/io5";

import "./styles/base.css";
import "./styles/App.css";

import { recordedBlobToWavBase64 } from "./audio/recording";
import {
  ChatMessageBubble,
  type EditingReplyDraft,
} from "./components/ChatMessageBubble";
import { CustomSelect } from "./components/CustomSelect";
import {
  type AppConfig,
  type Conversation,
  type Message,
  type MessageAttachment,
  type ModelType,
  clearLegacyConversationsStorage,
  createEmptyAppConfig,
  createEmptyConversations,
  getModelChoices,
  getModelConfig,
  getModelMeta,
  getModelOptions,
  hasAnyConversations,
  loadConversationsFromStorage,
  loadUserState,
  normalizeConversations,
  normalizeAppConfig,
  saveUserState,
  isModelConfigured,
  updateModelConfig,
} from "./modelConfig";

type SynthesizeSpeechResponse = {
  audio_base64: string;
  mime_type: string;
};

type TranscribeAudioResponse = {
  text: string;
};

type ChatReplyResponse = {
  content: string;
  tts_text: string;
  original_content: string;
};

type AgentFetchedPage = {
  url: string;
  title: string;
  text: string;
};

type AgentShellResult = {
  command: string;
  cwd: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
};

type AgentShellPlan = {
  should_run: boolean;
  command: string;
  reason: string;
};

const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;

/* =========================
   页面职责说明
   1. 管理聊天首页的模型切换、会话切换和消息发送。
   2. 把会话历史存进后端 SQLite，保证长期使用时稳定恢复。
   3. 启动时读取后端配置，用于判断当前模型是否可直接使用。
   ========================= */

function App() {
  /**
   * 初始化时先恢复“上次使用的模型 + 会话”。
   * 如果用户在设置页改了默认模型，这里也会自动吃到新的默认值。
   */
  const initialUserState = loadUserState();

  /**
   * 当前选中的模型。
   * 聊天页左侧切换模型时，会同步切换该模型下的会话列表。
   */
  const [model, setModel] = useState<ModelType>(initialUserState.model);

  /**
   * 所有模型共用一份会话仓库，结构类似：
   * {
   *   openai: [Conversation, ...],
   *   qwen: [Conversation, ...]
   * }
   */
  const [conversations, setConversations] = useState(createEmptyConversations);
  const [conversationsReady, setConversationsReady] = useState(false);

  /**
   * 当前正在查看的会话 ID。
   * 这里不直接存整个对象，避免状态嵌套过深导致更新不一致。
   */
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(
    initialUserState.conversationId
  );

  /**
   * 输入框内容与发送状态。
   * loading 为 true 时会禁用输入，避免重复提交。
   */
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [loading, setLoading] = useState(false);

  /**
   * 后端模型配置。
   * 这里会从 Rust 侧读 config.json，决定某个模型是否已经配置完成。
   */
  const [appConfig, setAppConfig] = useState<AppConfig>(createEmptyAppConfig);
  const [configStatus, setConfigStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle"
  );
  const [configError, setConfigError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [speechError, setSpeechError] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const [copyNoticeClosing, setCopyNoticeClosing] = useState(false);
  const [speakingMessageKey, setSpeakingMessageKey] = useState<string | null>(null);
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);
  const [expandedOriginalKeys, setExpandedOriginalKeys] = useState<string[]>([]);
  const [editingReply, setEditingReply] = useState<EditingReplyDraft | null>(null);
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "transcribing">(
    "idle"
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  /**
   * 聊天区底部锚点，用于每次发送和收到消息后自动滚动到底部。
   */
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);

  /**
   * 当前模型下的所有会话，以及当前真正选中的会话对象。
   * 用 useMemo 做一次派生，避免 JSX 里反复写查找逻辑。
   */
  const currentModelConversations = useMemo(
    () => conversations[model] ?? [],
    [conversations, model]
  );

  const modelOptions = useMemo(() => getModelOptions(appConfig), [appConfig]);
  const currentModelMeta = useMemo(() => getModelMeta(appConfig, model), [appConfig, model]);
  const currentProviderConfig = useMemo(() => getModelConfig(appConfig, model), [appConfig, model]);
  const currentModelMultimodal = currentProviderConfig.is_multimodal;

  const currentConversation = useMemo(
    () =>
      currentConversationId
        ? currentModelConversations.find((conversation) => conversation.id === currentConversationId) ??
          null
        : null,
    [currentConversationId, currentModelConversations]
  );

  const providerModelChoices = useMemo(() => {
    return getModelChoices(appConfig, model);
  }, [appConfig, model]);

  const ttsReady = useMemo(() => {
    const tts = appConfig.speech.tts;
    const needsVoiceDescription = tts.model.includes("voicedesign");

    return Boolean(
      tts.base_url.trim() &&
        tts.api_key.trim() &&
        tts.model.trim() &&
        (!needsVoiceDescription || tts.voice_description.trim())
    );
  }, [appConfig.speech.tts]);

  const asrReady = useMemo(() => {
    const asr = appConfig.speech.asr;

    if (asr.provider === "tencent") {
      return Boolean(
        asr.app_id.trim() &&
          asr.secret_id.trim() &&
          asr.secret_key.trim() &&
          asr.tencent_engine_type.trim()
      );
    }

    return Boolean(asr.base_url.trim() && asr.api_key.trim() && asr.model.trim());
  }, [appConfig.speech.asr]);

  /**
   * 页面挂载后读取后端配置。
   * 如果配置还没准备好，聊天页会明确提示，而不是让用户点了发送才发现报错。
   */
  useEffect(() => {
    const loadConfig = async () => {
      setConfigStatus("loading");
      setConfigError("");

      try {
        const config = await invoke<AppConfig>("load_app_config");
        setAppConfig(normalizeAppConfig(config));
        setConfigStatus("ready");
      } catch (error) {
        setConfigStatus("error");
        setConfigError(String(error));
      }
    };

    void loadConfig();
  }, []);

  /**
   * 会话长期存储在 Rust 侧 SQLite。
   * 首次升级时，如果发现旧 localStorage 里还有会话，会自动导入 SQLite。
   */
  useEffect(() => {
    let canceled = false;

    const loadConversationHistory = async () => {
      setHistoryError("");

      try {
        const stored = normalizeConversations(
          await invoke<Record<ModelType, Conversation[]>>("load_conversations")
        );
        const legacy = loadConversationsFromStorage();
        const shouldImportLegacy =
          !hasAnyConversations(stored) && hasAnyConversations(legacy);
        const nextConversations = shouldImportLegacy ? legacy : stored;

        if (shouldImportLegacy) {
          await invoke("save_conversations", { conversations: nextConversations });
          clearLegacyConversationsStorage();
        }

        if (!canceled) {
          setConversations(nextConversations);
        }
      } catch (error) {
        const legacy = loadConversationsFromStorage();

        if (!canceled) {
          setConversations(legacy);
          setHistoryError(`会话数据库加载失败，已临时使用旧本地缓存：${String(error)}`);
        }
      } finally {
        if (!canceled) {
          setConversationsReady(true);
        }
      }
    };

    void loadConversationHistory();

    return () => {
      canceled = true;
    };
  }, []);

  /**
   * 会话变化后写入 SQLite。用短延迟合并连续编辑，避免改会话名时每个字符都落库。
   */
  useEffect(() => {
    if (!conversationsReady) {
      return;
    }

    const saveTimer = window.setTimeout(() => {
      void invoke("save_conversations", { conversations }).catch((error) => {
        setHistoryError(`会话数据库保存失败：${String(error)}`);
      });
    }, 300);

    return () => window.clearTimeout(saveTimer);
  }, [conversations, conversationsReady]);

  /**
   * 记录“当前模型 + 当前会话”。
   * 设置页切回聊天页后，也能继续停留在用户刚刚使用的位置。
   */
  useEffect(() => {
    saveUserState(model, currentConversationId);
  }, [model, currentConversationId]);

  useEffect(() => {
    if (!currentModelMultimodal && pendingAttachments.length > 0) {
      setPendingAttachments([]);
    }
  }, [currentModelMultimodal, pendingAttachments.length]);

  /**
   * 当用户切换模型时，检查当前会话 ID 是否仍然有效。
   * 这是之前容易出问题的地方：旧模型的会话 ID 在新模型里不存在，会导致右侧空白。
   */
  useEffect(() => {
    if (!conversationsReady) {
      return;
    }

    const hasCurrentConversation = currentModelConversations.some(
      (conversation) => conversation.id === currentConversationId
    );

    if (!hasCurrentConversation) {
      setCurrentConversationId(currentModelConversations[0]?.id ?? null);
    }
  }, [conversationsReady, currentConversationId, currentModelConversations]);

  /**
   * 新消息加入后自动滚动到底部，保证桌面端长对话体验更顺手。
   */
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentConversation?.messages.length, loading]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      mediaRecorderRef.current?.stop();
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  /**
   * 当前模型是否已经配置可用。
   * 只要 base_url、api_key 和 model 名称任意一个为空，就视为未完成配置。
   */
  const currentModelReady = isModelConfigured(appConfig, model);
  const agentQuickActionsReady = appConfig.agent.enabled;

  const switchProviderModel = async (modelName: string) => {
    const nextConfig = updateModelConfig(appConfig, model, { model: modelName });

    setAppConfig(nextConfig);
    setConfigError("");

    try {
      await invoke("save_app_config", { config: nextConfig });
    } catch (error) {
      setConfigError(`模型切换保存失败：${String(error)}`);
    }
  };

  const addImageAttachments = async (files: FileList | null) => {
    if (!files?.length) {
      return;
    }

    if (!currentModelMultimodal) {
      setSpeechError("当前模型未开启多模态能力，请先在设置页开启后再发送图片。");
      return;
    }

    try {
      const remainingSlots = MAX_IMAGE_ATTACHMENTS - pendingAttachments.length;
      const selectedFiles = Array.from(files).slice(0, Math.max(remainingSlots, 0));
      const nextAttachments = await Promise.all(
        selectedFiles.map(async (file) => {
          if (!file.type.startsWith("image/")) {
            throw new Error(`${file.name} 不是图片文件。`);
          }

          if (file.size > MAX_IMAGE_SIZE) {
            throw new Error(`${file.name} 超过 8MB。`);
          }

          return {
            id: `image-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            type: "image" as const,
            name: file.name,
            mime_type: file.type || "image/png",
            data_url: await fileToDataUrl(file),
          };
        })
      );

      setPendingAttachments((current) =>
        [...current, ...nextAttachments].slice(0, MAX_IMAGE_ATTACHMENTS)
      );
      setSpeechError("");
    } catch (error) {
      setSpeechError(`图片添加失败：${String(error)}`);
    } finally {
      if (imageInputRef.current) {
        imageInputRef.current.value = "";
      }
    }
  };

  const removePendingAttachment = (attachmentId: string) => {
    setPendingAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId)
    );
  };

  /**
   * 新建会话时使用模型名做前缀，方便用户在多模型场景下快速区分用途。
   */
  const createNewConversation = () => {
    const now = Date.now();
    const nextConversation: Conversation = {
      id: `${model}-${Date.now()}`,
      model,
      provider_model: currentProviderConfig.model,
      name: `${currentModelMeta.label} 会话 ${currentModelConversations.length + 1}`,
      created_at: now,
      updated_at: now,
      messages: [],
    };

    setConversations((previous) => ({
      ...previous,
      [model]: [nextConversation, ...(previous[model] ?? [])],
    }));
    setCurrentConversationId(nextConversation.id);
    setMobileSidebarOpen(false);
  };

  /**
   * 删除会话后，如果删掉的正好是当前会话，就回退到同模型下第一条会话。
   */
  const deleteConversation = (conversationId: string) => {
    const nextConversations = currentModelConversations.filter(
      (conversation) => conversation.id !== conversationId
    );

    setConversations((previous) => ({
      ...previous,
      [model]: nextConversations,
    }));

    if (currentConversationId === conversationId) {
      setCurrentConversationId(nextConversations[0]?.id ?? null);
    }
  };

  /**
   * 会话名称支持就地编辑。
   * 为了避免误清空，这里对纯空白做了 trim 校验，空值时回退到原名称。
   */
  const renameConversation = (conversationId: string, name: string) => {
    const now = Date.now();

    setConversations((previous) => ({
      ...previous,
      [model]: (previous[model] ?? []).map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              name: name.trimStart(),
              updated_at: now,
            }
          : conversation
      ),
    }));
  };

  const runAgentQuickAction = async (text: string): Promise<Message | null> => {
    const action = parseAgentQuickAction(text);

    if (!action) {
      return null;
    }

    if (action.kind === "unsupported") {
      return {
        role: "ai",
        content: "这个操作我现在还没接上真实工具。当前可直接执行的是：打开网页 URL / 读取网页文本 / 打开本地路径 / 复制文本 / 执行明确输入的 Shell 命令。下一步接入独立浏览器后，才能做截图观察、点击和填写表单。",
      };
    }

    if (!appConfig.agent.enabled) {
      return {
        role: "ai",
        content: "Agent 还没有开启。请到设置页的“Agent 设置”里打开总开关，并开启对应的浏览器或系统操作能力。",
      };
    }

    if (
      action.category === "browser" &&
      (!appConfig.agent.browser_enabled || !appConfig.agent.enabled_skills.includes(action.skill))
    ) {
      return {
        role: "ai",
        content: `浏览器技能 ${action.skill} 还没有启用。请到设置页的“Agent 设置”里开启浏览器操作和对应技能。`,
      };
    }

    const systemCapabilityEnabled =
      action.kind === "shell" ? appConfig.agent.shell_enabled : appConfig.agent.system_enabled;

    if (
      action.category === "system" &&
      (!systemCapabilityEnabled || !appConfig.agent.enabled_skills.includes(action.skill))
    ) {
      return {
        role: "ai",
        content:
          action.kind === "shell"
            ? `Shell 技能 ${action.skill} 还没有启用。请到设置页的“Agent 设置”里开启 Shell 执行和对应技能。`
            : `系统技能 ${action.skill} 还没有启用。请到设置页的“Agent 设置”里开启系统操作和对应技能。`,
      };
    }

    if (appConfig.agent.require_confirmation) {
      const accepted = window.confirm(`Agent 准备执行：${action.confirmText}\n\n是否继续？`);

      if (!accepted) {
        return {
          role: "ai",
          content: `已取消：${action.confirmText}`,
        };
      }
    }

    try {
      if (action.kind === "open_url") {
        await openUrl(action.url);
        return {
          role: "ai",
          content: `已打开网页：${action.url}\n\n当前版本先调用系统默认浏览器打开网页；后续会升级为独立 Agent 浏览器，并支持读取页面、截图观察和点击操作。`,
        };
      }

      if (action.kind === "fetch_url_text") {
        const page = await invoke<AgentFetchedPage>("agent_fetch_url_text", {
          url: action.url,
        });
        const title = page.title || "未提取到标题";
        return {
          role: "ai",
          content: `已读取网页文本：${title}\n${page.url}\n\n${page.text}`,
        };
      }

      if (action.kind === "open_path") {
        await openPath(action.path);
        return {
          role: "ai",
          content: `已打开路径：${action.path}`,
        };
      }

      if (action.kind === "shell") {
        const result = await invoke<AgentShellResult>("agent_run_shell", {
          request: {
            command: action.command,
            cwd: action.cwd,
          },
        });
        return {
          role: "ai",
          content: formatShellResult(result),
        };
      }

      await navigator.clipboard.writeText(action.text);
      return {
        role: "ai",
        content: "已复制到剪贴板。",
      };
    } catch (agentError) {
      return {
        role: "ai",
        content: `Agent 操作失败：${String(agentError)}`,
      };
    }
  };

  const runAgentAutoShellAction = async (
    text: string,
    optimisticMessages: Message[],
    conversationId: string
  ): Promise<Message | null> => {
    if (
      !currentModelReady ||
      !appConfig.agent.enabled ||
      !appConfig.agent.shell_enabled ||
      !appConfig.agent.enabled_skills.includes("system.shell")
    ) {
      return null;
    }

    let plan: AgentShellPlan;
    try {
      plan = await invoke<AgentShellPlan>("agent_plan_shell_action", {
        request: {
          model,
          userText: text,
          messages: optimisticMessages.map(toApiMessage),
        },
      });
    } catch (planError) {
      console.warn("Agent Shell 规划失败，回退到普通聊天。", planError);
      return null;
    }

    if (!plan.should_run || !plan.command.trim()) {
      return null;
    }

    let result: AgentShellResult;
    try {
      result = await invoke<AgentShellResult>("agent_run_shell", {
        request: {
          command: plan.command,
          cwd: "",
        },
      });
    } catch (shellError) {
      return {
        role: "ai",
        content: `Agent 判断需要执行 Shell，但命令运行失败。\n\n计划命令：\`${plan.command}\`\n原因：${plan.reason || "未提供"}\n错误：${String(shellError)}`,
      };
    }
    const toolContext = buildShellToolContext(plan, result);
    const reply = await invoke<ChatReplyResponse>("chat_with_ai", {
      model,
      messages: [
        ...optimisticMessages.map(toApiMessage),
        {
          role: "user",
          content: toolContext,
        },
      ],
      conversationId,
    });
    const replyImages = extractImageAttachments(reply.content);
    const replyContent = stripImageMarkdown(reply.content);

    return {
      role: "ai",
      content: replyContent || reply.content,
      tts_text: reply.tts_text,
      original_content: reply.original_content || reply.content,
      attachments: replyImages,
    };
  };

  /**
   * 输入发送的核心逻辑：
   * 1. 先把用户消息写进本地 UI，保证页面即时反馈。
   * 2. 再把标准化后的 messages 传给 Rust 后端。
   * 3. 成功时写入 AI 回复，失败时写入错误提示气泡。
   */
  const sendMessage = async () => {
    if (
      (!input.trim() && pendingAttachments.length === 0) ||
      loading ||
      !conversationsReady
    ) {
      return;
    }

    if (pendingAttachments.length > 0 && !currentModelMultimodal) {
      setSpeechError("当前模型未开启多模态能力，不能发送图片。");
      return;
    }

    const now = Date.now();
    const activeConversation: Conversation =
      currentConversation ??
      {
        id: `${model}-${Date.now()}`,
        model,
        provider_model: currentProviderConfig.model,
        name: `${currentModelMeta.label} 会话 ${currentModelConversations.length + 1}`,
        created_at: now,
        updated_at: now,
        messages: [],
      };
    const shouldCreateConversation = !currentConversation;
    const userMessage: Message = {
      role: "user",
      content: input.trim(),
      attachments: pendingAttachments,
    };

    const optimisticMessages = [...activeConversation.messages, userMessage];

    setConversations((previous) => ({
      ...previous,
      [model]: shouldCreateConversation
        ? [
            { ...activeConversation, updated_at: now, messages: optimisticMessages },
            ...(previous[model] ?? []),
          ]
        : (previous[model] ?? []).map((conversation) =>
            conversation.id === activeConversation.id
              ? { ...conversation, updated_at: now, messages: optimisticMessages }
              : conversation
          ),
    }));
    setCurrentConversationId(activeConversation.id);

    setInput("");
    setPendingAttachments([]);
    setLoading(true);

    try {
      const agentReply = await runAgentQuickAction(input.trim());

      if (agentReply) {
        setConversations((previous) => ({
          ...previous,
          [model]: (previous[model] ?? []).map((conversation) =>
            conversation.id === activeConversation.id
              ? {
                  ...conversation,
                  updated_at: Date.now(),
                  messages: [...optimisticMessages, agentReply],
                }
              : conversation
          ),
        }));
        return;
      }

      const autoAgentReply = await runAgentAutoShellAction(
        input.trim(),
        optimisticMessages,
        activeConversation.id
      );

      if (autoAgentReply) {
        setConversations((previous) => ({
          ...previous,
          [model]: (previous[model] ?? []).map((conversation) =>
            conversation.id === activeConversation.id
              ? {
                  ...conversation,
                  updated_at: Date.now(),
                  messages: [...optimisticMessages, autoAgentReply],
                }
              : conversation
          ),
        }));
        return;
      }

      if (!currentModelReady) {
        setConversations((previous) => ({
          ...previous,
          [model]: (previous[model] ?? []).map((conversation) =>
            conversation.id === activeConversation.id
              ? {
                  ...conversation,
                  updated_at: Date.now(),
                  messages: [
                    ...optimisticMessages,
                    {
                      role: "ai",
                      content: "当前模型还没有配置完整。要聊天请先到设置页填写模型配置；要使用 Agent 操作，请先在设置页开启 Agent。",
                    },
                  ],
                }
              : conversation
          ),
        }));
        return;
      }

      const apiMessages = optimisticMessages.map(toApiMessage);

      const reply = await invoke<ChatReplyResponse>("chat_with_ai", {
        model,
        messages: apiMessages,
        conversationId: activeConversation.id,
      });
      const replyImages = extractImageAttachments(reply.content);
      const replyContent = stripImageMarkdown(reply.content);

      setConversations((previous) => ({
        ...previous,
        [model]: (previous[model] ?? []).map((conversation) =>
          conversation.id === activeConversation.id
            ? {
                ...conversation,
                updated_at: Date.now(),
                messages: [
                  ...optimisticMessages,
                  {
                    role: "ai",
                    content: replyContent || reply.content,
                    tts_text: reply.tts_text,
                    original_content: reply.original_content || reply.content,
                    attachments: replyImages,
                  },
                ],
              }
            : conversation
        ),
      }));
    } catch (error) {
      setConversations((previous) => ({
        ...previous,
        [model]: (previous[model] ?? []).map((conversation) =>
          conversation.id === activeConversation.id
            ? {
                ...conversation,
                updated_at: Date.now(),
                messages: [
                  ...optimisticMessages,
                  {
                    role: "ai",
                    content: `请求失败，请检查模型配置或网络状态。\n${String(error)}`,
                  },
                ],
              }
            : conversation
        ),
      }));
    } finally {
      setLoading(false);
    }
  };

  const toggleOriginal = (messageKey: string) => {
    setExpandedOriginalKeys((current) =>
      current.includes(messageKey)
        ? current.filter((key) => key !== messageKey)
        : [...current, messageKey]
    );
  };

  const startEditReply = (message: Message, messageKey: string) => {
    setEditingReply({
      messageKey,
      content: message.content,
      ttsText: message.tts_text ?? "",
    });
  };

  const cancelEditReply = () => {
    setEditingReply(null);
  };

  const saveEditedReply = (messageIndex: number) => {
    if (!editingReply) {
      return;
    }

    const nextContent = editingReply.content.trim();
    if (!nextContent) {
      setSpeechError("显示文本不能为空。");
      return;
    }

    setConversations((previous) => ({
      ...previous,
      [model]: (previous[model] ?? []).map((conversation) =>
        conversation.id === currentConversationId
          ? {
              ...conversation,
              updated_at: Date.now(),
              messages: conversation.messages.map((message, index) =>
                index === messageIndex && message.role === "ai"
                  ? {
                      ...message,
                      content: nextContent,
                      tts_text: editingReply.ttsText.trim(),
                      original_content: message.original_content ?? message.content,
                    }
                  : message
              ),
            }
          : conversation
      ),
    }));
    setEditingReply(null);
    setSpeechError("");
  };

  const copyReply = async (content: string, messageKey: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageKey(messageKey);
      setCopyNotice("回复已复制到剪贴板。");
      setCopyNoticeClosing(false);
      window.setTimeout(() => {
        setCopiedMessageKey((current) => (current === messageKey ? null : current));
        setCopyNoticeClosing(true);
      }, 1000);
      window.setTimeout(() => {
        setCopyNotice("");
        setCopyNoticeClosing(false);
      }, 1200);
    } catch (error) {
      setSpeechError(`复制失败：${String(error)}`);
    }
  };

  const stopSpeech = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setSpeakingMessageKey(null);
  };

  const speakReply = async (message: Message, messageKey: string) => {
    if (speakingMessageKey === messageKey) {
      stopSpeech();
      return;
    }

    if (!ttsReady) {
      setSpeechError(
        "TTS 配置不完整。mimo-v2.5-tts-voicedesign 还需要在设置页填写音色描述。"
      );
      return;
    }

    stopSpeech();
    setSpeechError("");
    setSpeakingMessageKey(messageKey);

    try {
      const ttsText = message.tts_text?.trim() || message.content;
      const audio = await invoke<SynthesizeSpeechResponse>("synthesize_speech", {
        request: {
          text: ttsText,
          format: "wav",
        },
      });
      const player = new Audio(`data:${audio.mime_type};base64,${audio.audio_base64}`);

      audioRef.current = player;
      player.onended = () => setSpeakingMessageKey(null);
      player.onerror = () => {
        setSpeakingMessageKey(null);
        setSpeechError("语音播放失败，请检查返回的音频格式。");
      };

      await player.play();
    } catch (error) {
      setSpeakingMessageKey(null);
      setSpeechError(`语音朗读失败：${String(error)}`);
    }
  };

  const cleanupRecording = () => {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    mediaRecorderRef.current = null;
    recordingChunksRef.current = [];
  };

  const finishRecording = async (blob: Blob) => {
    setRecordingState("transcribing");

    try {
      if (blob.size === 0) {
        throw new Error("没有采集到有效音频。");
      }

      const audioBase64 = await recordedBlobToWavBase64(blob);
      const result = await invoke<TranscribeAudioResponse>("transcribe_audio", {
        request: {
          audio_base64: audioBase64,
          mime_type: "audio/wav",
        },
      });
      const text = result.text.trim();

      if (!text) {
        throw new Error("没有识别到可用文本。");
      }

      setInput((current) => {
        const separator = current.trim() ? "\n" : "";
        return `${current}${separator}${text}`;
      });
      setSpeechError("");
    } catch (error) {
      setSpeechError(`语音输入失败：${String(error)}`);
    } finally {
      cleanupRecording();
      setRecordingState("idle");
    }
  };

  const startRecording = async () => {
    if (!asrReady) {
      setSpeechError("ASR 配置不完整，请先在设置页补全当前识别服务所需字段。");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setSpeechError("当前环境不支持麦克风录音。");
      return;
    }

    try {
      setSpeechError("");
      stopSpeech();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredTypes = [
        "audio/webm;codecs=opus",
        "audio/ogg;codecs=opus",
        "audio/webm",
        "audio/ogg",
      ];
      const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      recordingStreamRef.current = stream;
      recordingChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        setSpeechError("录音失败，请检查麦克风权限。");
        cleanupRecording();
        setRecordingState("idle");
      };
      recorder.onstop = () => {
        const recordedBlob = new Blob(recordingChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        void finishRecording(recordedBlob);
      };

      recorder.start();
      setRecordingState("recording");
    } catch (error) {
      cleanupRecording();
      setRecordingState("idle");
      setSpeechError(`无法启动麦克风：${String(error)}`);
    }
  };

  const toggleRecording = () => {
    if (recordingState === "recording") {
      mediaRecorderRef.current?.stop();
      return;
    }

    if (recordingState === "idle") {
      void startRecording();
    }
  };

  return (
    <div className="page-shell chat-page">
      {/* 顶部导航区：负责品牌展示、状态说明和进入设置页。 */}
      <header className="page-header chat-header">
        <div className="header-actions">
          <div className={`status-chip ${currentModelReady ? "is-ready" : "is-warning"}`}>
            {currentModelReady ? "当前模型已就绪" : "当前模型待配置"}
          </div>

          <button
            type="button"
            className="icon-action mobile-sidebar-toggle"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="打开模型和会话侧边栏"
          >
            <IoMenu size={20} />
          </button>

          <Link className="icon-action" to="/settings" aria-label="打开设置页">
            <IoSettingsSharp size={20} />
          </Link>
        </div>
      </header>

      {/* 页面主区域：左侧为模型和会话，右侧为聊天内容。 */}
      <div className="chat-layout">
        <button
          type="button"
          className={`chat-sidebar-backdrop ${mobileSidebarOpen ? "is-open" : ""}`}
          onClick={() => setMobileSidebarOpen(false)}
          aria-label="关闭模型和会话侧边栏"
        />

        <aside className={`chat-sidebar glass-panel ${mobileSidebarOpen ? "is-open" : ""}`}>
          <div className="chat-sidebar__mobile-header">
            <div>
              <p className="section-kicker">模型与会话</p>
              <h2>工作区</h2>
            </div>
            <button
              type="button"
              className="icon-action"
              onClick={() => setMobileSidebarOpen(false)}
              aria-label="关闭模型和会话侧边栏"
            >
              <IoClose size={20} />
            </button>
          </div>

          <section className="sidebar-section model-select-section">
            <div className="section-heading">
              <div>
                <p className="section-kicker">模型切换</p>
                <h2>选择工作模型</h2>
              </div>
            </div>

            <label className="model-select-label" htmlFor="chat-provider-select">
              模型列表
            </label>
            <CustomSelect
              id="chat-provider-select"
              className="model-select"
              value={model}
              options={modelOptions.map((option) => ({
                value: option.id,
                label: `${option.label} - ${option.provider}`,
              }))}
              onChange={(value) => {
                setModel(value as ModelType);
                setMobileSidebarOpen(false);
              }}
            />

            <label className="model-select-label" htmlFor="chat-provider-model-select">
              供应商模型
            </label>
            <CustomSelect
              id="chat-provider-model-select"
              className="model-select"
              value={currentProviderConfig.model}
              disabled={providerModelChoices.length === 0}
              placeholder={providerModelChoices.length === 0 ? "未添加模型" : "请选择模型"}
              options={providerModelChoices.map((modelName) => ({
                value: modelName,
                label: modelName,
              }))}
              onChange={(value) => void switchProviderModel(value)}
            />

          </section>

          <section className="sidebar-section">
            <div className="section-heading">
              <div>
                <p className="section-kicker">会话管理</p>
                <h2>{currentModelMeta.label} 会话列表</h2>
              </div>

              <button
                type="button"
                className="icon-action conversation-create-button"
                onClick={createNewConversation}
                title="新建会话"
                aria-label="新建会话"
              >
                <IoCreateOutline size={17} />
              </button>
            </div>

            {currentModelConversations.length > 0 ? (
              <ul className="conversation-list">
                {currentModelConversations.map((conversation) => (
                  <li
                    key={conversation.id}
                    className={`conversation-card ${
                      conversation.id === currentConversationId ? "is-active" : ""
                    }`}
                    onClick={() => {
                      setCurrentConversationId(conversation.id);
                      setMobileSidebarOpen(false);
                    }}
                  >
                    <div className="conversation-card__header">
                      <IoChatbubbleEllipses size={16} />
                      <span>{conversation.messages.length} 条消息</span>
                    </div>

                    <input
                      className="conversation-name"
                      value={conversation.name}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        renameConversation(conversation.id, event.target.value || "未命名会话")
                      }
                    />

                    <button
                      type="button"
                      className="conversation-delete-button"
                      aria-label={`删除会话 ${conversation.name}`}
                      title="删除会话"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteConversation(conversation.id);
                      }}
                    >
                      <IoTrashOutline size={17} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-card">
                <p>当前模型还没有会话。</p>
                <span>先创建一个新会话，再开始提问会更顺手。</span>
              </div>
            )}
          </section>
        </aside>

        <main className="chat-main glass-panel">
          {/* 聊天区头部：展示当前模型信息和配置状态。 */}
          <div className="chat-main__header">
            <div>
              <p className="section-kicker">当前模型</p>
              <h2>{currentModelMeta.label}</h2>
              <p className="chat-main__subtitle">{currentModelMeta.description}</p>
            </div>

            <div className="chat-main__summary">
              <span>{currentConversation?.messages.length ?? 0} 条消息</span>
              <span>{currentConversation ? "已选中会话" : "未选中会话"}</span>
            </div>
          </div>

          {/* 这里集中展示配置加载问题，避免状态信息散落在页面各处。 */}
          {(configStatus === "error" ||
            historyError ||
            (!currentModelReady && configStatus === "ready") ||
            speechError ||
            copyNotice) && (
            <div className="floating-alerts floating-alerts--chat" aria-live="polite">
              {configStatus === "error" && (
                <div className="alert-banner alert-banner--error">
                  配置加载失败：{configError}
                </div>
              )}

              {historyError && (
                <div className="alert-banner alert-banner--warning">{historyError}</div>
              )}

              {!currentModelReady && configStatus === "ready" && (
                <div className="alert-banner alert-banner--warning">
                  当前模型还没有配置完整。请前往设置页补充 Base URL、API Key 和模型名。
                </div>
              )}

              {speechError && (
                <div className="alert-banner alert-banner--warning">{speechError}</div>
              )}

              {copyNotice && (
                <div
                  className={`alert-banner alert-banner--success ${
                    copyNoticeClosing ? "is-leaving" : ""
                  }`}
                >
                  {copyNotice}
                </div>
              )}
            </div>
          )}

          <div className="chat-box">
            {currentConversation ? (
              currentConversation.messages.length > 0 ? (
                currentConversation.messages.map((message, index) => {
                  const messageKey = `${currentConversation.id}-${message.role}-${index}`;
                  const isSpeaking = speakingMessageKey === messageKey;

                  return (
                    <ChatMessageBubble
                      key={messageKey}
                      message={message}
                      messageKey={messageKey}
                      messageIndex={index}
                      modelLabel={currentModelMeta.label}
                      ttsReady={ttsReady}
                      isSpeaking={isSpeaking}
                      isCopied={copiedMessageKey === messageKey}
                      isOriginalExpanded={expandedOriginalKeys.includes(messageKey)}
                      editingReply={editingReply}
                      onCopy={(content, key) => void copyReply(content, key)}
                      onToggleOriginal={toggleOriginal}
                      onStartEdit={startEditReply}
                      onEditChange={setEditingReply}
                      onCancelEdit={cancelEditReply}
                      onSaveEdit={saveEditedReply}
                      onSpeak={(targetMessage, key) => void speakReply(targetMessage, key)}
                    />
                  );
                })
              ) : (
                <div className="chat-empty-state">
                  <h3>会话已创建</h3>
                  <p>现在可以直接输入问题，或者先去设置页确认该模型的接口信息。</p>
                </div>
              )
            ) : (
              <div className="chat-empty-state">
                <h3>直接输入即可开始</h3>
                <p>发送第一条消息时会自动创建新会话，也可以从侧边栏手动新建。</p>
              </div>
            )}

            {loading && (
              <div className="chat-line chat-ai">
                <div className="chat-bubble">
                  <span className="chat-role">{currentModelMeta.label}</span>
                  <p>正在整理回复，请稍等...</p>
                </div>
              </div>
            )}

            <div ref={chatBottomRef} />
          </div>

          {/* 底部输入区统一处理禁用态、回车发送和辅助说明。 */}
          <div className="input-panel">
            <div className="input-caption">
              {currentConversation
                ? "Enter 发送消息，先把模型配置好可以避免请求失败。"
                : "还没有会话，发送第一条消息时会自动创建。"}
            </div>

            <div className="input-area">
              <textarea
                className="input-box"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="输入问题、代码需求或灵感草稿..."
                disabled={loading || (!currentModelReady && !agentQuickActionsReady) || !conversationsReady}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
              />

              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden-file-input"
                onChange={(event) => void addImageAttachments(event.target.files)}
              />

              <button
                type="button"
                className="ghost-button image-attach-button"
                onClick={() => imageInputRef.current?.click()}
                disabled={
                  loading ||
                  !currentModelReady ||
                  !conversationsReady ||
                  !currentModelMultimodal ||
                  pendingAttachments.length >= MAX_IMAGE_ATTACHMENTS
                }
                title={currentModelMultimodal ? "添加图片" : "当前模型未开启多模态"}
                aria-label={currentModelMultimodal ? "添加图片" : "当前模型未开启多模态"}
              >
                <IoImageOutline size={20} />
              </button>

              <button
                type="button"
                className={`ghost-button record-button ${
                  recordingState === "recording" ? "is-recording" : ""
                }`}
                onClick={toggleRecording}
                disabled={
                  loading ||
                  !currentModelReady ||
                  !conversationsReady ||
                  recordingState === "transcribing"
                }
                title={
                  recordingState === "recording"
                    ? "停止录音"
                    : recordingState === "transcribing"
                      ? "正在识别"
                      : "语音输入"
                }
                aria-label={
                  recordingState === "recording"
                    ? "停止录音"
                    : recordingState === "transcribing"
                      ? "正在识别"
                      : "语音输入"
                }
              >
                {recordingState === "recording" ? (
                  <IoStopCircleOutline size={20} />
                ) : (
                  <IoMic size={20} />
                )}
              </button>

              <button
                type="button"
                className="primary-button send-button"
                onClick={() => void sendMessage()}
                disabled={
                  loading ||
                  (!input.trim() && pendingAttachments.length === 0) ||
                  (!currentModelReady && !agentQuickActionsReady) ||
                  !conversationsReady ||
                  recordingState !== "idle"
                }
              >
                {loading ? "发送中..." : "发送"}
              </button>
            </div>

            {pendingAttachments.length > 0 && (
              <div className="attachment-preview-list">
                {pendingAttachments.map((attachment) => (
                  <div className="attachment-preview" key={attachment.id}>
                    <img src={attachment.data_url} alt={attachment.name} />
                    <button
                      type="button"
                      className="attachment-remove-button"
                      onClick={() => removePendingAttachment(attachment.id)}
                      aria-label={`移除图片 ${attachment.name}`}
                      title="移除"
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;

const fileToDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
};

const toApiMessage = (message: Message) => {
  if (message.role === "user" && message.attachments?.length) {
    return {
      role: "user",
      content: [
        {
          type: "text",
          text: message.content || "请根据图片内容继续回答。",
        },
        ...message.attachments.map((attachment) => ({
          type: "image_url",
          image_url: {
            url: attachment.data_url,
          },
        })),
      ],
    };
  }

  return {
    role: message.role === "ai" ? "assistant" : "user",
    content: message.content,
  };
};

const extractImageAttachments = (content: string): MessageAttachment[] => {
  const attachments: MessageAttachment[] = [];
  const pattern = markdownImagePattern();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    attachments.push({
      id: `reply-image-${attachments.length}-${Date.now()}`,
      type: "image",
      name: match[1] || "AI 图片",
      mime_type: match[2].startsWith("data:image/")
        ? match[2].slice(5, match[2].indexOf(";"))
        : "image",
      data_url: match[2],
    });
  }

  return attachments;
};

const stripImageMarkdown = (content: string): string => {
  return content.replace(markdownImagePattern(), "").trim();
};

const markdownImagePattern = () =>
  /!\[([^\]]*)\]\((data:image\/[^)]+|https?:\/\/[^)\s]+)\)/g;

type AgentQuickAction =
  | {
      kind: "open_url";
      category: "browser";
      skill: "browser.open";
      url: string;
      confirmText: string;
    }
  | {
      kind: "fetch_url_text";
      category: "browser";
      skill: "browser.extract_text";
      url: string;
      confirmText: string;
    }
  | {
      kind: "open_path";
      category: "system";
      skill: "system.open_path";
      path: string;
      confirmText: string;
    }
  | {
      kind: "copy_text";
      category: "system";
      skill: "system.copy_text";
      text: string;
      confirmText: string;
    }
  | {
      kind: "shell";
      category: "system";
      skill: "system.shell";
      command: string;
      cwd: string;
      confirmText: string;
    }
  | {
      kind: "unsupported";
      category: "browser";
      skill: "browser.open";
      confirmText: string;
    };

const parseAgentQuickAction = (text: string): AgentQuickAction | null => {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  const shellCommand = extractShellCommand(trimmed);
  if (shellCommand) {
    return {
      kind: "shell",
      category: "system",
      skill: "system.shell",
      command: shellCommand,
      cwd: "",
      confirmText: `执行 Shell 命令：${shellCommand}`,
    };
  }

  const copyText = extractCopyText(trimmed);
  if (copyText) {
    return {
      kind: "copy_text",
      category: "system",
      skill: "system.copy_text",
      text: copyText,
      confirmText: "复制文本到剪贴板",
    };
  }

  const pageTextUrl = extractPageTextUrl(trimmed);
  if (pageTextUrl) {
    return {
      kind: "fetch_url_text",
      category: "browser",
      skill: "browser.extract_text",
      url: pageTextUrl,
      confirmText: `读取网页文本 ${pageTextUrl}`,
    };
  }

  const path = extractPathToOpen(trimmed);
  if (path) {
    return {
      kind: "open_path",
      category: "system",
      skill: "system.open_path",
      path,
      confirmText: `打开路径 ${path}`,
    };
  }

  const url = extractUrlToOpen(trimmed);
  if (url) {
    return {
      kind: "open_url",
      category: "browser",
      skill: "browser.open",
      url,
      confirmText: `打开网页 ${url}`,
    };
  }

  if (/截图|读取.*页面|提取.*页面|点击|填写|提交|浏览器|操作/.test(trimmed)) {
    return {
      kind: "unsupported",
      category: "browser",
      skill: "browser.open",
      confirmText: "暂未支持的 Agent 操作",
    };
  }

  return null;
};

const extractPageTextUrl = (text: string): string | null => {
  if (!/(读取|提取|总结|分析|查看).*(网页|页面|网站|URL|链接|内容)/i.test(text)) {
    return null;
  }

  return extractUrlFromText(text);
};

const extractUrlToOpen = (text: string): string | null => {
  if (!/(打开|访问|浏览|网页|网站|搜索)/.test(text)) {
    return null;
  }

  const explicitUrl = extractUrlFromText(text);
  if (explicitUrl) {
    return explicitUrl;
  }

  const commonSites: Array<[RegExp, string]> = [
    [/百度|baidu/i, "https://www.baidu.com"],
    [/哔哩哔哩|bilibili|b站/i, "https://www.bilibili.com"],
    [/github/i, "https://github.com"],
    [/google|谷歌/i, "https://www.google.com"],
    [/知乎|zhihu/i, "https://www.zhihu.com"],
  ];
  const matchedSite = commonSites.find(([pattern]) => pattern.test(text));

  return matchedSite?.[1] ?? null;
};

const extractUrlFromText = (text: string): string | null => {
  const urlMatch = text.match(/https?:\/\/[^\s，。；、)）]+/i);
  if (urlMatch) {
    return urlMatch[0];
  }

  const wwwMatch = text.match(/www\.[^\s，。；、)）]+/i);
  if (wwwMatch) {
    return `https://${wwwMatch[0]}`;
  }

  return null;
};

const extractPathToOpen = (text: string): string | null => {
  if (!/(打开|访问|定位|查看).*(文件|文件夹|目录|路径|盘|[A-Za-z]:\\|[A-Za-z]:\/)/.test(text)) {
    return null;
  }

  const windowsPath = text.match(/[A-Za-z]:[\\/][^\n\r]+/);
  if (windowsPath) {
    return windowsPath[0].trim().replace(/[，。；]+$/, "");
  }

  const quotedPath = text.match(/[“"']([^“"']+[\\/][^“"']+)[”"']/);
  return quotedPath?.[1]?.trim() ?? null;
};

const extractCopyText = (text: string): string | null => {
  const match = text.match(/^(?:帮我)?复制(?:一下|到剪贴板)?[：:\s]+([\s\S]+)$/);
  const value = match?.[1]?.trim();

  return value || null;
};

const extractShellCommand = (text: string): string | null => {
  const patterns = [
    /^(?:帮我)?(?:执行|运行)\s*(?:一下)?\s*(?:shell|命令|终端|powershell)\s*[：:\s]+([\s\S]+)$/i,
    /^(?:shell|powershell|pwsh|终端)\s*[：:\s]+([\s\S]+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const command = match?.[1]?.trim();

    if (command) {
      return command;
    }
  }

  return null;
};

const formatShellResult = (result: AgentShellResult): string => {
  const exitStatus = result.timed_out ? "已超时" : `退出码 ${result.exit_code ?? "未知"}`;
  const stdout = escapeMarkdownFence(result.stdout.trim() || "(无)");
  const stderr = result.stderr.trim();
  const stderrBlock = stderr
    ? `\n\nstderr:\n\`\`\`\n${escapeMarkdownFence(stderr)}\n\`\`\``
    : "";

  return `Shell 执行完成：${exitStatus}\n\n命令：\`${result.command}\`\n目录：\`${result.cwd || "."}\`\n\nstdout:\n\`\`\`\n${stdout}\n\`\`\`${stderrBlock}`;
};

const buildShellToolContext = (plan: AgentShellPlan, result: AgentShellResult): string => {
  const exitStatus = result.timed_out ? "已超时" : `退出码 ${result.exit_code ?? "未知"}`;
  const stdout = escapeMarkdownFence(result.stdout.trim() || "(无)");
  const stderr = result.stderr.trim();
  const stderrBlock = stderr
    ? `\n\nstderr:\n\`\`\`\n${escapeMarkdownFence(stderr)}\n\`\`\``
    : "";

  return `你刚刚根据用户需求自动调用了本地 Shell。请基于下面的执行结果，直接回答用户刚才的问题，不要编造没有出现在输出里的事实。\n\n规划理由：${plan.reason || "未提供"}\n命令：\`${result.command}\`\n工作目录：\`${result.cwd || "."}\`\n状态：${exitStatus}\n\nstdout:\n\`\`\`\n${stdout}\n\`\`\`${stderrBlock}`;
};

const escapeMarkdownFence = (text: string): string => {
  return text.replace(/```/g, "`\u200b``");
};
