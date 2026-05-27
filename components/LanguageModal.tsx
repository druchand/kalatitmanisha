import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../auth/AuthModalContext";

export default function LanguageModal(): React.ReactElement | null {
  const {
    isLanguageOpen,
    closeLanguage,
    availableLangs,
    selectLanguage,
    lang,
    loading,
  } = useLanguage();
  const auth = useAuth();

  if (!isLanguageOpen) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={closeLanguage}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={closeLanguage} />
      <View style={styles.cardWrap}>
        <View style={styles.card}>
          <Text style={styles.title}>Select language</Text>
          {!auth.sessionId ? (
            <Text style={styles.guestNote}>
              Guest mode supports limited languages. Sign in to unlock all available languages.
            </Text>
          ) : null}
          {loading ? (
            <ActivityIndicator style={{ marginVertical: 32 }} />
          ) : (
            <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator>
              {availableLangs.map((option) => {
                const active = option.code === lang;
                const primaryLabel = option.englishName || option.name || option.code;
                const secondaryLabel =
                  option.nativeName && option.nativeName !== primaryLabel ? option.nativeName : "";
                const emoji = option.emoji || option.flag || "🌐";
                return (
                  <TouchableOpacity
                    key={option.code}
                    onPress={() => selectLanguage(option.code)}
                    style={[styles.item, active && styles.itemActive]}
                  >
                    <View style={styles.itemRow}>
                      <View style={styles.itemTextWrap}>
                        <Text style={styles.itemLabel} numberOfLines={1} ellipsizeMode="tail">
                          {emoji ? `${emoji} ` : ""}
                          <Text style={styles.itemLabelPrimary}>{primaryLabel}</Text>
                          {secondaryLabel ? (
                            <Text style={styles.itemLabelSecondary}> / {secondaryLabel}</Text>
                          ) : null}
                        </Text>
                      </View>
                      {active ? <Text style={styles.itemActiveText}>Selected</Text> : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
          <TouchableOpacity style={styles.closeBtn} onPress={closeLanguage}>
            <Text style={styles.closeText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  cardWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "flex-end",
    padding: 16,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    maxHeight: "80%",
    width: "100%",
    maxWidth: 288,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  guestNote: {
    fontSize: 12,
    color: "#64748b",
    marginBottom: 10,
  },
  list: {
    paddingBottom: 8,
  },
  item: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
    marginBottom: 10,
    backgroundColor: "#fff",
  },
  itemActive: {
    borderColor: "#2563eb",
    backgroundColor: "#ebf4ff",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  itemTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  itemLabel: {
    fontSize: 16,
    color: "#0f172a",
  },
  itemLabelPrimary: {
    fontSize: 16,
    color: "#0f172a",
    fontWeight: "500",
  },
  itemLabelSecondary: {
    fontSize: 13,
    color: "#64748b",
  },
  itemActiveText: {
    fontSize: 12,
    color: "#2563eb",
    fontWeight: "600",
  },
  closeBtn: {
    marginTop: 6,
    alignSelf: "flex-end",
  },
  closeText: {
    color: "#2563eb",
    fontWeight: "600",
  },
});
