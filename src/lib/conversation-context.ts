import type { ChatMessage } from "@/lib/assistant";

export type PromptContextMessage = {
  role: ChatMessage["role"];
  content: string;
};

export function normalizeConversation(messages: ChatMessage[]) {
  const contextualMessages = messages.filter((message) => message.includeInContext !== false);
  const normalized: PromptContextMessage[] = [];

  for (const message of contextualMessages) {
    if (!normalized.length) {
      if (message.role !== "user") {
        continue;
      }

      normalized.push({
        role: message.role,
        content: message.content,
      });
      continue;
    }

    const lastMessage = normalized[normalized.length - 1];

    if (lastMessage.role === message.role) {
      normalized[normalized.length - 1] = {
        role: message.role,
        content: message.content,
      };
      continue;
    }

    normalized.push({
      role: message.role,
      content: message.content,
    });
  }

  const recentMessages = normalized.slice(-8);

  while (recentMessages[0]?.role === "assistant") {
    recentMessages.shift();
  }

  return recentMessages;
}

export function applyClientPromptPrefix(
  messages: PromptContextMessage[],
  clientPromptPrefix: string,
) {
  if (!clientPromptPrefix.trim()) {
    return messages;
  }

  const firstUserIndex = messages.findIndex((message) => message.role === "user");

  if (firstUserIndex === -1) {
    return messages;
  }

  return messages.map((message, index) => {
    if (index !== firstUserIndex || message.role !== "user") {
      return message;
    }

    if (message.content.startsWith(clientPromptPrefix)) {
      return message;
    }

    return {
      ...message,
      content: `${clientPromptPrefix}${message.content}`,
    };
  });
}

export function formatCurrentDateContext(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}
