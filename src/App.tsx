import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Link } from "react-router-dom";
import "./styles/App.css";



// 定义支持的模型类型
// "openai" 表示 OpenAI 的 GPT 模型
// "deepseek" 表示 DeepSeek 模型
// "qwen" 表示通义千问模型
// "mimo" 表示小米 MIMO 模型
type ModelType = "openai" | "deepseek" | "qwen" | "mimo";

// 定义 UI 内部消息结构
// role: 消息的发送方，"user" 表示用户，"ai" 表示 AI
// content: 消息的内容
type Message = {
  role: "user" | "ai";
  content: string;
};

// 定义对话的结构
type Conversation = {
  id: string;
  name: string;
  messages: Message[];
};

// 定义保存对话到本地存储的函数
const saveConversationsToLocalStorage = (conversations: Record<ModelType, Conversation[]>) => {
  localStorage.setItem("chatConversations", JSON.stringify(conversations));
};

// 定义从本地存储加载对话的函数
const loadConversationsFromLocalStorage = (): Record<ModelType, Conversation[]> => {
  const savedConversations = localStorage.getItem("chatConversations");
  return savedConversations ? JSON.parse(savedConversations) : { openai: [], deepseek: [], qwen: [], mimo: [] };
};

function App() {
  const [model, setModel] = useState<ModelType>("openai");
  const [conversations, setConversations] = useState<Record<ModelType, Conversation[]>>(loadConversationsFromLocalStorage);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const currentConversation = currentConversationId
    ? conversations[model].find((conv) => conv.id === currentConversationId)
    : null;

  useEffect(() => {
    saveConversationsToLocalStorage(conversations);
  }, [conversations]);

  const createNewConversation = () => {
    const newConversation: Conversation = {
      id: Date.now().toString(),
      name: `新对话 ${conversations[model].length + 1}`,
      messages: [],
    };
    setConversations((prev) => ({
      ...prev,
      [model]: [...prev[model], newConversation],
    }));
    setCurrentConversationId(newConversation.id);
  };

  // 删除对话的函数
  const deleteConversation = (id: string) => {
    // 更新对话状态，过滤掉指定 ID 的对话
    setConversations((prev) => ({
      ...prev,
      [model]: prev[model].filter((conv) => conv.id !== id),
    }));
    // 如果当前对话是被删除的对话，则清空当前对话 ID
    if (currentConversationId === id) {
      setCurrentConversationId(null);
    }
  };

  // 重命名对话的函数
  const renameConversation = (id: string, newName: string) => {
    // 更新对话状态，将指定 ID 的对话名称更新为新名称
    setConversations((prev) => ({
      ...prev,
      [model]: prev[model].map((conv) =>
        conv.id === id ? { ...conv, name: newName } : conv
      ),
    }));
  };

  // 发送消息的函数
  const sendMessage = async () => {
    // 如果输入为空、正在加载或当前没有选中对话，则直接返回
    if (!input.trim() || loading || !currentConversation) return;

    // 创建用户消息对象
    const userMsg: Message = { role: "user", content: input };
    // 将用户消息添加到当前对话的消息列表中
    const updatedMessages = [...currentConversation.messages, userMsg];

    // 更新对话状态，添加用户消息
    setConversations((prev) => ({
      ...prev,
      [model]: prev[model].map((conv) =>
        conv.id === currentConversation.id
          ? { ...conv, messages: updatedMessages }
          : conv
      ),
    }));
    // 清空输入框内容
    setInput("");
    // 设置加载状态为 true
    setLoading(true);

    try {
      // 将消息转换为 API 所需的格式
      const apiMessages = updatedMessages.map((m) => ({
        role: m.role === "ai" ? "assistant" : "user",
        content: m.content,
      }));

      // 调用后端接口获取 AI 回复
      const aiReply = await invoke<string>("chat_with_ai", {
        model,
        messages: apiMessages,
      });

      // 创建 AI 消息对象
      const aiMsg: Message = { role: "ai", content: aiReply };
      // 更新对话状态，添加 AI 消息
      setConversations((prev) => ({
        ...prev,
        [model]: prev[model].map((conv) =>
          conv.id === currentConversation.id
            ? { ...conv, messages: [...updatedMessages, aiMsg] }
            : conv
        ),
      }));
    } catch (e: any) {
      // 如果调用失败，生成错误消息
      const errMsg =
        typeof e === "string" ? e : e?.toString?.() || JSON.stringify(e);
      setConversations((prev) => ({
        ...prev,
        [model]: prev[model].map((conv) =>
          conv.id === currentConversation.id
            ? {
                ...conv,
                messages: [...updatedMessages, { role: "ai", content: `❌ 调用失败：\n${errMsg}` }],
              }
            : conv
        ),
      }));
    } finally {
      // 无论成功与否，最后将加载状态设置为 false
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif", maxWidth: 800 }}>
      <h2>🧠 AI 对话</h2>

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value as ModelType)}
          style={{ marginRight: 10 }}
        >
          <option value="openai">OpenAI (GPT)</option>
          <option value="deepseek">DeepSeek</option>
          <option value="qwen">通义千问</option>
          <option value="mimo">小米 MIMO</option>
        </select>
        <button onClick={createNewConversation}>新建对话</button>
        <Link to="/settings">
          <button>设置</button>
        </Link>
      </div>

      <div style={{ display: "flex", marginBottom: 10 }}>
        <div style={{ flex: 1, marginRight: 10 }}>
          <h3>对话列表</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {conversations[model].map((conv) => (
              <li
                key={conv.id}
                style={{
                  padding: 10,
                  border: "1px solid #ccc",
                  marginBottom: 5,
                  background: conv.id === currentConversationId ? "#e6f7ff" : "#fff",
                  cursor: "pointer",
                }}
                onClick={() => setCurrentConversationId(conv.id)}
              >
                <input
                  value={conv.name}
                  onChange={(e) => renameConversation(conv.id, e.target.value)}
                  style={{ border: "none", background: "transparent", width: "80%" }}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(conv.id);
                  }}
                  style={{ marginLeft: 10 }}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ flex: 2 }}>
          <h3>对话内容</h3>
          <div
            style={{
              border: "1px solid #ccc",
              height: 360,
              padding: 10,
              overflowY: "auto",
              background: "#fafafa",
            }}
          >
            {currentConversation ? (
              currentConversation.messages.map((msg, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <strong>{msg.role === "user" ? "用户" : "AI"}：</strong>
                  <span style={{ marginLeft: 4 }}>{msg.content}</span>
                </div>
              ))
            ) : (
              <div>请选择一个对话</div>
            )}
            {loading && (
              <div>
                <strong>AI：</strong> 思考中…
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        <input
          className="input-box"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入内容..."
          disabled={loading || !currentConversation}
          onKeyDown={(e) => {
            if (e.key === "Enter") sendMessage();
          }}
        />
        <button className="btn-send" onClick={sendMessage} disabled={loading || !currentConversation}>
          {loading ? "思考中…" : "发送"}
        </button>
      </div>
    </div>
  );
}

export default App;
