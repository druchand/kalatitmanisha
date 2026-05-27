// app/components/MessageBubble.tsx
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { AIChatMessage } from "../types/ai-chat";

interface MessageBubbleProps {
  message: AIChatMessage;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const { role, intent, content } = message;

  return (
    <View
      style={[
        styles.container,
        role === "user" && styles.userContainer,
        role === "assistant" && styles.aiContainer,
        role === "system" && styles.systemContainer,
      ]}
    >
      <View
        style={[
          styles.bubble,
          role === "user" && styles.userBubble,
          role === "assistant" && styles.aiBubble,
          role === "system" && styles.systemBubble,
        ]}
      >
        <Text
          style={[
            styles.text,
            intent === "reflect" && styles.reflectionText,
            intent === "gita_map" && styles.gitaText,
            intent === "safety" && styles.safetyText,
          ]}
        >
          {content}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: "100%",
    marginVertical: 6,
    paddingHorizontal: 12,
  },

  userContainer: { alignItems: "flex-end" },
  aiContainer: { alignItems: "flex-start" },
  systemContainer: { alignItems: "center" },

  bubble: {
    maxWidth: "85%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },

  userBubble: { backgroundColor: "#DCF8C6" },
  aiBubble: { backgroundColor: "#F2F2F2" },
  systemBubble: { backgroundColor: "#EAEAEA" },

  text: { fontSize: 15, lineHeight: 22, color: "#222" },

  reflectionText: { fontStyle: "italic" },
  gitaText: { fontWeight: "500" },
  safetyText: { fontWeight: "600" },
});