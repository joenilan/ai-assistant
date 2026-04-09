# Model Benchmark Pack

Use this file to compare small local models for the desktop assistant on the Raspberry Pi.

## Current Result

The benchmark was completed on April 9, 2026.

- winning default: `gemma-3-1b-it-Q4_K_M`
- runner-up: `Qwen3-1.7B-Q4_K_M` with `/no_think`
- disqualified in current runtime: plain `Qwen3-1.7B` thinking mode

Current interpretation:

- Gemma is the best default for v1 desktop assistant chat.
- Qwen3 is only worth exposing after the app can force `/no_think` reliably.
- `qwen2.5-1.5b-instruct` should no longer be treated as the default assistant voice.

The raw benchmark artifact in this repo is `summary.json`.

## Goal

Pick the best default model for a general chat assistant under real Pi constraints:

- short conversational replies
- good instruction following
- low hallucination tendency
- decent handling of tool or search summaries
- acceptable latency for normal desktop use

## Candidate Models

Test these first because they already exist on the Pi:

- `qwen2.5-1.5b-instruct-q4_k_m.gguf`
- `gemma-3-1b-it-Q4_K_M.gguf`
- `SmolLM2-1.7B-Instruct-Q4_K_M.gguf`
- `qwen2.5-3b-instruct-q4_k_m.gguf`

Do not use this as the default general assistant voice unless it unexpectedly wins:

- `qwen2.5-coder-1.5b-instruct-q4_k_m.gguf`

If none of the above feel good enough, add and test:

- `Qwen3-1.7B`

## Default Test Settings

Keep these identical across models unless the Pi agent has a strong reason to change them:

- threads: `4`
- context: `2048`
- max output tokens: `120`
- temperature: `0.35`
- one run per prompt for quick pass
- second run only for finalists

If `2048` makes a model too sluggish, note that explicitly and retry at `1024`.

## Response Rules

Use the same system prompt for every test:

```text
You are a concise local desktop assistant. Answer clearly, stay grounded in available context, and do not invent facts when the app can look them up instead.
```

The ideal assistant behavior:

- short and natural
- helpful without rambling
- admits uncertainty
- does not drift into coder-assistant behavior
- does not over-explain simple questions

## Prompt Pack

### 1. Casual chat quality

```text
I'm building a desktop AI assistant for daily use. In two short sentences, what makes a good assistant feel useful instead of annoying?
```

### 2. Concise factual answer

```text
Explain what a local-first AI assistant is in one short paragraph for a non-technical user.
```

### 3. Clarifying uncertainty

```text
If you are not sure about a fact, what should you do instead of guessing? Answer as the assistant speaking to the user.
```

### 4. Instruction following

```text
Give me exactly three bullet points for the first milestones of this assistant project. Keep each bullet under ten words.
```

### 5. Tool-summary grounding

Prompt:

```text
Use only this context and answer briefly.

Context:
- The Raspberry Pi backend is at http://192.168.1.151:18080
- The current default model is gemma-3-1b-it-Q4_K_M.gguf
- Qwen3-1.7B may be used as an alternate if forced into /no_think

Question:
What should the desktop app connect to by default, and what should it let the user change?
```

### 6. Multi-turn memory

Prompt A:

```text
Remember this: my preferred assistant voice should be calm and brief.
```

Prompt B:

```text
What voice style did I ask for?
```

### 7. Hallucination resistance

```text
What version of Windows am I using right now?
```

Good answer behavior:

- should say it does not know from current context
- should not invent a Windows version

### 8. Voice-friendly reply style

```text
Answer this like a spoken assistant reply: "Should I start with voice or text for the first prototype?"
```

### 9. Search handoff behavior

```text
If a user asks for a current fact you do not know, how should the app and model work together? Answer in two sentences.
```

### 10. Desktop companion tone

```text
Give me a greeting line for a desktop assistant avatar that feels warm but not cheesy.
```

## Scorecard

Score each prompt from `1` to `5` in these categories:

- naturalness
- instruction following
- factual discipline
- brevity
- assistant vibe

Also record:

- time to first token if available
- total response time
- obvious repetition or derailment
- whether the answer feels too robotic, too verbose, or too uncertain

## Quick Ranking Rubric

Use this weighting:

- `35%` conversational quality
- `25%` instruction following
- `20%` factual discipline
- `20%` latency

If two models are close, prefer:

- the model that stays concise
- the model that admits uncertainty correctly
- the model that feels better for spoken assistant replies

## Recommendation Logic

Use this decision order:

1. If `gemma-3-1b-it` feels clearly better while staying fastest, promote it.
2. If `SmolLM2-1.7B-Instruct` feels more natural and still responsive, promote it.
3. Keep `qwen2.5-1.5b-instruct` only if it still wins overall balance.
4. Use `qwen2.5-3b-instruct` only if the quality jump is worth the slowdown.
5. If none of the current models are good enough, add `Qwen3-1.7B` and benchmark it in non-thinking mode if supported by the Pi runtime.

## Message To Send The Pi Agent

```text
We now have the first desktop shell working, and the current default model does not feel good enough for general assistant chat.

Please benchmark the currently installed small models for real assistant use, not coding:
- qwen2.5-1.5b-instruct-q4_k_m.gguf
- gemma-3-1b-it-Q4_K_M.gguf
- SmolLM2-1.7B-Instruct-Q4_K_M.gguf
- qwen2.5-3b-instruct-q4_k_m.gguf
- Qwen3-1.7B-Q4_K_M.gguf if available

Use the prompt pack in MODEL_BENCHMARK.md with identical settings where possible:
- 4 threads
- 2048 context, or 1024 if needed for responsiveness
- max_tokens 120
- temperature 0.35

Please score for:
- conversational quality
- instruction following
- factual discipline
- brevity
- latency

The target is a general desktop assistant voice, not a coding helper.

If none of the current models are good enough, research whether Qwen3-1.7B is the best next small-model candidate for this Pi and whether our current llama.cpp runtime can support the preferred non-thinking mode cleanly.
```

## Outcome To Record

After testing, record:

- the winning default model
- runner-up model
- why the winner was chosen
- whether a new model should be downloaded
- whether Qwen3-1.7B is worth adding next
