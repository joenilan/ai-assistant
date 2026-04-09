import { startTransition, useEffect, useRef, useState, type FormEvent } from "react";
import {
  chatCompletion,
  checkBackend,
  getRuntimeConfig,
  listModels,
  type BackendStatus,
  type ChatMessage,
  type RuntimeConfig,
} from "./lib/assistant";
import "./App.css";

const starterPrompts = [
  "Summarize what this assistant is supposed to become.",
  "What should we validate first before adding voice?",
  "Give me a compact plan for a text-first local assistant.",
];

const initialTranscript: ChatMessage[] = [
  {
    id: "boot-message",
    role: "assistant",
    content:
      "Local shell online. The first milestone is compact text chat to the Pi, then voice, then the avatar overlay.",
    meta: "Bootstrap note",
  },
];

function createMessage(
  role: ChatMessage["role"],
  content: string,
  meta?: string,
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    meta,
  };
}

function trimConversation(messages: ChatMessage[]) {
  return messages.slice(-8).map(({ role, content }) => ({ role, content }));
}

function formatLatency(status: BackendStatus | null) {
  if (!status?.ok) {
    return "Unavailable";
  }

  return `${status.latencyMs} ms`;
}

function formatStatusTone(status: BackendStatus | null) {
  if (!status) {
    return "status-pill status-pill--idle";
  }

  return status.ok
    ? "status-pill status-pill--ready"
    : "status-pill status-pill--error";
}

function getBackendOwnedModel(
  runtimeConfig: RuntimeConfig | null,
  availableModels: string[],
) {
  return availableModels[0] || runtimeConfig?.llmModel || "";
}

function App() {
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [messages, setMessages] = useState(initialTranscript);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("Bootstrapping the local assistant shell...");
  const [error, setError] = useState("");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isCheckingBackend, setIsCheckingBackend] = useState(false);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const transcriptRef = useRef<HTMLElement | null>(null);
  const activeModel = getBackendOwnedModel(runtimeConfig, availableModels);

  async function refreshBackend(showBusy = true) {
    if (showBusy) {
      setIsCheckingBackend(true);
    }

    try {
      const status = await checkBackend();
      startTransition(() => {
        setBackendStatus(status);
        setNotice(`Pi backend reachable at ${status.endpoint}`);
        setError("");
      });
    } catch (refreshError) {
      const message =
        refreshError instanceof Error
          ? refreshError.message
          : "Failed to reach the Pi backend.";

      startTransition(() => {
        setBackendStatus(null);
        setError(message);
      });
    } finally {
      if (showBusy) {
        setIsCheckingBackend(false);
      }
    }
  }

  async function refreshModels(showBusy = true) {
    if (showBusy) {
      setIsRefreshingModels(true);
    }

    try {
      const models = await listModels();
      startTransition(() => {
        setAvailableModels(models);
        if (models[0]) {
          setNotice(`Pi backend reports ${models[0]} as available`);
        }
        setError("");
      });
    } catch (refreshError) {
      const message =
        refreshError instanceof Error
          ? refreshError.message
          : "Failed to load available models.";

      startTransition(() => {
        setAvailableModels([]);
        setError(message);
      });
    } finally {
      if (showBusy) {
        setIsRefreshingModels(false);
      }
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const config = await getRuntimeConfig();

        if (cancelled) {
          return;
        }

        startTransition(() => {
          setRuntimeConfig(config);
          setNotice(`Runtime loaded. Default model: ${config.llmModel}`);
        });

        await Promise.all([refreshBackend(false), refreshModels(false)]);
      } catch (bootstrapError) {
        const message =
          bootstrapError instanceof Error
            ? bootstrapError.message
            : "Failed to load the runtime configuration.";

        if (!cancelled) {
          startTransition(() => {
            setError(message);
          });
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const transcript = transcriptRef.current;

    if (!transcript) {
      return;
    }

    transcript.scrollTo({
      top: transcript.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isSending]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const prompt = draft.trim();

    if (!prompt || isSending || !runtimeConfig) {
      return;
    }

    const userMessage = createMessage("user", prompt);
    const nextMessages = [...messages, userMessage];

    setDraft("");
    setError("");
    setIsSending(true);
    setMessages(nextMessages);

    try {
      const response = await chatCompletion({
        maxTokens: 192,
        temperature: 0.35,
        systemPrompt: runtimeConfig.assistantSystemPrompt,
        messages: trimConversation(nextMessages),
      });

      startTransition(() => {
        setMessages((currentMessages) => [
          ...currentMessages,
          createMessage("assistant", response.content, response.model),
        ]);
        setNotice(`Assistant replied from backend model ${response.model}`);
      });
    } catch (sendError) {
      const message =
        sendError instanceof Error
          ? sendError.message
          : "The assistant request failed.";

      startTransition(() => {
        setError(message);
        setMessages((currentMessages) => [
          ...currentMessages,
          createMessage(
            "assistant",
            "I couldn't complete that request. Check the Pi connection or the runtime config, then try again.",
            "Local shell",
          ),
        ]);
      });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Zombiebox local assistant</p>
          <h1>Chat first. Voice next. Pi-powered all the way through.</h1>
          <p className="hero-text">
            The PC owns tools, state, and UI. The Raspberry Pi stays focused on
            compact text generation so the assistant stays responsive.
          </p>
        </div>

        <div className="hero-status">
          <div className={formatStatusTone(backendStatus)}>
            <span className="status-dot" />
            {backendStatus?.ok ? "Pi reachable" : "Backend pending"}
          </div>
          <p className="status-copy">{notice}</p>
        </div>
      </section>

      <section className="workspace">
        <section className="panel conversation-panel">
          <header className="panel-header">
            <div>
              <p className="panel-label">Conversation</p>
              <h2>Prototype the text loop before voice</h2>
            </div>
            <div className="header-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => setMessages(initialTranscript)}
              >
                Reset transcript
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => void refreshBackend()}
                disabled={isCheckingBackend}
              >
                {isCheckingBackend ? "Checking..." : "Check Pi"}
              </button>
            </div>
          </header>

          <section className="transcript" ref={transcriptRef}>
            {messages.map((message) => (
              <article
                className={`message message--${message.role}`}
                key={message.id}
              >
                <div className="message-head">
                  <span className="message-role">{message.role}</span>
                  {message.meta ? (
                    <span className="message-meta">{message.meta}</span>
                  ) : null}
                </div>
                <p>{message.content}</p>
              </article>
            ))}

            {isSending ? (
              <article className="message message--assistant message--pending">
                <div className="message-head">
                  <span className="message-role">assistant</span>
                  <span className="message-meta">Thinking on the Pi</span>
                </div>
                <p>Waiting for a compact reply from the current model...</p>
              </article>
            ) : null}
          </section>

          <form className="composer" onSubmit={handleSubmit}>
            <label className="composer-label" htmlFor="assistant-prompt">
              Ask the assistant
            </label>
            <textarea
              id="assistant-prompt"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              placeholder="Try a short prompt first. Tool-backed answers and voice are the next layers."
              rows={4}
            />

            <div className="prompt-row">
              {starterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  className="chip-button"
                  type="button"
                  onClick={() => setDraft(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>

            <div className="composer-footer">
              <div className="composer-meta">
                <span>Context window: last 8 turns only</span>
                <span>Backend model: {activeModel || "Loading..."}</span>
              </div>
              <button
                className="send-button"
                type="submit"
                disabled={!draft.trim() || isSending || isBootstrapping}
              >
                {isSending ? "Sending..." : "Send"}
              </button>
            </div>
          </form>
        </section>

        <aside className="sidebar">
          <section className="panel stack-panel">
            <p className="panel-label">Runtime</p>
            <h2>Current shell decisions</h2>
            <dl className="data-grid">
              <div>
                <dt>Shell</dt>
                <dd>Tauri 2 + React</dd>
              </div>
              <div>
                <dt>Voice plan</dt>
                <dd>whisper.cpp + SAPI</dd>
              </div>
              <div>
                <dt>Default model</dt>
                <dd>{activeModel || "Loading..."}</dd>
              </div>
              <div>
                <dt>Backend latency</dt>
                <dd>{formatLatency(backendStatus)}</dd>
              </div>
            </dl>
          </section>

          <section className="panel config-panel">
            <div className="sidebar-heading">
              <div>
                <p className="panel-label">Config</p>
                <h2>Pi connection</h2>
              </div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => void refreshModels()}
                disabled={isRefreshingModels}
              >
                {isRefreshingModels ? "Refreshing..." : "Reload models"}
              </button>
            </div>

            <div className="config-list">
              <div>
                <span>Base URL</span>
                <strong>{runtimeConfig?.llmBaseUrl || "Loading..."}</strong>
              </div>
              <div>
                <span>Models endpoint</span>
                <strong>{runtimeConfig?.llmModelsEndpoint || "Loading..."}</strong>
              </div>
              <div>
                <span>Chat endpoint</span>
                <strong>{runtimeConfig?.llmChatEndpoint || "Loading..."}</strong>
              </div>
            </div>

            <div className="readout-block">
              <span className="field-label">Active backend model</span>
              <strong>{activeModel || "No model reported yet"}</strong>
              <p>
                Model switching is Pi-owned. This app only reflects what the
                backend reports and does not switch models client-side.
              </p>
            </div>

            {availableModels.length > 1 ? (
              <div className="readout-block">
                <span className="field-label">Backend advertised models</span>
                <ul className="readout-list">
                  {availableModels.map((model) => (
                    <li key={model}>{model}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="panel roadmap-panel">
            <p className="panel-label">Build track</p>
            <h2>What this scaffold proves</h2>
            <ul>
              <li>Text-first chat loop to the Pi</li>
              <li>Rust-side HTTP bridge to avoid webview CORS issues</li>
              <li>Environment-driven runtime config for local deployment</li>
              <li>Room for SAPI, whisper.cpp, tray support, and the avatar overlay</li>
            </ul>
          </section>

          {error ? (
            <section className="panel error-panel">
              <p className="panel-label">Attention</p>
              <h2>Runtime error</h2>
              <p>{error}</p>
            </section>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

export default App;
