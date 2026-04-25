import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Link } from "react-router-dom";
import {
  IoAdd,
  IoChatbubbleEllipses,
  IoMic,
  IoSettingsSharp,
  IoStopCircleOutline,
} from "react-icons/io5";

import "./styles/base.css";
import "./styles/App.css";

import { recordedBlobToWavBase64 } from "./audio/recording";
import {
  ChatMessageBubble,
  type EditingReplyDraft,
} from "./components/ChatMessageBubble";
import {
  type AppConfig,
  type Conversation,
  type Message,
  type ModelType,
  createEmptyAppConfig,
  getModelChoices,
  getModelConfig,
  getModelMeta,
  getModelOptions,
  loadConversationsFromStorage,
  loadUserState,
  normalizeAppConfig,
  saveConversationsToStorage,
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

/* =========================
   页面职责说明
   1. 管理聊天首页的模型切换、会话切换和消息发送。
   2. 把会话历史存进 localStorage，保证刷新后仍能恢复。
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
  const [conversations, setConversations] = useState(loadConversationsFromStorage);

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
  const [speechError, setSpeechError] = useState("");
  const [speakingMessageKey, setSpeakingMessageKey] = useState<string | null>(null);
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);
  const [expandedOriginalKeys, setExpandedOriginalKeys] = useState<string[]>([]);
  const [editingReply, setEditingReply] = useState<EditingReplyDraft | null>(null);
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "transcribing">(
    "idle"
  );

  /**
   * 聊天区底部锚点，用于每次发送和收到消息后自动滚动到底部。
   */
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
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
   * 会话仓库只要变化，就立即持久化。
   * 这样关闭应用、刷新页面或切换路由后都能恢复聊天上下文。
   */
  useEffect(() => {
    saveConversationsToStorage(conversations);
  }, [conversations]);

  /**
   * 记录“当前模型 + 当前会话”。
   * 设置页切回聊天页后，也能继续停留在用户刚刚使用的位置。
   */
  useEffect(() => {
    saveUserState(model, currentConversationId);
  }, [model, currentConversationId]);

  /**
   * 当用户切换模型时，检查当前会话 ID 是否仍然有效。
   * 这是之前容易出问题的地方：旧模型的会话 ID 在新模型里不存在，会导致右侧空白。
   */
  useEffect(() => {
    const hasCurrentConversation = currentModelConversations.some(
      (conversation) => conversation.id === currentConversationId
    );

    if (!hasCurrentConversation) {
      setCurrentConversationId(currentModelConversations[0]?.id ?? null);
    }
  }, [currentConversationId, currentModelConversations]);

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

  /**
   * 新建会话时使用模型名做前缀，方便用户在多模型场景下快速区分用途。
   */
  const createNewConversation = () => {
    const nextConversation: Conversation = {
      id: `${model}-${Date.now()}`,
      name: `${currentModelMeta.label} 会话 ${currentModelConversations.length + 1}`,
      messages: [],
    };

    setConversations((previous) => ({
      ...previous,
      [model]: [nextConversation, ...(previous[model] ?? [])],
    }));
    setCurrentConversationId(nextConversation.id);
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
    setConversations((previous) => ({
      ...previous,
      [model]: (previous[model] ?? []).map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              name: name.trimStart(),
            }
          : conversation
      ),
    }));
  };

  /**
   * 输入发送的核心逻辑：
   * 1. 先把用户消息写进本地 UI，保证页面即时反馈。
   * 2. 再把标准化后的 messages 传给 Rust 后端。
   * 3. 成功时写入 AI 回复，失败时写入错误提示气泡。
   */
  const sendMessage = async () => {
    if (!input.trim() || loading || !currentConversation || !currentModelReady) {
      return;
    }

    const userMessage: Message = {
      role: "user",
      content: input.trim(),
    };

    const optimisticMessages = [...currentConversation.messages, userMessage];

    setConversations((previous) => ({
      ...previous,
      [model]: (previous[model] ?? []).map((conversation) =>
        conversation.id === currentConversation.id
          ? { ...conversation, messages: optimisticMessages }
          : conversation
      ),
    }));

    setInput("");
    setLoading(true);

    try {
      const apiMessages = optimisticMessages.map((message) => ({
        role: message.role === "ai" ? "assistant" : "user",
        content: message.content,
      }));

      const reply = await invoke<ChatReplyResponse>("chat_with_ai", {
        model,
        messages: apiMessages,
      });

      setConversations((previous) => ({
        ...previous,
        [model]: (previous[model] ?? []).map((conversation) =>
          conversation.id === currentConversation.id
            ? {
                ...conversation,
                messages: [
                  ...optimisticMessages,
                  {
                    role: "ai",
                    content: reply.content,
                    tts_text: reply.tts_text,
                    original_content: reply.original_content || reply.content,
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
          conversation.id === currentConversation.id
            ? {
                ...conversation,
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
      window.setTimeout(() => {
        setCopiedMessageKey((current) => (current === messageKey ? null : current));
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
        <div>
          <p className="page-eyebrow">MuNan AI Desktop</p>
          <h1 className="page-title">多模型对话工作台</h1>
          <p className="page-description">
            左侧管理会话，右侧专注聊天，设置页统一维护每个模型的接口与密钥。
          </p>
        </div>

        <div className="header-actions">
          <div className={`status-chip ${currentModelReady ? "is-ready" : "is-warning"}`}>
            {currentModelReady ? "当前模型已就绪" : "当前模型待配置"}
          </div>

          <Link className="icon-action" to="/settings" aria-label="打开设置页">
            <IoSettingsSharp size={20} />
          </Link>
        </div>
      </header>

      {/* 页面主区域：左侧为模型和会话，右侧为聊天内容。 */}
      <div className="chat-layout">
        <aside className="chat-sidebar glass-panel">
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
            <select
              id="chat-provider-select"
              className="model-select"
              value={model}
              onChange={(event) => setModel(event.target.value as ModelType)}
            >
              {modelOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} - {option.provider}
                </option>
              ))}
            </select>

            <label className="model-select-label" htmlFor="chat-provider-model-select">
              供应商模型
            </label>
            <select
              id="chat-provider-model-select"
              className="model-select"
              value={currentProviderConfig.model}
              disabled={providerModelChoices.length === 0}
              onChange={(event) => void switchProviderModel(event.target.value)}
            >
              <option value="">请选择模型</option>
              {providerModelChoices.map((modelName) => (
                <option key={modelName} value={modelName}>
                  {modelName}
                </option>
              ))}
            </select>

            <div className="model-select-summary">
              <span className="section-badge">{currentModelMeta.provider}</span>
              {currentProviderConfig.model && (
                <span className="section-badge model-name-badge">{currentProviderConfig.model}</span>
              )}
              <span className={`status-dot ${currentModelReady ? "is-ready" : "is-missing"}`} />
            </div>
          </section>

          <section className="sidebar-section">
            <div className="section-heading">
              <div>
                <p className="section-kicker">会话管理</p>
                <h2>{currentModelMeta.label} 会话列表</h2>
              </div>

              <button type="button" className="primary-button" onClick={createNewConversation}>
                <IoAdd size={18} />
                新建会话
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
                    onClick={() => setCurrentConversationId(conversation.id)}
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
                      className="ghost-button danger-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteConversation(conversation.id);
                      }}
                    >
                      删除
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
          {configStatus === "error" && (
            <div className="alert-banner alert-banner--error">
              配置加载失败：{configError}
            </div>
          )}

          {!currentModelReady && configStatus === "ready" && (
            <div className="alert-banner alert-banner--warning">
              当前模型还没有配置完整。请前往设置页补充 Base URL、API Key 和模型名。
            </div>
          )}

          {speechError && (
            <div className="alert-banner alert-banner--warning">{speechError}</div>
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
                <h3>先选择一个会话</h3>
                <p>如果左侧还是空的，可以点击“新建会话”快速开始。</p>
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
                : "请先创建或选择一个会话。"}
            </div>

            <div className="input-area">
              <textarea
                className="input-box"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="输入你的问题、代码需求或灵感草稿..."
                disabled={loading || !currentConversation || !currentModelReady}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
              />

              <button
                type="button"
                className={`ghost-button record-button ${
                  recordingState === "recording" ? "is-recording" : ""
                }`}
                onClick={toggleRecording}
                disabled={
                  loading ||
                  !currentConversation ||
                  !currentModelReady ||
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
                  !currentConversation ||
                  !currentModelReady ||
                  recordingState !== "idle"
                }
              >
                {loading ? "发送中..." : "发送"}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
