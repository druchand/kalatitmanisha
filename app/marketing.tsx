import React from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View, Image } from "react-native";
import { useLanguage } from "../context/LanguageContext";

const screenshots = [
  { key: "home", title: "Home Experience", source: require("../assets/marketing/home.jpg") },
  { key: "dilemma", title: "Dilemma Guidance", source: require("../assets/marketing/dilemma.jpg") },
  { key: "favourites", title: "Favourites", source: require("../assets/marketing/favourites.jpg") },
  { key: "aichat", title: "AI Chat", source: require("../assets/marketing/aichat.jpg") },
];

const openUrl = async (url: string) => {
  try {
    await Linking.openURL(url);
  } catch {
    // no-op on unsupported shells
  }
};

export default function MarketingRoute() {
  const { t } = useLanguage();
  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.page}>
      <View style={styles.hero}>
        <Text style={styles.brand}>Kalatit Manisha</Text>
        <Text style={styles.tagline}>Timeless wisdom, made inclusive.</Text>
        <Text style={styles.body}>
          Kalatit Manisha is a multilingual Bhagavad Gita companion for reflection, learning, and daily guidance.
        </Text>
        <Text style={styles.body}>
          Accessibility is our key differentiator for visually impaired and elderly users worldwide: most interactive
          tiles support touch haptic feedback, long-press spoken labels, and tap actions.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Feature Highlights</Text>
        <Text style={styles.bullet}>- Multilingual experience including English, Hindi, and Tamil flows</Text>
        <Text style={styles.bullet}>- Verse exploration with related verse navigation</Text>
        <Text style={styles.bullet}>- Dilemma mode with relevant verse guidance</Text>
        <Text style={styles.bullet}>- Audio and narration-focused learning</Text>
        <Text style={styles.bullet}>- Personalized favorites and fast navigation</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>App Preview Videos</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("Preview Assets Pending Refresh")}</Text>
          <Text style={styles.body}>
            {t(
              "App Store preview videos and screenshots were removed from the active app bundle and will be restored after the next verified TestFlight build."
            )}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Screenshots</Text>
        {screenshots.map((shot) => (
          <View key={shot.key} style={styles.card}>
            <Text style={styles.cardTitle}>{shot.title}</Text>
            <Image source={shot.source} style={styles.image} resizeMode="contain" />
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Links</Text>
        <Pressable onPress={() => openUrl("https://app.kalatitmanisha.com/privacy-policy")}>
          <Text style={styles.link}>Privacy Policy</Text>
        </Pressable>
        <Pressable onPress={() => openUrl("https://app.kalatitmanisha.com/contact")}>
          <Text style={styles.link}>Contact</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  content: {
    width: "100%",
    maxWidth: 1080,
    alignSelf: "center",
    padding: 20,
    gap: 20,
  },
  hero: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dbe3ef",
    borderRadius: 16,
    padding: 20,
    gap: 10,
  },
  brand: {
    fontSize: 34,
    fontWeight: "800",
    color: "#0f172a",
  },
  tagline: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  body: {
    fontSize: 17,
    lineHeight: 26,
    color: "#334155",
  },
  section: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dbe3ef",
    borderRadius: 16,
    padding: 18,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#0f172a",
  },
  bullet: {
    fontSize: 16,
    lineHeight: 24,
    color: "#334155",
  },
  card: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#dbe3ef",
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  image: {
    width: "100%",
    height: 560,
    borderRadius: 12,
    backgroundColor: "#e2e8f0",
  },
  link: {
    fontSize: 16,
    lineHeight: 24,
    color: "#1d4ed8",
    textDecorationLine: "underline",
  },
});
