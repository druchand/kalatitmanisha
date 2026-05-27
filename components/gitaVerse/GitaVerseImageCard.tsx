import React from "react";
import {
  Image,
  ImageBackground,
  ImageSourcePropType,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { APP_LOGO_IMAGE } from "../../utils/logoAssets";

type GitaVerseImageCardProps = {
  sanskritText: string;
  chapter?: number;
  verse?: number;
  width?: number;
  backgroundSource?: ImageSourcePropType;
  showVerseLabel?: boolean;
  minimalChrome?: boolean;
};

const DEFAULT_BACKGROUND = APP_LOGO_IMAGE;

export default function GitaVerseImageCard({
  sanskritText,
  chapter,
  verse,
  width = 340,
  backgroundSource = DEFAULT_BACKGROUND,
  showVerseLabel = true,
  minimalChrome = false,
}: GitaVerseImageCardProps) {
  const normalizedText = String(sanskritText || "").trim();
  const verseLabel = chapter && verse ? `Chapter ${chapter} • Verse ${verse}` : "Bhagavad Gita";
  const sanskritWords = normalizedText.split(/\s+/).filter(Boolean).length;
  const densityScore = normalizedText.length + sanskritWords * 4;
  const dynamicSanskritStyle = React.useMemo(() => {
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    if (minimalChrome) {
      // Minimal mode has tighter vertical space; scale down progressively for denser verses.
      const target = 24 - densityScore * 0.055;
      const fontSize = clamp(Number(target.toFixed(2)), 14, 22);
      return {
        fontSize,
        lineHeight: Math.round(fontSize * 1.42),
      };
    }
    const target = 27 - densityScore * 0.048;
    const fontSize = clamp(Number(target.toFixed(2)), 16, 25);
    return {
      fontSize,
      lineHeight: Math.round(fontSize * 1.38),
    };
  }, [densityScore, minimalChrome]);
  const isWeb = Platform.OS === "web";

  if (!normalizedText) return null;

  return (
    <View style={[styles.preview, minimalChrome && styles.previewMinimal, { width }]}>
      {isWeb ? (
        <View style={styles.previewCanvas}>
          <Image source={backgroundSource} style={styles.previewImageWeb} resizeMode="contain" />
          {!minimalChrome ? <View style={styles.overlay} /> : null}
          <View style={[styles.previewTextWrap, minimalChrome && styles.previewTextWrapMinimal]}>
            {showVerseLabel ? (
              <Text numberOfLines={2} style={styles.previewVerseLabel}>
                {verseLabel}
              </Text>
            ) : null}
            <Text
              style={[
                styles.previewSanskrit,
                minimalChrome && styles.previewSanskritMinimal,
                dynamicSanskritStyle,
              ]}
            >
              {normalizedText}
            </Text>
          </View>
        </View>
      ) : (
        <ImageBackground
          source={backgroundSource}
          style={styles.previewCanvas}
          imageStyle={styles.previewImage}
          resizeMode="cover"
        >
          {!minimalChrome ? <View style={styles.overlay} /> : null}
          <View style={[styles.previewTextWrap, minimalChrome && styles.previewTextWrapMinimal]}>
            {showVerseLabel ? (
              <Text numberOfLines={2} style={styles.previewVerseLabel}>
                {verseLabel}
              </Text>
            ) : null}
            <Text
              style={[
                styles.previewSanskrit,
                minimalChrome && styles.previewSanskritMinimal,
                dynamicSanskritStyle,
              ]}
            >
              {normalizedText}
            </Text>
          </View>
        </ImageBackground>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    alignSelf: "center",
    aspectRatio: 16 / 10,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.12)",
    backgroundColor: "rgba(15,23,42,0.05)",
  },
  previewMinimal: {
    aspectRatio: 16 / 9,
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  previewCanvas: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  previewImage: {
    opacity: 0.95,
  },
  previewImageWeb: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
    opacity: 0.95,
    backgroundColor: "rgba(15,23,42,0.06)",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  previewTextWrap: {
    width: "90%",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: "rgba(255,255,255,0.26)",
    borderRadius: 12,
  },
  previewTextWrapMinimal: {
    width: "94%",
    backgroundColor: "rgba(15,23,42,0.18)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  previewVerseLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
    opacity: 0.75,
    letterSpacing: 0.4,
    marginBottom: 12,
    textAlign: "center",
  },
  previewSanskrit: {
    fontSize: 23,
    lineHeight: 32,
    fontWeight: "800",
    textAlign: "center",
    color: "#0f172a",
    textShadowColor: "rgba(255,255,255,0.65)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  previewSanskritMinimal: {
    fontSize: 19,
    lineHeight: 28,
    color: "#f8fafc",
    textShadowColor: "rgba(15,23,42,0.95)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    letterSpacing: 0.2,
  },
});
