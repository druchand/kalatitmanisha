// types/ai-chat.ts
export type AIChatRole = "system" | "assistant" | "user";

export type AIChatIntent =
  | "intake"
  | "safety"
  | "clarify"
  | "reflect"
  | "confirm"
  | "gita_map"
  | "close"
  | "other";

export type AIChatMessageStatus = "pending" | "sent" | "error";

export type AIChatMessage = {
  id: string;
  role: AIChatRole;
  intent?: AIChatIntent;
  content: string;
  createdAt: number;
  status?: AIChatMessageStatus;
};