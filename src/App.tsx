/**
 * React 基础 Hook
 * useState：用于组件内部状态
 * useEffect：用于副作用（这里用来做本地存储同步）
 */
import { useState, useEffect } from "react";

/**
 * Tauri 前端调用 Rust 后端命令的核心方法
 * invoke("命令名", 参数)
 */
import { invoke } from "@tauri-apps/api/core";

/**
 * react-router 的跳转组件
 * 用于跳转到设置页
 */
import { Link } from "react-router-dom";

/**
 * 当前页面的样式文件
 * 所有样式都集中在这里，组件中不再出现 style={}
 */
import "./styles/App.css";

/* =========================
   一、类型定义（TypeScript 的“契约”）
   ========================= */

/**
 * 支持的模型类型
 * 用联合类型可以：
 * 1. 限制取值范围
 * 2. 在 switch / if 时获得智能提示
 */
type ModelType = "openai" | "deepseek" | "qwen" | "mimo";

/**
 * 单条消息结构
 * role：消息来源
 * content：消息文本
 */
type Message = {
  role: "user" | "ai";
  content: string;
};

/**
 * 一个完整对话
 * id：唯一标识（时间戳）
 * name：对话显示名称
 * messages：消息列表
 */
type Conversation = {
  id: string;
  name: string;
  messages: Message[];
};

/* =========================
   二、本地存储工具函数
   ========================= */

/**
 * 将所有模型的对话数据保存到 localStorage
 * 使用 Record<ModelType, Conversation[]> 统一结构
 */
const saveConversationsToLocalStorage = (
  conversations: Record<ModelType, Conversation[]>
) => {
  localStorage.setItem(
    "chatConversations",
    JSON.stringify(conversations)
  );
};

/**
 * 从 localStorage 中加载对话数据
 * 如果没有存过数据，则返回一个“完整但为空”的默认结构
 */
const loadConversationsFromLocalStorage =
  (): Record<ModelType, Conversation[]> => {
    const saved = localStorage.getItem("chatConversations");

    return saved
      ? JSON.parse(saved)
      : {
        openai: [],
        deepseek: [],
        qwen: [],
        mimo: [],
      };
  };

/* =========================
   三、主组件
   ========================= */

function App() {
  /**
   * 当前选中的模型
   */
  const [model, setModel] = useState<ModelType>("openai");

  /**
   * 所有模型的全部对话
   * 结构：{ openai: [...], deepseek: [...] }
   */
  const [conversations, setConversations] = useState<
    Record<ModelType, Conversation[]>
  >(loadConversationsFromLocalStorage);

  /**
   * 当前选中的对话 ID
   */
  const [currentConversationId, setCurrentConversationId] =
    useState<string | null>(null);

  /**
   * 输入框中的文本
   */
  const [input, setInput] = useState("");

  /**
   * 是否正在等待 AI 回复
   * 用于禁用按钮、显示“思考中…”
   */
  const [loading, setLoading] = useState(false);

  /**
   * 根据当前模型 + 对话 ID
   * 动态算出“当前正在聊天的对话”
   */
  const currentConversation = currentConversationId
    ? conversations[model].find(
      (c) => c.id === currentConversationId
    )
    : null;

  /**
   * 只要 conversations 发生变化
   * 就自动同步到 localStorage
   */
  useEffect(() => {
    saveConversationsToLocalStorage(conversations);
  }, [conversations]);

  /* =========================
     四、对话管理
     ========================= */

  /**
   * 创建一个新的空对话
   */
  const createNewConversation = () => {
    const conv: Conversation = {
      id: Date.now().toString(), // 简单唯一 ID
      name: `新对话 ${conversations[model].length + 1}`,
      messages: [],
    };

    setConversations((prev) => ({
      ...prev,
      [model]: [...prev[model], conv],
    }));

    // 创建完成后立刻切换到新对话
    setCurrentConversationId(conv.id);
  };

  /**
   * 删除指定 ID 的对话
   */
  const deleteConversation = (id: string) => {
    setConversations((prev) => ({
      ...prev,
      [model]: prev[model].filter((c) => c.id !== id),
    }));

    // 如果删的是当前对话，则清空选中状态
    if (currentConversationId === id) {
      setCurrentConversationId(null);
    }
  };

  /**
   * 修改对话名称
   * 直接在列表中输入即可生效
   */
  const renameConversation = (id: string, name: string) => {
    setConversations((prev) => ({
      ...prev,
      [model]: prev[model].map((c) =>
        c.id === id ? { ...c, name } : c
      ),
    }));
  };

  /* =========================
     五、发送消息
     ========================= */

  const sendMessage = async () => {
    /**
     * 防御性判断：
     * - 输入为空
     * - 正在请求中
     * - 没有选中对话
     */
    if (!input.trim() || loading || !currentConversation) return;

    // 构造用户消息
    const userMsg: Message = {
      role: "user",
      content: input,
    };

    // 新的消息列表（用户消息先入）
    const updatedMessages = [
      ...currentConversation.messages,
      userMsg,
    ];

    // 立即更新 UI（先显示用户消息）
    setConversations((prev) => ({
      ...prev,
      [model]: prev[model].map((c) =>
        c.id === currentConversation.id
          ? { ...c, messages: updatedMessages }
          : c
      ),
    }));

    setInput("");
    setLoading(true);

    try {
      /**
       * 将内部 Message 转成 AI API 标准格式
       */
      const apiMessages = updatedMessages.map((m) => ({
        role: m.role === "ai" ? "assistant" : "user",
        content: m.content,
      }));

      /**
       * 调用 Tauri 后端 Rust 方法
       */
      const reply = await invoke<string>("chat_with_ai", {
        model,
        messages: apiMessages,
      });

      // 将 AI 回复加入对话
      setConversations((prev) => ({
        ...prev,
        [model]: prev[model].map((c) =>
          c.id === currentConversation.id
            ? {
              ...c,
              messages: [
                ...updatedMessages,
                { role: "ai", content: reply },
              ],
            }
            : c
        ),
      }));
    } catch (e: any) {
      /**
       * 捕获错误并显示在聊天窗口中
       * 这是桌面应用里非常友好的做法
       */
      setConversations((prev) => ({
        ...prev,
        [model]: prev[model].map((c) =>
          c.id === currentConversation.id
            ? {
              ...c,
              messages: [
                ...updatedMessages,
                {
                  role: "ai",
                  content: `❌ 调用失败：\n${String(e)}`,
                },
              ],
            }
            : c
        ),
      }));
    } finally {
      setLoading(false);
    }
  };

  /* =========================
     六、UI 渲染
     ========================= */

  return (
    <div className="main-container">
      {/* 顶部工具栏 */}
      <div className="nav-container">
        <h1>🧠 AI 对话</h1>



        <Link to="/settings">
          <button>设置</button>
        </Link>
      </div>

      {/* 主体区域 */}
      <div className="content-layout">
        {/* 左侧对话列表 */}
        <div className="conversation-list">
          <div>
            <h3>对话列表</h3>
            <select
              className="model-select"
              value={model}
              onChange={(e) =>
                setModel(e.target.value as ModelType)
              }
            >
              <option value="openai">OpenAI (GPT)</option>
              <option value="deepseek">DeepSeek</option>
              <option value="qwen">通义千问</option>
              <option value="mimo">小米 MIMO</option>
            </select>

            <button onClick={createNewConversation}>
              新建对话
            </button>
          </div>
          <ul>
            {conversations[model].map((conv) => (
              <li
                key={conv.id}
                className={`conversation-item ${conv.id === currentConversationId
                  ? "active"
                  : ""
                  }`}
                onClick={() =>
                  setCurrentConversationId(conv.id)
                }
              >
                <input
                  className="conversation-name"
                  value={conv.name}
                  onChange={(e) =>
                    renameConversation(
                      conv.id,
                      e.target.value
                    )
                  }
                />
                <button
                  className="btn-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(conv.id);
                  }}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* 右侧聊天区域 */}
        <div className="chat-panel">
          <h2>对话内容</h2>

          <div className="chat-box">
            {currentConversation ? (
              currentConversation.messages.map((msg, i) => (
                <div key={i} className="chat-line">
                  <strong>
                    {msg.role === "user"
                      ? "用户"
                      : "AI"}
                    ：
                  </strong>
                  <span>{msg.content}</span>
                </div>
              ))
            ) : (
              <div className="chat-empty">
                请选择一个对话
              </div>
            )}

            {loading && (
              <div className="chat-line">
                <strong>AI：</strong> 思考中…
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 输入区域 */}
      <div className="input-area">
        <input
          className="input-box"
          value={input}
          onChange={(e) =>
            setInput(e.target.value)
          }
          placeholder="输入内容..."
          disabled={loading || !currentConversation}
          onKeyDown={(e) =>
            e.key === "Enter" && sendMessage()
          }
        />

        <button
          className="btn-send"
          onClick={sendMessage}
          disabled={loading || !currentConversation}
        >
          {loading ? "思考中…" : "发送"}
        </button>
      </div>
    </div>
  );
}

export default App;
