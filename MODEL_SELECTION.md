# Model Selection

Current model choice for the Windows-side assistant shell.

## Recommended Defaults

- default assistant model: `gemma-3-1b-it-Q4_K_M.gguf`
- alternate profile: `Qwen3-1.7B-Q4_K_M.gguf` only when forced into `/no_think`

## Do Not Use As Default

- `qwen2.5-1.5b-instruct-q4_k_m.gguf`
- `qwen2.5-3b-instruct-q4_k_m.gguf`
- plain `Qwen3-1.7B-Q4_K_M.gguf` thinking mode in the current runtime

## Why Gemma Wins

- best spoken-assistant tone
- best useful latency
- concise without feeling as robotic
- better factual discipline than the current Qwen2.5 default

## Known Caveats

- Gemma was weaker on the memory continuity follow-up prompt.
- Qwen3 is only viable right now when forced into `/no_think`.
- Plain Qwen3 thinking mode was much slower and produced multiple blank final answers in the current `llama.cpp` setup.

## Immediate App Behavior

- Set the app default model to `gemma-3-1b-it-Q4_K_M.gguf`.
- Keep model selection available in the UI.
- Do not expose Qwen3 as a normal preset until the app can reliably inject `/no_think` or an equivalent runtime switch.

## Benchmark Summary

April 9, 2026:

| Model | Conv | Instr | Fact | Brief | Lat | Cold | Total |
|---|---:|---:|---:|---:|---:|---:|---:|
| gemma-3-1b-it-Q4_K_M | 4 | 2 | 4 | 4 | 5 | 3.0s | 65.9s |
| Qwen3-1.7B-Q4_K_M + /no_think | 3 | 3 | 4 | 3 | 3 | 5.0s | 91.1s |
| SmolLM2-1.7B-Instruct-Q4_K_M | 2 | 2 | 3 | 2 | 3 | 9.0s | 91.3s |
| qwen2.5-1.5b-instruct-q4_k_m | 2 | 2 | 2 | 2 | 4 | 11.0s | 77.4s |
| qwen2.5-3b-instruct-q4_k_m | 3 | 4 | 2 | 2 | 1 | 17.0s | 180.9s |
| Qwen3-1.7B-Q4_K_M default | 1 | 1 | 2 | 1 | 1 | 10.0s | 231.8s |

Raw benchmark artifact: `summary.json`
