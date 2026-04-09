import { invoke } from "@tauri-apps/api/core";

export type MessageRole = "system" | "user" | "assistant";

export interface RuntimeConfig {
  llmBaseUrl: string;
  llmModelsEndpoint: string;
  llmChatEndpoint: string;
  llmModel: string;
  llmTimeoutMs: number;
  assistantSystemPrompt: string;
}

export interface BackendStatus {
  ok: boolean;
  modelCount: number;
  latencyMs: number;
  endpoint: string;
}

export interface ChatMessage {
  id: string;
  role: Exclude<MessageRole, "system">;
  content: string;
  meta?: string;
}

export interface ChatMessageInput {
  role: MessageRole;
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessageInput[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface ChatCompletionResponse {
  content: string;
  model: string;
}

export async function getRuntimeConfig() {
  return invoke<RuntimeConfig>("get_runtime_config");
}

export async function checkBackend() {
  return invoke<BackendStatus>("check_backend");
}

export async function listModels() {
  return invoke<string[]>("list_models");
}

export async function chatCompletion(request: ChatCompletionRequest) {
  return invoke<ChatCompletionResponse>("chat_completion", { request });
}
