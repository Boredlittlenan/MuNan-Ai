import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Link } from "react-router-dom";
import './app.css';

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

  const deleteConversation = (id: string) => {
    setConversations((prev) => ({
      ...prev,
      [model]: prev[model].filter((conv) => conv.id !== id),
    }));
    if (currentConversationId === id) {
      setCurrentConversationId(null);
    }
  };

  const renameConversation = (id: string, newName: string) => {
    setConversations((prev) => ({
      ...prev,
      [model]: prev[model].map((conv) =>
        conv.id === id ? { ...conv, name: newName } : conv
      ),
    }));
  };

  const sendMessage = async () => {
    if (!input.trim() || loading || !currentConversation) return;

    const userMsg: Message = { role: "user", content: input };
    const updatedMessages = [...currentConversation.messages, userMsg];

    setConversations((prev) => ({
      ...prev,
      [model]: prev[model].map((conv) =>
        conv.id === currentConversation.id
          ? { ...conv, messages: updatedMessages }
          : conv
      ),
    }));
    setInput("");
    setLoading(true);

    try {
      const apiMessages = updatedMessages.map((m) => ({
        role: m.role === "ai" ? "assistant" : "user",
        content: m.content,
      }));

      const aiReply = await invoke<string>("chat_with_ai", {
        model,
        messages: apiMessages,
      });

      const aiMsg: Message = { role: "ai", content: aiReply };
      setConversations((prev) => ({
        ...prev,
        [model]: prev[model].map((conv) =>
          conv.id === currentConversation.id
            ? { ...conv, messages: [...updatedMessages, aiMsg] }
            : conv
        ),
      }));
    } catch (e: any) {
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
