import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AIChatIntent, AIChatMessage } from "@/types/ai-chat";

export type AIChatStage =
  | "idle"
  | "intake"
  | "clarify"
  | "reflect"
  | "confirm"
  | "gita_map"
  | "close";

const CHAT_LOCK_KEY = "ai_chat_last_completed_at";

// Testing tweak: short lock in dev, 24h in prod
const CHAT_LOCK_WINDOW_MS = __DEV__ ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000;

function makeId(prefix = "msg") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function now() {
  return Date.now();
}

function push(
  setMessages: React.Dispatch<React.SetStateAction<AIChatMessage[]>>,
  role: AIChatMessage["role"],
  intent: AIChatIntent,
  content: string
) {
  setMessages((prev) => [
    ...prev,
    {
      id: makeId(role === "user" ? "user" : role === "system" ? "sys" : "ai"),
      role,
      intent,
      content,
      createdAt: now(),
    },
  ]);
}

export function useAIChatController() {
  const [stage, setStage] = useState<AIChatStage>("idle");
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [locked, setLocked] = useState(false);

  const [clarifyTurns, setClarifyTurns] = useState(0);
  const [intakeText, setIntakeText] = useState<string>("");
  const [clarifyAnswer1, setClarifyAnswer1] = useState<string>("");
  const [reflectionText, setReflectionText] = useState<string | null>(null);

  // Boot: lock check + seed messages
  useEffect(() => {
    (async () => {
      const last = await AsyncStorage.getItem(CHAT_LOCK_KEY);
      if (last) {
        const elapsed = now() - Number(last);
        if (elapsed < CHAT_LOCK_WINDOW_MS) {
          setLocked(true);
          setStage("close");
          if (messages.length === 0) {
            push(
              setMessages,
              "system",
              "close",
              "Session complete for now. You can return after the settling window."
            );
          }
          return;
        }
      }

      setLocked(false);
      setStage("intake");

      if (messages.length === 0) {
        push(
          setMessages,
          "system",
          "intake",
          "This is a guided reflection. Share only what feels safe to share."
        );
        push(
          setMessages,
          "assistant",
          "intake",
          "Whenever you are ready, describe the nagging thought or inner disturbance that keeps returning."
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendUserMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || locked) return;

      const effectiveStage: AIChatStage = stage === "idle" ? "intake" : stage;

      if (!intakeText && effectiveStage === "intake") {
        setIntakeText(trimmed);
      }

      push(setMessages, "user", effectiveStage as AIChatIntent, trimmed);

      if (effectiveStage === "intake") {
        setClarifyTurns(0);
        setStage("clarify");
        push(
          setMessages,
          "assistant",
          "clarify",
          "Thank you. To understand better, what emotion feels strongest right now—fear, anger, sadness, guilt, or confusion?"
        );
        return;
      }

      if (effectiveStage === "clarify") {
        const next = clarifyTurns + 1;
        setClarifyTurns(next);

        if (next === 1) {
          setClarifyAnswer1(trimmed);
          push(
            setMessages,
            "assistant",
            "clarify",
            "Thank you. When does this feeling intensify most—during a specific time of day, place, or interaction?"
          );
          return;
        }

        const firstUser = intakeText || "";
        const clarifyAnswer2 = trimmed;

        const reflection =
          `Here is what I understood so far:\n\n` +
          `• The recurring concern: ${firstUser}\n` +
          `• The feeling you named: ${clarifyAnswer1}\n` +
          `• The situation tends to intensify around: ${clarifyAnswer2}\n\n` +
          `At the heart of this, there appears to be an inner tension you are trying to carry with clarity.`;

        setReflectionText(reflection);
        setStage("confirm");
        push(setMessages, "assistant", "reflect", reflection);
        return;
      }
    },
    [clarifyTurns, intakeText, locked, stage, clarifyAnswer1]
  );

  const editReflection = useCallback(() => {
    if (locked) return;
    setReflectionText(null);
    setClarifyTurns(0);
    setClarifyAnswer1("");
    setStage("clarify");
    push(
      setMessages,
      "assistant",
      "clarify",
      "My apologies. Let's try again. What emotion feels strongest right now—fear, anger, sadness, guilt, or confusion?"
    );
  }, [locked]);

  const closeSession = useCallback(async () => {
    await AsyncStorage.setItem(CHAT_LOCK_KEY, now().toString());
    setLocked(true);
    setStage("close");
    push(
      setMessages,
      "system",
      "close",
      "Session complete for now. You can return after the settling window."
    );
  }, []);

  const confirmReflection = useCallback(() => {
    if (locked) return;
    if (!reflectionText) return;

    setStage("gita_map");
    push(
      setMessages,
      "assistant",
      "gita_map",
      "In the Bhagavad Gita, Arjuna also faced an inner turbulence when clarity felt distant and the mind replayed the weight of consequences. Krishna does not offer quick fixes; he points to steadiness of understanding and the discipline of seeing one’s duty without being consumed by fear of outcomes.\n\nSuggested study (read slowly, not as a solution but as a mirror):\n• 2.47 — focus on action, not the fruits\n• 2.48 — equanimity in success and failure\n• 6.5 — lift yourself with your own mind\n\nIf this reflection truly represents you, save it and sit with it quietly for a few minutes."
    );

    void closeSession();
  }, [closeSession, locked, reflectionText]);

  return {
    stage,
    messages,
    locked,
    sendUserMessage,
    confirmReflection,
    editReflection,
  };
}