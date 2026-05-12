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
  CONVERSATIONS_CHANGED_EVENT,
  type AppConfig,
  type AgentScheduledTask,
  type AgentScheduledTaskKind,
  type AgentScheduledTaskScheduleMode,
  type Conversation,
  type Message,
  type MessageAttachment,
  type ModelType,
  clearLegacyConversationsStorage,
  createAgentScheduledTaskId,
  createEmptyAppConfig,
  createEmptyConversations,
  getNextAgentScheduledTaskRun,
  getModelChoices,
  getModelConfig,
  getModelMeta,
  getModelOptions,
  hasAnyConversations,
  loadAgentScheduledTasks,
  loadConversationsFromStorage,
  loadUserState,
  normalizeAgentTaskCustomIntervalDays,
  normalizeAgentTaskTimeOfDay,
  normalizeConversations,
  normalizeAppConfig,
  saveAgentScheduledTasks,
  saveUserState,
  isModelConfigured,
  isAgentSkillEnabled,
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

type AgentTavilyPlan = {
  should_search: boolean;
  query: string;
  reason: string;
};

type AgentScheduledTaskPlan = {
  should_create?: boolean;
  tasks?: AgentScheduledTaskPlanItem[];
  should_update?: boolean;
  updates?: AgentScheduledTaskPlanItem[];
  should_delete?: boolean;
  delete_ids?: string[];
  reason: string;
};

type AgentScheduledTaskPlanItem = {
  id?: string;
  title?: string;
  prompt?: string;
  kind?: string;
  schedule_mode?: string;
  scheduled_at?: string | number;
  time_of_day?: string;
  weekdays?: number[];
  month_day?: number | null;
  year_month?: number | null;
  year_month_day?: number | null;
  custom_interval_days?: number | null;
  enabled?: boolean | null;
  model?: string;
};

type AgentTavilySearchResult = {
  query: string;
  answer: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
    score?: number | null;
  }>;
};

type AgentToolCall =
  | {
      kind: "shell";
      command: string;
    }
  | {
      kind: "tavily";
      query: string;
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

  useEffect(() => {
    let canceled = false;

    const refreshConversationHistory = async () => {
      try {
        const stored = normalizeConversations(
          await invoke<Record<ModelType, Conversation[]>>("load_conversations")
        );

        if (!canceled) {
          setConversations(stored);
          setConversationsReady(true);
          setHistoryError("");
        }
      } catch (error) {
        if (!canceled) {
          setHistoryError(`会话数据库刷新失败：${String(error)}`);
        }
      }
    };

    window.addEventListener(CONVERSATIONS_CHANGED_EVENT, refreshConversationHistory);

    return () => {
      canceled = true;
      window.removeEventListener(CONVERSATIONS_CHANGED_EVENT, refreshConversationHistory);
    };
  }, []);

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
  const confirmAgentShell = (command: string, reason?: string): boolean => {
    if (!appConfig.agent.require_confirmation) {
      return true;
    }

    const reasonText = reason?.trim() ? `\n\n原因：${reason.trim()}` : "";
    return window.confirm(`Agent 准备执行 Shell 命令：\n${command}${reasonText}\n\n是否继续？`);
  };

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

  const summarizeAgentToolContexts = async (
    optimisticMessages: Message[],
    conversationId: string,
    toolContexts: string[],
    intro: string,
    assistantContent = "",
    targetModel: ModelType = model
  ): Promise<ChatReplyResponse> => {
    return await invoke<ChatReplyResponse>("chat_with_ai", {
      model: targetModel,
      messages: [
        ...optimisticMessages.map(toApiMessage),
        ...(assistantContent.trim()
          ? [
              {
                role: "assistant",
                content: assistantContent.trim(),
              },
            ]
          : []),
        {
          role: "user",
          content: `${intro}\n\n${toolContexts.join("\n\n---\n\n")}`,
        },
      ],
      conversationId,
    });
  };

  const saveScheduledTaskState = (tasks: AgentScheduledTask[]) => {
    saveAgentScheduledTasks(tasks);
  };

  const createReplyMessage = (
    reply: ChatReplyResponse,
    taskModel: ModelType,
    toolContexts: string[] = [],
    allowTaskCreation = true,
    fallbackTaskRequest = ""
  ): Message => {
    const structuredTaskCreation = allowTaskCreation
      ? createScheduledTasksFromReply(reply.original_content || reply.content, taskModel)
      : { tasks: [], rejectedCount: 0 };
    const fallbackTaskCreation = allowTaskCreation
      ? createScheduledTasksFromUserRequest(fallbackTaskRequest, taskModel)
      : { tasks: [], rejectedCount: 0 };
    const taskCreation =
      fallbackTaskCreation.tasks.length > 0 ? fallbackTaskCreation : structuredTaskCreation;
    const usedFallbackTaskCreation = fallbackTaskCreation.tasks.length > 0;

    if (taskCreation.tasks.length > 0) {
      saveScheduledTaskState([...loadAgentScheduledTasks(), ...taskCreation.tasks]);
    }

    const cleanedContent = stripScheduledTaskBlocks(stripAgentToolCalls(reply.content));
    const replyImages = extractImageAttachments(cleanedContent);
    const replyContent = stripImageMarkdown(cleanedContent);
    const taskNotice = buildScheduledTaskCreationNotice(taskCreation.tasks);
    const contentParts = usedFallbackTaskCreation
      ? [taskNotice, "已按本机当前时间创建真实计划任务，到点后会自动执行。"].filter(Boolean)
      : [replyContent, taskNotice].filter(Boolean);

    if (taskCreation.rejectedCount > 0) {
      contentParts.push(`有 ${taskCreation.rejectedCount} 个计划任务格式不完整，已忽略。`);
    }

    return {
      role: "ai",
      content:
        contentParts.join("\n\n") ||
        stripScheduledTaskBlocks(stripAgentToolCalls(reply.content)),
      tts_text: reply.tts_text,
      original_content: appendAgentToolOriginalContent(
        reply.original_content || reply.content,
        toolContexts
      ),
      attachments: replyImages,
    };
  };

  const createAgentSummaryMessage = (
    reply: ChatReplyResponse,
    toolContexts: string[] = [],
    targetModel: ModelType = model
  ): Message => createReplyMessage(reply, targetModel, toolContexts);

  const runAgentQuickAction = async (
    text: string,
    optimisticMessages: Message[],
    conversationId: string
  ): Promise<Message | null> => {
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
      !isAgentSkillEnabled(appConfig.agent, action.skill)
    ) {
      return {
        role: "ai",
        content: `Agent 工具 ${action.skill} 还没有启用。请到设置页的“Agent 设置”里打开对应工具。`,
      };
    }

    if (
      action.category === "system" &&
      !isAgentSkillEnabled(appConfig.agent, action.skill)
    ) {
      return {
        role: "ai",
        content: `Agent 工具 ${action.skill} 还没有启用。请到设置页的“Agent 设置”里打开对应工具。`,
      };
    }

    let actionConfirmed = true;

    if (appConfig.agent.require_confirmation) {
      actionConfirmed = window.confirm(`Agent 准备执行：${action.confirmText}\n\n是否继续？`);

      if (!actionConfirmed) {
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
            confirmed: actionConfirmed,
          },
        });
        const toolContext = buildShellToolContext(
          {
            should_run: true,
            command: action.command,
            reason: action.confirmText,
          },
          result
        );

        try {
          const reply = await summarizeAgentToolContexts(
            optimisticMessages,
            conversationId,
            [toolContext],
            "应用已真实执行本地 Shell。请基于下面的真实执行结果直接回复用户，明确任务是否完成，不要编造。"
          );
          return createAgentSummaryMessage(reply, [toolContext]);
        } catch (summaryError) {
          return {
            role: "ai",
            content: `Shell 已执行，但模型总结失败：${String(summaryError)}`,
            original_content: toolContext,
          };
        }
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

  const runAgentScheduledTaskCreation = async (
    text: string,
    optimisticMessages: Message[]
  ): Promise<Message | null> => {
    const isTaskChangeRequest = looksLikeScheduledTaskChangeRequest(text);
    if (
      !currentModelReady ||
      (!looksLikePotentialScheduledTaskRequest(text) && !isTaskChangeRequest)
    ) {
      return null;
    }

    let plan: AgentScheduledTaskPlan;
    const existingTasks = loadAgentScheduledTasks();
    try {
      plan = await invoke<AgentScheduledTaskPlan>("agent_plan_scheduled_tasks", {
        request: {
          model,
          userText: text,
          messages: optimisticMessages.map(toApiMessage),
          existingTasks: existingTasks.map(toScheduledTaskPlannerContext),
        },
      });
    } catch (planError) {
      console.warn("计划任务规划失败，回退到普通聊天。", planError);
      if (isTaskChangeRequest) {
        return {
          role: "ai",
          content: `我识别到你想修改计划任务，但计划任务规划器调用失败，所以没有保存任何变更。\n\n错误：${String(planError)}`,
          tts_text: "(平静)我识别到你想修改计划任务，但规划器调用失败，所以没有保存。",
        };
      }
      return null;
    }

    const safePlan = normalizeScheduledTaskPlanForRequest(plan, text);
    if (!hasScheduledTaskPlanChanges(safePlan)) {
      if (isTaskChangeRequest) {
        return {
          role: "ai",
          content:
            existingTasks.length > 0
              ? `我识别到你想修改计划任务，但没有定位到要修改的那一条，所以没有保存任何变更。\n\n你可以这样说：“把每日早间天气播报改成每周一到周五 9 点”。`
              : "我识别到你想修改计划任务，但当前还没有可修改的计划任务。",
          tts_text: "(平静)我识别到你想修改计划任务，但没有定位到要修改的那一条，所以没有保存。",
          original_content: JSON.stringify(plan, null, 2),
        };
      }
      return null;
    }

    const taskChange = applyScheduledTaskPlan(safePlan, model, existingTasks);
    if (taskChange.changed) {
      saveScheduledTaskState(taskChange.tasks);

      return {
        role: "ai",
        content: `${buildScheduledTaskChangeNotice(taskChange)}\n\n已根据你的要求更新真实计划任务。`,
        tts_text: "(清晰)已根据你的要求更新计划任务。",
        original_content: JSON.stringify(safePlan, null, 2),
      };
    }

    return {
      role: "ai",
      content: `我识别到你想调整计划任务，但规划结果没有通过应用校验，所以没有保存。\n\n原因：${plan.reason || "任务匹配、时间或调度规则不完整"}。请说清楚要改哪一个任务，例如“把每日天气提醒改到早上 8 点”。`,
      tts_text: "(平静)我识别到你想调整计划任务，但任务匹配或时间规则不完整，所以没有保存。",
      original_content: JSON.stringify(safePlan, null, 2),
    };
  };

  const runAgentAutoShellAction = async (
    text: string,
    optimisticMessages: Message[],
    conversationId: string
  ): Promise<Message | null> => {
    if (
      !currentModelReady ||
      !appConfig.agent.enabled ||
      !isAgentSkillEnabled(appConfig.agent, "system.shell")
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

    const confirmed = confirmAgentShell(plan.command, plan.reason);
    if (!confirmed) {
      return {
        role: "ai",
        content: `已取消 Shell 执行。\n\n计划命令：\`${plan.command}\`\n原因：${plan.reason || "未提供"}`,
      };
    }

    let result: AgentShellResult;
    try {
      result = await invoke<AgentShellResult>("agent_run_shell", {
        request: {
          command: plan.command,
          cwd: "",
          confirmed,
        },
      });
    } catch (shellError) {
      return {
        role: "ai",
        content: `Agent 判断需要执行 Shell，但命令运行失败。\n\n计划命令：\`${plan.command}\`\n原因：${plan.reason || "未提供"}\n错误：${String(shellError)}`,
      };
    }
    const toolContext = buildShellToolContext(plan, result);
    const reply = await summarizeAgentToolContexts(
      optimisticMessages,
      conversationId,
      [toolContext],
      "应用已根据用户需求真实执行本地 Shell。请基于下面的真实执行结果直接回复用户，明确任务是否完成，不要编造。"
    );

    return createAgentSummaryMessage(reply, [toolContext]);
  };

  const runAgentAutoTavilyAction = async (
    text: string,
    optimisticMessages: Message[],
    conversationId: string
  ): Promise<Message | null> => {
    if (
      !currentModelReady ||
      !appConfig.agent.enabled ||
      !appConfig.agent.tavily_api_key.trim() ||
      !isAgentSkillEnabled(appConfig.agent, "search.tavily")
    ) {
      return null;
    }

    let plan: AgentTavilyPlan;
    try {
      plan = await invoke<AgentTavilyPlan>("agent_plan_tavily_search", {
        request: {
          model,
          userText: text,
          messages: optimisticMessages.map(toApiMessage),
        },
      });
    } catch (planError) {
      console.warn("Agent Tavily 规划失败，回退到普通聊天。", planError);
      return null;
    }

    if (!plan.should_search || !plan.query.trim()) {
      return null;
    }

    let result: AgentTavilySearchResult;
    try {
      result = await invoke<AgentTavilySearchResult>("agent_tavily_search", {
        request: {
          query: plan.query,
          max_results: appConfig.agent.tavily_max_results,
        },
      });
    } catch (searchError) {
      return {
        role: "ai",
        content: `Agent 判断需要 Tavily 搜索，但搜索失败。\n\n搜索词：\`${plan.query}\`\n原因：${plan.reason || "未提供"}\n错误：${String(searchError)}`,
      };
    }

    const toolContext = buildTavilyToolContext(plan, result);
    const reply = await summarizeAgentToolContexts(
      optimisticMessages,
      conversationId,
      [toolContext],
      "应用已根据用户需求真实调用 Tavily 联网搜索。请基于下面的真实搜索结果直接回复用户，必要时给出来源链接，不要编造。"
    );

    return createAgentSummaryMessage(reply, [toolContext]);
  };

  const resolveAgentToolCallReply = async (
    reply: ChatReplyResponse,
    optimisticMessages: Message[],
    conversationId: string,
    targetModel: ModelType = model
  ): Promise<ChatReplyResponse> => {
    const rawReply = reply.original_content || reply.content;
    const latestUserText = getLatestUserText(optimisticMessages);
    const toolCalls = extractAgentToolCalls(
      rawReply,
      isAgentSkillEnabled(appConfig.agent, "system.shell") && isLocalActionRequest(latestUserText)
    );
    const maxToolCalls = Math.min(Math.max(Math.round(appConfig.agent.max_steps || 1), 1), 30);
    const scheduledToolCalls = toolCalls.slice(0, maxToolCalls);
    const shellToolCall = scheduledToolCalls.find((toolCall) => toolCall.kind === "shell");
    const tavilyToolCall = scheduledToolCalls.find((toolCall) => toolCall.kind === "tavily");

    if (toolCalls.length === 0) {
      return reply;
    }

    if (!appConfig.agent.enabled) {
      return {
        content: "模型请求调用 Agent 工具，但 Agent 总开关没有开启。请到设置页开启 Agent 总开关后再试。",
        tts_text: "(平静)模型请求调用工具，但 Agent 总开关还没有开启。请到设置页打开 Agent。",
        original_content: rawReply,
      };
    }

    if (
      shellToolCall &&
      !isAgentSkillEnabled(appConfig.agent, "system.shell")
    ) {
      return {
        content: "模型请求执行 Shell 工具，但 system.shell 还没有启用。请到设置页开启 Agent 总开关，并打开 Shell 执行工具。",
        tts_text: "(平静)模型请求执行本地命令，但 Shell 能力还没有开启。请到设置页打开对应开关。",
        original_content: rawReply,
      };
    }

    if (
      tavilyToolCall &&
      (!isAgentSkillEnabled(appConfig.agent, "search.tavily") ||
        !appConfig.agent.tavily_api_key.trim())
    ) {
      return {
        content: "模型请求调用 Tavily 搜索，但 search.tavily 没有启用或 Tavily API Key 为空。请到设置页打开 Tavily 搜索工具并填写 API Key。",
        tts_text: "(平静)模型请求联网搜索，但 Tavily 还没有配置完整。请到设置页填写密钥并打开对应开关。",
        original_content: rawReply,
      };
    }

    const toolContexts: string[] = [];
    if (toolCalls.length > scheduledToolCalls.length) {
      toolContexts.push(
        `模型请求了 ${toolCalls.length} 个 Agent 工具调用；当前单次任务步数上限是 ${maxToolCalls}，只执行前 ${scheduledToolCalls.length} 个。`
      );
    }

    for (const [index, toolCall] of scheduledToolCalls.entries()) {
      if (toolCall.kind === "shell") {
        const reason = `模型在回复中请求第 ${index + 1} 个 execute_shell 工具调用。`;
        const confirmed = confirmAgentShell(toolCall.command, reason);
        if (!confirmed) {
          toolContexts.push(
            `第 ${index + 1} 个 Shell 工具调用已被用户取消。\n命令：\`${toolCall.command}\``
          );
          continue;
        }

        try {
          const result = await invoke<AgentShellResult>("agent_run_shell", {
            request: {
              command: toolCall.command,
              cwd: "",
              confirmed,
            },
          });
          toolContexts.push(
            buildShellToolContext(
              {
                should_run: true,
                command: toolCall.command,
                reason,
              },
              result
            )
          );
        } catch (shellError) {
          toolContexts.push(
            `第 ${index + 1} 个 Shell 工具调用失败。\n命令：\`${toolCall.command}\`\n错误：${String(shellError)}`
          );
        }
      } else {
        try {
          const result = await invoke<AgentTavilySearchResult>("agent_tavily_search", {
            request: {
              query: toolCall.query,
              max_results: appConfig.agent.tavily_max_results,
            },
          });
          toolContexts.push(
            buildTavilyToolContext(
              {
                should_search: true,
                query: toolCall.query,
                reason: `模型在回复中请求第 ${index + 1} 个 tavily_search 工具调用。`,
              },
              result
            )
          );
        } catch (searchError) {
          toolContexts.push(
            `第 ${index + 1} 个 Tavily 搜索工具调用失败。\n搜索词：\`${toolCall.query}\`\n错误：${String(searchError)}`
          );
        }
      }
    }

    const finalReply = await summarizeAgentToolContexts(
      optimisticMessages,
      conversationId,
      toolContexts,
      `你刚刚请求了 ${toolCalls.length} 个 Agent 工具调用，应用按当前步数上限处理了 ${scheduledToolCalls.length} 个。请基于下面所有真实结果回复用户，明确哪些任务完成了，哪些任务受系统限制未完成，不要编造。`,
      stripAgentToolCalls(rawReply),
      targetModel
    );

    return {
      ...finalReply,
      original_content: appendAgentToolOriginalContent(
        finalReply.original_content || finalReply.content || rawReply,
        toolContexts
      ),
    };
  };

  /**
   * 输入发送的核心逻辑：
   * 1. 先把用户消息写进本地 UI，保证页面即时反馈。
   * 2. 再把标准化后的 messages 传给 Rust 后端。
   * 3. 成功时写入 AI 回复，失败时写入错误提示气泡。
   */
  const sendMessage = async () => {
    const userText = input.trim();

    if (
      (!userText && pendingAttachments.length === 0) ||
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
      content: userText,
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
      const scheduledTaskReply = await runAgentScheduledTaskCreation(
        userText,
        optimisticMessages
      );

      if (scheduledTaskReply) {
        setConversations((previous) => ({
          ...previous,
          [model]: (previous[model] ?? []).map((conversation) =>
            conversation.id === activeConversation.id
              ? {
                  ...conversation,
                  updated_at: Date.now(),
                  messages: [...optimisticMessages, scheduledTaskReply],
                }
              : conversation
          ),
        }));
        return;
      }

      const agentReply = await runAgentQuickAction(
        userText,
        optimisticMessages,
        activeConversation.id
      );

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

      const tavilyAgentReply = await runAgentAutoTavilyAction(
        userText,
        optimisticMessages,
        activeConversation.id
      );

      if (tavilyAgentReply) {
        setConversations((previous) => ({
          ...previous,
          [model]: (previous[model] ?? []).map((conversation) =>
            conversation.id === activeConversation.id
              ? {
                  ...conversation,
                  updated_at: Date.now(),
                  messages: [...optimisticMessages, tavilyAgentReply],
                }
              : conversation
          ),
        }));
        return;
      }

      const autoAgentReply = await runAgentAutoShellAction(
        userText,
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
      const replyForToolDetection = {
        ...reply,
        original_content: reply.original_content || reply.content,
      };
      const finalReply = await resolveAgentToolCallReply(
        replyForToolDetection,
        optimisticMessages,
        activeConversation.id
      );
      const replyMessage = createReplyMessage(finalReply, model, [], true, userText);

      setConversations((previous) => ({
        ...previous,
        [model]: (previous[model] ?? []).map((conversation) =>
          conversation.id === activeConversation.id
            ? {
                ...conversation,
                updated_at: Date.now(),
                messages: [
                  ...optimisticMessages,
                  replyMessage,
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

  const createFolderCommand = extractCreateFolderCommand(trimmed);
  if (createFolderCommand) {
    return {
      kind: "shell",
      category: "system",
      skill: "system.shell",
      command: createFolderCommand,
      cwd: "",
      confirmText: `创建文件夹：${createFolderCommand}`,
    };
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

const extractCreateFolderCommand = (text: string): string | null => {
  if (!/(新建|创建|建立).*(文件夹|目录)/.test(text)) {
    return null;
  }

  const folderName =
    text.match(/(?:叫|名为|名称为|名字叫)\s*[「“"']?([^」”"'\s，。；]+)[」”"']?/i)?.[1]?.trim() ||
    text.match(/(?:文件夹|目录)\s*[「“"']([^」”"']+)[」”"']/i)?.[1]?.trim() ||
    text.match(/(?:文件夹|目录)\s+([^\s，。；]+)/i)?.[1]?.trim();

  if (!folderName) {
    return null;
  }

  const escapedFolderName = escapePowerShellSingleQuotedString(folderName);
  const targetExpression = /桌面|desktop/i.test(text)
    ? `Join-Path $env:USERPROFILE 'Desktop\\${escapedFolderName}'`
    : `'${escapedFolderName}'`;

  return `$target = ${targetExpression}; New-Item -ItemType Directory -Path $target -Force | Select-Object FullName`;
};

const escapePowerShellSingleQuotedString = (value: string): string => {
  return value.replace(/'/g, "''").replace(/[\\/:*?"<>|]/g, "_");
};

const extractAgentToolCalls = (
  text: string,
  includeShellCodeBlocks = false
): AgentToolCall[] => {
  const calls: AgentToolCall[] = [];
  const blockPattern = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(text))) {
    const block = match[1];
    const xmlFunction = block.match(/<function\s*=\s*["']?([a-zA-Z0-9_-]+)["']?\s*>/i);
    const functionName = xmlFunction?.[1]?.trim();

    if (functionName === "execute_shell") {
      const command = extractXmlParameter(block, "command");
      if (command) {
        calls.push({ kind: "shell", command });
      }
      continue;
    }

    if (functionName === "tavily_search") {
      const query = extractXmlParameter(block, "query");
      if (query) {
        calls.push({ kind: "tavily", query });
      }
      continue;
    }

    const jsonCall = block.match(/\{[\s\S]*\}/);
    if (!jsonCall) {
      continue;
    }

    try {
      const parsed = JSON.parse(jsonCall[0]) as {
        function?: string;
        name?: string;
        arguments?: { command?: string; query?: string };
        parameters?: { command?: string; query?: string };
        command?: string;
        query?: string;
      };
      const jsonFunctionName = parsed.function || parsed.name;

      if (jsonFunctionName === "execute_shell") {
        const command =
          parsed.command || parsed.arguments?.command || parsed.parameters?.command || "";
        if (command.trim()) {
          calls.push({ kind: "shell", command: command.trim() });
        }
      }

      if (jsonFunctionName === "tavily_search") {
        const query = parsed.query || parsed.arguments?.query || parsed.parameters?.query || "";
        if (query.trim()) {
          calls.push({ kind: "tavily", query: query.trim() });
        }
      }
    } catch {
      continue;
    }
  }

  if (calls.length === 0 && includeShellCodeBlocks) {
    for (const command of extractShellCodeBlocks(text)) {
      calls.push({ kind: "shell", command });
    }
  }

  return calls;
};

const extractShellCodeBlocks = (text: string): string[] => {
  const commands: string[] = [];
  const codeBlockPattern = /```(?:powershell|pwsh|shell|bash|sh|ps1)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = codeBlockPattern.exec(text))) {
    const command = match[1].trim();

    if (command && looksLikeShellCommand(command)) {
      commands.push(command);
    }
  }

  return commands;
};

const looksLikeShellCommand = (command: string): boolean => {
  return /(^|\n)\s*(New-Item|Remove-Item|Copy-Item|Move-Item|Rename-Item|Set-Item|Get-ChildItem|Test-Path|mkdir|md|ni|cargo|pnpm|npm|git|powershell|pwsh)\b/i.test(
    command
  );
};

const getLatestUserText = (messages: Message[]): string => {
  return [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
};

const isLocalActionRequest = (text: string): boolean => {
  return /(桌面|文件夹|文件|目录|路径|新建|创建|删除|复制|移动|重命名|运行|执行|命令|构建|测试|检查|打开|保存)/.test(
    text
  );
};

const extractXmlParameter = (block: string, name: string): string | null => {
  const pattern = new RegExp(
    `<parameter\\s*=\\s*["']?${name}["']?\\s*>([\\s\\S]*?)<\\/parameter>`,
    "i"
  );
  const value = block.match(pattern)?.[1]?.trim();

  return value ? decodeBasicHtmlEntities(value) : null;
};

const stripAgentToolCalls = (text: string): string => {
  return text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "").trim();
};

const decodeBasicHtmlEntities = (text: string): string => {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
};

type ScheduledTaskCreationResult = {
  tasks: AgentScheduledTask[];
  rejectedCount: number;
};

type ScheduledTaskChangeResult = {
  tasks: AgentScheduledTask[];
  created: AgentScheduledTask[];
  updated: AgentScheduledTask[];
  deleted: AgentScheduledTask[];
  rejectedCount: number;
  changed: boolean;
};

const createScheduledTasksFromReply = (
  content: string,
  model: ModelType
): ScheduledTaskCreationResult => {
  const tasks: AgentScheduledTask[] = [];
  let rejectedCount = 0;
  const blockPattern = /<scheduled_task>([\s\S]*?)<\/scheduled_task>/gi;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(content))) {
    const block = match[1];
    const title = extractTagText(block, "title") || "计划任务";
    const prompt = extractTagText(block, "prompt");
    const scheduledAtText = extractTagText(block, "scheduled_at");
    const kindText = extractTagText(block, "kind")?.toLowerCase() ?? "";
    const scheduleModeText = extractTagText(block, "schedule_mode")?.toLowerCase() ?? "";
    const scheduleTypeText = extractTagText(block, "schedule_type")?.toLowerCase() ?? "";
    const recurrenceText = extractTagText(block, "recurrence")?.toLowerCase() ?? "";
    const timeOfDayText = extractTagText(block, "time_of_day") ?? "";
    const weekdaysText = extractTagText(block, "weekdays") ?? "";
    const monthDayText =
      extractTagText(block, "month_day") || extractTagText(block, "month_days") || "";
    const yearMonthText = extractTagText(block, "year_month") ?? "";
    const yearMonthDayText = extractTagText(block, "year_month_day") ?? "";
    const customIntervalDaysText = extractTagText(block, "custom_interval_days") ?? "";
    const scheduledAt = scheduledAtText
      ? parseScheduledTaskDateTime(scheduledAtText)
      : Number.NaN;

    const now = Date.now();
    const kind: AgentScheduledTaskKind =
      kindText.includes("reminder") || kindText.includes("提醒")
        ? "reminder"
        : "ai_prompt";
    const scheduleMode = parseScheduledTaskScheduleMode(
      scheduleModeText,
      scheduleTypeText,
      recurrenceText
    );
    const recurrence = scheduleMode === "once" ? undefined : scheduleMode;
    const timeOfDay = normalizeAgentTaskTimeOfDay(
      timeOfDayText,
      Number.isFinite(scheduledAt) ? scheduledAt : now
    );
    const weekdays = parseNumberList(weekdaysText, 1, 7);
    const monthDay = Number(monthDayText);
    const yearMonth = Number(yearMonthText);
    const yearMonthDay = Number(yearMonthDayText);
    const customIntervalDays = normalizeAgentTaskCustomIntervalDays(
      Number(customIntervalDaysText)
    );
    const baseScheduledAt =
      scheduleMode === "once"
        ? scheduledAt
        : buildInitialScheduledTaskAnchor(scheduleMode, timeOfDay, now);
    const timeOfDayValid = scheduleMode === "once" || isValidTimeOfDay(timeOfDayText);
    const scheduleDetailsValid =
      timeOfDayValid &&
      (scheduleMode !== "weekly" || weekdays.length > 0) &&
      (scheduleMode !== "monthly" || isValidScheduleDay(monthDay, 1, 31)) &&
      (scheduleMode !== "yearly" ||
        (isValidScheduleDay(yearMonth, 1, 12) &&
          isValidScheduleDay(
            yearMonthDay,
            1,
            getDaysInMonthForScheduledTask(2028, Math.round(yearMonth) - 1)
          ))) &&
      (scheduleMode !== "custom_days" ||
        (Boolean(customIntervalDaysText.trim()) &&
          Number.isFinite(Number(customIntervalDaysText)) &&
          Number(customIntervalDaysText) > 0));

    if (!prompt || !Number.isFinite(baseScheduledAt) || !scheduleDetailsValid) {
      rejectedCount += 1;
      continue;
    }

    if (scheduleMode === "once" && baseScheduledAt <= now) {
      rejectedCount += 1;
      continue;
    }

    const task: AgentScheduledTask = {
      id: createAgentScheduledTaskId(),
      title: title.trim(),
      prompt: prompt.trim(),
      scheduled_at: baseScheduledAt,
      enabled: true,
      kind,
      schedule_mode: scheduleMode,
      schedule_type: scheduleMode === "once" ? "once" : "recurring",
      recurrence,
      time_of_day: scheduleMode === "once" ? undefined : timeOfDay,
      weekdays: scheduleMode === "weekly" ? weekdays : undefined,
      month_days:
        scheduleMode === "monthly" && Number.isFinite(monthDay) && monthDay >= 1
          ? [Math.min(Math.max(Math.round(monthDay), 1), 31)]
          : undefined,
      year_month:
        scheduleMode === "yearly" && Number.isFinite(yearMonth)
          ? Math.min(Math.max(Math.round(yearMonth), 1), 12)
          : undefined,
      year_month_day:
        scheduleMode === "yearly" && Number.isFinite(yearMonthDay)
          ? Math.min(Math.max(Math.round(yearMonthDay), 1), 31)
          : undefined,
      custom_interval_days:
        scheduleMode === "custom_days"
          ? customIntervalDays
          : undefined,
      status: "pending",
      model,
      source: "chat",
      created_at: now,
      updated_at: now,
    };
    const nextRunAt =
      scheduleMode === "once" ? baseScheduledAt : getNextAgentScheduledTaskRun(task, now);

    if (!nextRunAt || nextRunAt <= now) {
      rejectedCount += 1;
      continue;
    }

    tasks.push({
      ...task,
      scheduled_at: nextRunAt,
    });
  }

  return { tasks, rejectedCount };
};

const createScheduledTasksFromPlan = (
  plan: AgentScheduledTaskPlan,
  model: ModelType
): ScheduledTaskCreationResult => {
  const taskItems = plan.tasks ?? [];
  if (!plan.should_create || taskItems.length === 0) {
    return { tasks: [], rejectedCount: 0 };
  }

  return taskItems.reduce<ScheduledTaskCreationResult>(
    (result, item) => {
      const itemResult = createScheduledTasksFromReply(
        planItemToScheduledTaskBlock(item),
        resolvePlannedTaskModel(item.model, model)
      );
      result.tasks.push(...itemResult.tasks);
      result.rejectedCount += itemResult.rejectedCount;
      return result;
    },
    { tasks: [], rejectedCount: 0 }
  );
};

const planItemToScheduledTaskBlock = (item: AgentScheduledTaskPlanItem): string => {
  const scheduleMode = normalizePlannedScheduleMode(item.schedule_mode);
  const kind = item.kind === "reminder" ? "reminder" : "ai_prompt";
  const lines = [
    "<scheduled_task>",
    `<title>${escapeTagText(item.title || "计划任务")}</title>`,
    `<schedule_mode>${scheduleMode}</schedule_mode>`,
    `<kind>${kind}</kind>`,
    `<prompt>${escapeTagText(item.prompt || item.title || "到点后执行计划任务。")}</prompt>`,
  ];

  if (scheduleMode === "once") {
    lines.push(
      `<scheduled_at>${escapeTagText(normalizePlanText(item.scheduled_at))}</scheduled_at>`
    );
  } else {
    lines.push(`<time_of_day>${escapeTagText(item.time_of_day || "")}</time_of_day>`);
  }

  if (scheduleMode === "weekly") {
    lines.push(`<weekdays>${escapeTagText((item.weekdays || []).join(","))}</weekdays>`);
  }

  if (scheduleMode === "monthly") {
    lines.push(`<month_day>${item.month_day ?? ""}</month_day>`);
  }

  if (scheduleMode === "yearly") {
    lines.push(`<year_month>${item.year_month ?? ""}</year_month>`);
    lines.push(`<year_month_day>${item.year_month_day ?? ""}</year_month_day>`);
  }

  if (scheduleMode === "custom_days") {
    lines.push(`<custom_interval_days>${item.custom_interval_days ?? ""}</custom_interval_days>`);
  }

  lines.push("</scheduled_task>");
  return lines.join("\n");
};

const hasScheduledTaskPlanChanges = (plan: AgentScheduledTaskPlan): boolean => {
  return Boolean(
    (plan.should_create && (plan.tasks?.length ?? 0) > 0) ||
      (plan.should_update && (plan.updates?.length ?? 0) > 0) ||
      (plan.should_delete && (plan.delete_ids?.length ?? 0) > 0)
  );
};

const normalizeScheduledTaskPlanForRequest = (
  plan: AgentScheduledTaskPlan,
  text: string
): AgentScheduledTaskPlan => {
  if (
    !looksLikeScheduledTaskChangeRequest(text) ||
    looksLikeExplicitScheduledTaskCreationRequest(text) ||
    !plan.should_create
  ) {
    return plan;
  }

  return {
    ...plan,
    should_create: false,
    tasks: [],
    reason:
      plan.reason ||
      "用户是在修改已有计划任务，已忽略模型返回的新建任务以避免重复创建。",
  };
};

const applyScheduledTaskPlan = (
  plan: AgentScheduledTaskPlan,
  fallbackModel: ModelType,
  existingTasks: AgentScheduledTask[]
): ScheduledTaskChangeResult => {
  const deleteIds = new Set(
    (plan.delete_ids ?? []).map((id) => id.trim()).filter(Boolean)
  );
  const deleted = existingTasks.filter((task) => deleteIds.has(task.id));
  let nextTasks = existingTasks.filter((task) => !deleteIds.has(task.id));
  const updated: AgentScheduledTask[] = [];
  let rejectedCount = 0;

  if (plan.should_update) {
    for (const item of plan.updates ?? []) {
      const taskId = item.id?.trim() ?? "";
      const targetIndex = nextTasks.findIndex((task) => task.id === taskId);

      if (targetIndex < 0) {
        rejectedCount += 1;
        continue;
      }

      const nextTask = createUpdatedScheduledTaskFromPlanItem(
        item,
        nextTasks[targetIndex],
        fallbackModel
      );

      if (!nextTask) {
        rejectedCount += 1;
        continue;
      }

      nextTasks = nextTasks.map((task, index) =>
        index === targetIndex ? nextTask : task
      );
      updated.push(nextTask);
    }
  }

  const createdResult = createScheduledTasksFromPlan(plan, fallbackModel);
  rejectedCount += createdResult.rejectedCount;

  const tasks = [...nextTasks, ...createdResult.tasks].sort(
    (left, right) => left.scheduled_at - right.scheduled_at
  );

  return {
    tasks,
    created: createdResult.tasks,
    updated,
    deleted,
    rejectedCount,
    changed: createdResult.tasks.length > 0 || updated.length > 0 || deleted.length > 0,
  };
};

const createUpdatedScheduledTaskFromPlanItem = (
  item: AgentScheduledTaskPlanItem,
  existingTask: AgentScheduledTask,
  fallbackModel: ModelType
): AgentScheduledTask | null => {
  const mergedItem = mergePlanItemWithExistingTask(item, existingTask);
  const model = resolvePlannedTaskModel(mergedItem.model, existingTask.model || fallbackModel);
  const parsed = createScheduledTasksFromReply(
    planItemToScheduledTaskBlock(mergedItem),
    model
  );
  const nextTask = parsed.tasks[0];

  if (!nextTask) {
    return null;
  }

  return {
    ...nextTask,
    id: existingTask.id,
    enabled: mergedItem.enabled ?? existingTask.enabled,
    status: "pending",
    model,
    source: existingTask.source,
    created_at: existingTask.created_at,
    updated_at: Date.now(),
    last_run_at: existingTask.last_run_at,
    last_error: undefined,
  };
};

const mergePlanItemWithExistingTask = (
  item: AgentScheduledTaskPlanItem,
  existingTask: AgentScheduledTask
): AgentScheduledTaskPlanItem => {
  const fallback = scheduledTaskToPlanItem(existingTask);
  const scheduleMode = normalizePlannedScheduleMode(
    item.schedule_mode || fallback.schedule_mode
  );

  return {
    id: item.id?.trim() || fallback.id,
    title: item.title?.trim() || fallback.title,
    prompt: item.prompt?.trim() || fallback.prompt,
    kind: item.kind === "reminder" || item.kind === "ai_prompt" ? item.kind : fallback.kind,
    schedule_mode: scheduleMode,
    scheduled_at:
      normalizePlanText(item.scheduled_at) ||
      (scheduleMode === "once" ? normalizePlanText(fallback.scheduled_at) : ""),
    time_of_day:
      item.time_of_day?.trim() || (scheduleMode === "once" ? "" : fallback.time_of_day),
    weekdays:
      Array.isArray(item.weekdays) && item.weekdays.length
        ? item.weekdays
        : fallback.weekdays,
    month_day: item.month_day ?? fallback.month_day,
    year_month: item.year_month ?? fallback.year_month,
    year_month_day: item.year_month_day ?? fallback.year_month_day,
    custom_interval_days:
      item.custom_interval_days ?? fallback.custom_interval_days,
    enabled: item.enabled ?? fallback.enabled,
    model: item.model?.trim() || fallback.model,
  };
};

const scheduledTaskToPlanItem = (task: AgentScheduledTask): AgentScheduledTaskPlanItem => {
  const fallbackDate = new Date(task.scheduled_at);

  return {
    id: task.id,
    title: task.title,
    prompt: task.prompt,
    kind: task.kind,
    schedule_mode: task.schedule_mode,
    scheduled_at: new Date(task.scheduled_at).toISOString(),
    time_of_day: task.time_of_day ?? formatScheduledTaskTimeOfDay(task.scheduled_at),
    weekdays: task.weekdays ?? [getScheduledTaskChineseWeekday(task.scheduled_at)],
    month_day: task.month_days?.[0] ?? fallbackDate.getDate(),
    year_month: task.year_month ?? fallbackDate.getMonth() + 1,
    year_month_day: task.year_month_day ?? fallbackDate.getDate(),
    custom_interval_days: task.custom_interval_days ?? 1,
    enabled: task.enabled,
    model: task.model,
  };
};

const toScheduledTaskPlannerContext = (task: AgentScheduledTask) => ({
  id: task.id,
  title: task.title,
  prompt: task.prompt,
  kind: task.kind,
  schedule_mode: task.schedule_mode,
  scheduled_at: task.scheduled_at,
  time_of_day: task.time_of_day ?? "",
  weekdays: task.weekdays ?? [],
  month_days: task.month_days ?? [],
  year_month: task.year_month ?? null,
  year_month_day: task.year_month_day ?? null,
  custom_interval_days: task.custom_interval_days ?? null,
  enabled: task.enabled,
  status: task.status,
  model: task.model,
  source: task.source,
  created_at: task.created_at,
  updated_at: task.updated_at,
  last_run_at: task.last_run_at ?? null,
});

const resolvePlannedTaskModel = (
  value: string | undefined,
  fallbackModel: ModelType
): ModelType => {
  return value?.trim() || fallbackModel;
};

const normalizePlanText = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
};

const formatScheduledTaskTimeOfDay = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
};

const getScheduledTaskChineseWeekday = (timestamp: number): number => {
  const day = new Date(timestamp).getDay();
  return day === 0 ? 7 : day;
};

const normalizePlannedScheduleMode = (
  value: string | undefined
): AgentScheduledTaskScheduleMode => {
  const normalized = value?.trim().toLowerCase() ?? "";
  return isScheduledTaskScheduleMode(normalized)
    ? normalized
    : parseScheduledTaskScheduleMode(normalized, "", "");
};

const escapeTagText = (value: string): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

const createScheduledTasksFromUserRequest = (
  content: string,
  model: ModelType
): ScheduledTaskCreationResult => {
  const text = content.trim();
  if (!text || looksLikeRecurringScheduledTaskRequest(text) || !looksLikeScheduledTaskRequest(text)) {
    return { tasks: [], rejectedCount: 0 };
  }

  const now = Date.now();
  const scheduledAt = parseSingleScheduledTaskTime(text, now);
  if (!scheduledAt || scheduledAt <= now) {
    return { tasks: [], rejectedCount: 0 };
  }

  const kind = inferScheduledTaskKind(text);
  const task: AgentScheduledTask = {
    id: createAgentScheduledTaskId(),
    title: inferScheduledTaskTitle(text, kind),
    prompt:
      kind === "ai_prompt"
        ? `按用户原始请求执行，并直接给出结果：${text}`
        : stripScheduleTimePhrases(text) || text,
    scheduled_at: scheduledAt,
    enabled: true,
    kind,
    schedule_mode: "once",
    schedule_type: "once",
    status: "pending",
    model,
    source: "chat",
    created_at: now,
    updated_at: now,
  };

  return { tasks: [task], rejectedCount: 0 };
};

const looksLikeRecurringScheduledTaskRequest = (text: string): boolean => {
  return /(每天|每日|每周|每月|每年|每隔|每[0-9零〇一二两三四五六七八九十百]+天)/.test(text);
};

const looksLikePotentialScheduledTaskRequest = (text: string): boolean => {
  const normalized = text.replace(/\s+/g, "");
  const hasScheduleSignal =
    /(提醒|通知|告诉|叫我|闹钟|日程|计划任务|定时|到点|以后|每天|每日|每周|每月|每年|每隔|分钟后|小时后|明天|后天|明早|明晚|今晚|早晨|早上|上午|中午|下午|晚上|修改|更改|改成|改到|改为|换成|删除|取消|移除|暂停|停止|恢复|启用|开启|关闭|关掉|[0-9零〇一二两三四五六七八九十]{1,3}(点|时))/.test(
      normalized
    );
  const hasTaskSignal =
    /(提醒|通知|告诉|叫我|执行|查询|播报|汇报|总结|整理|天气|闹钟|日程|任务|待办|会议|喝水|吃药|计划任务|修改|更改|改成|改到|改为|换成|删除|取消|暂停|恢复|启用|关闭)/.test(
      normalized
    );

  return (hasScheduleSignal && hasTaskSignal) || looksLikeScheduledTaskChangeRequest(text);
};

const looksLikeScheduledTaskChangeRequest = (text: string): boolean => {
  const normalized = text.replace(/\s+/g, "");
  const hasChangeVerb =
    /(修改|更改|改成|改到|改为|换成|调到|调整为|删除|取消|移除|暂停|停止|恢复|启用|开启|关闭|关掉)/.test(
      normalized
    );
  const hasTaskObject =
    /(计划任务|提醒|通知|闹钟|日程|任务|待办|天气|喝水|吃药|会议)/.test(
      normalized
    );
  const hasScheduleTarget =
    /(每天|每日|每周|每月|每年|每隔|周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天]|早晨|早上|上午|中午|下午|晚上|凌晨|[0-9零〇一二两三四五六七八九十]{1,3}(点|时))/.test(
      normalized
    );

  return hasChangeVerb && (hasTaskObject || hasScheduleTarget);
};

const looksLikeExplicitScheduledTaskCreationRequest = (text: string): boolean => {
  return /(新增|新建|创建|添加|加一个|再加|再建|再创建|另建|新加|建立)/.test(
    text.replace(/\s+/g, "")
  );
};

const looksLikeScheduledTaskRequest = (text: string): boolean => {
  return (
    /(提醒|通知|告诉|叫我|闹钟|到点|执行|查询|播报|汇报|总结|整理)/.test(text) &&
    hasSingleScheduledTaskTime(text)
  );
};

const hasSingleScheduledTaskTime = (text: string): boolean => {
  return Boolean(parseSingleScheduledTaskTime(text, Date.now()));
};

const parseSingleScheduledTaskTime = (text: string, now: number): number | null => {
  const normalized = text.replace(/\s+/g, "");
  const relativeMinutes = parseRelativeDelayMinutes(normalized);
  if (relativeMinutes !== null) {
    return now + relativeMinutes * 60_000;
  }

  const dayOffset = parseRelativeDayOffset(normalized);
  const clock = parseClockTime(normalized);
  if (!clock) {
    return null;
  }

  const candidate = new Date(now);
  if (dayOffset !== null) {
    candidate.setDate(candidate.getDate() + dayOffset);
  }
  candidate.setHours(clock.hours, clock.minutes, 0, 0);

  if (dayOffset === null && candidate.getTime() <= now) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate.getTime();
};

const parseRelativeDelayMinutes = (text: string): number | null => {
  if (/半(个)?小时后/.test(text)) {
    return 30;
  }

  const minuteMatch = text.match(/([0-9]+|[零〇一二两三四五六七八九十百]+)(?:个)?(?:分钟|分)后/);
  if (minuteMatch) {
    return parseChineseNumber(minuteMatch[1]);
  }

  const hourMatch = text.match(/([0-9]+|[零〇一二两三四五六七八九十百]+)(?:个)?(?:小时|钟头)后/);
  if (hourMatch) {
    return parseChineseNumber(hourMatch[1]) * 60;
  }

  return null;
};

const parseRelativeDayOffset = (text: string): number | null => {
  if (/后天/.test(text)) {
    return 2;
  }

  if (/明天|明早|明晚/.test(text)) {
    return 1;
  }

  if (/今天|今晚|今早|稍后/.test(text)) {
    return 0;
  }

  return null;
};

const parseClockTime = (
  text: string
): { hours: number; minutes: number } | null => {
  const period = text.match(/(凌晨|早上|上午|中午|下午|晚上|今晚|明早|明晚)/)?.[1] ?? "";
  const colonMatch = text.match(/([01]?\d|2[0-3])[:：]([0-5]\d)/);
  const hourMatch =
    colonMatch ??
    text.match(/([0-9]{1,2}|[零〇一二两三四五六七八九十]{1,3})(?:点|时)(半|[0-9]{1,2}|[零〇一二两三四五六七八九十]{1,3})?/);

  if (!hourMatch) {
    return null;
  }

  let hours = parseChineseNumber(hourMatch[1]);
  let minutes = 0;

  if (colonMatch) {
    minutes = Number(colonMatch[2]);
  } else if (hourMatch[2] === "半") {
    minutes = 30;
  } else if (hourMatch[2]) {
    minutes = parseChineseNumber(hourMatch[2]);
  }

  if ((period.includes("下午") || period.includes("晚上") || period.includes("晚")) && hours < 12) {
    hours += 12;
  }

  if (period.includes("中午") && hours < 11) {
    hours += 12;
  }

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return { hours, minutes };
};

const parseChineseNumber = (value: string): number => {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  const digitMap: Record<string, number> = {
    零: 0,
    "〇": 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  if (value === "十") {
    return 10;
  }

  if (value.includes("百")) {
    const [hundredsText, restText = ""] = value.split("百");
    return (digitMap[hundredsText] || 1) * 100 + (restText ? parseChineseNumber(restText) : 0);
  }

  if (value.includes("十")) {
    const [tensText, onesText = ""] = value.split("十");
    return (tensText ? digitMap[tensText] || 0 : 1) * 10 + (onesText ? digitMap[onesText] || 0 : 0);
  }

  return digitMap[value] ?? Number.NaN;
};

const inferScheduledTaskKind = (text: string): AgentScheduledTaskKind => {
  return /(天气|查询|搜索|联网|告诉|播报|汇报|总结|整理|检查|生成|执行)/.test(text)
    ? "ai_prompt"
    : "reminder";
};

const inferScheduledTaskTitle = (
  text: string,
  kind: AgentScheduledTaskKind
): string => {
  if (/天气/.test(text)) {
    return "天气提醒";
  }

  if (/闹钟/.test(text)) {
    return "闹钟提醒";
  }

  const action = stripScheduleTimePhrases(text)
    .replace(/^(请|帮我|麻烦|记得|到时候|然后)/, "")
    .trim();
  const fallback = kind === "ai_prompt" ? "AI 定时任务" : "提醒任务";

  return action ? action.slice(0, 24) : fallback;
};

const stripScheduleTimePhrases = (text: string): string => {
  return text
    .replace(/半(个)?小时后/g, "")
    .replace(/([0-9]+|[零〇一二两三四五六七八九十百]+)(?:个)?(?:分钟|分|小时|钟头)后/g, "")
    .replace(/(今天|明天|后天|今晚|明早|明晚|今早|稍后)/g, "")
    .replace(/(凌晨|早上|上午|中午|下午|晚上)?([0-9]{1,2}|[零〇一二两三四五六七八九十]{1,3})([:：][0-5]\d|(?:点|时)(半|[0-9]{1,2}|[零〇一二两三四五六七八九十]{1,3})?)?/g, "")
    .replace(/^(提醒我|通知我|告诉我|叫我)/, "")
    .trim();
};

const parseScheduledTaskScheduleMode = (
  modeValue: string,
  scheduleTypeValue: string,
  recurrenceValue: string
): AgentScheduledTaskScheduleMode => {
  if (isScheduledTaskScheduleMode(modeValue)) {
    return modeValue;
  }

  const normalized = `${modeValue} ${scheduleTypeValue} ${recurrenceValue}`.toLowerCase();
  if (
    normalized.includes("custom_days") ||
    normalized.includes("custom") ||
    normalized.includes("interval") ||
    normalized.includes("自定义") ||
    normalized.includes("间隔")
  ) {
    return "custom_days";
  }

  if (
    normalized.includes("weekly") ||
    normalized.includes("week") ||
    normalized.includes("按周") ||
    normalized.includes("每周")
  ) {
    return "weekly";
  }

  if (
    normalized.includes("monthly") ||
    normalized.includes("month") ||
    normalized.includes("按月") ||
    normalized.includes("每月")
  ) {
    return "monthly";
  }

  if (
    normalized.includes("yearly") ||
    normalized.includes("annual") ||
    normalized.includes("按年") ||
    normalized.includes("每年")
  ) {
    return "yearly";
  }

  if (
    normalized.includes("daily") ||
    normalized.includes("everyday") ||
    normalized.includes("按日") ||
    normalized.includes("每日") ||
    normalized.includes("每天")
  ) {
    return "daily";
  }

  if (
    scheduleTypeValue.includes("recurring") ||
    scheduleTypeValue.includes("repeat") ||
    scheduleTypeValue.includes("重复")
  ) {
    return "daily";
  }

  return "once";
};

const isScheduledTaskScheduleMode = (value: string): value is AgentScheduledTaskScheduleMode => {
  return (
    value === "once" ||
    value === "daily" ||
    value === "weekly" ||
    value === "monthly" ||
    value === "yearly" ||
    value === "custom_days"
  );
};

const isValidScheduleDay = (value: number, min: number, max: number): boolean => {
  return Number.isFinite(value) && value >= min && value <= max;
};

const isValidTimeOfDay = (value: string): boolean => {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value.trim());
};

const parseScheduledTaskDateTime = (value: string): number => {
  const normalized = value.trim();
  if (/^\d{10,}$/.test(normalized)) {
    const timestamp = Number(normalized);
    if (Number.isFinite(timestamp)) {
      return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
    }
  }

  return Date.parse(normalized);
};

const getDaysInMonthForScheduledTask = (year: number, monthIndex: number): number => {
  return new Date(year, monthIndex + 1, 0).getDate();
};

const parseNumberList = (value: string, min: number, max: number): number[] => {
  const normalized = value
    .replace(/[，、;；]/g, ",")
    .replace(/星期天|星期日|周天|周日|礼拜天|礼拜日/g, "7")
    .replace(/星期一|周一|礼拜一/g, "1")
    .replace(/星期二|周二|礼拜二/g, "2")
    .replace(/星期三|周三|礼拜三/g, "3")
    .replace(/星期四|周四|礼拜四/g, "4")
    .replace(/星期五|周五|礼拜五/g, "5")
    .replace(/星期六|周六|礼拜六/g, "6");
  const numbers = normalized
    .split(/[,\s]+/)
    .map((item) => Math.round(Number(item.trim())))
    .filter((item) => Number.isFinite(item) && item >= min && item <= max);

  return Array.from(new Set(numbers)).sort((left, right) => left - right);
};

const buildInitialScheduledTaskAnchor = (
  mode: AgentScheduledTaskScheduleMode,
  timeOfDay: string,
  fromTime: number
): number => {
  if (mode === "once") {
    return fromTime;
  }

  const [hours, minutes] = normalizeAgentTaskTimeOfDay(timeOfDay, fromTime)
    .split(":")
    .map(Number);
  const candidate = new Date(fromTime);
  candidate.setHours(hours, minutes, 0, 0);

  if (candidate.getTime() <= fromTime) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate.getTime();
};

const stripScheduledTaskBlocks = (text: string): string => {
  return text.replace(/<scheduled_task>[\s\S]*?<\/scheduled_task>/gi, "").trim();
};

const extractTagText = (block: string, tag: string): string | null => {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  const value = block.match(pattern)?.[1]?.trim();

  return value ? decodeBasicHtmlEntities(value) : null;
};

const buildScheduledTaskCreationNotice = (tasks: AgentScheduledTask[]): string => {
  if (tasks.length === 0) {
    return "";
  }

  const lines = tasks.map((task) => {
    const scheduleText =
      task.schedule_mode !== "once"
        ? `，${formatScheduledTaskRecurrence(task)}`
        : "";
    return `- ${task.title}：${formatFullDateTime(task.scheduled_at)}${scheduleText}`;
  });

  return `已创建计划任务：\n${lines.join("\n")}`;
};

const buildScheduledTaskChangeNotice = (change: ScheduledTaskChangeResult): string => {
  const sections: string[] = [];
  const creationNotice = buildScheduledTaskCreationNotice(change.created);

  if (creationNotice) {
    sections.push(creationNotice);
  }

  if (change.updated.length > 0) {
    sections.push(
      `已更新计划任务：\n${change.updated
        .map((task) => `- ${formatScheduledTaskSummary(task)}`)
        .join("\n")}`
    );
  }

  if (change.deleted.length > 0) {
    sections.push(
      `已删除计划任务：\n${change.deleted
        .map((task) => `- ${task.title}`)
        .join("\n")}`
    );
  }

  if (change.rejectedCount > 0) {
    sections.push(`有 ${change.rejectedCount} 个任务变更没有通过校验，已忽略。`);
  }

  return sections.join("\n\n");
};

const formatScheduledTaskSummary = (task: AgentScheduledTask): string => {
  const scheduleText =
    task.schedule_mode !== "once" ? `，${formatScheduledTaskRecurrence(task)}` : "";
  const enabledText = task.enabled ? "" : "，已暂停";
  return `${task.title}：${formatFullDateTime(task.scheduled_at)}${scheduleText}${enabledText}`;
};

const formatScheduledTaskRecurrence = (task: AgentScheduledTask): string => {
  switch (task.schedule_mode) {
    case "weekly":
      return `每周 ${formatScheduledTaskWeekdays(task.weekdays)} 重复`;
    case "monthly":
      return `每月 ${task.month_days?.[0] ?? 1} 号重复`;
    case "yearly":
      return `每年 ${task.year_month ?? 1} 月 ${task.year_month_day ?? 1} 号重复`;
    case "custom_days":
      return `每 ${task.custom_interval_days ?? 1} 天重复`;
    case "daily":
    default:
      return "每日重复";
  }
};

const formatScheduledTaskWeekdays = (weekdays: number[] | undefined): string => {
  const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const selected = Array.isArray(weekdays) && weekdays.length ? weekdays : [1];
  return selected
    .slice()
    .sort((left, right) => left - right)
    .map((weekday) => labels[weekday - 1])
    .filter(Boolean)
    .join("、");
};

const formatFullDateTime = (timestamp: number): string => {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
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

const buildTavilyToolContext = (
  plan: AgentTavilyPlan,
  result: AgentTavilySearchResult
): string => {
  const answer = result.answer.trim();
  const results = result.results.length
    ? result.results
        .map(
          (item, index) =>
            `${index + 1}. ${item.title || "未命名结果"}\nURL: ${item.url}\n摘要: ${item.content || "(无摘要)"}`
        )
        .join("\n\n")
    : "(没有返回搜索结果)";

  return `你刚刚根据用户需求调用了 Tavily 联网搜索。请基于下面的真实搜索结果回答用户，尽量标注来源链接，不要编造没有出现在搜索结果里的事实。\n\n规划理由：${plan.reason || "未提供"}\n搜索词：${result.query || plan.query}\n\nTavily Answer:\n${answer || "(无)"}\n\n搜索结果:\n${results}`;
};

const appendAgentToolOriginalContent = (
  originalContent: string,
  toolContexts: string[]
): string => {
  if (toolContexts.length === 0) {
    return originalContent;
  }

  return `${originalContent}\n\n--- Agent 工具原始结果 ---\n${toolContexts.join("\n\n---\n\n")}`;
};

const escapeMarkdownFence = (text: string): string => {
  return text.replace(/```/g, "`\u200b``");
};
