# MuNan AI 后续 AI 上手说明

这份文档面向后续接手项目的 AI 或开发者，目标是快速理解软件功能、目录结构、关键文件职责、配置流和常见改动入口。

## 1. 软件定位

MuNan AI 是一个基于 Tauri 2 + React + TypeScript + Rust 的桌面端多模型 AI 对话工具。

当前核心能力：

- 多供应商对话：支持 OpenAI、DeepSeek、Qwen、MIMO、NVIDIA。
- 多会话管理：每个模型有独立会话列表，聊天记录保存在浏览器 `localStorage`。
- 模型配置中心：设置页统一维护各供应商的 Base URL、API Key、模型名、自定义模型列表。
- 配置备份：设置页右上角支持本地或 WebDAV 导出/导入设置 JSON，便于迁移和备份。
- 默认模型记忆：用户选择的默认模型和最近会话会写入本地状态。
- TTS 配置与朗读：AI 回复旁有复制按钮和扬声器按钮，可调用 TTS 生成音频并播放。
- MIMO TTS VoiceDesign：支持 `mimo-v2.5-tts-voicedesign` 的“音色描述”字段。
- 语音输入：聊天输入框旁有麦克风按钮，录音后调用 ASR 配置识别并回填输入框。ASR 支持 OpenAI-like/MIMO 和腾讯云语音识别两种 provider。
- 双文本回复：AI 回复会拆成用户可见文本和 TTS 朗读文本，朗读文本可携带风格标签与音频标签。
- AI 人设：设置页可编辑后台人设提示词，每次聊天请求都会作为 system message 注入。

## 2. 技术栈

- 前端：React 19、TypeScript、Vite、React Router、react-icons。
- 桌面壳：Tauri 2。
- 后端：Rust、Tauri command、reqwest、serde、serde_json、tokio。
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
- 真实密钥不要写进文档或提交。优先使用 `src-tauri/config.local.json`。
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
├─ modelConfig.ts         # 前端共享类型、模型元数据、本地存储工具
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
- `Message`、`Conversation`：聊天消息与会话类型。AI 消息可包含 `tts_text` 和 `original_content`。
- `ModelConfig`：通用供应商配置，字段为 `base_url`、`api_key`、`model`。
- `AsrConfig`：ASR 配置，包含 `provider`、通用 ASR 字段、腾讯云凭据字段、`region`、`tencent_engine_type`。
- `TtsConfig`：TTS 配置，继承 `ModelConfig`，额外有 `voice`、`voice_description`。
- `PersonaConfig`：AI 人设配置，字段为 `prompt`。
- `WebDavConfig`：WebDAV 备份配置，字段为 `url`、`username`、`password`、`path`。
- `SpeechConfig`：ASR/TTS 配置组合。
- `AppConfig`：整份应用配置结构。
- `createEmptyAppConfig()`：生成完整空配置。
- `normalizeAppConfig()`：兜底后端返回缺字段的情况。
- `isModelConfigured()`：判断聊天模型是否可用。

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
- 维护当前供应商、当前会话、输入框、加载状态。
- 从 `localStorage` 恢复和保存会话。
- 发送聊天消息：调用 `invoke<ChatReply>("chat_with_ai", { model, messages })`。
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
  -> Tauri invoke("chat_with_ai")
  -> Rust commands/chat.rs
  -> 读取 persona.prompt
  -> 注入 prompts/chat_response_guide.md
  -> 调用对应 AI provider
  -> 解析 <display_text> 与 <tts_text>
  -> 返回 ChatReply
  -> 前端保存 content / tts_text / original_content
```

### `src/Settings.tsx`

设置页主组件，主要职责：

- 进入页面时读取 `load_app_config`。
- 展示左侧供应商列表。
- 编辑当前供应商的 `base_url`、`api_key`、`model`。
- 维护自定义模型列表。
- 保存整份配置：`invoke("save_app_config", { config })`。
- 保存默认模型到 `localStorage`。
- 导出当前表单配置为 JSON 备份文件。
- 导入/导出按钮会先弹窗选择本地文件或 WebDAV。
- 从 JSON 备份文件或 WebDAV 导入配置到表单，确认后再点击“保存设置”写入配置文件。
- WebDAV 配置按钮用于维护 WebDAV 地址、用户名、密码和备份文件路径。
- 编辑 ASR/TTS 配置。
- 编辑 AI 人设提示词，保存到 `persona.prompt`。

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
├─ config.json            # 本地真实配置，不应提交真实密钥
├─ tauri.conf.json        # Tauri 窗口、构建、打包配置
├─ build.rs               # Tauri build hook
└─ src/
   ├─ main.rs             # 二进制入口，只调用 munan_ai_lib::run()
   ├─ lib.rs              # Tauri Builder、插件、command 注册
   ├─ config.rs           # 配置结构、加载、保存
   ├─ ai/                 # 各聊天供应商适配器
   ├─ commands/           # Tauri commands
   └─ speech/             # ASR/TTS 模块
```

### `src-tauri/src/config.rs`

后端配置中心。配置读取优先级：

```text
./config.local.json
./src-tauri/config.local.json
./config.json
./src-tauri/config.json
```

保存时会写回当前解析到的配置文件；如果都不存在，会默认写入：

- 工作目录有 `src-tauri/` 时：`src-tauri/config.local.json`
- 否则：`config.local.json`

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
- 将 `persona.prompt` 作为人设 system message 注入。
- 将 `src-tauri/prompts/chat_response_guide.md` 作为双文本回复格式引导注入。
- 按模型供应商分发到 `src-tauri/src/ai/*`。
- 从模型输出中解析 `<display_text>` 和 `<tts_text>`。
- 返回 `ChatReply { content, tts_text, original_content }`。

解析失败时会把模型原始输出作为 `content`，`tts_text` 留空，保证聊天不会因为格式问题中断。

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
    "prompt": "你是 MuNan AI，一个温和、清晰、可靠的桌面 AI 助手。"
  },
  "webdav": {
    "url": "",
    "username": "",
    "password": "",
    "path": "munan-ai-settings.json"
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
- `persona.prompt`：后台 AI 人设提示词，每次聊天请求都会注入。
- `webdav`：WebDAV 备份配置，仅保存在本机配置中；本地导出和 WebDAV 导出的备份 JSON 都会移除该字段。
- `custom_models`：设置页添加的自定义模型列表。

## 7. 样式系统

### `src/styles/base.css`

包含全局设计变量和通用样式：

- 颜色变量、阴影、圆角。
- 通用按钮：`.primary-button`、`.ghost-button`、`.icon-action`。
- 通用状态：`.status-chip`、`.alert-banner`。
- 表单输入基础样式。
- 响应式基础布局。

### `src/styles/App.css`

聊天页专用样式：

- `.chat-layout`：左右布局。
- `.chat-sidebar`：模型和会话列表。
- `.chat-main`：聊天主体。
- `.chat-box`：消息滚动区。
- `.chat-bubble`：消息气泡。
- `.chat-message-actions` / `.chat-message-action`：AI 回复复制和朗读按钮。
- `.input-panel` / `.input-area`：底部输入区。
- `.record-button`：语音输入按钮。

### `src/styles/Settings.css`

设置页专用样式：

- `.settings-layout`：左右设置布局。
- `.settings-sidebar`：模型导航。
- `.settings-main`：配置表单。
- `.settings-field`：配置字段卡片。
- `.settings-textarea`：音色描述多行输入。
- `.speech-settings-grid`：ASR/TTS 双栏布局。

## 8. 本地存储

前端使用 `localStorage` 保存轻量用户状态：

- `chatConversations`：各模型会话列表和消息内容。
- `userState`：最近使用的模型和会话 ID。
- `preferredModel`：设置页选定的默认模型。

后端配置保存在 JSON 文件中，不进 `localStorage`。

设置页导入/导出：

- 导入/导出按钮会先弹出来源/目标选择弹窗：本地文件或 WebDAV。
- WebDAV 配置按钮维护 `webdav.url`、`webdav.username`、`webdav.password`、`webdav.path`。`webdav.path` 留空时后端默认使用 `munan-ai-settings.json`。
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

## 11. 已知注意点

- 聊天记录以前端 `localStorage` 为主，`commands/history.rs` 目前不是主路径。
- 语音输入会先在前端转成 WAV 再传给后端。
- 如果某些 WebView 无法解码录音 Blob，检查 `MediaRecorder` 输出格式和 Web Audio 支持。
- 语音输入依赖用户授权麦克风；如果 `getUserMedia` 报错，优先检查系统麦克风权限和 WebView 权限。
- OpenAI-like helper 默认从 `choices[0].message.content` 取文本，不适合所有供应商的特殊响应格式。
- NVIDIA 适配器是流式解析，改动时要保留 SSE 逐行处理。
- `mimo-v2.5-tts-voicedesign` 不使用内置 `voice`，需要 `voice_description`。
- 不要把真实 API Key 写进示例、文档或测试输出。

## 12. 快速定位表

| 需求 | 优先查看文件 |
| --- | --- |
| 聊天发送失败 | `src/App.tsx`, `src-tauri/src/commands/chat.rs`, `src-tauri/src/ai/openai_like.rs` |
| 某个供应商返回为空 | `src-tauri/src/ai/{provider}.rs` |
| 设置页字段不显示 | `src/Settings.tsx`, `src/modelConfig.ts` |
| 保存配置失败 | `src-tauri/src/config.rs`, `src-tauri/src/commands/config.rs` |
| TTS 不朗读 | `src/App.tsx`, `src-tauri/src/speech/tts.rs`, `src-tauri/config.local.json` |
| 语音输入不识别 | `src/App.tsx`, `src-tauri/src/speech/asr.rs`, `src-tauri/config.local.json` |
| VoiceDesign 报缺少音色描述 | 设置页 TTS 的“音色描述”字段 |
| 新增模型下拉选项 | `src/modelConfig.ts` 的 `MODEL_CATALOG` |
| 改窗口大小或标题 | `src-tauri/tauri.conf.json` |
| 改全局视觉风格 | `src/styles/base.css` |
| 改聊天气泡样式 | `src/styles/App.css` |
