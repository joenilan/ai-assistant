# AI Assistant

Local-first desktop assistant shell built with `Tauri 2`, `React`, and `TypeScript`.

## Current Scope

This scaffold currently proves the first milestone:

- desktop shell running on the PC
- text-first chat UI
- Rust-side HTTP bridge to the Raspberry Pi `llama.cpp` backend
- Rust-side bridge to the Pi control API for model switching
- explicit `Auto / Chat / Web / File` assistant modes
- web search grounding through SearXNG
- local text-file grounding for file-based answers
- local Windows-native TTS with voice selection, output-device routing, and stop support
- environment-driven runtime config
- backend-owned model reporting, status checks, and streamed replies
- frontend-triggered model switching over LAN through the Pi control API

Push-to-talk, tray behavior, and the avatar overlay come next.

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

The desktop app now switches Pi model profiles through the control API on `:18082`.

Current control flow:

- `gemma` is the default assistant profile
- `qwen3` is the backup profile
- when `qwen3` is active, the app prepends the profile-provided `client_prompt_prefix` so `/no_think` is applied automatically

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
- `LLM_CONTROL_BASE_URL`
- `LLM_CONTROL_HEALTH_ENDPOINT`
- `LLM_CONTROL_MODELS_ENDPOINT`
- `LLM_CONTROL_SWITCH_ENDPOINT`
- `SEARXNG_URL`
- `LLM_MODEL`
- `LLM_TIMEOUT_MS`
- `ASSISTANT_SYSTEM_PROMPT`
- `TTS_BACKEND`
- `TTS_VOICE`
- `TTS_OUTPUT_DEVICE`
- `TTS_RATE`
- `TTS_VOLUME`

Default Pi values already point at:

- `http://192.168.1.151:18080`
- `http://192.168.1.151:18082`
- `http://192.168.1.151:8888/search`
- `gemma-3-1b-it-Q4_K_M.gguf`
- `Microsoft Zira Desktop`
- system default audio output unless `TTS_OUTPUT_DEVICE` is set

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

1. Add push-to-talk with `whisper.cpp`.
2. Add tray presence and the transparent avatar overlay window.
3. Add smarter auto-routing and tighter file permission boundaries.
4. Add memory/settings persistence beyond local browser storage.

Project direction and architecture notes live in [AGENTS.md](./AGENTS.md).

Benchmark artifacts currently live in [summary.json](./summary.json) and [MODEL_BENCHMARK.md](./MODEL_BENCHMARK.md).
