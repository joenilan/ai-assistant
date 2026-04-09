# AI Assistant

Local-first desktop assistant shell built with `Tauri 2`, `React`, and `TypeScript`.

## Current Scope

This scaffold currently proves the first milestone:

- desktop shell running on the PC
- text-first chat UI
- Rust-side HTTP bridge to the Raspberry Pi `llama.cpp` backend
- environment-driven runtime config
- backend-owned model reporting and status checks

Voice, tray behavior, avatar overlay, and tool execution come next.

## Current Model Recommendation

Based on the April 9, 2026 Raspberry Pi benchmark pass:

- default general assistant model: `gemma-3-1b-it-Q4_K_M`
- runner-up: `Qwen3-1.7B-Q4_K_M` only when forced into `/no_think`
- do not use plain `Qwen3-1.7B` thinking mode as-is in the current `llama.cpp` setup

Why Gemma is the current default:

- best spoken-assistant tone
- fastest useful latency
- better factual discipline than the current Qwen2.5 default
- less robotic than the other installed options

The desktop app does not switch models on the Pi yet. It only reflects the backend-reported model and leaves actual switching to the Raspberry Pi side.

## Stack

- `Tauri 2`
- `React 19`
- `TypeScript`
- Rust host commands for Pi HTTP calls

## Runtime Config

Copy `.env.example` to `.env` and adjust values if needed.

Supported variables:

- `LLM_BASE_URL`
- `LLM_MODELS_ENDPOINT`
- `LLM_CHAT_ENDPOINT`
- `LLM_MODEL`
- `LLM_TIMEOUT_MS`
- `ASSISTANT_SYSTEM_PROMPT`

Default Pi values already point at:

- `http://192.168.1.151:18080`
- `gemma-3-1b-it-Q4_K_M.gguf`

## Run

Install dependencies:

```bash
bun install
```

Start the desktop app in development:

```bash
bun run tauri dev
```

Build the frontend only:

```bash
bun run build
```

Check the Rust host:

```bash
cd src-tauri
cargo check
```

## Next Milestones

1. Add tool-backed answers for web and local files.
2. Add `SAPI` text-to-speech.
3. Add push-to-talk with `whisper.cpp`.
4. Add tray presence and the transparent avatar overlay window.

Project direction and architecture notes live in [AGENTS.md](./AGENTS.md).

Benchmark artifacts currently live in [summary.json](./summary.json) and [MODEL_BENCHMARK.md](./MODEL_BENCHMARK.md).
