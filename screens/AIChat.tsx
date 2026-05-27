// screens/AIChat.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Clipboard,
  FlatList,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useLocalSearchParams } from "expo-router";
import { useAuth } from "../auth/AuthModalContext";
import { AUTH_BASE } from "../auth/utils/authApi";
import { getSessionToken } from "../auth/utils/storage";
import AppIcon from "../components/AppIcon";
import PageBottomMeta from "../components/layout/PageBottomMeta";
import { useLanguage } from "../context/LanguageContext";
import { useLocation } from "../context/LocationContext";

const CHAT_FUNCTIONS_BASE_URL = AUTH_BASE;
const CHAT_ENDPOINT = `${CHAT_FUNCTIONS_BASE_URL}/chat`;
const GUEST_CHAT_SESSION_KEY = "guest_ai_chat_session_id";

const createGuestChatSessionId = () =>
  `guest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

export default function AIChat() {
  // Route params are optional; use them if your app passes these in.
  // Example: navigate to this screen with params: firstName, city, lang, sessionId
  const params = useLocalSearchParams<{
    sessionId?: string;
    firstName?: string;
    city?: string;
    lang?: string;
  }>();

  const auth = useAuth();
  const location = useLocation();
  const { lang: contextLang, langName: contextLangName, availableLangs } = useLanguage();

  type ChatRole = "user" | "assistant" | "system";
  type ChatMessage = { id: string; role: ChatRole; content: string };

  // Session + user context (fallbacks are safe defaults)
  const [storageSessionId, setStorageSessionId] = useState("");
  const [guestSessionId, setGuestSessionId] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = (await getSessionToken()) || "";
        if (!alive) return;
        setStorageSessionId(String(token).trim());
      } catch {
        if (!alive) return;
        setStorageSessionId("");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const existing = String((await AsyncStorage.getItem(GUEST_CHAT_SESSION_KEY)) || "").trim();
        if (!alive) return;
        if (existing) {
          setGuestSessionId(existing);
          return;
        }
        const next = createGuestChatSessionId();
        await AsyncStorage.setItem(GUEST_CHAT_SESSION_KEY, next);
        if (!alive) return;
        setGuestSessionId(next);
      } catch {
        if (!alive) return;
        setGuestSessionId(createGuestChatSessionId());
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const sessionId = useMemo(() => {
    const fromParams = typeof params.sessionId === "string" ? params.sessionId.trim() : "";
    if (fromParams) return fromParams;
    const fromAuth = auth.sessionId?.trim() || "";
    if (fromAuth) return fromAuth;
    const fromStorage = storageSessionId.trim();
    if (fromStorage) return fromStorage;
    return guestSessionId.trim();
  }, [params.sessionId, auth.sessionId, storageSessionId, guestSessionId]);

  const isGuestChat = useMemo(() => {
    const fromAuth = auth.sessionId?.trim() || "";
    const fromStorage = storageSessionId.trim();
    return !fromAuth && !fromStorage && sessionId.startsWith("guest_");
  }, [auth.sessionId, sessionId, storageSessionId]);

  const firstName = useMemo(() => {
    const fromParams = typeof params.firstName === "string" ? params.firstName.trim() : "";
    if (fromParams) return fromParams;
    const fromUser = auth.user?.firstName ?? auth.user?.name ?? auth.user?.nickname ?? "";
    return typeof fromUser === "string" ? fromUser.trim() : "";
  }, [params.firstName, auth.user?.firstName, auth.user?.name, auth.user?.nickname]);

  const locationCity = useMemo(() => {
    if (!location.place) return "";
    const [firstSegment] = location.place.split(",");
    return firstSegment?.trim() ?? "";
  }, [location.place]);

  const city = useMemo(() => {
    const fromParams = typeof params.city === "string" ? params.city.trim() : "";
    if (fromParams) return fromParams;
    return locationCity;
  }, [params.city, locationCity]);

  const userAddressCity = useMemo(() => {
    const addresses = auth.user?.addresses ?? [];
    if (!addresses.length) return "";
    const firstAddress = addresses[0] ?? {};
    if (typeof firstAddress?.city === "string" && firstAddress.city.trim()) {
      return firstAddress.city.trim();
    }
    return "";
  }, [auth.user?.addresses]);

  const cityForPayload = useMemo(
    () => city || locationCity || userAddressCity || "Unknown",
    [city, locationCity, userAddressCity]
  );

  const lang = useMemo(() => {
    const fromParams = typeof params.lang === "string" ? params.lang.trim() : "";
    return fromParams || contextLang;
  }, [params.lang, contextLang]);

  const languageName = useMemo(() => {
    const fromParams = typeof params.lang === "string" ? params.lang.trim() : "";
    if (fromParams) {
      const normalizedCode = fromParams.toUpperCase();
      const matched = availableLangs.find((option) => option.code === normalizedCode);
      if (matched?.displayName) return matched.displayName;
      if (matched?.englishName) return matched.englishName;
      if (matched?.name) return matched.name;
      return fromParams;
    }
    return contextLangName;
  }, [params.lang, availableLangs, contextLangName]);

  const localTime = useMemo(() => {
    // Backend expects a string; ISO is reliable
    return new Date().toISOString();
  }, []);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(true);
  const [isUserNearBottom, setIsUserNearBottom] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const [layoutHeight, setLayoutHeight] = useState(0);

  const didBootRef = useRef(false);

  const listRef = useRef<FlatList<ChatMessage> | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canSend = useMemo(() => text.trim().length > 0 && !loading, [text, loading]);

  function scrollToBottomSoon(latestContentHeight?: number, latestLayoutHeight?: number) {
    setTimeout(() => {
      const finalContentHeight = latestContentHeight ?? contentHeight;
      const finalLayoutHeight = latestLayoutHeight ?? layoutHeight;
      if (finalContentHeight > 0 && finalLayoutHeight > 0) {
        const targetOffset = Math.max(finalContentHeight - finalLayoutHeight, 0);
        const extraPad = Math.min(160, finalLayoutHeight / 2);
        listRef.current?.scrollToOffset({
          offset: Math.max(targetOffset - extraPad, 0),
          animated: true,
        });
      } else {
        listRef.current?.scrollToEnd({ animated: true });
      }
    }, 50);
  }

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    const distanceFromBottom =
      contentSize.height - (layoutMeasurement.height + contentOffset.y);
    const near = distanceFromBottom <= 120;
    setIsUserNearBottom(near);
    setShowScrollToBottom(!near);
  }

  function handleContentSizeChange(_: number, height: number) {
    setContentHeight(height);
  }

  function handleListLayout(event: LayoutChangeEvent) {
    setLayoutHeight(event.nativeEvent.layout.height);
  }

  async function postChat(payload: {
    sessionId: string;
    message: string;
    firstName: string;
    city: string;
    localTime: string;
    lang: string;
    guest?: boolean;
  }) {
    // Wix HTTP functions live under /_functions (or /_functions-dev)
    const urlObj = new URL(CHAT_ENDPOINT);
    if (payload.sessionId) {
      urlObj.searchParams.set("sessionId", payload.sessionId);
      urlObj.searchParams.set("session", payload.sessionId);
    }
    const url = urlObj.toString();

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(payload.sessionId
          ? {
              "x-session-id": payload.sessionId,
              "x-session": payload.sessionId,
              ...(payload.guest ? { "x-guest-session-id": payload.sessionId } : {}),
            }
          : {}),
      },
      body: JSON.stringify(payload),
    });

    // Read text first so we can debug non-JSON responses (HTML, empty body, etc.)
    const rawText = await res.text();

    let data: any = rawText;
    if (rawText) {
      try {
        data = JSON.parse(rawText);
      } catch {
        data = rawText;
      }
    }

    if (__DEV__) {
      console.log("[postChat] url:", url);
      console.log("[postChat] status:", res.status);
      console.log("[postChat] payload:", payload);
      console.log(
        "[postChat] raw response (first 400 chars):",
        rawText ? rawText.slice(0, 400) : "(empty)"
      );
    }

    if (!res.ok) {
      const msg =
        (data && (data.error || data.message)) ||
        (rawText && rawText.trim() ? rawText.slice(0, 160) : "") ||
        `Request failed (${res.status})`;
      const normalizedMsg = String(msg || "").toLowerCase();
      if (
        normalizedMsg.includes("missing object") ||
        normalizedMsg.includes("invalid payload") ||
        normalizedMsg.includes("serversessioncache")
      ) {
        throw new Error(
          payload.guest
            ? "Could not start guest chat. Please try again."
            : "Session expired. Please sign in again."
        );
      }
      throw new Error(msg);
    }

    if (typeof rawText !== "string" || !rawText.trim()) {
      throw new Error(
        "Server returned an empty response. Check the chat endpoint (https://kalatitmanisha.com/_functions/chat) and the function implementation."
      );
    }

    return data;
  }

  function extractReplyText(data: any): string {
    if (!data) return "";

    if (typeof data === "string") return data.trim();

    if (typeof data.reply === "string") return data.reply.trim();

    if (data.body && typeof data.body.reply === "string") {
      return data.body.reply.trim();
    }

    return "";
  }

  useEffect(() => {
    if (!sessionId) return;
    // Gate the welcome call until we have the identity + locale signals.
    // For now we treat having firstName + city as a proxy for signed-in readiness.
    const ready = !!sessionId && !!languageName;
    if (!ready) return;
    if (didBootRef.current) return;

    didBootRef.current = true;
    setError(null);

    (async () => {
      setLoading(true);
      try {
        const data = await postChat({
          sessionId,
          message: "", // boot: ask backend to return welcome
          firstName: firstName || "Friend",
          city: cityForPayload,
          localTime,
          lang: languageName,
          guest: isGuestChat,
        });

        if (__DEV__) {
          console.log("[AIChat boot] post_chat response:", data);
        }

        const replyText = extractReplyText(data);

        // Only append if we got something meaningful
        if (replyText && replyText.trim()) {
          const assistantMsg: ChatMessage = {
            id: `a_boot_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            role: "assistant",
            content: replyText,
          };
          setMessages((prev) => (prev.length ? prev : [assistantMsg]));
          maybeScrollToBottom();
        } else {
          // In dev, surface the raw shape to help prompt/contract tuning
          const debug = __DEV__ ? `\n\n(raw) ${JSON.stringify(data)}` : "";
          const assistantMsg: ChatMessage = {
            id: `a_boot_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            role: "assistant",
            content: `Welcome message not received.${debug}`,
          };
          setMessages((prev) => (prev.length ? prev : [assistantMsg]));
          maybeScrollToBottom();
        }
      } catch (e: any) {
        const msg = typeof e?.message === "string" ? e.message : "Something went wrong";
        setError(msg);
        const assistantMsg: ChatMessage = {
          id: `a_booterr_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          role: "assistant",
          content: `Sorry — I couldn't start the session. ${msg}`,
        };
        setMessages((prev) => (prev.length ? prev : [assistantMsg]));
        maybeScrollToBottom();
        // allow retry by navigating away/back
        didBootRef.current = false;
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId, languageName, firstName, cityForPayload, localTime]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = null;
      }
    };
  }, []);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || loading || !sessionId) return;

    setText("");
    setError(null);

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      role: "user",
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMsg]);
    maybeScrollToBottom();

    setLoading(true);
    try {
      const data = await postChat({
        sessionId,
        message: trimmed,
        firstName: firstName || "Friend",
        city: cityForPayload,
        localTime,
        lang: languageName,
        guest: isGuestChat,
      });

      if (__DEV__) {
        console.log("[AIChat send] post_chat response:", data);
      }

      const replyText = extractReplyText(data);

      const assistantMsg: ChatMessage = {
        id: `a_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        role: "assistant",
        content: replyText || "(No response text received — check server response shape in console)",
      };

        setMessages((prev) => [...prev, assistantMsg]);
        maybeScrollToBottom();
    } catch (e: any) {
      const msg = typeof e?.message === "string" ? e.message : "Something went wrong";
      setError(msg);

      const assistantMsg: ChatMessage = {
        id: `aerr_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        role: "assistant",
        content: `Sorry — I couldn't reach the server. ${msg}`,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      maybeScrollToBottom();
    } finally {
      setLoading(false);
    }
  }

  function markCopied(messageId: string) {
    setCopiedMessageId(messageId);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => {
      setCopiedMessageId((prev) => (prev === messageId ? null : prev));
    }, 1800);
  }

  async function handleCopyText(messageId: string, text: string) {
    if (!text) return;

    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined") {
        const webNavigator = navigator as Navigator & {
          clipboard?: { writeText: (value: string) => Promise<void> };
        };
        if (webNavigator.clipboard?.writeText) {
          await webNavigator.clipboard.writeText(text);
          markCopied(messageId);
          return;
        }
      }
      Clipboard.setString(text);
      markCopied(messageId);
    } catch (err) {
      if (__DEV__) {
        console.debug("[AIChat] copy failed", err);
      }
    }
  }

  async function handleShareText(text: string) {
    if (!text) return;
    try {
      await Share.share({ message: text });
    } catch (err) {
      if (__DEV__) {
        console.debug("[AIChat] share failed", err);
      }
    }
  }

  function maybeScrollToBottom(force = false) {
    if (force || isUserNearBottom) {
      scrollToBottomSoon();
    }
  }

  function handleScrollToEnd() {
    scrollToBottomSoon();
    setIsUserNearBottom(true);
    setShowScrollToBottom(false);
  }

  function buildMessageRender(message: ChatMessage) {
    const raw = String(message.content ?? "");
    const trimmed = raw.trim();
    const nodes = trimmed ? parseHtmlNodes(trimmed) : [];
    const plainText = trimmed
      ? nodes.length
        ? htmlNodesToPlainText(nodes).trim() || trimmed
        : trimmed
      : "";

    const textContent = nodes.length ? (
      <Text style={styles.bubbleText}>
        {nodes.map((node, index) => renderHtmlNode(node, `${message.id}-${index}`))}
      </Text>
    ) : (
      <Text style={styles.bubbleText}>{trimmed || ""}</Text>
    );

    return { textContent, plainText, trimmed };
  }

  return (
    <View style={styles.screenRoot}>
      <KeyboardAvoidingView
        style={styles.container}
      behavior={Platform.select({ ios: "padding", android: undefined })}
      keyboardVerticalOffset={Platform.select({ ios: 80, android: 0 })}
    >
      <View style={styles.header}>
        <Text style={styles.title}>AI Chat</Text>
        <Text style={styles.subTitle}>
          {loading
            ? "Thinking…"
            : error
            ? `Error: ${error}`
            : isGuestChat
            ? `Guest chat • Lang: ${lang}`
            : `Lang: ${lang} • Session: ${sessionId.slice(0, 8)}…`}
        </Text>
      </View>

      <FlatList
        ref={(r) => {
          listRef.current = r;
        }}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onLayout={handleListLayout}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onContentSizeChange={handleContentSizeChange}
        ListFooterComponent={
          <View style={{ marginTop: 10 }}>
            <PageBottomMeta />
          </View>
        }
        renderItem={({ item }) => {
          const { textContent, plainText, trimmed } = buildMessageRender(item);
          return (
            <View style={styles.messageWrapper}>
              <View
                style={[
                  styles.bubble,
                  item.role === "user" ? styles.bubbleUser : styles.bubbleAssistant,
                ]}
              >
                <Text style={styles.bubbleRole}>
                  {item.role === "user" ? "You" : item.role === "assistant" ? "Guide" : "System"}
                </Text>
                {textContent}
              </View>
              <View style={styles.bubbleActionsRow}>
                <Pressable
                  onPress={() => handleCopyText(item.id, plainText)}
                  style={({ pressed }) => [
                    styles.actionButton,
                    pressed && styles.actionButtonPressed,
                  ]}
                >
                  <AppIcon family="feather" name="copy" size={16} color="#0f172a" />
                </Pressable>
                <Pressable
                  onPress={() => handleShareText(plainText || trimmed)}
                  style={({ pressed }) => [
                    styles.actionButton,
                    pressed && styles.actionButtonPressed,
                  ]}
                >
                  <AppIcon family="feather" name="share-2" size={16} color="#0f172a" />
                </Pressable>
                {copiedMessageId === item.id && (
                  <Text style={styles.actionStatus}>Copied</Text>
                )}
              </View>
            </View>
          );
        }}
      />

      <View style={styles.composer}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={loading ? "Please wait…" : "Type here…"}
          placeholderTextColor="rgba(15,23,42,0.45)"
          style={styles.input}
          multiline
          editable={!loading}
        />
        <Pressable
          onPress={handleSend}
          disabled={!canSend}
          style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
        >
          <Text style={styles.sendBtnText}>{loading ? "…" : "Send"}</Text>
        </Pressable>
      </View>
      {showScrollToBottom && (
        <Pressable style={styles.scrollButton} onPress={handleScrollToEnd}>
          <AppIcon family="feather" name="chevron-down" size={20} color="#0f172a" />
        </Pressable>
      )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  screenRoot: { flex: 1 },
  header: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8 },
  title: { color: "#0f172a", fontSize: 18, fontWeight: "700" },
  subTitle: { color: "rgba(15,23,42,0.65)", marginTop: 4 },

  listContent: { paddingHorizontal: 14, paddingBottom: 180, gap: 10 },

  bubble: {
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    maxWidth: "90%",
  },
  bubbleUser: { alignSelf: "flex-end", backgroundColor: "rgba(34,197,94,0.22)" },
  bubbleAssistant: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(15,23,42,0.06)",
  },

  bubbleRole: { color: "rgba(15,23,42,0.6)", fontSize: 12, marginBottom: 4 },
  bubbleText: { color: "#0f172a", fontSize: 15, lineHeight: 20 },
  messageWrapper: { marginBottom: 10 },
  bubbleActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    alignSelf: "center",
    gap: 26,
  },
  actionButton: {
    padding: 6,
    borderRadius: 999,
    backgroundColor: "rgba(15,23,42,0.06)",
  },
  actionButtonPressed: { opacity: 0.65 },
  actionStatus: { color: "rgba(15,23,42,0.6)", fontSize: 12, marginLeft: 6 },
  htmlInlineText: { color: "#0f172a", fontSize: 15, lineHeight: 20 },
  htmlBold: { fontWeight: "700" },
  htmlItalic: { fontStyle: "italic" },
  htmlUnderline: { textDecorationLine: "underline" },
  htmlParagraph: { marginTop: 6, marginBottom: 6 },
  htmlListItem: { marginBottom: 4 },
  htmlBlock: { marginBottom: 4 },

  scrollButton: {
    position: "absolute",
    alignSelf: "center",
    bottom: 96,
    backgroundColor: "rgba(15,23,42,0.12)",
    borderRadius: 999,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 6,
  },

  composer: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    
    paddingBottom: 28,
    marginBottom: 72,

    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(15,23,42,0.14)",
    alignItems: "flex-end",
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "rgba(15,23,42,0.05)",
    color: "#0f172a",
  },
  sendBtn: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "rgba(34,197,94,0.75)",
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: "#0f172a", fontWeight: "800" },
});

type HtmlNode = TextNode | ElementNode;
interface TextNode {
  type: "text";
  text: string;
}
interface ElementNode {
  type: "element";
  tag: string;
  children: HtmlNode[];
}

const ALLOWED_HTML_TAGS = new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "br",
  "p",
  "ul",
  "ol",
  "li",
]);
const SKIP_BODY_TAGS = new Set(["script", "style"]);

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|\w+);/gi, (match, encoded) => {
    if (!encoded) return match;

    if (encoded[0] === "#") {
      const isHex = encoded[1] === "x" || encoded[1] === "X";
      const num = parseInt(encoded.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (!Number.isNaN(num)) return String.fromCodePoint(num);
      return match;
    }

    const normalized = encoded.toLowerCase();
    return HTML_ENTITY_MAP[normalized] ?? match;
  });
}

function htmlNodesToPlainText(nodes: HtmlNode[]): string {
  return nodes.map(nodeToPlainText).join("");
}

function nodeToPlainText(node: HtmlNode): string {
  if (node.type === "text") return node.text;
  const inner = node.children.map(nodeToPlainText).join("");
  switch (node.tag) {
    case "br":
      return "\n";
    case "p":
      return inner + "\n\n";
    case "li":
      return `• ${inner}\n`;
    default:
      return inner;
  }
}

function parseHtmlNodes(value: string): HtmlNode[] {
  const root: ElementNode = { type: "element", tag: "root", children: [] };
  const stack: ElementNode[] = [root];
  const normalized = value.replace(/\r\n?/g, "\n");
  const length = normalized.length;
  let pos = 0;
  let skipTag: string | null = null;

  const appendTextNode = (parent: ElementNode, text: string) => {
    if (!text) return;
    const decoded = decodeHtmlEntities(text);
    if (!decoded) return;
    const last = parent.children[parent.children.length - 1];
    if (last && last.type === "text") {
      last.text += decoded;
      return;
    }
    parent.children.push({ type: "text", text: decoded });
  };

  while (pos < length) {
    if (skipTag) {
      const closingSequence = `</${skipTag}`;
      const closingIndex = normalized.indexOf(closingSequence, pos);
      if (closingIndex === -1) break;
      const closingEnd = normalized.indexOf(">", closingIndex);
      if (closingEnd === -1) {
        pos = length;
        break;
      }
      pos = closingEnd + 1;
      skipTag = null;
      continue;
    }

    const nextTag = normalized.indexOf("<", pos);
    if (nextTag === -1) {
      appendTextNode(stack[stack.length - 1], normalized.slice(pos));
      break;
    }

    if (nextTag > pos) {
      appendTextNode(stack[stack.length - 1], normalized.slice(pos, nextTag));
    }

    const closingBracket = normalized.indexOf(">", nextTag);
    if (closingBracket === -1) {
      appendTextNode(stack[stack.length - 1], normalized.slice(nextTag));
      break;
    }

    const tagContent = normalized.slice(nextTag + 1, closingBracket).trim();
    const tagMatch = tagContent.match(/^\/?\s*([a-zA-Z0-9]+)/);
    const tagName = tagMatch ? tagMatch[1].toLowerCase() : "";
    const isClosing = tagContent.startsWith("/");
    const isSelfClosing = tagContent.endsWith("/") || tagName === "br";

    if (!tagName) {
      pos = closingBracket + 1;
      continue;
    }

    if (!ALLOWED_HTML_TAGS.has(tagName)) {
      if (SKIP_BODY_TAGS.has(tagName) && !isClosing) {
        skipTag = tagName;
      }
      pos = closingBracket + 1;
      continue;
    }

    if (isClosing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tagName) {
          stack.length = i;
          break;
        }
      }
      pos = closingBracket + 1;
      continue;
    }

    if (tagName === "br") {
      appendTextNode(stack[stack.length - 1], "\n");
      pos = closingBracket + 1;
      continue;
    }

    const element: ElementNode = { type: "element", tag: tagName, children: [] };
    stack[stack.length - 1].children.push(element);
    if (!isSelfClosing) {
      stack.push(element);
    }

    pos = closingBracket + 1;
  }

  return root.children;
}

function renderHtmlNode(node: HtmlNode, key: string): React.ReactNode {
  if (node.type === "text") {
    if (!node.text) return null;
    return (
      <Text key={key} style={styles.htmlInlineText}>
        {node.text}
      </Text>
    );
  }

  const children = node.children
    .map((child, index) => renderHtmlNode(child, `${key}-${index}`))
    .filter(Boolean);

  switch (node.tag) {
    case "strong":
    case "b":
      return (
        <Text key={key} style={styles.htmlBold}>
          {children}
        </Text>
      );
    case "em":
    case "i":
      return (
        <Text key={key} style={styles.htmlItalic}>
          {children}
        </Text>
      );
    case "u":
      return (
        <Text key={key} style={styles.htmlUnderline}>
          {children}
        </Text>
      );
    case "p":
      return (
        <Text key={key} style={[styles.htmlParagraph, styles.htmlInlineText]}>
          {children}
          {"\n"}
        </Text>
      );
    case "li":
      return (
        <Text key={key} style={[styles.htmlListItem, styles.htmlInlineText]}>
          {"\u2022 "}
          {children}
          {"\n"}
        </Text>
      );
    case "ul":
    case "ol":
      return (
        <Text key={key} style={[styles.htmlBlock, styles.htmlInlineText]}>
          {children}
        </Text>
      );
    default:
      return (
        <Text key={key} style={styles.htmlInlineText}>
          {children}
        </Text>
      );
  }
}
