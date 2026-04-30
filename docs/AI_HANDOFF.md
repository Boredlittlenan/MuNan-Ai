# MuNan AI 后续 AI 上手说明

这份文档面向后续接手项目的 AI 或开发者，目标是快速理解软件功能、目录结构、关键文件职责、配置流和常见改动入口。

## 1. 软件定位

MuNan AI 是一个基于 Tauri 2 + React + TypeScript + Rust 的桌面端多模型 AI 对话工具。

当前核心能力：

- 多供应商对话：支持 OpenAI、DeepSeek、Qwen、MIMO、NVIDIA。
- 自定义供应商：设置页模型导航可手动添加 OpenAI-compatible 模型供应商。
- 多模态模型：每个聊天模型可独立开启 `is_multimodal`，开启后聊天输入区支持图片附件，并按 OpenAI-compatible `image_url` 消息格式发送。
- 多会话管理：每个模型有独立会话列表，聊天记录长期保存在 Tauri 后端 SQLite。
- Token 用量统计：成功聊天请求会记录供应商返回的 usage，设置页单独展示统计、趋势图、柱形图和模型占比饼图，支持日期筛选；明细默认永久保存，日汇总长期保存。
- 模型配置中心：设置页统一维护各供应商的 Base URL、API Key、模型名、自定义模型列表和多模态开关。
- 配置备份：设置页右上角支持本地或 WebDAV 导出/导入设置 JSON，便于迁移和备份。
- 默认模型记忆：用户选择的默认模型和最近会话会写入本地状态。
- TTS 配置与朗读：AI 回复旁有复制按钮和扬声器按钮，可调用 TTS 生成音频并播放。
- MIMO TTS VoiceDesign：支持 `mimo-v2.5-tts-voicedesign` 的“音色描述”字段。
- 语音输入：聊天输入框旁有麦克风按钮，录音后调用 ASR 配置识别并回填输入框。ASR 支持 OpenAI-like/MIMO 和腾讯云语音识别两种 provider。
- 双文本回复：AI 回复会拆成用户可见文本和 TTS 朗读文本，朗读文本可携带风格标签与音频标签。
- AI 人设：设置页“基础配置”可编辑用户名和后台人设提示词，每次聊天请求都会作为 system message 注入。
- 响应式布局：聊天页和设置页已适配 PC、平板和手机。手机端聊天页使用可折叠模型/会话侧边栏，消息区独立滚动，输入区固定在底部。

## 2. 技术栈

- 前端：React 19、TypeScript、Vite、React Router、react-icons。
- 桌面壳：Tauri 2。
- 后端：Rust、Tauri command、reqwest、serde、serde_json、tokio、rusqlite。
- 包管理：pnpm。

常用命令：

```bash
pnpm install
pnpm dev
pnpm build
pnpm tauri dev
pnpm tauri build
```

Rust 检查：

```bash
cd src-tauri
cargo check
cargo fmt --check
```

## 3. 顶层目录结构

```text
MuNan-Ai/
├─ docs/                  # 项目说明和技术文档
├─ public/                # Vite 静态资源
├─ src/                   # React 前端源码
├─ src-tauri/             # Tauri/Rust 后端与桌面配置
├─ dist/                  # 前端构建产物，自动生成
├─ node_modules/          # 前端依赖，自动生成
├─ index.html             # Vite 入口 HTML
├─ package.json           # 前端脚本和依赖
├─ pnpm-lock.yaml         # pnpm 锁文件
├─ tsconfig.json          # TypeScript 配置
├─ tsconfig.node.json     # Vite/Node 侧 TypeScript 配置
└─ vite.config.ts         # Vite 配置，Tauri devUrl 使用 1420
```

注意：

- `dist/`、`node_modules/`、`src-tauri/target/` 都是生成目录，不要手工维护。
- 真实密钥不要写进文档或提交。运行时配置会写入系统应用数据目录，仓库里的 `config.example.json` 只做模板。
- 设置页导出的配置 JSON 会包含 API Key、SecretId、SecretKey 等敏感字段，只适合个人备份；导出内容不会包含 WebDAV 配置。
- 修改前先看 `git status --short`，不要回滚用户已有改动。

## 4. 前端关键文件

```text
src/
├─ App.tsx                # 聊天主页
├─ Settings.tsx           # 设置页面
├─ audio/recording.ts     # 录音 Blob 转 WAV/Base64 工具
├─ components/            # 聊天页拆出的 UI 组件
├─ settings/              # 设置页辅助工具
├─ main.tsx               # React 路由和应用挂载
├─ modelConfig.ts         # 前端共享类型、模型元数据、轻量状态和迁移工具
├─ vite-env.d.ts          # Vite 类型声明
└─ styles/
   ├─ base.css            # 全局变量、基础控件、通用面板样式
   ├─ App.css             # 聊天页样式
   └─ Settings.css        # 设置页样式
```

### `src/modelConfig.ts`

前端配置模型的中心文件，主要包含：

- `MODEL_OPTIONS`：支持的供应商列表。
- `ModelType`：模型供应商联合类型。
- `MessageAttachment`：消息附件类型，目前支持图片，字段为 `id`、`type`、`name`、`mime_type`、`data_url`。
- `Message`、`Conversation`：聊天消息与会话类型。消息可包含 `attachments`，AI 消息可包含 `tts_text` 和 `original_content`。
- `ModelConfig`：通用供应商配置，字段为 `base_url`、`api_key`、`model`、`is_multimodal`。
- `CustomProviderConfig`：用户手动添加的模型供应商，字段为 `id`、`label`、`provider`、`base_url`、`api_key`、`model`、`is_multimodal`、`custom_models`。
- `AsrConfig`：ASR 配置，包含 `provider`、通用 ASR 字段、腾讯云凭据字段、`region`、`tencent_engine_type`。
- `TtsConfig`：TTS 配置，继承 `ModelConfig`，额外有 `voice`、`voice_description`。
- `PersonaConfig`：AI 人设配置，字段为 `username`、`prompt`。
- `WebDavConfig`：WebDAV 备份配置，字段为 `url`、`username`、`password`、`path`。
- `UsageConfig`：Token 用量统计配置，目前包含 `detail_retention_days`，默认 0，表示永久保存明细。
- `SpeechConfig`：ASR/TTS 配置组合。
- `AppConfig`：整份应用配置结构。
- `createEmptyAppConfig()`：生成完整空配置。
- `normalizeAppConfig()`：兜底后端返回缺字段的情况。
- `isModelConfigured()`：判断聊天模型是否可用。
- `normalizeConversations()`：归一化 SQLite 或旧 localStorage 返回的会话数据。

### `src/audio/recording.ts`

语音输入的纯前端音频处理工具：

- `recordedBlobToWavBase64()`：把 `MediaRecorder` 采集到的 Blob 解码成 `AudioBuffer`。
- 内部编码为 WAV，再转换为 Base64 传给 Rust ASR 命令。

### `src/components/ChatMessageBubble.tsx`

聊天消息气泡组件。负责：

- AI 回复的复制、朗读、显示原文、编辑按钮。
- AI 回复编辑态的显示文本和朗读文本编辑。
- 原文展开面板。

### `src/settings/configBackup.ts`

设置页导入/导出辅助工具：

- `exportAppConfigBackup()`：调用 Tauri `export_app_config`。
- `revealConfigBackup()`：用 opener 插件定位导出的文件。
- `readConfigBackup()`：读取 JSON 备份并通过 `normalizeAppConfig()` 归一化。

新增聊天供应商时，需要同步改：

- `MODEL_OPTIONS`
- `MODEL_CATALOG`
- `MODEL_META`
- `createEmptyAppConfig`
- `createEmptyConversations`
- Rust 后端 `AppConfig`
- Rust `chat_with_ai` 分发逻辑

### `src/App.tsx`

聊天页主组件，主要职责：

- 加载后端配置：`invoke<AppConfig>("load_app_config")`。
- 加载后端会话：`invoke("load_conversations")`，旧 `localStorage` 会话会在首次发现 SQLite 为空时自动导入。
- 维护当前供应商、当前会话、输入框、加载状态。
- 手机端维护 `mobileSidebarOpen`，用于控制模型/会话抽屉式侧边栏。
- 会话变化后延迟写入 SQLite：`invoke("save_conversations")`。
- 发送聊天消息：调用 `invoke<ChatReply>("chat_with_ai", { model, messages })`。
- 当前模型开启 `is_multimodal` 时，输入区可选择图片；用户消息会转换为 `[{ type: "text" }, { type: "image_url" }]` 内容数组。
- AI 返回内容中如果包含 Markdown 图片或兼容接口返回的 `image_url` part，前端会转成消息附件渲染。
- 每条 AI 回复提供复制、朗读、显示原文和编辑按钮。
- 朗读按钮优先使用 `message.tts_text`，没有朗读文本时回退到 `message.content`。
- 处理语音输入：录音、转 WAV、调用 `transcribe_audio`、把识别文本追加到输入框。

ASR 调用链：

```text
点击输入框旁麦克风
  -> App.tsx startRecording()
  -> getUserMedia 获取麦克风
  -> MediaRecorder 采集音频 Blob
  -> audio/recording.ts recordedBlobToWavBase64()
  -> Web Audio API 解码 Blob 并编码为 WAV
  -> Tauri invoke("transcribe_audio")
  -> Rust speech/asr.rs
  -> 读取 speech.asr 配置
  -> 按 provider 调用 OpenAI-like/MIMO 或腾讯云 SentenceRecognition
  -> 返回文本
  -> App.tsx 追加到输入框
```

聊天回复调用链：

```text
App.tsx sendMessage()
  -> 如果当前模型开启 is_multimodal，把图片附件转为 image_url content part
  -> Tauri invoke("chat_with_ai")
  -> Rust commands/chat.rs
  -> 读取 persona.username / persona.prompt
  -> 注入 prompts/chat_response_guide.md
  -> 调用对应 AI provider
  -> 解析 <display_text> 与 <tts_text>
  -> 返回 ChatReply
  -> 前端保存 content / tts_text / original_content
```

### `src/Settings.tsx`

设置页主组件，主要职责：

- 进入页面时读取 `load_app_config`。
- 左侧展示三类设置入口：基础配置、模型配置、ASR/TTS 配置；左栏桌面端固定自身高度，不随右侧内容切换伸缩。
- 基础配置中维护 `persona.username`、`persona.prompt`、默认模型和 WebDAV 配置。
- 用量统计独立为设置分类，展示筛选范围、今日、本月、明细数量、线性趋势图、每日柱形图和各模型占比饼图。
- 用量统计页可设置明细保存时间，0 表示永久保存，7-3650 表示自动清理更早明细。
- 可在模型导航中添加自定义供应商，自定义供应商按 OpenAI-compatible 接口调用。
- 编辑当前供应商的 `base_url`、`api_key`、`model`、`is_multimodal`。
- 维护自定义模型列表。
- 保存整份配置：`invoke("save_app_config", { config })`。
- 保存默认模型到 `localStorage`。
- 导出当前表单配置为 JSON 备份文件。
- 导入/导出按钮会先弹窗选择本地文件或 WebDAV。
- 从 JSON 备份文件或 WebDAV 导入配置到表单，确认后再点击“保存设置”写入配置文件。
- WebDAV 地址、用户名、密码和备份文件路径在“基础配置”中维护。
- 编辑 ASR/TTS 配置。
- 编辑用户名和 AI 人设提示词，分别保存到 `persona.username` 与 `persona.prompt`。

ASR 设置：

- `provider = "openai_like"`：使用 Base URL、API Key、`model`，适用于 MIMO 或 OpenAI-like 音频理解接口。
- `provider = "tencent"`：使用腾讯云 AppId、SecretId、SecretKey、地域和识别引擎类型。
- 腾讯云识别引擎类型保存在 `speech.asr.tencent_engine_type`，默认 `16k_zh-PY`，不会影响 OpenAI-like/MIMO 的 `speech.asr.model`。

## 5. 后端关键文件

```text
src-tauri/
├─ Cargo.toml             # Rust 依赖和 crate 配置
├─ Cargo.lock             # Rust 锁文件
├─ config.example.json    # 配置模板，不放真实密钥
├─ tauri.conf.json        # Tauri 窗口、构建、打包配置
├─ build.rs               # Tauri build hook
└─ src/
   ├─ main.rs             # 二进制入口，只调用 munan_ai_lib::run()
   ├─ lib.rs              # Tauri Builder、插件、command 注册
   ├─ config.rs           # 配置结构、加载、保存
   ├─ storage.rs          # SQLite 会话长期存储
   ├─ ai/                 # 各聊天供应商适配器
   ├─ commands/           # Tauri commands
   └─ speech/             # ASR/TTS 模块
```

### `src-tauri/src/config.rs`

后端配置中心。运行时配置保存到系统应用数据目录：

```text
{app_data_dir}/config.json
```

首次运行时，如果应用数据目录还没有配置，会尝试从旧开发路径迁移：

```text
./config.local.json
./src-tauri/config.local.json
./config.json
./src-tauri/config.json
```

保存前会为已有配置写一份 `config.json.bak`，降低配置损坏时的恢复成本。

### `src-tauri/src/storage.rs`

SQLite 会话存储中心：

- 数据库文件：`{app_data_dir}/conversations.sqlite`。
- `conversations` 表保存会话 ID、供应商 ID、当前模型名、会话名、创建/更新时间。
- `messages` 表保存每条消息、TTS 文本、模型原始输出和图片附件 JSON。
- 旧数据库缺少 `messages.attachments` 时，启动会自动添加该列。
- `token_usage_events` 表保存每次成功聊天请求的短期明细。
- `token_usage_daily` 表按日期、供应商、模型保存长期日汇总。
- `load_conversations` 返回按供应商 ID 分组的会话列表。
- `save_conversations` 使用事务重写会话快照，前端会做 300ms 延迟合并，避免频繁落库。
- `load_token_usage_stats` 接收可选 `start_date` / `end_date`，返回今日、本月、筛选范围、日趋势和按模型分组的统计数据。
- `record_token_usage` 在聊天请求成功后写入明细并累加日汇总，然后按 `usage.detail_retention_days` 清理旧明细；`0` 会跳过清理。
- 首次升级时，前端会把旧 `localStorage.chatConversations` 导入 SQLite，成功后移除旧聊天历史缓存。

### `src-tauri/src/speech/asr.rs`

ASR 语音输入转写实现。

OpenAI-like/MIMO：

- 读取 `speech.asr.base_url`、`speech.asr.api_key`、`speech.asr.model`。
- 前端会把录音统一转换为 WAV，并传入纯 Base64 和 `audio/wav`。
- 后端补成 `data:audio/wav;base64,...` 后按音频理解格式发送。
- 从 `choices[0].message.content` 读取文本，若为空兜底读取 `reasoning_content`。

腾讯云：

- 读取 `speech.asr.app_id`、`secret_id`、`secret_key`、`region`、`tencent_engine_type`。
- 默认地域：`ap-shanghai`。
- 默认识别引擎类型：`16k_zh-PY`，对应腾讯云一句话识别的中英粤引擎。
- 调用腾讯云一句话识别 `SentenceRecognition`。
- 后端使用 TC3-HMAC-SHA256 签名。
- 请求体中 `EngSerViceType` 来自 `tencent_engine_type`。
- 腾讯云模式固定使用 `https://asr.tencentcloudapi.com`，不会读取 OpenAI-like/MIMO 使用的 `base_url`。
- 公共 API 签名主要使用 SecretId/SecretKey；AppId 用于账号信息完整性和生成 `UsrAudioKey`。

腾讯云 `AuthFailure.SignatureFailure` 排查：

- 这是腾讯云 API 鉴权层错误，请求还没有进入音频识别逻辑。
- AppId、SecretId、SecretKey 必须分别填写；AppId 是数字账号 ID，SecretId 通常以 `AKID` 开头，SecretKey 是配套密钥。
- 不要把 `appid:SecretId:SecretKey` 整串填进一个输入框，也不要把 AppId 当成 SecretId。
- 检查 SecretId/SecretKey 是否多复制了空格或换行、是否被禁用/删除、是否属于当前腾讯云账号。
- TC3 签名依赖时间戳；如果本机时间严重不准，也可能导致鉴权失败。
- 当前实现的签名头包含 `content-type;host;x-tc-action`，时间戳和日期来自同一个 UTC 时间点。

### `src-tauri/src/commands/chat.rs`

聊天命令入口：

- 读取 `AppConfig`。
- 将 `persona.username` 作为用户信息 system message 注入。
- 将 `persona.prompt` 作为人设 system message 注入。
- 将 `src-tauri/prompts/chat_response_guide.md` 作为双文本回复格式引导注入。
- 按模型供应商分发到 `src-tauri/src/ai/*`。
- 未命中内置供应商时，会在 `custom_providers` 中查找同名 `id`，并使用 `openai_like::chat_api` 调用。
- `ChatMessage.content` 使用 `serde_json::Value`，兼容纯文本和 OpenAI-compatible 多模态 content 数组。
- OpenAI-compatible 响应会解析 `usage.prompt_tokens`、`usage.completion_tokens`、`usage.total_tokens`；不返回 usage 的供应商会只记录请求次数，token 数为 0。
- 请求模型前会保留最近 80 条上下文消息，避免长会话无限膨胀导致请求过慢或超上下文。
- 从模型输出中解析 `<display_text>` 和 `<tts_text>`。
- 返回 `ChatReply { content, tts_text, original_content }`。

解析失败时会把模型原始输出作为 `content`，`tts_text` 留空，保证聊天不会因为格式问题中断。`original_content` 保存模型原始输出，用于前端“显示原文”。

### `src-tauri/prompts/chat_response_guide.md`

运行时对话引导文件。它要求模型每次输出：

```text
<display_text>
给用户看的正常回复
</display_text>

<tts_text>
(温柔 平静)给 TTS 朗读的口播版本，可以带 [轻笑]、[停顿] 等标签
</tts_text>
```

`tts_text` 必须忠实于 `display_text`，不能新增事实、承诺或结论。包含代码时，朗读稿只概括代码作用，不逐字朗读代码。

### `src-tauri/src/speech/tts.rs`

TTS 合成实现。

- 读取 `speech.tts`。
- 校验 Base URL、API Key、模型名。
- 如果模型名包含 `voicedesign`，要求 `voice_description` 不为空。
- MIMO VoiceDesign 约定：音色描述放 `user` message，需要朗读的文本放 `assistant` message，`audio.format` 常用 `wav`。
- 从响应 `choices[0].message.audio.data` 读取 base64 音频。

## 6. 配置文件说明

配置模板：`src-tauri/config.example.json`。

ASR 配置示例：

```json
{
  "schema_version": 1,
  "speech": {
    "asr": {
      "provider": "openai_like",
      "base_url": "https://api.xiaomimimo.com/v1/chat/completions",
      "api_key": "你的 MiMo API Key",
      "model": "mimo-v2.5",
      "tencent_engine_type": "16k_zh-PY",
      "app_id": "",
      "secret_id": "",
      "secret_key": "",
      "region": "ap-shanghai"
    }
  },
  "persona": {
    "username": "木南",
    "prompt": "你是 MuNan AI，一个温和、清晰、可靠的桌面 AI 助手。"
  },
  "webdav": {
    "url": "",
    "username": "",
    "password": "",
    "path": "munan-ai-settings.json"
  },
  "usage": {
    "detail_retention_days": 0
  }
}
```

腾讯云 ASR 配置示例：

```json
{
  "provider": "tencent",
  "base_url": "",
  "api_key": "",
  "model": "",
  "tencent_engine_type": "16k_zh-PY",
  "app_id": "你的腾讯云 AppId",
  "secret_id": "你的腾讯云 SecretId",
  "secret_key": "你的腾讯云 SecretKey",
  "region": "ap-shanghai"
}
```

字段说明：

- `provider`：ASR 服务类型，`openai_like` 或 `tencent`。
- `speech.asr.model`：OpenAI-like/MIMO ASR 使用的模型 ID。
- `speech.asr.tencent_engine_type`：腾讯云识别引擎类型，对应 `EngSerViceType`，默认 `16k_zh-PY`；`16k_zh_en` 属于其它 ASR 产品/模型表述，不适用于当前一句话识别接口。
- `speech.asr.region`：腾讯云地域，默认 `ap-shanghai`。
- 腾讯云 ASR 不使用 `speech.asr.base_url`、`speech.asr.api_key`、`speech.asr.model`，避免和 OpenAI-like/MIMO 配置互相覆盖。
- `speech.tts.voice_description`：VoiceDesign 音色描述。
- `persona.username`：基础配置中的用户名，每次聊天请求会作为用户信息注入。
- `persona.prompt`：后台 AI 人设提示词，每次聊天请求都会注入。
- `webdav`：WebDAV 备份配置，仅保存在本机配置中；本地导出和 WebDAV 导出的备份 JSON 都会移除该字段。
- `usage.detail_retention_days`：Token 用量明细保存天数，默认 0，即永久保存；填写 7-3650 时会按天数清理明细；日汇总长期保留。
- `custom_models`：设置页添加的自定义模型列表。
- `custom_providers`：设置页添加的自定义供应商列表，导入/导出会保留该列表。
- 聊天模型的 `is_multimodal`：开启后前端允许发送图片附件；关闭时图片按钮不可用，纯文本聊天不受影响。该字段存在于内置聊天模型配置和 `custom_providers` 中，不用于 ASR/TTS。

## 7. 样式系统

### `src/styles/base.css`

包含全局设计变量和通用样式：

- 颜色变量、阴影、圆角。
- 通用按钮：`.primary-button`、`.ghost-button`、`.icon-action`。
- `.icon-action` 是纯图标按钮，固定为圆形；文字按钮继续使用 `.primary-button` 或 `.ghost-button`。
- 通用状态：`.status-chip`、`.alert-banner`。
- 表单输入基础样式。
- 响应式基础布局。

### `src/styles/App.css`

聊天页专用样式：

- `.chat-layout`：左右布局。
- `.chat-sidebar`：模型和会话列表。
- `.mobile-sidebar-toggle` / `.chat-sidebar-backdrop`：手机端模型和会话抽屉入口与遮罩。
- `.chat-main`：聊天主体。
- `.chat-box`：消息滚动区。
- `.chat-bubble`：消息气泡。
- `.chat-message-actions` / `.chat-message-action`：AI 回复复制和朗读按钮。
- `.message-attachment-grid`：聊天气泡内的图片附件网格。
- `.input-panel` / `.input-area`：底部输入区。
- `.image-attach-button` / `.attachment-preview-list`：图片选择按钮和待发送图片预览。
- `.record-button`：语音输入按钮。

响应式约定：

- PC 端：聊天页使用左侧栏 + 右侧聊天主体。
- 平板端：聊天页降为单列，模型/会话区域保持展开，会话卡片横向滚动。
- 手机端：隐藏聊天页顶部品牌文案和状态文字，仅保留圆形侧边栏按钮与圆形设置按钮；模型切换和会话管理进入可折叠侧边栏；页面本身固定为 `100dvh`，只允许 `.chat-box` 上下滚动，输入框和录音/发送按钮固定在底部。
- 手机端抽屉内会隐藏重复标题，避免出现“模型与会话 / 工作区 / 模型切换 / 选择工作模型”等冗余文字。

### `src/styles/Settings.css`

设置页专用样式：

- `.settings-layout`：左右设置布局。
- `.settings-sidebar`：设置分类导航，桌面端固定高度，避免切换分类时跳动。
- `.settings-main`：配置表单。
- `.settings-field`：配置字段卡片。
- `.settings-textarea`：音色描述多行输入。
- `.speech-settings-grid`：ASR/TTS 双栏布局。

## 8. 本地存储

后端长期数据：

- `{app_data_dir}/config.json`：模型、ASR/TTS、人设、WebDAV 等运行时配置。
- `{app_data_dir}/config.json.bak`：上一次配置备份。
- `{app_data_dir}/conversations.sqlite`：长期聊天历史。
- 图片附件当前以 data URL 或远程 URL 形式保存到 `messages.attachments` JSON 字段；大图会增加 SQLite 体积，前端单张限制 8MB，单条最多 4 张。
- Token 用量也保存在 `conversations.sqlite`：明细表默认永久保存，可由用户设置自动清理；日汇总表长期保留。设置页图表查询日汇总数据，避免数据变多后影响页面响应。

前端仍使用 `localStorage` 保存轻量用户状态：

- `userState`：最近使用的模型和会话 ID。
- `preferredModel`：设置页选定的默认模型。
- `chatConversations`：仅作为旧版本迁移来源；迁移成功后会删除。

后端配置和聊天历史都不再依赖 `localStorage`。

设置页导入/导出：

- 导入/导出按钮会先弹出来源/目标选择弹窗：本地文件或 WebDAV。
- 基础配置维护 `webdav.url`、`webdav.username`、`webdav.password`、`webdav.path`。`webdav.path` 留空时后端默认使用 `munan-ai-settings.json`。
- 本地导出：调用 `export_app_config`，读取当前表单中的 `AppConfig`，在用户 `Downloads` 目录生成 `munan-ai-settings-*.json` 备份文件。
- 导出成功横幅会显示“打开文件所在目录”，前端使用 `@tauri-apps/plugin-opener` 的 `revealItemInDir()` 打开导出文件位置。
- WebDAV 导出：调用 `export_app_config_to_webdav`，使用 HTTP PUT 上传备份 JSON。
- 本地导入：用户选择 JSON 文件后，前端解析并通过 `normalizeAppConfig()` 填回表单。
- WebDAV 导入：调用 `import_app_config_from_webdav`，使用 HTTP GET 读取备份 JSON。
- 导入不会立刻写入磁盘，用户需要点击“保存设置”才会调用 `save_app_config`。
- 导出的文件可能包含模型密钥，不能提交到 Git，也不要发给无关人员。
- 备份 JSON 不包含 `webdav` 字段；本地导入和 WebDAV 导入都会保留当前本机 WebDAV 配置。
- 设置页所有密码输入框旁都有小眼睛按钮，可临时切换明文/密文显示。

## 9. 常见改动入口

### 新增聊天供应商

1. 前端 `src/modelConfig.ts` 加模型元数据、默认配置、会话空列表。
2. Rust `src-tauri/src/config.rs` 的 `AppConfig` 增加字段。
3. Rust `src-tauri/src/ai/` 新增供应商适配器。
4. Rust `src-tauri/src/ai/mod.rs` 声明模块。
5. Rust `src-tauri/src/commands/chat.rs` 增加 match 分支。
6. 更新 `src-tauri/config.example.json`。
7. 运行 `pnpm build` 和 `cargo check`。

### 改语音输入 / ASR

优先看：

- `src/App.tsx` 的录音、WAV 转换和 `transcribe_audio` 调用。
- `src/Settings.tsx` 的 ASR 表单。
- `src/modelConfig.ts` 的 `AsrConfig`。
- `src-tauri/src/config.rs` 的 `AsrConfig`。
- `src-tauri/src/speech/asr.rs`。
- `src-tauri/src/speech/types.rs`。

注意：语音输入只把识别文本回填输入框，不会自动发送消息。

### 改图片 / 多模态聊天

优先看：

- `src/Settings.tsx` 的“多模态能力”开关。
- `src/App.tsx` 的 `pendingAttachments`、`addImageAttachments()`、`toApiMessage()`、`extractImageAttachments()`。
- `src/components/ChatMessageBubble.tsx` 的附件渲染。
- `src/modelConfig.ts` 的 `MessageAttachment`、`ModelConfig.is_multimodal`、`normalizeAttachments()`。
- `src-tauri/src/ai/types.rs` 的 `ChatMessage.content`。
- `src-tauri/src/storage.rs` 的 `messages.attachments` 存储。

注意：当前按 OpenAI-compatible 视觉消息格式发送图片，即 content 数组中包含 `image_url.url`。供应商必须真的支持视觉输入，否则即使开关开启也可能由供应商返回不支持图片的错误。

### 改 Token 用量统计

优先看：

- `src/Settings.tsx` 的用量统计设置项、日期筛选、线性图、柱形图、饼图和 `usage.detail_retention_days` 输入项。
- `src/modelConfig.ts` 的 `UsageConfig`。
- `src-tauri/src/ai/types.rs` 的 `TokenUsage` / `AiResponse`。
- `src-tauri/src/ai/openai_like.rs` 的 usage 解析。
- `src-tauri/src/commands/chat.rs` 的成功请求后记录逻辑。
- `src-tauri/src/storage.rs` 的 `token_usage_events`、`token_usage_daily`、`load_token_usage_stats`。

注意：统计优先使用供应商返回的 usage 字段；没有 usage 时不做本地 tokenizer 估算，只记录请求次数。

### 改 TTS

优先看：

- `src/App.tsx` 的 `speakReply()`。
- `src-tauri/src/speech/tts.rs`。
- `src-tauri/src/speech/types.rs`。
- `src/modelConfig.ts` 的 `TtsConfig`。
- `src/Settings.tsx` 的 TTS 表单。

## 10. 验证清单

每次改完建议至少跑：

```bash
pnpm build
cd src-tauri
cargo check
cargo fmt --check
```

如果改了 UI，建议启动：

```bash
pnpm tauri dev
```

手动检查：

- 聊天页能加载。
- 设置页能加载。
- 切换模型不报错。
- 保存设置后聊天页能读取最新配置。
- AI 回复的复制按钮能复制文本。
- TTS 配置完整时，扬声器按钮能触发朗读。
- ASR 配置完整时，麦克风按钮能录音、停止并把识别文本回填输入框。
- ASR 配置不完整时，有清晰错误提示。
- 多模态开关关闭时，图片按钮禁用；开启后可添加图片、预览、移除，并随消息保存到 SQLite。
- 支持视觉输入的供应商应能收到 `image_url` 消息；返回 Markdown 图片时聊天气泡应直接显示图片。
- 成功聊天后，设置页用量统计能看到请求次数；供应商返回 usage 时能看到 token 数增长。
- 日期筛选后，线性图、柱形图和模型占比饼图应按筛选范围更新。
- 明细保存时间默认为 0，即永久保存；修改为具体天数并保存后，后续成功请求会按新天数清理旧明细。
- 手机端宽度下，聊天页应无横向溢出；模型/会话抽屉可打开和关闭；页面整体不滚动，消息框独立滚动，输入区固定在底部。

## 11. 已知注意点

- 聊天记录以 SQLite 为主，旧 `localStorage` 只用于升级迁移。
- 语音输入会先在前端转成 WAV 再传给后端。
- 如果某些 WebView 无法解码录音 Blob，检查 `MediaRecorder` 输出格式和 Web Audio 支持。
- 语音输入依赖用户授权麦克风；如果 `getUserMedia` 报错，优先检查系统麦克风权限和 WebView 权限。
- OpenAI-like helper 默认从 `choices[0].message.content` 取文本，不适合所有供应商的特殊响应格式。
- 图片附件保存为 data URL 会增大 `conversations.sqlite`；如果后续加入文件管理，建议改为文件落盘 + SQLite 保存引用路径。
- Token 明细默认永久保存；如果用户设置了保存天数，长期趋势仍依赖日汇总表。NVIDIA 等流式供应商可能不返回 usage，因此 token 数可能为 0，但请求次数仍会记录。
- NVIDIA 适配器是流式解析，改动时要保留 SSE 逐行处理；后端会把以 `/v1` 结尾的 Base URL 自动补成 `/chat/completions`。
- `mimo-v2.5-tts-voicedesign` 不使用内置 `voice`，需要 `voice_description`。
- 不要把真实 API Key 写进示例、文档或测试输出。

## 12. 快速定位表

| 需求 | 优先查看文件 |
| --- | --- |
| 聊天发送失败 | `src/App.tsx`, `src-tauri/src/commands/chat.rs`, `src-tauri/src/ai/openai_like.rs` |
| 某个供应商返回为空 | `src-tauri/src/ai/{provider}.rs` |
| 设置页字段不显示 | `src/Settings.tsx`, `src/modelConfig.ts` |
| 保存配置失败 | `src-tauri/src/config.rs`, `src-tauri/src/commands/config.rs` |
| TTS 不朗读 | `src/App.tsx`, `src-tauri/src/speech/tts.rs`, 应用数据目录 `config.json` |
| 语音输入不识别 | `src/App.tsx`, `src-tauri/src/speech/asr.rs`, 应用数据目录 `config.json` |
| 图片按钮不可用 | 设置页当前模型的 `is_multimodal`, `src/App.tsx` |
| 图片消息不显示 | `src/components/ChatMessageBubble.tsx`, `src-tauri/src/storage.rs` |
| Token 统计不增长 | `src-tauri/src/commands/chat.rs`, `src-tauri/src/storage.rs`, 供应商响应 `usage` |
| VoiceDesign 报缺少音色描述 | 设置页 TTS 的“音色描述”字段 |
| 新增模型下拉选项 | `src/modelConfig.ts` 的 `MODEL_CATALOG` |
| 改窗口大小或标题 | `src-tauri/tauri.conf.json` |
| 改全局视觉风格 | `src/styles/base.css` |
| 改聊天气泡样式 | `src/styles/App.css` |
