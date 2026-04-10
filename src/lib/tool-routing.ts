import type { AssistantToolMode } from "@/lib/assistant";

const currentSensitiveTriggers = [
  "latest",
  "current",
  "today",
  "news",
  "weather",
  "forecast",
  "price",
  "stock",
  "score",
  "release",
  "version",
  "look up",
  "search",
  "recent",
  "what day",
  "what date",
  "what's the date",
  "what is the date",
  "which day",
  "what time",
  "what year",
  "what month",
];

const pureDatePatterns = [
  "what day",
  "what date",
  "what's the date",
  "what is the date",
  "which day",
  "what time is it",
  "what year is it",
  "what month is it",
  "today's date",
  "todays date",
  "current date",
  "current time",
];

export function isCurrentSensitivePrompt(prompt: string) {
  const normalized = prompt.toLowerCase();
  return currentSensitiveTriggers.some((trigger) => normalized.includes(trigger));
}

export function isPureDateTimePrompt(prompt: string) {
  const normalized = prompt.toLowerCase();
  return pureDatePatterns.some((pattern) => normalized.includes(pattern));
}

export function buildTrustedContext(options: {
  prompt: string;
  currentDate: string;
  toolMode: AssistantToolMode;
}) {
  const { prompt, currentDate, toolMode } = options;

  if (!currentDate.trim()) {
    return undefined;
  }

  if (isPureDateTimePrompt(prompt)) {
    return `Current local date/time from the user's device (authoritative): ${currentDate}. Use this directly for date and time answers instead of model memory.`;
  }

  if (toolMode === "web" || isCurrentSensitivePrompt(prompt)) {
    return `Current local date/time from the user's device (authoritative): ${currentDate}. Treat this as trusted live context if the request depends on current facts.`;
  }

  return undefined;
}
