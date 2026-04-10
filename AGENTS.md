# AI Assistant Project Guide

## Status
- This repo now contains a working desktop assistant shell with real application code.
- The current app already includes:
  - `Tauri 2 + React + TypeScript`
  - Pi-backed streamed chat
  - Pi control-API model switching over LAN
  - tool modes for direct chat, web search, and local file grounding
  - persisted settings and conversation history in SQLite
  - rolling conversation summaries stored in the DB and injected into prompt assembly
  - Windows-native TTS with selectable voices and output devices
  - tray presence and close-to-tray behavior
- Treat the Raspberry Pi backend as an existing external dependency and a hard performance constraint.
- `src/App.tsx` is still too large and should be refactored incrementally rather than treated as the long-term final shape.

## Product Vision
- Build a local-first assistant that can answer by text or voice.
- Support wake or voice activation later, but start with push-to-talk or click-to-talk for reliability.
- Give the assistant access to explicit tools such as internet search and local file reading so it can look things up instead of bluffing.
- Present the assistant through a living avatar instead of a plain chat box.
- Leave room for a later game layer with Tamagotchi-style state, progression, and personality without weakening the core assistant behavior.

## Current Priorities
- Always-on desktop presence matters more than game mechanics.
- The assistant should stay available while gaming, browsing, or watching video.
- Text-to-speech and speech-to-text are first-class requirements, not optional polish.
- Low desktop overhead matters; avoid a heavy shell if a lighter one can satisfy the product needs.
- The Tamagotchi or game layer is deferred and should not drive the first stack decision.
- The first working milestone is text chat, not voice activation.

## Product Principles
- The assistant must remain useful even when the avatar or game layer is disabled.
- The Pi model is not the whole product; it is only the text generation engine.
- Tool use, search, memory, file access, and UI state belong in the application layer.
- Keep prompts short, tool results distilled, and responses concise by default.
- Prefer deterministic app logic for permissions, routing, and state over letting a small model improvise everything.

## Hard Constraints
- Do not assume cloud-only inference.
- Do not assume high concurrency, huge contexts, or long generations will perform well.
- Do not let the Pi own wake word detection, speech-to-text, text-to-speech, avatar rendering, or game simulation.
- The app should stay responsive even when the Pi is slow or temporarily unavailable.
- The assistant must degrade gracefully by using shorter prompts, smaller replies, and explicit tool routing.

## Recommended Stack
### Shell And UI
- `Tauri 2`
- `React`
- `TypeScript`

### Host Runtime
- Keep Rust usage minimal and focused on Tauri host integration, plugins, and any native glue that the webview cannot do directly.
- Keep most application logic in TypeScript so the UI, orchestration, and tool pipeline stay in one primary language.

### Storage
- Use a local SQLite database for memory, settings, and assistant state.

### LLM Backend
- Continue using the Raspberry Pi `llama.cpp` backend over HTTP.

### Current Default Model Choice
- Current recommended default for general assistant chat: `gemma-3-1b-it-Q4_K_M`
- Current alternate profile worth keeping: `Qwen3-1.7B-Q4_K_M` only when forced into `/no_think`
- Do not treat `qwen2.5-1.5b-instruct` as the default desktop assistant voice anymore

### Initial Voice Backends
- `STT`: `whisper.cpp`
- `TTS`: Windows `WinRT` / OneCore voices
- `Later TTS upgrade path`: `Piper`

### Why This Stack
- A plain website or PWA is the wrong shell for a movable transparent desktop companion.
- Electron remains viable, but it is not the preferred default because desktop overhead is now an explicit concern.
- Godot is not the right first shell because the assistant runtime, tools, files, and voice plumbing matter more than advanced avatar or game rendering.
- Tauri gives the project desktop windows, tray support, global shortcuts, and native integration without carrying Electron's runtime cost.

## Window Model
### Main Window
- Standard app window for chat, settings, logs, permissions, and memory review.

### Avatar Overlay Window
- Separate transparent window for the assistant avatar.
- Frameless and movable.
- Always-on-top when enabled.
- Optional click-through behavior when the user wants the avatar visible but non-interactive.

### Background Presence
- Use a system tray icon so the assistant can stay running without a large visible main window.
- The assistant should be usable even when only the tray and avatar overlay are present.

### Fullscreen Caveat
- Design the overlay to work well on the normal desktop and with borderless or windowed apps.
- Do not promise reliable visibility over true exclusive fullscreen games or video players.
- If fullscreen overlay behavior becomes critical later, treat that as a separate platform-specific problem, not a base assumption.

## Target Architecture
### PC Responsibilities
- Main application runtime
- Text UI and avatar UI
- Voice capture and wake flow
- Speech-to-text
- Text-to-speech
- Tool execution
- Internet search
- Local file access
- Memory and state persistence
- Prompt assembly
- Request throttling, retries, and timeouts

### Raspberry Pi Responsibilities
- Serve `llama.cpp` over the LAN
- Expose model listing and chat completion endpoints
- Generate short, focused responses from compact prompts
- Optionally switch between available models based on the task

### Design Rule
- The PC is the assistant.
- The Pi is the language engine.
- Until a real backend switch path exists, model switching remains Pi-owned and should not be implied as a frontend-only control.

## Interaction Modes
### Fast Assistant Mode
- For quick Alexa-style exchanges
- Use short prompts and short answers
- Use no tools unless clearly necessary
- Favor low latency and conversational responsiveness

### Research Mode
- For questions that need facts, search, or file inspection
- The application decides which tools to run
- Tool output is summarized before going to the model
- The model writes the final user-facing answer after evidence is collected

This split matters because the selected Pi-scale models will degrade badly if every interaction becomes a giant multi-tool chain with full transcript history attached.

## Context Strategy
- Never send the full conversation history by default.
- Keep only the last few user and assistant turns in the active prompt.
- Maintain a rolling conversation summary outside the prompt.
- Store persistent memory in the app, not inside the transcript.
- Inject only task-relevant retrieved facts, not raw dumps.
- Summarize search and file results before forwarding them to the Pi.
- Default to short replies unless the user explicitly asks for depth.
- The current implementation already persists conversation summaries in SQLite and injects them from the Rust host before chat generation.
- The current implementation still trims recent raw turns with a blunt turn-count heuristic; that should eventually be replaced with a token-budget policy.

## Voice And Avatar Strategy
- Run voice input on the PC.
- Run text-to-speech on the PC.
- Keep the avatar fully local to the app for smooth animation.
- Use the model output only as the semantic response, not as the source of avatar state.
- Start with push-to-talk, then graduate to wake word activation once the base loop is stable.
- The avatar should have idle, listening, thinking, and speaking states even before any game mechanics exist.

## Voice Strategy
- Voice should be PC-owned from day one.
- Start with text chat before adding any voice flow.
- After text chat is stable, add a global push-to-talk shortcut rather than always-listening wake word mode.
- Use local speech-to-text and text-to-speech on the PC through a sidecar or local service boundary, not browser speech APIs.
- Treat wake word support as a later phase after mic capture, interruption, and TTS playback are stable.
- TTS must be interruptible so the assistant can stop speaking when the user talks or cancels.
- The avatar should react to voice state even if the speech engine is swapped later.

## Initial Voice Decision
### Speech-To-Text
- Use `whisper.cpp` as the initial STT backend.
- Run it on the PC, not on the Raspberry Pi.
- Treat it as an on-demand transcription tool for push-to-talk, not as a permanently hot always-listening service.
- Start with a small English model appropriate for low-latency local use.
- Keep the STT integration behind an interface so a lighter native Windows recognizer can be added later if needed.

### Text-To-Speech
- Use Windows `WinRT` speech synthesis as the initial TTS backend.
- This keeps the first implementation free, local, and easy to integrate.
- Build the TTS integration behind an interface from day one.
- Plan `Piper` as the first voice-quality upgrade path after the assistant loop is working.

### Why This Pairing
- `whisper.cpp` aligns well with the existing `llama.cpp`-style local inference approach.
- Windows-native `WinRT` speech gives the app better voice coverage and cleaner output routing without adding a cloud dependency.
- This pairing minimizes early complexity while preserving a clean path to better voices later.

## Recommended First Prototypes
- Prototype a transparent Tauri avatar window that can be moved, pinned, and toggled between interactive and click-through.
- Prototype tray presence plus a global push-to-talk shortcut.
- Prototype text chat to the Pi before any voice work.
- Prototype local text-to-speech playback on the PC with Windows `WinRT`.
- Prototype mic capture to local speech-to-text on the PC with `whisper.cpp`.
- Prototype one full loop: text or voice input -> optional tools -> Pi reply -> TTS output -> avatar speaking state.

These prototypes should be completed before heavy UI or memory work because they validate the product shell and the voice loop.

## Living Assistant / Game Layer
- Treat the living avatar as a separate layer on top of the assistant runtime.
- The assistant should have optional state such as mood, energy, curiosity, or affection.
- Conversations, reminders, successful tasks, and idle time can influence that state.
- Visual changes, animations, and unlocks can reflect the state.
- Do not let the game layer block tool use, search, or answer quality.
- The assistant must still work as a serious utility even when the playful layer grows.

## Phased Build Plan
### Phase 1: Reliable Core
- Choose the app stack
- Add config loading
- Add Pi connectivity checks
- Add model listing
- Add basic text chat
- Add clear error handling for backend failure
- Add short system prompts and reply limits
- Current state: done

### Phase 2: Tool-Backed Answers
- Add internet search as an explicit app-owned tool
- Add local file reading with clear permission boundaries
- Add a tool routing layer
- Add evidence summarization before model calls
- Add simple memory and conversation summaries
- Current state: mostly done for first pass; needs tighter prompt budgeting and stricter file boundaries

### Phase 3: Voice Assistant
- Add Windows-native text-to-speech
- Add push-to-talk
- Add `whisper.cpp` speech-to-text
- Add interrupt and cancel behavior
- Add optional wake word after the voice loop is stable
- Current state: TTS is in, push-to-talk and STT are not

### Phase 4: Living Avatar
- Add avatar rendering
- Add animation states for listening, thinking, and speaking
- Sync TTS playback with simple visual response
- Add local state storage for personality and mood

### Phase 5: Game Layer
- Add Tamagotchi-style stats and progression
- Add routines, habits, and relationship signals
- Add rewards, unlocks, or cosmetic changes
- Keep all of this optional and separate from the core assistant loop

## What To Tell The Pi Side
- The Pi should stay focused on short text generation.
- The app will own voice, avatar, tools, memory, search, and orchestration.
- We want the Pi prompts to stay compact to avoid latency and context collapse.
- We may use different models for different modes, but only if switching is cheap and predictable.
- We should verify which OpenAI-style features actually work instead of assuming parity.
- The desktop shell is currently expected to be Tauri-based, not browser-only.
- The product is optimizing for a lightweight always-running PC assistant, not a heavyweight local app shell.
- The current voice plan is `whisper.cpp` on the PC for STT and Windows `WinRT` on the PC for initial TTS.
- Text chat comes before voice; wake word comes after push-to-talk.

## Questions For The Pi Side
- What context size is realistically safe for responsive use on each model?
- Which model should be the default for quick assistant replies?
- Is model switching fast enough for real task routing, or should the app mostly stick to one default?
- Is streaming stable enough to support better voice and avatar responsiveness?
- What request timeout and concurrency limits should the PC enforce?
- Are there server settings on `llama.cpp` that should be standardized for this app, such as threads, context size, or batching?

Most of these were answered by the April 9, 2026 benchmark pass:
- default quick assistant reply model: `gemma-3-1b-it-Q4_K_M`
- best alternate currently worth keeping: `Qwen3-1.7B-Q4_K_M` with `/no_think`
- `qwen2.5-3b-instruct` is too slow for the quality gain
- plain `Qwen3-1.7B` thinking mode is not usable in the current runtime because it was much slower and often returned blank final answers

## Existing LLM Backend
### Host
- Hostname: `zombiebox`
- LAN IP: `192.168.1.151`
- Hardware: Raspberry Pi 5, 16 GB RAM
- OS: Debian 13

### Runtime
- Inference engine: `llama.cpp`
- Binary path: `/mnt/ssd/ai/llama.cpp/build/bin/llama-server`
- Service unit: `/etc/systemd/system/llama-server.service`
- Service name: `llama-server.service`
- Model storage: `/mnt/ssd/models`
- Source/build storage: `/mnt/ssd/ai/llama.cpp`

### API
- Base URL: `http://192.168.1.151:18080`
- Models endpoint: `http://192.168.1.151:18080/v1/models`
- Chat endpoint: `http://192.168.1.151:18080/v1/chat/completions`
- The server is OpenAI-compatible enough for standard chat-completion flows.
- Do not assume broader OpenAI API feature parity without testing it first.

Example request:

```bash
curl http://192.168.1.151:18080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gemma-3-1b-it-Q4_K_M.gguf",
    "messages": [
      {"role": "system", "content": "Reply briefly."},
      {"role": "user", "content": "Say hello from the Pi."}
    ],
    "max_tokens": 64,
    "temperature": 0.3
  }'
```

## Model Notes
### Default Model
- Current recommended default model file: `gemma-3-1b-it-Q4_K_M.gguf`
- Reason:
  - best spoken-assistant tone in the benchmark pass
  - best useful latency of the tested models
  - best overall fit for a v1 desktop assistant
- Known weakness:
  - memory continuity was weaker than expected in the benchmark follow-up test

### Available Models
- `qwen2.5-1.5b-instruct-q4_k_m.gguf`
- `qwen2.5-coder-1.5b-instruct-q4_k_m.gguf`
- `gemma-3-1b-it-Q4_K_M.gguf`
- `SmolLM2-1.7B-Instruct-Q4_K_M.gguf`
- `qwen2.5-3b-instruct-q4_k_m.gguf`
- `Qwen3-1.7B-Q4_K_M.gguf`

### Benchmark Snapshot
- April 9, 2026 assistant benchmark winner: `Gemma 3 1B IT Q4_K_M`
  - scores: conversation `4`, instruction `2`, factual discipline `4`, brevity `4`, latency `5`
  - cold-ready: about `3.0s`
  - full prompt-pack total: about `65.9s`
  - qualitative result: best overall spoken desktop assistant tone
- Runner-up: `Qwen3-1.7B-Q4_K_M` with `/no_think`
  - scores: conversation `3`, instruction `3`, factual discipline `4`, brevity `3`, latency `3`
  - cold-ready: about `5.0s`
  - full prompt-pack total: about `91.1s`
  - qualitative result: usable alternate, but more generic than Gemma
- `Qwen3-1.7B-Q4_K_M` in default thinking mode
  - effectively disqualified in the current runtime
  - much slower and produced multiple blank final answers
- `SmolLM2-1.7B-Instruct Q4_K_M`
  - acceptable, but too stiff and generic to win
- `Qwen2.5-1.5B-Instruct Q4_K_M`
  - fast enough, but too lecture-heavy and weak on assistant behavior
- `Qwen2.5-3B-Instruct Q4_K_M`
  - too slow for the gain

### Practical Recommendation
- Best current general default: `Gemma 3 1B`
- Best alternate candidate currently installed: `Qwen3-1.7B` with `/no_think`
- Best small coding helper: `Qwen2.5-Coder-1.5B`
- Do not use plain `Qwen3-1.7B` thinking mode as the default in the current `llama.cpp` setup
- Do not use `qwen2.5-1.5b-instruct` as the default assistant voice anymore
- The 3B Qwen remains too slow and heavy to treat as the always-on default

## Model Switching On The Pi
- Helper script: `/home/dietpi/bin/llama-model`
- Control health endpoint: `http://192.168.1.151:18082/health`
- Control models endpoint: `http://192.168.1.151:18082/api/models`
- Control switch endpoint: `http://192.168.1.151:18082/api/switch`
- The desktop app can switch Pi model profiles over LAN through the control API; shell access is not required.
- The control API returns the active alias and any required `client_prompt_prefix`.
- The control API may also return model-policy metadata such as:
  - `default_alias`
  - `backup_alias`
  - `ui_tier`
  - `recommended`
- When `qwen3` is active, prepend the returned client prompt prefix so `/no_think` is applied automatically.

Commands:

```bash
/home/dietpi/bin/llama-model list
/home/dietpi/bin/llama-model status
/home/dietpi/bin/llama-model switch qwen
/home/dietpi/bin/llama-model switch coder
/home/dietpi/bin/llama-model switch gemma
/home/dietpi/bin/llama-model switch qwen3b
/home/dietpi/bin/llama-model switch smollm
```

Alias mapping:
- `qwen` -> `qwen2.5-1.5b-instruct-q4_k_m.gguf`
- `coder` -> `qwen2.5-coder-1.5b-instruct-q4_k_m.gguf`
- `gemma` -> `gemma-3-1b-it-Q4_K_M.gguf`
- `qwen3b` -> `qwen2.5-3b-instruct-q4_k_m.gguf`
- `smollm` -> `SmolLM2-1.7B-Instruct-Q4_K_M.gguf`
- `qwen3` -> `Qwen3-1.7B-Q4_K_M.gguf`

## Search Integration
- Local SearXNG URL: `http://127.0.0.1:8888/search`
- Search should be treated as an explicit application tool, not a model responsibility.
- Fetch search results outside the model, then pass cleaned context into the prompt.

## External Dependencies
- The Raspberry Pi `llama.cpp` backend and its control API are real external dependencies for this repo.
- The local SearXNG instance is also an external dependency when web grounding is enabled.
- Other assistant experiments or sibling projects on the same machine are not part of this repo and should not guide changes here.
- If the Pi hosts multiple apps that share the same inference stack, assume they will contend for the same limited hardware unless proven otherwise.

## Guidance For This Repo
- Read backend URLs and model names from environment variables; do not hardcode LAN addresses into app code.
- The first useful implementation should be a PC-owned assistant shell backed by the Pi over HTTP.
- Use the Pi for short completion tasks, not for app orchestration.
- Keep tool use explicit and inspectable.
- Prefer serialized or lightly concurrent requests to the Pi.
- Treat streaming support, embeddings, function calling, JSON mode, and multimodal features as capabilities to verify rather than assume.
- If a request needs search or file access, the app should gather evidence first and then ask the model to answer from that evidence.
- Keep the first release focused on desktop utility, voice, and responsiveness.
- Do not let avatar polish or game ideas delay the first working assistant loop.
- Prefer sidecars or local helper services for STT and TTS over tightly coupling the app to browser-specific speech features.
- Build all voice backends behind replaceable interfaces so Windows `WinRT`, `Piper`, and `whisper.cpp` are implementation choices, not architectural traps.
- Default the app to `gemma-3-1b-it-Q4_K_M` unless the environment overrides it.
- Do not expose Qwen3 as a normal profile until the app can reliably force `/no_think` or an equivalent runtime switch.
- Do not present model choice as a UI-owned feature unless the app can actually change the active model on the Pi.
- Inject trusted live context explicitly for current-sensitive requests.
  - current local date/time
  - search evidence
  - file excerpts
  - any tool results the app already knows
- Treat prompt assembly discipline as a higher priority than chasing model upgrades once a viable default model is in place.

## Suggested Environment Variables
- `LLM_BASE_URL`
- `LLM_CHAT_ENDPOINT`
- `LLM_MODELS_ENDPOINT`
- `LLM_CONTROL_BASE_URL`
- `LLM_CONTROL_HEALTH_ENDPOINT`
- `LLM_CONTROL_MODELS_ENDPOINT`
- `LLM_CONTROL_SWITCH_ENDPOINT`
- `LLM_MODEL`
- `LLM_TIMEOUT_MS`
- `LLM_MAX_INPUT_TOKENS`
- `LLM_MAX_OUTPUT_TOKENS`
- `LLM_ENABLE_STREAMING`
- `SEARXNG_URL`
- `ASSISTANT_SYSTEM_PROMPT`
- `ASSISTANT_MEMORY_DB_PATH`
- `STT_BACKEND`
- `STT_MODEL`
- `TTS_BACKEND`
- `TTS_VOICE`
- `TTS_OUTPUT_DEVICE`
- `TTS_VOLUME`
- `TTS_PITCH`
- `WHISPER_CPP_PATH`
- `WHISPER_MODEL_PATH`
- `PUSH_TO_TALK_SHORTCUT`

## Open Decisions
- Which `whisper.cpp` model is the best default balance of accuracy and latency on the PC
- Which Windows voice should be the default first voice
- Whether the avatar should be rendered with standard web UI, canvas, or a dedicated character layer
- Whether wake word belongs in the first public version or a later phase
- Whether the first release should persist long-term memory by default
- How much personality should exist before the assistant utility loop is solid

Future agents should preserve this file as the repo-level source of truth until the project has a README, actual code structure, and explicit architecture docs.
