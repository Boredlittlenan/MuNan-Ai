# MuNan AI Architecture

## Frontend

- `src/App.tsx`: chat workspace UI and conversation state.
- `src/App.tsx`: also handles multimodal image attachments for models marked with `is_multimodal`.
- `src/App.tsx`: renders AI HTML/CSS cards from `<ai_card>` blocks, supports simple/full card switching, parses `<scheduled_task>` blocks from AI replies, and applies AI-planned scheduled task create/update/delete changes from chat.
- `src/ScheduledTaskRunner.tsx`: app-level scheduled task runner mounted under the router, so due tasks run while the app is open regardless of whether the user is on the chat page or settings page.
- `src/Settings.tsx`: settings UI, including model configuration, the per-model multimodal toggle, Agent controls, usage charts, and the standalone scheduled task section.
- `src/modelConfig.ts`: shared frontend model metadata, storage helpers, and config types.
- Agent settings live in `src/Settings.tsx` and `src/modelConfig.ts`; they manage feature toggles and a skill allowlist. `src/App.tsx` currently includes quick actions for opening URLs/paths, reading webpage text, copying text, and letting the active AI model plan Shell commands from user intent.
- AI replies that contain `<tool_call><function=execute_shell>...` or `<function=tavily_search>...` are intercepted by the chat page, executed through Tauri Agent commands, stripped from the visible message, and then fed back into the model for a final user-facing answer.
- AI replies that contain `<scheduled_task>...` are parsed into local scheduled tasks. The schedule is driven by `schedule_mode` (`once`, `daily`, `weekly`, `monthly`, `yearly`, `custom_days`). The app-level scheduler checks due tasks, writes results into a per-model "计划任务" conversation, then marks one-time tasks as done or advances repeating modes to the next run.
- For one-time chat requests such as "in one minute" or "tomorrow at 8", `src/App.tsx` also has a deterministic local fallback parser. It creates a real task from the user's text if the model only claims a task was created but omits `<scheduled_task>`.
- Natural-language scheduled task changes now use `agent_plan_scheduled_tasks` before the normal chat response. The dedicated planner receives existing scheduled tasks so the active model can understand arbitrary creation, edit, pause/resume, and deletion requests, while the frontend validates and persists the resulting task data.
- Conversation history loads from Tauri commands and is persisted in backend SQLite, including message image attachment metadata/data and token usage statistics; `localStorage` is only used for lightweight UI state and legacy migration.
- Scheduled tasks are stored in `localStorage` under `agentScheduledTasks` and synchronized across the settings page, chat page, and app-level runner with custom browser events.
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
- Agent config includes `agent.enabled`, browser/system/Shell/Tavily operation toggles, Tavily API Key/result limit, `require_confirmation`, `max_steps`, and `enabled_skills`. Shell and Tavily are off by default; when enabled, the active AI model first plans whether a tool call is needed, then tool output is sent back into the normal chat reply flow.
- Scheduled tasks are not part of `config.json`; they are user runtime data managed by frontend helpers in `src/modelConfig.ts`.
- Use `src-tauri/config.example.json` as the committed template.
- Old `config.local.json` / `config.json` files in the repo are migrated automatically on first load.

## AI Response Blocks

- `src-tauri/prompts/chat_response_guide.md` requires every model response to include `<display_text>` and `<tts_text>`.
- `<ai_card>` blocks live inside `display_text` and include `title`, `simple_html`, `full_html`, and shared `css`. The frontend strips the raw block from Markdown and renders it inside a sandboxed iframe.
- `<tool_call>` blocks request real Agent actions and are not shown directly to the user.
- `<scheduled_task>` blocks create local scheduled tasks. Use `schedule_mode` directly: `once` requires an explicit ISO `scheduled_at`; `daily` uses `time_of_day`; `weekly` uses `weekdays` plus `time_of_day`; `monthly` uses `month_day` plus `time_of_day`; `yearly` uses `year_month`, `year_month_day`, and `time_of_day`; `custom_days` uses `custom_interval_days` plus `time_of_day`. Rust injects the current local time into the system prompt so the model can resolve relative times.

## Adding ASR/TTS Later

- Add provider-specific request code under `src-tauri/src/speech/`.
- Extend `SpeechConfig` in `src-tauri/src/config.rs` and mirror the type in `src/modelConfig.ts`.
- Register new commands in `src-tauri/src/lib.rs`.
- Add UI entry points only after the backend command shape is stable.
