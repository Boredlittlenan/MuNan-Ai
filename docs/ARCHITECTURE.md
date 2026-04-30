# MuNan AI Architecture

## Frontend

- `src/App.tsx`: chat workspace UI and conversation state.
- `src/App.tsx`: also handles multimodal image attachments for models marked with `is_multimodal`.
- `src/Settings.tsx`: model configuration UI, including the per-model multimodal toggle.
- `src/modelConfig.ts`: shared frontend model metadata, storage helpers, and config types.
- Agent settings live in `src/Settings.tsx` and `src/modelConfig.ts`; they manage feature toggles and a skill allowlist. `src/App.tsx` currently includes quick actions for opening URLs/paths, reading webpage text, copying text, and letting the active AI model plan Shell commands from user intent.
- Conversation history loads from Tauri commands and is persisted in backend SQLite, including message image attachment metadata/data and token usage statistics; `localStorage` is only used for lightweight UI state and legacy migration.
- `src/styles/`: page and shared styles.

## Tauri Backend

- `src-tauri/src/lib.rs`: Tauri builder, plugins, app state, and command registration.
- `src-tauri/src/main.rs`: binary entry point only.
- `src-tauri/src/commands/`: Tauri command handlers.
- `src-tauri/src/commands/agent.rs`: Agent capability preview, webpage text extraction, and explicit Shell command execution.
- `src-tauri/src/config.rs`: runtime config loading, saving, and schema structs.
- `src-tauri/src/storage.rs`: SQLite conversation storage and Tauri commands.
- `src-tauri/src/ai/`: chat model adapters and OpenAI-compatible request helpers.
- `src-tauri/src/speech/`: reserved ASR and TTS command/types modules.

## Runtime Config

- Runtime config is saved in the OS app data directory as `config.json`.
- Chat model configs include `is_multimodal`; when enabled, the frontend sends OpenAI-compatible `image_url` content parts.
- Usage config includes `usage.detail_retention_days`, which controls how long per-request token usage events are kept. `0` means keeping details permanently. Daily aggregates are retained long term and can be queried by date range for charts.
- Agent config includes `agent.enabled`, browser/system/Shell operation toggles, `require_confirmation`, `max_steps`, and `enabled_skills`. Shell execution is off by default; when enabled, the active AI model first plans whether a Shell command is needed, then the command output is sent back into the normal chat reply flow.
- Use `src-tauri/config.example.json` as the committed template.
- Old `config.local.json` / `config.json` files in the repo are migrated automatically on first load.

## Adding ASR/TTS Later

- Add provider-specific request code under `src-tauri/src/speech/`.
- Extend `SpeechConfig` in `src-tauri/src/config.rs` and mirror the type in `src/modelConfig.ts`.
- Register new commands in `src-tauri/src/lib.rs`.
- Add UI entry points only after the backend command shape is stable.
