// components/MessageList.tsx
import React, { useMemo } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import type { AIChatMessage } from "../types/ai-chat";
import { MessageBubble } from "./MessageBubble";

interface MessageListProps {
  messages: AIChatMessage[];

  /**
   * Optional: called when user scrolls up to load older messages (future-proof).
   * With inverted FlatList, "end reached" corresponds to the top of the chat.
   */
  onLoadOlder?: () => void;

  /**
   * Optional: prevents repeated calls while loading older messages.
   */
  isLoadingOlder?: boolean;

  /**
   * Optional: extra padding at bottom if you have a composer overlaying the list.
   */
  bottomPadding?: number;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  onLoadOlder,
  isLoadingOlder,
  bottomPadding = 12,
}) => {
  // FlatList performs better if data reference changes only when needed
  const data = useMemo(() => messages, [messages]);

  return (
    <View style={styles.container}>
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MessageBubble message={item} />}
        inverted
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
        onEndReached={() => {
          if (!onLoadOlder) return;
          if (isLoadingOlder) return;
          onLoadOlder();
        }}
        onEndReachedThreshold={0.2}
        // Helps reduce re-renders
        removeClippedSubviews
        initialNumToRender={18}
        maxToRenderPerBatch={18}
        windowSize={10}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingTop: 12,
  },
});