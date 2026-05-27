// components/AIChatComposer.tsx
import React, { useMemo, useState } from "react";
import {
  View,
  TextInput,
  Pressable,
  Text,
  StyleSheet,
  Platform,
} from "react-native";

interface AIChatComposerProps {
  /**
   * Called when the user taps Send with non-empty text.
   */
  onSend: (text: string) => void | Promise<void>;

  /**
   * Optional placeholder text.
   */
  placeholder?: string;

  /**
   * Optional: disables the composer (e.g., while AI is responding).
   */
  disabled?: boolean;

  /**
   * Optional: max characters allowed in composer.
   */
  maxChars?: number;
}

export const AIChatComposer: React.FC<AIChatComposerProps> = ({
  onSend,
  placeholder = "Write here…",
  disabled = false,
  maxChars = 1200,
}) => {
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);

  const trimmed = useMemo(() => text.trim(), [text]);
  const canSend = !disabled && !isSending && trimmed.length > 0;

  async function handleSend() {
    if (!canSend) return;

    const payload = trimmed;
    setIsSending(true);
    try {
      // Clear input immediately for a calm, responsive feel.
      setText("");
      await onSend(payload);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <View style={[styles.container, disabled && styles.containerDisabled]}>
      <View style={styles.inputWrap}>
        <TextInput
          value={text}
          onChangeText={(v) => setText(v.slice(0, maxChars))}
          placeholder={placeholder}
          editable={!disabled && !isSending}
          multiline
          style={styles.input}
          textAlignVertical="top"
          returnKeyType="send"
          blurOnSubmit={Platform.OS === "web"}
          onSubmitEditing={() => {
            // On mobile, multiline TextInput doesn't reliably submit;
            // Send button is the canonical action.
          }}
        />
        <Text style={styles.counter}>
          {text.length}/{maxChars}
        </Text>
      </View>

      <Pressable
        onPress={handleSend}
        disabled={!canSend}
        style={({ pressed }) => [
          styles.sendButton,
          !canSend && styles.sendButtonDisabled,
          pressed && canSend && styles.sendButtonPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Send message"
      >
        <Text style={styles.sendButtonText}>{isSending ? "…" : "Send"}</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#DDD",
    backgroundColor: "#FFF",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
  },
  containerDisabled: {
    opacity: 0.8,
  },
  inputWrap: {
    flex: 1,
  },
  input: {
    minHeight: 44,
    maxHeight: 120,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#DDD",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 22,
    color: "#222",
    backgroundColor: "#FFF",
  },
  counter: {
    marginTop: 6,
    fontSize: 11,
    color: "#777",
    alignSelf: "flex-end",
  },
  sendButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#222",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 64,
  },
  sendButtonDisabled: {
    backgroundColor: "#999",
  },
  sendButtonPressed: {
    opacity: 0.85,
  },
  sendButtonText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "600",
  },
});