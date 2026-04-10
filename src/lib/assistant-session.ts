import type { AssistantToolMode, ChatCompletionRequest, ChatMessage } from "@/lib/assistant";
import {
  applyClientPromptPrefix,
  formatCurrentDateContext,
  normalizeConversation,
} from "@/lib/conversation-context";
import { buildTrustedContext } from "@/lib/tool-routing";

interface BuildChatCompletionRequestOptions {
  prompt: string;
  messages: ChatMessage[];
  userMessage: ChatMessage;
  systemPrompt: string;
  clientPromptPrefix?: string;
  requestId: string;
  toolMode: AssistantToolMode;
  filePath?: string;
  conversationId?: number;
  maxTokens?: number;
  temperature?: number;
}

export function buildChatCompletionRequest(
  options: BuildChatCompletionRequestOptions,
): ChatCompletionRequest {
  const currentDate = formatCurrentDateContext();
  const normalizedRecentMessages = normalizeConversation([...options.messages, options.userMessage]);
  const requestMessages = applyClientPromptPrefix(
    normalizedRecentMessages,
    options.clientPromptPrefix || "",
  );

  return {
    prompt: options.prompt,
    maxTokens: options.maxTokens ?? 192,
    temperature: options.temperature ?? 0.35,
    systemPrompt: options.systemPrompt,
    currentDate,
    trustedContext: buildTrustedContext({
      prompt: options.prompt,
      currentDate,
      toolMode: options.toolMode,
    }),
    requestId: options.requestId,
    toolMode: options.toolMode,
    filePath: options.filePath?.trim() || undefined,
    messages: requestMessages,
    conversationId: options.conversationId,
  };
}
