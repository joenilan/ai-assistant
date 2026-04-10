import { invoke } from "@tauri-apps/api/core";

export type MessageRole = "system" | "user" | "assistant";
export type AssistantToolMode = "auto" | "chat" | "web" | "file";

export interface RuntimeConfig {
  backendType: string;
  llmBaseUrl: string;
  llmModelsEndpoint: string;
  llmChatEndpoint: string;
  llmControlBaseUrl: string;
  llmControlHealthEndpoint: string;
  llmControlModelsEndpoint: string;
  llmControlSwitchEndpoint: string;
  searxngUrl: string;
  llmModel: string;
  llmTimeoutMs: number;
  assistantSystemPrompt: string;
  ttsBackend: string;
  ttsVoice: string;
  ttsOutputDevice: string;
  ttsRate: number;
  ttsVolume: number;
  ttsPitch: number;
}

export interface BackendStatus {
  ok: boolean;
  modelCount: number;
  latencyMs: number;
  endpoint: string;
  activeModel?: string | null;
}

export interface ControlModelProfile {
  alias: string;
  model: string;
  role: string;
  uiTier: string;
  recommended: boolean;
  clientPromptPrefix: string;
  note: string;
  active: boolean;
}

export interface ControlState {
  ready: boolean;
  currentAlias?: string | null;
  defaultAlias?: string | null;
  backupAlias?: string | null;
  currentModel?: string | null;
  liveModel?: string | null;
  configuredModel?: string | null;
  models: ControlModelProfile[];
}

export interface SwitchModelResponse {
  ok: boolean;
  alias?: string | null;
  model?: string | null;
  clientPromptPrefix: string;
  stdout?: string | null;
}

export interface ChatMessage {
  id: string;
  role: Exclude<MessageRole, "system">;
  content: string;
  meta?: string;
  includeInContext?: boolean;
  toolMode?: Exclude<AssistantToolMode, "auto">;
}

export interface ChatMessageInput {
  role: MessageRole;
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessageInput[];
  prompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  requestId?: string;
  toolMode?: AssistantToolMode;
  filePath?: string;
  currentDate?: string;
  conversationId?: number;
}

export interface ChatCompletionResponse {
  content: string;
  model: string;
  toolMode?: Exclude<AssistantToolMode, "auto"> | null;
  toolDetail?: string | null;
}

export interface ChatStreamEvent {
  requestId: string;
  delta?: string;
  model?: string;
  done: boolean;
}

export interface AssistantProgressEvent {
  requestId: string;
  stage: string;
  message: string;
  tone: "neutral" | "search" | "file" | "generation" | "success" | "warning" | "error";
  detail?: string | null;
}

export interface TtsStatus {
  available: boolean;
  backend: string;
  speaking: boolean;
  activeVoice?: string | null;
  activeOutputDevice?: string | null;
  configuredVoice: string;
  configuredOutputDevice: string;
  voices: TtsVoice[];
  outputDevices: AudioOutputDevice[];
  rate: number;
  volume: number;
  pitch: number;
}

export interface TtsVoice {
  id: string;
  name: string;
  language: string;
}

export interface AudioOutputDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface TtsStateEvent {
  state: "idle" | "speaking" | "error";
  speaking: boolean;
  voice?: string | null;
  outputDevice?: string | null;
  message: string;
  detail?: string | null;
}

export interface SpeakTextRequest {
  text: string;
  voiceId?: string;
  deviceId?: string;
  rate?: number;
  volume?: number;
  pitch?: number;
}

export type SettingsMap = Record<string, string>;

export interface PersistedMessage {
  id: number;
  conversationId: number;
  role: "user" | "assistant" | "system";
  content: string;
  meta?: string | null;
  toolMode?: string | null;
  includeInContext: boolean;
  createdAt: string;
}

export interface ConversationSummary {
  id: number;
  startedAt: string;
  title?: string | null;
  messageCount: number;
}

export async function getRuntimeConfig() {
  return invoke<RuntimeConfig>("get_runtime_config");
}

export async function getSettings() {
  return invoke<SettingsMap>("get_settings");
}

export async function saveSettings(values: SettingsMap) {
  return invoke<void>("save_settings", { values });
}

export async function createConversation() {
  return invoke<number>("create_conversation");
}

export async function appendMessage(
  conversationId: number,
  role: string,
  content: string,
  meta: string | null,
  toolMode: string | null,
  includeInContext: boolean,
) {
  return invoke<number>("append_message", {
    conversationId,
    role,
    content,
    meta,
    toolMode,
    includeInContext,
  });
}

export async function getConversation(conversationId: number) {
  return invoke<PersistedMessage[]>("get_conversation", { conversationId });
}

export async function listConversations() {
  return invoke<ConversationSummary[]>("list_conversations");
}

export async function summarizeConversation(conversationId: number) {
  return invoke<string>("summarize_conversation", { conversationId });
}

export async function checkBackend() {
  return invoke<BackendStatus>("check_backend");
}

export async function listModels() {
  return invoke<string[]>("list_models");
}

export async function getControlState() {
  return invoke<ControlState>("get_control_state");
}

export async function switchModel(alias: string) {
  return invoke<SwitchModelResponse>("switch_model", { alias });
}

export async function getTtsStatus() {
  return invoke<TtsStatus>("get_tts_status");
}

export async function speakText(request: SpeakTextRequest) {
  return invoke<void>("speak_text", { request });
}

export async function stopTts() {
  return invoke<boolean>("stop_tts");
}

export async function enqueueTts(request: SpeakTextRequest) {
  return invoke<void>("enqueue_tts", { request });
}

export async function chatCompletion(request: ChatCompletionRequest) {
  return invoke<ChatCompletionResponse>("chat_completion", { request });
}

export async function chatCompletionStream(request: ChatCompletionRequest) {
  return invoke<ChatCompletionResponse>("chat_completion_stream", { request });
}

export function formatInvokeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;

    if (typeof record.message === "string") {
      return record.message;
    }

    if (typeof record.error === "string") {
      return record.error;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown invoke error";
    }
  }

  return "Unknown invoke error";
}
