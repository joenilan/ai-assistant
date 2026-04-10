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
- click-to-talk, global push-to-talk, and optional open-mic voice input with local `whisper.cpp`
- personality presets plus custom personality guidance in app settings
- environment-driven runtime config
- backend-owned model reporting, status checks, and streamed replies
- frontend-triggered model switching over LAN through the Pi control API

Avatar overlay work, voice polish, and tighter tool permissions come next.

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
- `ASSISTANT_PERSONALITY_PRESET`
- `ASSISTANT_PERSONALITY_CUSTOM`
- `STT_BACKEND`
- `WHISPER_CPP_PATH`
- `WHISPER_MODEL_PATH`
- `STT_LANGUAGE`
- `STT_THREADS`
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
- local `whisper.cpp` stays unset until you point the app at a binary and model
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

1. Add the transparent avatar overlay window.
2. Tighten tool permissions and smarter auto-routing.
3. Improve voice polish, interruption, and device controls.
4. Add richer memory review and assistant-state UI.

## Voice Input

The app now supports three local speech-input paths:

- click `Record voice` to capture a review-first draft
- use the configured global push-to-talk shortcut to capture and send on release
- enable `Open mic` in the Voice panel to auto-detect utterances and send them
- all three paths keep audio on the PC and transcribe with local `whisper.cpp`

Set these before using it:

- `WHISPER_CPP_PATH` to `whisper-cli.exe` or its containing directory
- `WHISPER_MODEL_PATH` to a local Whisper model such as `ggml-base.en.bin`
- optional: `STT_LANGUAGE` and `STT_THREADS`
- optional: `PUSH_TO_TALK_SHORTCUT`, for example `Ctrl+Alt+Space`

This is still intentionally conservative for v1. Open mic is VAD-based local speech detection, not a wake word.

Project direction and architecture notes live in [AGENTS.md](./AGENTS.md).

Benchmark artifacts currently live in [summary.json](./summary.json) and [MODEL_BENCHMARK.md](./MODEL_BENCHMARK.md).
