import { startTransition, useEffect, useRef, useState, type FormEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  AlertCircle,
  Bot,
  FileText,
  Globe,
  Mic,
  Moon,
  RefreshCw,
  RotateCcw,
  Send,
  Server,
  Square,
  Sparkles,
  Sun,
  Volume2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingsPanel } from "@/components/SettingsPanel";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  appendMessage,
  type AssistantProgressEvent,
  type AssistantToolMode,
  chatCompletionStream,
  checkBackend,
  createConversation,
  enqueueTts,
  formatInvokeError,
  getControlState,
  getConversation,
  getRuntimeConfig,
  getSttStatus,
  getTtsStatus,
  listConversations,
  speakText,
  stopTts,
  summarizeConversation,
  switchModel,
  transcribeAudio,
  type BackendStatus,
  type ChatMessage,
  type ChatStreamEvent,
  type ControlState,
  type PersistedMessage,
  type RuntimeConfig,
  type SttStatus,
  type TtsStateEvent,
  type TtsStatus,
} from "@/lib/assistant";
import { buildChatCompletionRequest } from "@/lib/assistant-session";
import { startAudioCapture, type ActiveAudioCapture } from "@/lib/audio-capture";
import {
  getEffectiveProfileTier,
  getActiveProfile,
  getBackendModel,
  getProfileTierLabel,
  sortModelProfiles,
} from "@/lib/model-profiles";
import { cn } from "@/lib/utils";

const starterPrompts = [
  "Summarize what this assistant is supposed to become.",
  "What should we validate first before adding voice?",
  "Give me a compact plan for a text-first local assistant.",
];

const toolModeOptions: Array<{
  value: AssistantToolMode;
  label: string;
  hint: string;
}> = [
  { value: "auto", label: "Auto", hint: "Use web search when the prompt looks current-sensitive." },
  { value: "chat", label: "Chat", hint: "Ask the Pi only, with no extra tools." },
  { value: "web", label: "Web", hint: "Search first, then answer from the evidence." },
  { value: "file", label: "File", hint: "Read a local text file and answer from it." },
];

// Trigger a rolling summary after this many completed exchanges (user + assistant pairs).
const SUMMARIZE_EVERY = 6;

const themeStorageKey = "ai-assistant-theme";
const autoSpeakStorageKey = "ai-assistant-auto-speak";
const voiceStorageKey = "ai-assistant-voice";
const audioDeviceStorageKey = "ai-assistant-audio-device";
const advancedModelsStorageKey = "ai-assistant-show-advanced-models";

type ActivityTone =
  | AssistantProgressEvent["tone"]
  | "idle";

interface AssistantActivity {
  tone: ActivityTone;
  message: string;
  detail?: string | null;
}

interface VoiceActivity {
  state: "idle" | "speaking" | "error";
  message: string;
  detail?: string | null;
}

interface VoiceInputActivity {
  state: "idle" | "recording" | "transcribing" | "error";
  message: string;
  detail?: string | null;
}

const initialTranscript: ChatMessage[] = [
  {
    id: "boot-message",
    role: "assistant",
    content:
      "Local shell online. The first milestone is compact text chat to the Pi, then voice, then the avatar overlay.",
    meta: "Bootstrap note",
    includeInContext: false,
  },
];

function createMessage(
  role: ChatMessage["role"],
  content: string,
  meta?: string,
  includeInContext = true,
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    meta,
    includeInContext,
  };
}

function formatLatency(status: BackendStatus | null) {
  if (!status?.ok) {
    return "Unavailable";
  }

  return `${status.latencyMs} ms`;
}

function wait(delayMs: number) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function formatAssistantMeta(
  model: string,
  toolMode?: Exclude<AssistantToolMode, "auto"> | null,
  toolDetail?: string | null,
) {
  const prefix =
    toolMode === "web"
      ? "Web grounded"
      : toolMode === "file"
        ? "File grounded"
        : "Direct Pi reply";

  if (toolDetail?.trim()) {
    return `${prefix} · ${toolDetail} · ${model}`;
  }

  return `${prefix} · ${model}`;
}

function getActivityToneClasses(tone: ActivityTone) {
  switch (tone) {
    case "search":
      return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "file":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "generation":
      return "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300";
    case "success":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "warning":
      return "border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300";
    case "error":
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

function getToolToneClasses(toolMode: Exclude<AssistantToolMode, "auto"> | undefined) {
  switch (toolMode) {
    case "web":
      return "border-sky-500/20 bg-sky-500/5";
    case "file":
      return "border-amber-500/20 bg-amber-500/5";
    default:
      return "border-border bg-card";
  }
}

function getVoiceStateClasses(state: VoiceActivity["state"]) {
  switch (state) {
    case "speaking":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "error":
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

function getVoiceInputStateClasses(state: VoiceInputActivity["state"]) {
  switch (state) {
    case "recording":
      return "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300";
    case "transcribing":
      return "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300";
    case "error":
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

function extractSentences(text: string): { sentences: string[]; remaining: string } {
  const sentences: string[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "." || ch === "!" || ch === "?") {
      const next = text[i + 1];
      if (next === " " || next === "\n" || i === text.length - 1) {
        const sentence = text.slice(start, i + 1).trim();
        // Skip very short fragments (e.g. "Dr." or "Mr.")
        if (sentence.length >= 8) {
          sentences.push(sentence);
          start = i + 2;
        }
      }
    }
  }

  return { sentences, remaining: text.slice(start) };
}

function resolvePreferredVoiceId(
  voices: TtsStatus["voices"],
  selectedVoiceId: string,
  configuredVoice: string,
) {
  return (
    voices.find((voice) => voice.id === selectedVoiceId) ||
    voices.find((voice) => voice.id === configuredVoice || voice.name === configuredVoice) ||
    voices[0] ||
    null
  );
}

function resolvePreferredOutputDeviceId(
  outputDevices: TtsStatus["outputDevices"],
  selectedDeviceId: string,
  configuredOutputDevice: string,
) {
  return (
    outputDevices.find((device) => device.id === selectedDeviceId) ||
    outputDevices.find(
      (device) => device.id === configuredOutputDevice || device.name === configuredOutputDevice,
    ) ||
    null
  );
}

function persistedToChatMessage(msg: PersistedMessage): ChatMessage {
  return {
    id: `persisted-${msg.id}`,
    role: msg.role as ChatMessage["role"],
    content: msg.content,
    meta: msg.meta ?? undefined,
    includeInContext: msg.includeInContext,
    toolMode: msg.toolMode as ChatMessage["toolMode"] ?? undefined,
  };
}

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof document === "undefined") {
      return "dark";
    }

    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [controlState, setControlState] = useState<ControlState | null>(null);
  const [sttStatus, setSttStatus] = useState<SttStatus | null>(null);
  const [messages, setMessages] = useState(initialTranscript);
  const [draft, setDraft] = useState("");
  const [toolMode, setToolMode] = useState<AssistantToolMode>("auto");
  const [filePath, setFilePath] = useState("");
  const [notice, setNotice] = useState("Bootstrapping the local assistant shell...");
  const [error, setError] = useState("");
  const [ttsStatus, setTtsStatus] = useState<TtsStatus | null>(null);
  const [selectedVoice, setSelectedVoice] = useState("");
  const [selectedOutputDevice, setSelectedOutputDevice] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return window.localStorage.getItem(audioDeviceStorageKey) || "";
  });
  const [ttsRate, setTtsRate] = useState(1.0);
  const [ttsVolume, setTtsVolume] = useState(1.0);
  const [ttsPitch, setTtsPitch] = useState(0.0);
  const [autoSpeak, setAutoSpeak] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }

    const stored = window.localStorage.getItem(autoSpeakStorageKey);
    return stored === null ? true : stored === "true";
  });
  const [showAdvancedModels, setShowAdvancedModels] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.localStorage.getItem(advancedModelsStorageKey) === "true";
  });
  const [voiceActivity, setVoiceActivity] = useState<VoiceActivity>({
    state: "idle",
    message: "Voice output idle.",
  });
  const [voiceInputActivity, setVoiceInputActivity] = useState<VoiceInputActivity>({
    state: "idle",
    message: "Voice input idle.",
  });
  const [activity, setActivity] = useState<AssistantActivity>({
    tone: "idle",
    message: "Connecting to the local assistant runtime...",
  });
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isCheckingBackend, setIsCheckingBackend] = useState(false);
  const [isRefreshingControl, setIsRefreshingControl] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [switchingAlias, setSwitchingAlias] = useState<string | null>(null);
  const [isRefreshingTts, setIsRefreshingTts] = useState(false);
  const [isRefreshingStt, setIsRefreshingStt] = useState(false);
  const [isSpeakingRequest, setIsSpeakingRequest] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [isTranscribingVoice, setIsTranscribingVoice] = useState(false);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const activeRecordingRef = useRef<ActiveAudioCapture | null>(null);
  // Counts completed user+assistant exchanges for the current conversation.
  // Summarization fires every SUMMARIZE_EVERY exchanges (background, non-blocking).
  const exchangeCountRef = useRef(0);
  const activeProfile = getActiveProfile(controlState);
  const sortedModelProfiles = sortModelProfiles(controlState?.models || [], controlState);
  const visibleModelProfiles = sortedModelProfiles.filter((profile) => {
    const effectiveTier = getEffectiveProfileTier(profile, controlState);
    const isAdvanced = effectiveTier === "quality_slow" || effectiveTier === "legacy";
    const isActive = profile.active || profile.alias === controlState?.currentAlias;

    return showAdvancedModels || !isAdvanced || isActive;
  });

  const backendModel = getBackendModel(controlState, backendStatus, runtimeConfig);
  const sendDisabled =
    !draft.trim() ||
    isSending ||
    isTranscribingVoice ||
    isBootstrapping ||
    !!switchingAlias ||
    controlState?.ready === false ||
    (toolMode === "file" && !filePath.trim());
  const lastAssistantReply = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.includeInContext !== false);
  const selectedVoiceOption =
    ttsStatus?.voices.find((voice) => voice.id === selectedVoice) || ttsStatus?.voices[0] || null;
  const selectedOutputDeviceOption =
    ttsStatus?.outputDevices.find((device) => device.id === selectedOutputDevice) || null;

  useEffect(() => {
    const root = document.documentElement;

    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(autoSpeakStorageKey, String(autoSpeak));
  }, [autoSpeak]);

  useEffect(() => {
    window.localStorage.setItem(advancedModelsStorageKey, String(showAdvancedModels));
  }, [showAdvancedModels]);

  useEffect(() => {
    if (!selectedVoice) {
      return;
    }

    window.localStorage.setItem(voiceStorageKey, selectedVoice);
  }, [selectedVoice]);

  useEffect(() => {
    window.localStorage.setItem(audioDeviceStorageKey, selectedOutputDevice);
  }, [selectedOutputDevice]);

  // ttsRate/ttsVolume/ttsPitch are now persisted via the settings DB (save via SettingsPanel).
  // The sliders update live state only; they do not need localStorage anymore.

  async function refreshBackend(showBusy = true) {
    if (showBusy) {
      setIsCheckingBackend(true);
    }

    try {
      const status = await checkBackend();

      startTransition(() => {
        setBackendStatus(status);
        setNotice(
          status.activeModel
            ? `Pi backend reachable. Active model: ${status.activeModel}`
            : `Pi backend reachable at ${status.endpoint}`,
        );
        setActivity({
          tone: "success",
          message: "Pi backend reachable.",
          detail: status.activeModel || status.endpoint,
        });
        setError("");
      });
    } catch (refreshError) {
      const message = formatInvokeError(refreshError);

      startTransition(() => {
        setBackendStatus(null);
        setActivity({
          tone: "error",
          message: "The Pi backend could not be reached.",
          detail: message,
        });
        setError(message);
      });
    } finally {
      if (showBusy) {
        setIsCheckingBackend(false);
      }
    }
  }

  async function refreshControl(showBusy = true) {
    if (showBusy) {
      setIsRefreshingControl(true);
    }

    try {
      const nextControlState = await getControlState();

      startTransition(() => {
        setControlState(nextControlState);
        const liveModel = nextControlState.liveModel || nextControlState.currentModel;
        setNotice(
          liveModel
            ? `Control API ready. Active profile: ${nextControlState.currentAlias || "unknown"} (${liveModel})`
            : "Control API reachable.",
        );
        setActivity({
          tone: nextControlState.ready ? "success" : "warning",
          message: nextControlState.ready
            ? "Control API ready."
            : "Control API reachable, but the model is still warming up.",
          detail: liveModel || nextControlState.currentAlias || "No active profile reported.",
        });
        setError("");
      });
    } catch (refreshError) {
      const message = formatInvokeError(refreshError);

      startTransition(() => {
        setActivity({
          tone: "error",
          message: "The control API could not be reached.",
          detail: message,
        });
        setError(message);
      });
    } finally {
      if (showBusy) {
        setIsRefreshingControl(false);
      }
    }
  }

  async function refreshTts(showBusy = true) {
    if (showBusy) {
      setIsRefreshingTts(true);
    }

    try {
      const nextTtsStatus = await getTtsStatus();

      startTransition(() => {
        setTtsStatus(nextTtsStatus);
        if (!nextTtsStatus.available) {
          setVoiceActivity({
            state: "error",
            message: "Windows voice output is unavailable.",
            detail: `Backend: ${nextTtsStatus.backend}`,
          });
        } else if (!nextTtsStatus.speaking) {
          setVoiceActivity((currentVoiceActivity) =>
            currentVoiceActivity.state === "speaking"
              ? {
                  state: "idle",
                  message: "Voice output idle.",
                  detail:
                    nextTtsStatus.activeVoice ||
                    nextTtsStatus.configuredVoice ||
                    nextTtsStatus.activeOutputDevice ||
                    null,
                }
              : currentVoiceActivity,
          );
        }
      });
    } catch (ttsError) {
      const message = formatInvokeError(ttsError);

      startTransition(() => {
        setTtsStatus(null);
        setVoiceActivity({
          state: "error",
          message: "Could not load voice output status.",
          detail: message,
        });
      });
    } finally {
      if (showBusy) {
        setIsRefreshingTts(false);
      }
    }
  }

  async function refreshStt(showBusy = true) {
    if (showBusy) {
      setIsRefreshingStt(true);
    }

    try {
      const nextSttStatus = await getSttStatus();

      startTransition(() => {
        setSttStatus(nextSttStatus);
        if (!nextSttStatus.ready) {
          setVoiceInputActivity({
            state: "error",
            message: "Speech input is not ready.",
            detail: nextSttStatus.message,
          });
        } else {
          setVoiceInputActivity((currentActivity) =>
            currentActivity.state === "recording" || currentActivity.state === "transcribing"
              ? currentActivity
              : {
                  state: "idle",
                  message: "Voice input idle.",
                  detail: `${nextSttStatus.language} · ${nextSttStatus.threads} thread${nextSttStatus.threads === 1 ? "" : "s"}`,
                },
          );
        }
      });
    } catch (sttError) {
      const message = formatInvokeError(sttError);

      startTransition(() => {
        setSttStatus(null);
        setVoiceInputActivity({
          state: "error",
          message: "Could not load speech input status.",
          detail: message,
        });
      });
    } finally {
      if (showBusy) {
        setIsRefreshingStt(false);
      }
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [config, conversations] = await Promise.all([
          getRuntimeConfig(),
          listConversations().catch(() => [] as Awaited<ReturnType<typeof listConversations>>),
        ]);

        if (cancelled) {
          return;
        }

        // Resume the most recent conversation if it has messages, otherwise create one.
        let activeConvId: number;
        if (conversations.length > 0 && conversations[0].messageCount > 0) {
          activeConvId = conversations[0].id;
          const persisted = await getConversation(activeConvId);
          if (!cancelled && persisted.length > 0) {
            // Seed the exchange counter so summarization stays aligned
            // with the total turn count, not just the current session.
            exchangeCountRef.current = Math.floor(persisted.length / 2);
            startTransition(() => {
              setMessages([
                ...initialTranscript,
                ...persisted.map(persistedToChatMessage),
              ]);
            });
          }
        } else {
          activeConvId = await createConversation();
        }

        if (!cancelled) {
          setConversationId(activeConvId);
        }

        startTransition(() => {
          setRuntimeConfig(config);
          setNotice(`Runtime loaded. Backend URL: ${config.llmBaseUrl}`);
          setActivity({
            tone: "idle",
            message: "Runtime loaded.",
            detail: config.llmBaseUrl,
          });

          // Seed sliders from config (DB takes priority over env via Rust layer).
          setTtsRate(config.ttsRate);
          setTtsVolume(config.ttsVolume);
          setTtsPitch(config.ttsPitch);
        });

        await Promise.all([
          refreshBackend(false),
          refreshControl(false),
          refreshTts(false),
          refreshStt(false),
        ]);
      } catch (bootstrapError) {
        const message = formatInvokeError(bootstrapError);

        if (!cancelled) {
          startTransition(() => {
            setActivity({
              tone: "error",
              message: "Bootstrap failed.",
              detail: message,
            });
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
    return () => {
      const recording = activeRecordingRef.current;
      activeRecordingRef.current = null;
      if (recording) {
        void recording.cancel();
      }
    };
  }, []);

  useEffect(() => {
    if (!ttsStatus?.voices.length) {
      return;
    }

    const storedVoice = window.localStorage.getItem(voiceStorageKey) || "";
    const nextVoice = resolvePreferredVoiceId(
      ttsStatus.voices,
      selectedVoice || storedVoice,
      ttsStatus.configuredVoice,
    );

    if (nextVoice && nextVoice.id !== selectedVoice) {
      setSelectedVoice(nextVoice.id);
    }
  }, [selectedVoice, ttsStatus]);

  useEffect(() => {
    if (!ttsStatus) {
      return;
    }

    const storedOutputDevice = window.localStorage.getItem(audioDeviceStorageKey) || "";
    const nextDevice = resolvePreferredOutputDeviceId(
      ttsStatus.outputDevices,
      selectedOutputDevice || storedOutputDevice,
      ttsStatus.configuredOutputDevice,
    );

    if (!nextDevice && selectedOutputDevice) {
      setSelectedOutputDevice("");
      return;
    }

    if (nextDevice && nextDevice.id !== selectedOutputDevice) {
      setSelectedOutputDevice(nextDevice.id);
    }
  }, [selectedOutputDevice, ttsStatus]);

  useEffect(() => {
    let disposed = false;
    let unlistenPromise: Promise<() => void> | null = null;

    unlistenPromise = listen<TtsStateEvent>("tts-state", (event) => {
      if (disposed) {
        return;
      }

      startTransition(() => {
        setTtsStatus((currentStatus) =>
          currentStatus
            ? {
                ...currentStatus,
                speaking: event.payload.speaking,
                activeVoice: event.payload.voice || currentStatus.activeVoice,
                activeOutputDevice:
                  event.payload.outputDevice || currentStatus.activeOutputDevice,
              }
            : currentStatus,
        );
        setVoiceActivity({
          state: event.payload.state,
          message: event.payload.message,
          detail: event.payload.detail,
        });
      });
    });

    return () => {
      disposed = true;
      void unlistenPromise?.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const viewport = scrollViewportRef.current;

    if (!viewport) {
      return;
    }

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isSending]);

  async function waitForControlReady(expectedAlias: string) {
    let lastError = "";

    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const nextControlState = await getControlState();

        startTransition(() => {
          setControlState(nextControlState);
          setError("");
        });

        if (nextControlState.ready && nextControlState.currentAlias === expectedAlias) {
          return nextControlState;
        }
      } catch (pollError) {
        lastError = formatInvokeError(pollError);
      }

      await wait(1000);
    }

    if (lastError) {
      throw new Error(lastError);
    }

    throw new Error(`Timed out waiting for ${expectedAlias} to become ready.`);
  }

  async function handleModelSwitch(alias: string) {
    if (switchingAlias || alias === controlState?.currentAlias) {
      return;
    }

    setError("");
    setSwitchingAlias(alias);
    setActivity({
      tone: "warning",
      message: `Switching the Pi to ${alias}...`,
      detail: "Waiting for the control API to report ready.",
    });

    try {
      const response = await switchModel(alias);

      startTransition(() => {
        setNotice(`Switching the Pi backend to ${alias}. Waiting for the model to become ready...`);
      });

      const nextControlState = await waitForControlReady(alias);
      await refreshBackend(false);

      const nextActiveProfile =
        nextControlState.models.find((model) => model.active) ||
        nextControlState.models.find((model) => model.alias === alias) ||
        null;

      startTransition(() => {
        setNotice(
          nextActiveProfile
            ? `Pi backend switched to ${nextActiveProfile.alias} (${nextActiveProfile.model}).`
            : `Pi backend switched to ${response.alias || alias}.`,
        );
        setActivity({
          tone: "success",
          message: `Active profile: ${nextActiveProfile?.alias || response.alias || alias}`,
          detail: nextActiveProfile?.model || response.model || null,
        });
      });
    } catch (switchError) {
      const message = formatInvokeError(switchError);

      startTransition(() => {
        setActivity({
          tone: "error",
          message: "Model switch failed.",
          detail: message,
        });
        setError(message);
      });
    } finally {
      setSwitchingAlias(null);
    }
  }

  async function handleSpeak(content: string) {
    const trimmedContent = content.trim();
    const voiceToUse = selectedVoiceOption;

    if (!trimmedContent || !ttsStatus?.available || !voiceToUse) {
      return;
    }

    setIsSpeakingRequest(true);

    try {
      await speakText({
        text: trimmedContent,
        voiceId: voiceToUse.id,
        deviceId: selectedOutputDevice || undefined,
        rate: ttsRate,
        volume: ttsVolume,
        pitch: ttsPitch,
      });

      startTransition(() => {
        setVoiceActivity({
          state: "speaking",
          message: "Speaking reply.",
          detail: selectedOutputDeviceOption
            ? `${voiceToUse.name} · ${selectedOutputDeviceOption.name}`
            : `${voiceToUse.name} · System default`,
        });
        setTtsStatus((currentStatus) =>
          currentStatus
            ? {
                ...currentStatus,
                speaking: true,
                activeVoice: voiceToUse.name,
                activeOutputDevice: selectedOutputDeviceOption?.name || "System default",
              }
            : currentStatus,
        );
      });
    } catch (speakError) {
      const message = formatInvokeError(speakError);

      startTransition(() => {
        setVoiceActivity({
          state: "error",
          message: "Voice output failed.",
          detail: message,
        });
        setError(message);
      });
    } finally {
      setIsSpeakingRequest(false);
    }
  }

  async function handleStopSpeaking() {
    setIsSpeakingRequest(true);

    try {
      await stopTts();

      startTransition(() => {
        setTtsStatus((currentStatus) =>
          currentStatus
            ? {
                ...currentStatus,
                speaking: false,
                activeVoice: null,
                activeOutputDevice: null,
              }
            : currentStatus,
        );
        setVoiceActivity({
          state: "idle",
          message: "Voice output idle.",
          detail: selectedVoiceOption?.name || null,
        });
      });
    } catch (stopError) {
      const message = formatInvokeError(stopError);

      startTransition(() => {
        setVoiceActivity({
          state: "error",
          message: "Could not stop voice output.",
          detail: message,
        });
        setError(message);
      });
    } finally {
      setIsSpeakingRequest(false);
    }
  }

  async function handleStartVoiceCapture() {
    if (isRecordingVoice || isTranscribingVoice) {
      return;
    }

    if (!sttStatus?.ready) {
      const detail = sttStatus?.message || "Configure whisper.cpp before recording.";
      setVoiceInputActivity({
        state: "error",
        message: "Speech input is not ready.",
        detail,
      });
      setError(detail);
      return;
    }

    try {
      if (ttsStatus?.speaking) {
        await handleStopSpeaking();
      }

      const capture = await startAudioCapture();
      activeRecordingRef.current = capture;
      setIsRecordingVoice(true);
      setError("");
      setVoiceInputActivity({
        state: "recording",
        message: "Recording from the microphone...",
        detail: "Click stop when you finish speaking.",
      });
      setActivity({
        tone: "generation",
        message: "Listening for voice input...",
        detail: "Speech stays on the PC until transcription finishes.",
      });
    } catch (captureError) {
      const message = formatInvokeError(captureError);
      setVoiceInputActivity({
        state: "error",
        message: "Microphone capture failed.",
        detail: message,
      });
      setError(message);
    }
  }

  async function handleCancelVoiceCapture() {
    const capture = activeRecordingRef.current;
    activeRecordingRef.current = null;

    if (!capture) {
      return;
    }

    setIsRecordingVoice(false);

    try {
      await capture.cancel();
      setVoiceInputActivity({
        state: "idle",
        message: "Voice input idle.",
        detail: "Recording canceled.",
      });
      setActivity({
        tone: "idle",
        message: "Voice capture canceled.",
      });
    } catch (cancelError) {
      const message = formatInvokeError(cancelError);
      setVoiceInputActivity({
        state: "error",
        message: "Could not cancel microphone capture.",
        detail: message,
      });
      setError(message);
    }
  }

  async function handleStopVoiceCapture() {
    const capture = activeRecordingRef.current;
    activeRecordingRef.current = null;

    if (!capture) {
      return;
    }

    setIsRecordingVoice(false);
    setIsTranscribingVoice(true);
    setVoiceInputActivity({
      state: "transcribing",
      message: "Transcribing with whisper.cpp...",
      detail: sttStatus
        ? `${sttStatus.language} · ${sttStatus.threads} thread${sttStatus.threads === 1 ? "" : "s"}`
        : null,
    });
    setActivity({
      tone: "generation",
      message: "Transcribing microphone audio...",
      detail: "Running local whisper.cpp on the PC.",
    });

    try {
      const recording = await capture.stop();
      const response = await transcribeAudio({
        audioBytes: Array.from(recording.wavBytes),
        language: sttStatus?.language || runtimeConfig?.sttLanguage,
      });
      const nextDraft = response.text.trim();

      startTransition(() => {
        setDraft((currentDraft) => {
          if (!nextDraft) {
            return currentDraft;
          }

          if (!currentDraft.trim()) {
            return nextDraft;
          }

          return `${currentDraft.trim()}\n${nextDraft}`;
        });
        setVoiceInputActivity({
          state: "idle",
          message: "Voice input transcribed.",
          detail: `${Math.max(recording.durationMs / 1000, 0.1).toFixed(1)}s clip · review before sending`,
        });
        setActivity({
          tone: "success",
          message: "Voice transcription ready.",
          detail: nextDraft,
        });
        setError("");
      });
    } catch (transcriptionError) {
      const message = formatInvokeError(transcriptionError);

      startTransition(() => {
        setVoiceInputActivity({
          state: "error",
          message: "Voice transcription failed.",
          detail: message,
        });
        setActivity({
          tone: "error",
          message: "Voice transcription failed.",
          detail: message,
        });
        setError(message);
      });
    } finally {
      setIsTranscribingVoice(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const prompt = draft.trim();

    if (
      !prompt ||
      isSending ||
      !runtimeConfig ||
      !!switchingAlias ||
      controlState?.ready === false ||
      (toolMode === "file" && !filePath.trim())
    ) {
      return;
    }

    if (ttsStatus?.speaking) {
      await handleStopSpeaking();
    }

    const userMessage = createMessage("user", prompt);
    const assistantMessageId = crypto.randomUUID();
    const streamRequestId = crypto.randomUUID();
    const chatRequest = buildChatCompletionRequest({
      prompt,
      messages,
      userMessage,
      systemPrompt: runtimeConfig.assistantSystemPrompt,
      clientPromptPrefix: activeProfile?.clientPromptPrefix || "",
      requestId: streamRequestId,
      toolMode,
      filePath,
      conversationId: conversationId ?? undefined,
    });
    const nextMessages = [
      ...messages,
      userMessage,
      {
        id: assistantMessageId,
        role: "assistant" as const,
        content: "",
        meta:
          toolMode === "web"
            ? "Searching the web"
            : toolMode === "file"
              ? "Reading local file"
              : "Preparing reply",
        includeInContext: false,
        toolMode: toolMode === "auto" ? undefined : toolMode,
      },
    ];

    setDraft("");
    setError("");
    setIsSending(true);
    setMessages(nextMessages);
    setActivity({
      tone:
        toolMode === "web"
          ? "search"
          : toolMode === "file"
            ? "file"
            : "generation",
      message:
        toolMode === "web"
          ? "Searching the web..."
          : toolMode === "file"
            ? "Reading the selected file..."
            : "Sending the prompt to the Pi...",
      detail: toolMode === "file" ? filePath.trim() : prompt,
    });

    let unlisten: (() => void) | undefined;
    let unlistenProgress: (() => void) | undefined;
    let streamBuffer = "";
    let streamSpeechStarted = false;

    try {
      unlistenProgress = await listen<AssistantProgressEvent>("assistant-progress", (event) => {
        if (event.payload.requestId !== streamRequestId) {
          return;
        }

        startTransition(() => {
          setActivity({
            tone: event.payload.tone,
            message: event.payload.message,
            detail: event.payload.detail,
          });
          setMessages((currentMessages) =>
            currentMessages.map((message) => {
              if (message.id !== assistantMessageId) {
                return message;
              }

              return {
                ...message,
                meta: event.payload.message,
                toolMode:
                  event.payload.tone === "search"
                    ? "web"
                    : event.payload.tone === "file"
                      ? "file"
                      : message.toolMode,
              };
            }),
          );
        });
      });

      unlisten = await listen<ChatStreamEvent>("chat-stream", (event) => {
        if (event.payload.requestId !== streamRequestId) {
          return;
        }

        if (!event.payload.delta && !event.payload.model) {
          return;
        }

        const delta = event.payload.delta ?? "";

        startTransition(() => {
          setMessages((currentMessages) =>
            currentMessages.map((message) => {
              if (message.id !== assistantMessageId) {
                return message;
              }

              return {
                ...message,
                content: `${message.content}${delta}`,
                meta: event.payload.model || message.meta,
              };
            }),
          );
        });

        // Streaming TTS: speak complete sentences as they arrive.
        if (autoSpeak && delta && ttsStatus?.available && selectedVoiceOption) {
          streamBuffer += delta;
          const { sentences, remaining } = extractSentences(streamBuffer);
          streamBuffer = remaining;

          for (const sentence of sentences) {
            if (!streamSpeechStarted) {
              streamSpeechStarted = true;
              void handleSpeak(sentence);
            } else {
              void enqueueTts({
                text: sentence,
                voiceId: selectedVoiceOption.id,
                deviceId: selectedOutputDevice || undefined,
                rate: ttsRate,
                volume: ttsVolume,
                pitch: ttsPitch,
              });
            }
          }
        }
      });

      const response = await chatCompletionStream({
        ...chatRequest,
      });

      const assistantMeta = formatAssistantMeta(response.model, response.toolMode, response.toolDetail);
      const resolvedToolMode = response.toolMode || "chat";

      startTransition(() => {
        setMessages((currentMessages) =>
          currentMessages.map((message) => {
            if (message.id !== assistantMessageId) {
              return message;
            }

            return {
              ...message,
              content: response.content,
              meta: assistantMeta,
              includeInContext: true,
              toolMode: resolvedToolMode,
            };
          }),
        );
        setNotice(`Assistant replied from backend model ${response.model}`);
        setActivity({
          tone: "success",
          message:
            response.toolMode === "web"
              ? "Reply ready with web grounding."
              : response.toolMode === "file"
                ? "Reply ready from file grounding."
                : "Reply ready.",
          detail: response.toolDetail || response.model,
        });
      });

      // Persist this exchange to SQLite and trigger rolling summarization if due.
      if (conversationId !== null) {
        const convId = conversationId;
        void appendMessage(convId, "user", prompt, null, null, true).catch(() => {});
        void appendMessage(
          convId,
          "assistant",
          response.content,
          assistantMeta,
          resolvedToolMode,
          true,
        ).catch(() => {});

        exchangeCountRef.current += 1;
        if (exchangeCountRef.current % SUMMARIZE_EVERY === 0) {
          // Fire-and-forget: runs in background, result stored in DB,
          // injected automatically on the next chatCompletionStream call.
          void summarizeConversation(convId).catch(() => {});
        }
      }

      // Speak any text that didn't hit a sentence boundary during streaming.
      if (autoSpeak && ttsStatus?.available && selectedVoiceOption) {
        const tail = streamBuffer.trim() || (!streamSpeechStarted ? response.content : "");
        if (tail) {
          if (!streamSpeechStarted) {
            void handleSpeak(tail);
          } else {
            void enqueueTts({
              text: tail,
              voiceId: selectedVoiceOption.id,
              deviceId: selectedOutputDevice || undefined,
              rate: ttsRate,
              volume: ttsVolume,
              pitch: ttsPitch,
            });
          }
        }
      } else if (autoSpeak && !streamSpeechStarted) {
        void handleSpeak(response.content);
      }
    } catch (sendError) {
      const message = formatInvokeError(sendError);

      startTransition(() => {
        setError(message);
        setActivity({
          tone: "error",
          message: "The assistant request failed.",
          detail: message,
        });
        setMessages((currentMessages) => [
          ...currentMessages.filter((currentMessage) => currentMessage.id !== assistantMessageId),
          createMessage(
            "assistant",
            `I couldn't complete that request. ${message}`,
            "Local shell",
            false,
          ),
        ]);
      });
    } finally {
      unlisten?.();
      unlistenProgress?.();
      setIsSending(false);
    }
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 md:p-6">
        <header className="flex flex-col gap-4 border-b pb-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Bot className="size-5" />
              <h1 className="text-xl font-semibold tracking-tight">AI Assistant</h1>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Text-first desktop shell for the Raspberry Pi backend. The PC owns the
              interface and future tools; the Pi owns generation.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SettingsPanel
              onSaved={() => {
                getRuntimeConfig()
                  .then((config) => {
                    startTransition(() => {
                      setRuntimeConfig(config);
                      setTtsRate(config.ttsRate);
                      setTtsVolume(config.ttsVolume);
                      setTtsPitch(config.ttsPitch);
                    });
                  })
                  .catch(() => {});
                void refreshTts(false);
                void refreshStt(false);
                void refreshBackend(false);
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"))}
            >
              {theme === "dark" ? (
                <>
                  <Sun className="size-4" />
                  Light
                </>
              ) : (
                <>
                  <Moon className="size-4" />
                  Dark
                </>
              )}
            </Button>
            <Badge
              variant="outline"
              className={cn(
                "border-transparent",
                backendStatus?.ok
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {backendStatus?.ok ? "Pi reachable" : "Backend pending"}
            </Badge>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setMessages(initialTranscript);
                exchangeCountRef.current = 0;
                createConversation()
                  .then((id) => setConversationId(id))
                  .catch(() => {});
              }}
            >
              <RotateCcw className="size-4" />
              Reset transcript
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void refreshBackend()}
              disabled={isCheckingBackend}
            >
              <Server className="size-4" />
              {isCheckingBackend ? "Checking..." : "Check Pi"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void refreshControl()}
              disabled={isRefreshingControl}
            >
              <RefreshCw className="size-4" />
              {isRefreshingControl ? "Refreshing..." : "Refresh control"}
            </Button>
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_22rem]">
          <Card className="min-h-[40rem]">
            <CardHeader className="border-b">
              <div>
                <CardTitle>Conversation</CardTitle>
                <CardDescription>
                  Compact context, explicit tools, and streamed replies from the Pi.
                </CardDescription>
              </div>
              <CardAction>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Badge variant="outline">{backendModel || "No backend model yet"}</Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      "border-transparent",
                      toolMode === "web"
                        ? "bg-sky-500/10 text-sky-700 dark:text-sky-300"
                        : toolMode === "file"
                          ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          : toolMode === "auto"
                            ? "bg-violet-500/10 text-violet-700 dark:text-violet-300"
                            : "bg-muted text-muted-foreground",
                    )}
                  >
                    {toolMode}
                  </Badge>
                </div>
              </CardAction>
            </CardHeader>

            <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
              <div
                ref={scrollViewportRef}
                className="h-[30rem] overflow-auto rounded-lg border bg-background"
              >
                <div className="flex min-h-full flex-col gap-3 p-4">
                  {messages.map((message) => (
                    <article
                      key={message.id}
                      className={cn(
                        "max-w-[48rem] rounded-lg border px-4 py-3 transition-colors",
                        message.role === "user"
                          ? "ml-auto border-sky-500/20 bg-sky-500/10"
                          : getToolToneClasses(message.toolMode),
                      )}
                    >
                      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <span className="font-medium uppercase tracking-wide">
                            {message.role}
                          </span>
                          {message.role === "assistant" && message.toolMode ? (
                            <Badge
                              variant="outline"
                              className={cn(
                                "border-transparent",
                                message.toolMode === "web"
                                  ? "bg-sky-500/10 text-sky-700 dark:text-sky-300"
                                  : message.toolMode === "file"
                                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                    : "bg-muted text-muted-foreground",
                              )}
                            >
                              {message.toolMode}
                            </Badge>
                          ) : null}
                        </div>
                        {message.meta ? <span className="text-right">{message.meta}</span> : null}
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6">
                        {message.content || (message.meta === "Streaming from Pi" ? "..." : "")}
                      </p>
                    </article>
                  ))}
                </div>
              </div>

              <form className="space-y-4" onSubmit={handleSubmit}>
                <Textarea
                  id="assistant-prompt"
                  value={draft}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                  placeholder="Ask something directly, search the web, or point the assistant at a file."
                  className="min-h-28 resize-y"
                />

                <div className="space-y-3 rounded-lg border bg-muted/25 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {toolModeOptions.map((option) => (
                      <Button
                        key={option.value}
                        type="button"
                        size="sm"
                        variant={toolMode === option.value ? "secondary" : "outline"}
                        onClick={() => setToolMode(option.value)}
                      >
                        {option.value === "web" ? <Globe className="size-4" /> : null}
                        {option.value === "file" ? <FileText className="size-4" /> : null}
                        {option.value === "auto" ? <Sparkles className="size-4" /> : null}
                        {option.value === "chat" ? <Bot className="size-4" /> : null}
                        {option.label}
                      </Button>
                    ))}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {toolModeOptions.find((option) => option.value === toolMode)?.hint}
                  </p>

                  {toolMode === "file" ? (
                    <Input
                      value={filePath}
                      onChange={(event) => setFilePath(event.currentTarget.value)}
                      placeholder="Enter a local file path, for example E:\\git\\ai-assistant\\README.md"
                    />
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  {starterPrompts.map((prompt) => (
                    <Button
                      key={prompt}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDraft(prompt)}
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>

                <div className="flex flex-col gap-3 border-t pt-4 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>
                      Pi-owned model execution with control API switching over LAN.
                    </p>
                    <p>Configured fallback: {runtimeConfig?.llmModel || "Loading..."}</p>
                    <p>SearXNG: {runtimeConfig?.searxngUrl || "Loading..."}</p>
                    <p>Voice input: {sttStatus?.ready ? "whisper.cpp ready" : sttStatus?.message || "Not configured"}</p>
                    {activeProfile?.clientPromptPrefix ? (
                      <p>Client prompt prefix active: {activeProfile.clientPromptPrefix.trim()}</p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {isRecordingVoice ? (
                      <>
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={() => void handleStopVoiceCapture()}
                          disabled={isTranscribingVoice}
                        >
                          <Square className="size-4" />
                          Stop recording
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleCancelVoiceCapture()}
                          disabled={isTranscribingVoice}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void handleStartVoiceCapture()}
                        disabled={isSending || isTranscribingVoice || !sttStatus?.ready}
                      >
                        <Mic className="size-4" />
                        {isTranscribingVoice ? "Transcribing..." : "Record voice"}
                      </Button>
                    )}

                    <Button
                      type="submit"
                      disabled={sendDisabled}
                    >
                      <Send className="size-4" />
                      {isSending ? "Receiving..." : "Send"}
                    </Button>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            <Card
              size="sm"
              className={cn("border transition-colors", getActivityToneClasses(activity.tone))}
            >
              <CardHeader>
                <CardTitle>Activity</CardTitle>
                <CardDescription className="text-current/80">
                  Real-time status for the current assistant loop.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 size-4" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{activity.message}</p>
                    {activity.detail ? (
                      <p className="text-xs text-current/80">{activity.detail}</p>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle>Backend</CardTitle>
                <CardDescription>{notice}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Active model
                    </span>
                    <Badge variant="outline" className="bg-muted/40">
                      {backendModel || "Unknown"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Latency
                    </span>
                    <span className="text-sm">{formatLatency(backendStatus)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Control alias
                    </span>
                    <Badge variant="outline" className="bg-muted/40">
                      {controlState?.currentAlias || "Unknown"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Default alias
                    </span>
                    <Badge variant="outline" className="bg-muted/40">
                      {controlState?.defaultAlias || "Unknown"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Backup alias
                    </span>
                    <Badge variant="outline" className="bg-muted/40">
                      {controlState?.backupAlias || "Unknown"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Control ready
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "border-transparent",
                        controlState?.ready
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
                      )}
                    >
                      {controlState ? (controlState.ready ? "Ready" : "Warming") : "Loading"}
                    </Badge>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Chat endpoint
                    </span>
                    <span className="max-w-[12rem] truncate text-sm">
                      {runtimeConfig?.llmChatEndpoint || "Loading..."}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Control API
                    </span>
                    <span className="max-w-[12rem] truncate text-sm">
                      {runtimeConfig?.llmControlModelsEndpoint || "Loading..."}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle>Model Profiles</CardTitle>
                <CardDescription>
                  Switch the Pi backend without shell access.
                </CardDescription>
                <CardAction>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={showAdvancedModels ? "secondary" : "outline"}
                      onClick={() => setShowAdvancedModels((current) => !current)}
                    >
                      {showAdvancedModels ? "Hide advanced" : "Show advanced"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void refreshControl()}
                      disabled={isRefreshingControl || !!switchingAlias}
                    >
                      <RefreshCw className="size-4" />
                      {isRefreshingControl ? "Refreshing..." : "Refresh"}
                    </Button>
                  </div>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-3">
                {visibleModelProfiles.length ? (
                  <>
                    {visibleModelProfiles.map((model) => {
                      const isActive = model.active || model.alias === controlState?.currentAlias;
                      const effectiveTier = getEffectiveProfileTier(model, controlState);
                      const isSwitchingToModel = switchingAlias === model.alias;

                      return (
                        <article
                          key={model.alias}
                          className={cn(
                            "rounded-lg border p-3",
                            isActive
                              ? "border-primary/30 bg-primary/5"
                              : effectiveTier === "quality_slow"
                                ? "border-amber-500/20 bg-amber-500/5"
                                : "bg-background",
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium">{model.alias}</span>
                                <Badge variant={isActive ? "secondary" : "outline"}>
                                  {isActive ? "Active" : getProfileTierLabel(model, controlState)}
                                </Badge>
                                {model.recommended ? (
                                  <Badge
                                    variant="outline"
                                    className="border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                  >
                                    Recommended
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="text-xs text-muted-foreground">{model.model}</p>
                              <p className="text-sm text-muted-foreground">{model.note}</p>
                              {model.clientPromptPrefix ? (
                                <p className="text-xs text-muted-foreground">
                                  Client prefix: {model.clientPromptPrefix.trim()}
                                </p>
                              ) : null}
                            </div>

                            <Button
                              type="button"
                              size="sm"
                              variant={isActive ? "secondary" : "outline"}
                              disabled={isActive || !!switchingAlias || isSending}
                              onClick={() => void handleModelSwitch(model.alias)}
                            >
                              <Sparkles className="size-4" />
                              {isSwitchingToModel ? "Switching..." : isActive ? "Active" : "Use"}
                            </Button>
                          </div>
                        </article>
                      );
                    })}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Control API models have not loaded yet.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle>Voice</CardTitle>
                <CardDescription>
                  Local speech input with whisper.cpp and Windows-native speech output.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  className={cn(
                    "rounded-lg border p-3 transition-colors",
                    getVoiceInputStateClasses(voiceInputActivity.state),
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Mic className="mt-0.5 size-4" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{voiceInputActivity.message}</p>
                      {voiceInputActivity.detail ? (
                        <p className="text-xs text-current/80">{voiceInputActivity.detail}</p>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Speech input
                    </span>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={isRecordingVoice ? "destructive" : "outline"}
                        onClick={() =>
                          void (isRecordingVoice
                            ? handleStopVoiceCapture()
                            : handleStartVoiceCapture())
                        }
                        disabled={isTranscribingVoice || !sttStatus?.ready}
                      >
                        {isRecordingVoice ? <Square className="size-4" /> : <Mic className="size-4" />}
                        {isRecordingVoice ? "Stop" : "Record"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isRefreshingStt}
                        onClick={() => void refreshStt()}
                      >
                        <RefreshCw className="size-4" />
                        {isRefreshingStt ? "Refreshing..." : "Refresh"}
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-medium uppercase tracking-wide">Backend</span>
                      <span>{sttStatus?.backend || "Unknown"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-medium uppercase tracking-wide">Language</span>
                      <span>{sttStatus?.language || runtimeConfig?.sttLanguage || "en"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-medium uppercase tracking-wide">Threads</span>
                      <span>{sttStatus?.threads || runtimeConfig?.sttThreads || 4}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-medium uppercase tracking-wide">Model</span>
                      <span className="max-w-[12rem] truncate">
                        {sttStatus?.configuredModelPath || "Not configured"}
                      </span>
                    </div>
                  </div>
                </div>

                <Separator />

                <div
                  className={cn(
                    "rounded-lg border p-3 transition-colors",
                    getVoiceStateClasses(voiceActivity.state),
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Volume2 className="mt-0.5 size-4" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{voiceActivity.message}</p>
                      {voiceActivity.detail ? (
                        <p className="text-xs text-current/80">{voiceActivity.detail}</p>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Auto speak
                    </span>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={autoSpeak ? "secondary" : "outline"}
                        onClick={() => setAutoSpeak((currentValue) => !currentValue)}
                      >
                        {autoSpeak ? "On" : "Off"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isRefreshingTts}
                        onClick={() => void refreshTts()}
                      >
                        <RefreshCw className="size-4" />
                        {isRefreshingTts ? "Refreshing..." : "Refresh"}
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <div className="space-y-2">
                      <label
                        htmlFor="voice-select"
                        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                      >
                        Voice
                      </label>
                      <select
                        id="voice-select"
                        value={selectedVoice}
                        onChange={(event) => setSelectedVoice(event.currentTarget.value)}
                        disabled={!ttsStatus?.available || isSpeakingRequest}
                        className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {ttsStatus?.voices.length ? (
                          ttsStatus.voices.map((voice) => (
                            <option key={voice.id} value={voice.id}>
                              {voice.name} ({voice.language})
                            </option>
                          ))
                        ) : (
                          <option value="">No Windows voices detected</option>
                        )}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label
                        htmlFor="output-device-select"
                        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                      >
                        Output
                      </label>
                      <select
                        id="output-device-select"
                        value={selectedOutputDevice}
                        onChange={(event) => setSelectedOutputDevice(event.currentTarget.value)}
                        disabled={isSpeakingRequest}
                        className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="">System default</option>
                        {(ttsStatus?.outputDevices || []).map((device) => (
                          <option key={device.id} value={device.id}>
                            {device.name}
                            {device.isDefault ? " (default)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor="tts-speed"
                          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                        >
                          Speed
                        </label>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {ttsRate.toFixed(1)}x
                        </span>
                      </div>
                      <input
                        id="tts-speed"
                        type="range"
                        min={0.5}
                        max={3.0}
                        step={0.1}
                        value={ttsRate}
                        onChange={(event) => setTtsRate(parseFloat(event.currentTarget.value))}
                        disabled={isSpeakingRequest}
                        className="w-full accent-primary disabled:opacity-50"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor="tts-volume"
                          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                        >
                          Volume
                        </label>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {Math.round(ttsVolume * 100)}%
                        </span>
                      </div>
                      <input
                        id="tts-volume"
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={ttsVolume}
                        onChange={(event) => setTtsVolume(parseFloat(event.currentTarget.value))}
                        disabled={isSpeakingRequest}
                        className="w-full accent-primary disabled:opacity-50"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor="tts-pitch"
                          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                        >
                          Pitch
                        </label>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {ttsPitch > 0 ? "+" : ""}{Math.round(ttsPitch * 50)}%
                        </span>
                      </div>
                      <input
                        id="tts-pitch"
                        type="range"
                        min={-1}
                        max={1}
                        step={0.05}
                        value={ttsPitch}
                        onChange={(event) => setTtsPitch(parseFloat(event.currentTarget.value))}
                        disabled={isSpeakingRequest}
                        className="w-full accent-primary disabled:opacity-50"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!lastAssistantReply?.content || !ttsStatus?.available || isSpeakingRequest}
                    onClick={() => void handleSpeak(lastAssistantReply?.content || "")}
                  >
                    <Volume2 className="size-4" />
                    Speak last reply
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!ttsStatus?.speaking || isSpeakingRequest}
                    onClick={() => void handleStopSpeaking()}
                  >
                    <Square className="size-4" />
                    Stop
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-medium uppercase tracking-wide">Backend</span>
                    <span>{ttsStatus?.backend || runtimeConfig?.ttsBackend || "Loading..."}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-medium uppercase tracking-wide">Selected voice</span>
                    <span className="truncate text-right">
                      {selectedVoiceOption?.name || runtimeConfig?.ttsVoice || "Loading..."}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-medium uppercase tracking-wide">Selected output</span>
                    <span className="truncate text-right">
                      {selectedOutputDeviceOption?.name ||
                        runtimeConfig?.ttsOutputDevice ||
                        "System default"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle>Foundation</CardTitle>
                <CardDescription>Core responsibilities and next steps.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>The Pi handles generation. The PC handles search, files, voice, and UI state.</p>
                <p>Next: `whisper.cpp` push-to-talk, then tray presence and the avatar overlay.</p>
              </CardContent>
            </Card>

            {error ? (
              <Card size="sm" className="border-destructive/30">
                <CardHeader>
                  <CardTitle>Runtime error</CardTitle>
                  <CardDescription>Check the Pi connection and current backend state.</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-destructive">{error}</p>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
