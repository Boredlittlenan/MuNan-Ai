# MuNan AI Architecture

## Frontend

- `src/App.tsx`: chat workspace UI and conversation state.
- `src/Settings.tsx`: model configuration UI.
- `src/modelConfig.ts`: shared frontend model metadata, storage helpers, and config types.
- `src/styles/`: page and shared styles.

## Tauri Backend

- `src-tauri/src/lib.rs`: Tauri builder, plugins, app state, and command registration.
- `src-tauri/src/main.rs`: binary entry point only.
- `src-tauri/src/commands/`: Tauri command handlers.
- `src-tauri/src/config.rs`: runtime config loading, saving, and schema structs.
- `src-tauri/src/ai/`: chat model adapters and OpenAI-compatible request helpers.
- `src-tauri/src/speech/`: reserved ASR and TTS command/types modules.

## Runtime Config

- Keep real keys in `src-tauri/config.json` or `src-tauri/config.local.json`.
- Use `src-tauri/config.example.json` as the committed template.
- `config.local.json` is preferred when it exists, then `config.json`.

## Adding ASR/TTS Later

- Add provider-specific request code under `src-tauri/src/speech/`.
- Extend `SpeechConfig` in `src-tauri/src/config.rs` and mirror the type in `src/modelConfig.ts`.
- Register new commands in `src-tauri/src/lib.rs`.
- Add UI entry points only after the backend command shape is stable.
