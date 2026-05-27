import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useLanguage } from "../context/LanguageContext";

export default function CountryModal(): React.ReactElement | null {
  const {
    availableCountries,
    isCountryOpen,
    closeCountry,
    selectCountry,
    country,
    countryListLoading,
  } = useLanguage();
  const [searchTerm, setSearchTerm] = React.useState("");

  const filteredCountries = React.useMemo(() => {
    if (!searchTerm.trim()) return availableCountries;
    const normalized = searchTerm.trim().toLowerCase();
    return availableCountries.filter(
      (entry) =>
        entry.name.toLowerCase().includes(normalized) ||
        entry.code.toLowerCase().includes(normalized)
    );
  }, [availableCountries, searchTerm]);

  if (!isCountryOpen) return null;

  return (
    <Modal
      visible
      animationType="fade"
      transparent
      onRequestClose={closeCountry}
    >
      <Pressable style={styles.backdrop} onPress={closeCountry}>
        <Pressable style={styles.card} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.title}>Select Country</Text>
          <TextInput
            placeholder="Search countries…"
            style={styles.searchInput}
            value={searchTerm}
            onChangeText={setSearchTerm}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
          {countryListLoading || !availableCountries.length ? (
            <View style={styles.center}>
              <ActivityIndicator />
              <Text style={styles.helper}>Loading countries…</Text>
            </View>
          ) : (
            <FlatList
              data={filteredCountries}
              keyExtractor={(item) => item.code}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [
                    styles.countryRow,
                    pressed && styles.countryRowPressed,
                  ]}
                  onPress={() => {
                    selectCountry(item.code);
                    closeCountry();
                  }}
                >
                  <View style={styles.countryInfo}>
                    <Text style={styles.flag}>{item.emoji || "🏳️"}</Text>
                    <Text style={styles.countryName}>
                      {item.name} ({item.code})
                      {item.code === country ? "  ✓" : ""}
                    </Text>
                  </View>
                </Pressable>
              )}
              ListEmptyComponent={
                <View style={styles.center}>
                  <Text style={styles.helper}>No countries available.</Text>
                </View>
              }
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "flex-end",
    justifyContent: "flex-start",
    paddingRight: 12,
    paddingTop: 100,
    paddingLeft: 12,
    paddingBottom: 12,
  },
  card: {
    backgroundColor: "#fff",
    width: "100%",
    maxWidth: 260,
    borderRadius: 12,
    padding: 10,
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    maxHeight: "75%",
  },
  searchInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontSize: 13,
    backgroundColor: "#f9fafb",
  },
  title: { fontSize: 14, fontWeight: "700", textAlign: "center" },
  center: { paddingVertical: 16, alignItems: "center" },
  helper: { marginTop: 8, fontSize: 12, color: "#4b5563" },
  countryRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#fff",
  },
  countryRowPressed: {
    backgroundColor: "#f3f4f6",
  },
  countryInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  flag: {
    fontSize: 18,
  },
  countryName: { fontSize: 14, fontWeight: "600", color: "#0f172a" },
});
