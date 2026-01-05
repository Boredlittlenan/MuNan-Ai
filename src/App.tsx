import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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

// 定义发给后端的消息结构，符合 OpenAI 的 API 规范
// role: 消息的发送方，"user" 表示用户，"assistant" 表示 AI
// content: 消息的内容
type ApiMessage = {
  role: "user" | "assistant";
  content: string;
};

function App() {
  // 定义当前选择的模型，默认为 "openai"
  const [model, setModel] = useState<ModelType>("openai");
  // 定义消息列表，存储用户和 AI 的对话记录
  const [messages, setMessages] = useState<Message[]>([]);
  // 定义用户输入框的内容
  const [input, setInput] = useState("");
  // 定义是否处于加载状态
  const [loading, setLoading] = useState(false);

  // 发送消息的函数
  const sendMessage = async () => {
    // 如果输入为空或当前正在加载，则直接返回
    if (!input.trim() || loading) return;

    // 构造用户消息对象
    const userMsg: Message = { role: "user", content: input };

    // 🔥 构造完整消息上下文，包括之前的消息和当前用户消息
    const nextMessages = [...messages, userMsg];

    // UI 立即更新消息列表，显示用户消息
    setMessages(nextMessages);
    // 清空输入框
    setInput("");
    // 设置加载状态为 true
    setLoading(true);

    try {
      // 将消息转换为后端 API 所需的格式
      const apiMessages: ApiMessage[] = nextMessages.map((m) => ({
        role: m.role === "ai" ? "assistant" : "user",
        content: m.content,
      }));

      // 调用后端的 chat_with_ai 命令，传入模型和消息上下文
      const aiReply = await invoke<string>("chat_with_ai", {
        model,
        messages: apiMessages,
      });

      // 构造 AI 回复消息对象
      const aiMsg: Message = { role: "ai", content: aiReply };
      // 将 AI 回复追加到消息列表中
      setMessages((m) => [...m, aiMsg]);
    } catch (e: any) {
      // 如果调用失败，构造错误消息并追加到消息列表中
      const errMsg =
        typeof e === "string" ? e : e?.toString?.() || JSON.stringify(e);

      setMessages((m) => [
        ...m,
        { role: "ai", content: `❌ 调用失败：\n${errMsg}` },
      ]);
    } finally {
      // 🔥 保证无论成功或失败都关闭加载状态
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif", maxWidth: 800 }}>
      <h2>🧠 AI 对话</h2>

      {/* 消息显示区域 */}
      <div
        style={{
          border: "1px solid #ccc",
          height: 360,
          padding: 10,
          overflowY: "auto",
          marginBottom: 10,
          background: "#fafafa",
        }}
      >
        {messages.map((msg, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <strong>{msg.role === "user" ? "你" : "AI"}：</strong>
            <span style={{ marginLeft: 4 }}>{msg.content}</span>
          </div>
        ))}
        {loading && (
          <div>
            <strong>AI：</strong> 思考中…
          </div>
        )}
      </div>

      {/* 模型选择下拉框 */}
      <select
        value={model}
        onChange={(e) => setModel(e.target.value as ModelType)}
        style={{ marginBottom: 10 }}
      >
        <option value="openai">OpenAI (GPT)</option>
        <option value="deepseek">DeepSeek</option>
        <option value="qwen">通义千问</option>
        <option value="mimo">小米 MIMO</option>
      </select>

      {/* 输入框和发送按钮 */}
      <div>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          style={{ width: "75%", marginRight: 8 }}
          placeholder="输入内容..."
          disabled={loading}
          onKeyDown={(e) => {
            if (e.key === "Enter") sendMessage();
          }}
        />
        <button onClick={sendMessage} disabled={loading}>
          {loading ? "思考中…" : "发送"}
        </button>
      </div>
    </div>
  );
}

export default App;
