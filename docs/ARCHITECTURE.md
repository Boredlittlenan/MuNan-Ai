# MuNan AI Architecture

## Frontend

- `src/App.tsx`: chat workspace UI and conversation state.
- `src/Settings.tsx`: model configuration UI.
- `src/modelConfig.ts`: shared frontend model metadata, storage helpers, and config types.
- Conversation history loads from Tauri commands and is persisted in backend SQLite; `localStorage` is only used for lightweight UI state and legacy migration.
- `src/styles/`: page and shared styles.

## Tauri Backend

- `src-tauri/src/lib.rs`: Tauri builder, plugins, app state, and command registration.
- `src-tauri/src/main.rs`: binary entry point only.
- `src-tauri/src/commands/`: Tauri command handlers.
- `src-tauri/src/config.rs`: runtime config loading, saving, and schema structs.
- `src-tauri/src/storage.rs`: SQLite conversation storage and Tauri commands.
- `src-tauri/src/ai/`: chat model adapters and OpenAI-compatible request helpers.
- `src-tauri/src/speech/`: reserved ASR and TTS command/types modules.

## Runtime Config

- Runtime config is saved in the OS app data directory as `config.json`.
- Use `src-tauri/config.example.json` as the committed template.
- Old `config.local.json` / `config.json` files in the repo are migrated automatically on first load.

## Adding ASR/TTS Later

- Add provider-specific request code under `src-tauri/src/speech/`.
- Extend `SpeechConfig` in `src-tauri/src/config.rs` and mirror the type in `src/modelConfig.ts`.
- Register new commands in `src-tauri/src/lib.rs`.
- Add UI entry points only after the backend command shape is stable.
