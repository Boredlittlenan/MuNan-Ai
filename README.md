# MuNan AI

MuNan AI 是一个基于 Tauri 2 + React + TypeScript + Rust 的桌面端多模型 AI 对话工具。

## 当前能力

- 多模型对话：支持 OpenAI、DeepSeek、Qwen、MIMO、NVIDIA 和用户手动添加的 OpenAI-compatible 供应商。
- 模型配置中心：在设置页维护 Base URL、API Key、模型名、自定义模型和默认模型。
- 语音能力：支持 ASR 语音输入和 TTS 回复朗读；ASR 支持 OpenAI-like/MIMO 与腾讯云一句话识别。
- AI 人设与 TTS 引导：可在设置页编辑后台人设，AI 回复会拆成用户可见文本和 TTS 朗读文本。
- 配置备份：支持本地 JSON 和 WebDAV 导入/导出。
- 响应式 UI：PC、平板、手机均已适配；手机端聊天页使用可折叠模型/会话侧边栏，消息区独立滚动，输入区固定在底部。

## 开发运行

```bash
pnpm install
pnpm tauri dev
```

只跑前端构建检查：

```bash
pnpm build
```

Rust 检查：

```bash
cd src-tauri
cargo check
cargo fmt --check
```

## 配置文件

配置模板在 `src-tauri/config.example.json`。真实密钥请放在本地配置文件中，不要提交：

- `src-tauri/config.local.json`
- `src-tauri/config.json`

后端读取配置时优先使用 `config.local.json`。

## 文档

- `docs/AI_HANDOFF.md`：主要技术说明，适合后续 AI 或开发者快速接手。
- `docs/ARCHITECTURE.md`：简版架构索引。

## 注意

- `dist/`、`node_modules/`、`src-tauri/target/` 是生成目录。
- 导出的配置备份可能包含模型密钥，适合个人备份，不要提交到 Git。
- WebDAV 配置只保存在本机配置中，不会写入导出的备份 JSON。
