# MuNan AI

MuNan AI 是一个基于 Tauri 2 + React + TypeScript + Rust 的桌面端多模型 AI 对话工具。

## 当前能力

- 多模型对话：支持 OpenAI、DeepSeek、Qwen、MIMO、NVIDIA 和用户手动添加的 OpenAI-compatible 供应商。
- 设置中心：左侧按基础配置、模型配置、ASR/TTS 配置分类；基础配置中维护用户名、AI 人设、默认模型和 WebDAV，模型配置中维护 Base URL、API Key、模型名、自定义模型和多模态开关。
- 图片消息：单个聊天模型可标记为多模态；开启后聊天输入区可附加图片，并按 OpenAI-compatible 视觉消息格式发送。
- 语音能力：支持 ASR 语音输入和 TTS 回复朗读；ASR 支持 OpenAI-like/MIMO 与腾讯云一句话识别。
- AI 人设与 TTS 引导：可在设置页编辑用户名和后台人设，AI 回复会拆成用户可见文本和 TTS 朗读文本。
- 长期会话存储：聊天历史保存到 Tauri 后端 SQLite，旧版 localStorage 会话会在首次启动时自动迁移。
- Token 用量统计：成功聊天请求会记录供应商返回的 usage，设置页单独展示线性图、柱形图和模型占比饼图，支持日期筛选；明细默认永久保存。
- Agent 设置与快速动作：设置页新增 Agent 设置，可管理总开关、浏览器操作、系统操作、Shell 执行、高风险确认、单次步数和技能白名单；聊天页已支持打开网页、读取网页文本、打开本地路径、复制文本，并可由 AI 根据对话需求自动规划 Shell 命令。
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

## 本地数据

配置模板在 `src-tauri/config.example.json`。运行时配置会保存到系统应用数据目录中的 `config.json`，首次启动会自动迁移旧的 `config.local.json` / `config.json`。

聊天历史和 token 用量统计会保存到同一应用数据目录下的 `conversations.sqlite`，图片附件会随消息一起保存。真实密钥不要提交到 Git。

## 文档

- `docs/AI_HANDOFF.md`：主要技术说明，适合后续 AI 或开发者快速接手。
- `docs/ARCHITECTURE.md`：简版架构索引。

## 注意

- `dist/`、`node_modules/`、`src-tauri/target/` 是生成目录。
- 导出的配置备份可能包含模型密钥，适合个人备份，不要提交到 Git。
- WebDAV 配置只保存在本机配置中，不会写入导出的备份 JSON。
