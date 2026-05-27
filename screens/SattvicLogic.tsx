import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";

import PageBottomMeta from "../components/layout/PageBottomMeta";
import { useLanguage } from "../context/LanguageContext";
import { useVerseSelection } from "../context/VerseSelectionContext";
import { functionUrl } from "../utils/functionApi";

const SATTVIC_LOGIC_VERSE_PAYLOAD_ENDPOINT = functionUrl("SattvicLogicVersePayload");
const MIN_CHAPTER_NUMBER = 1;
const MAX_CHAPTER_NUMBER = 18;
const MIN_VERSE_NUMBER = 1;
const KNOWN_VERSE_COUNT_BY_CHAPTER: Record<number, number> = {
  1: 47,
  2: 72,
  3: 43,
  4: 42,
  5: 29,
  6: 47,
  7: 30,
  8: 28,
  9: 34,
  10: 42,
  11: 55,
  12: 20,
  13: 35,
  14: 27,
  15: 20,
  16: 24,
  17: 28,
  18: 78,
};

type SattvicLogicPayload = {
  _id?: string;
  title?: string;
  lang?: string;
  language_code?: string;
  sanskrit?: string;
  word_analysis?: string;
  manav_port?: string;
  system_state?: string;
  the_trigger?: string;
  direct_command?: string;
  [key: string]: any;
};

type SattvicLogicResponseMeta = {
  requestedLang: string;
  deliveredLang: string;
  fallbackUsed: boolean;
  fallbackLang: string | null;
};

const normalizeLangCode = (value: any, fallback = "") => {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return raw.split("-")[0].toUpperCase();
};

const clampChapter = (chapter: number) =>
  Math.min(MAX_CHAPTER_NUMBER, Math.max(MIN_CHAPTER_NUMBER, Math.floor(chapter || MIN_CHAPTER_NUMBER)));

const getMaxVerseForChapter = (chapter: number) => KNOWN_VERSE_COUNT_BY_CHAPTER[clampChapter(chapter)] ?? 72;

const parseEndpointResponse = (rawText: string) => {
  let parsed: any = {};
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = {};
    }
  }

  let body = parsed?.body ?? parsed ?? {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  return body ?? {};
};

const normalizeDisplayText = (value: any) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
};

const labelizeKey = (key: string) =>
  String(key || "")
    .replace(/^_/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

export default function SattvicLogic() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { t, lang: appLang } = useLanguage();
  const { selection, updateSelection } = useVerseSelection();
  const isCompact = width < 720;

  const requestedLang = normalizeLangCode(appLang, "EN") || "EN";
  const chapter = clampChapter(selection.chapter || MIN_CHAPTER_NUMBER);
  const verse = Math.min(
    getMaxVerseForChapter(chapter),
    Math.max(MIN_VERSE_NUMBER, selection.verse || MIN_VERSE_NUMBER)
  );
  const [payload, setPayload] = useState<SattvicLogicPayload | null>(null);
  const [responseMeta, setResponseMeta] = useState<SattvicLogicResponseMeta>({
    requestedLang,
    deliveredLang: requestedLang,
    fallbackUsed: false,
    fallbackLang: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setPayload(null);
    setResponseMeta({
      requestedLang,
      deliveredLang: requestedLang,
      fallbackUsed: false,
      fallbackLang: null,
    });
    setError("");
    setLoading(true);

    (async () => {
      try {
        const url = new URL(SATTVIC_LOGIC_VERSE_PAYLOAD_ENDPOINT);
        url.searchParams.set("chapter", String(chapter));
        url.searchParams.set("verse", String(verse));
        url.searchParams.set("lang", requestedLang);
        const response = await fetch(url.toString(), {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const rawText = await response.text();
        const parsed = parseEndpointResponse(rawText);
        const nextPayload =
          parsed?.payload ??
          parsed?.payLoad ??
          parsed?.data?.payload ??
          parsed?.data?.payLoad ??
          (parsed?._id || parsed?.title ? parsed : null);
        const deliveredLang = normalizeLangCode(parsed?.lang ?? nextPayload?.lang ?? nextPayload?.language_code, requestedLang);
        const parsedRequestedLang = normalizeLangCode(parsed?.requestedLang, requestedLang);
        const fallbackLang = normalizeLangCode(parsed?.fallbackLang, "") || null;
        if (!active) return;
        setResponseMeta({
          requestedLang: parsedRequestedLang,
          deliveredLang,
          fallbackUsed: Boolean(parsed?.fallbackUsed) || deliveredLang !== parsedRequestedLang,
          fallbackLang,
        });
        setPayload(nextPayload || null);
      } catch (err: any) {
        if (!active) return;
        setError(err?.message || String(err));
        setPayload(null);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [chapter, verse, requestedLang]);

  const goToVerse = useCallback(
    (nextChapter: number, nextVerse: number) => {
      const normalizedChapter = clampChapter(nextChapter);
      const normalizedVerse = Math.min(
        getMaxVerseForChapter(normalizedChapter),
        Math.max(MIN_VERSE_NUMBER, Math.floor(nextVerse || MIN_VERSE_NUMBER))
      );
      updateSelection({ chapter: normalizedChapter, verse: normalizedVerse });
      router.replace({
        pathname: "/sattviclogic",
      });
    },
    [router, updateSelection]
  );

  const previousTarget = useMemo(() => {
    if (verse > MIN_VERSE_NUMBER) return { chapter, verse: verse - 1 };
    const prevChapter = chapter <= MIN_CHAPTER_NUMBER ? MAX_CHAPTER_NUMBER : chapter - 1;
    return { chapter: prevChapter, verse: getMaxVerseForChapter(prevChapter) };
  }, [chapter, verse]);

  const nextTarget = useMemo(() => {
    const maxVerse = getMaxVerseForChapter(chapter);
    if (verse < maxVerse) return { chapter, verse: verse + 1 };
    const nextChapter = chapter >= MAX_CHAPTER_NUMBER ? MIN_CHAPTER_NUMBER : chapter + 1;
    return { chapter: nextChapter, verse: MIN_VERSE_NUMBER };
  }, [chapter, verse]);

  const primarySections = useMemo(
    () =>
      [
        {
          key: "sanskrit",
          label: t("Sanskrit"),
          value: payload?.sanskrit,
          subtitle: payload?.word_analysis,
        },
        { key: "manav_port", label: t("Manav Port"), value: payload?.manav_port },
        { key: "system_state", label: t("System State"), value: payload?.system_state },
        { key: "the_trigger", label: t("The Trigger"), value: payload?.the_trigger },
        { key: "direct_command", label: t("Direct Command"), value: payload?.direct_command },
      ].filter((item) => normalizeDisplayText(item.value)),
    [payload, t]
  );

  const extraSections = useMemo(() => {
    if (!payload) return [];
    const hidden = new Set([
      "_id",
      "_createdDate",
      "_updatedDate",
      "_owner",
      "title",
      "lang",
      "language_code",
      "sourceRecordId",
      "sourceLang",
      "sanskrit",
      "word_analysis",
      "manav_port",
      "system_state",
      "the_trigger",
      "direct_command",
    ]);
    return Object.entries(payload)
      .filter(([key, value]) => !hidden.has(key) && normalizeDisplayText(value))
      .map(([key, value]) => ({ key, label: labelizeKey(key), value }));
  }, [payload]);

  const title = String(payload?.title || t("Sattvic Logic")).trim();
  const languageLabel = responseMeta.fallbackUsed
    ? `${responseMeta.deliveredLang} fallback for ${responseMeta.requestedLang}`
    : responseMeta.deliveredLang;

  return (
    <View style={{ flex: 1, backgroundColor: "#f8fafc" }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          width: "100%",
          maxWidth: 980,
          alignSelf: "center",
          paddingHorizontal: isCompact ? 14 : 24,
          paddingTop: 18,
          paddingBottom: 112,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ marginBottom: 16 }}>
          <Text style={{ color: "#0f172a", fontSize: isCompact ? 26 : 34, fontWeight: "900", lineHeight: isCompact ? 32 : 40 }}>
            {title}
          </Text>
          <Text style={{ color: "#475569", marginTop: 6, fontSize: 15, fontWeight: "600" }}>
            {t("Verse {ref}", { ref: `${chapter}.${verse}` })} - {languageLabel}
          </Text>
        </View>

        {loading ? (
          <View style={{ paddingVertical: 54, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ color: "#334155", marginTop: 10 }}>{t("Loading...")}</Text>
          </View>
        ) : payload ? (
          <View style={{ gap: 12 }}>
            {[...primarySections, ...extraSections].map((item) => {
              const value = normalizeDisplayText(item.value);
              const subtitle = normalizeDisplayText((item as any).subtitle);
              return (
                <View
                  key={item.key}
                  style={{
                    backgroundColor: "#ffffff",
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: "rgba(15,23,42,0.12)",
                    padding: isCompact ? 14 : 16,
                  }}
                >
                  <Text style={{ color: "#0f172a", fontSize: 15, fontWeight: "800", marginBottom: 8 }}>
                    {item.label}
                  </Text>
                  <Text
                    style={{
                      color: "#1e293b",
                      fontSize: 15,
                      lineHeight: 23,
                      fontFamily: value.trim().startsWith("{") || value.trim().startsWith("[")
                        ? Platform.OS === "web"
                          ? "monospace"
                          : undefined
                        : undefined,
                    }}
                  >
                    {value}
                  </Text>
                  {subtitle ? (
                    <Text style={{ color: "#64748b", fontSize: 14, lineHeight: 21, marginTop: 10 }}>
                      {subtitle}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : (
          <View
            style={{
              backgroundColor: "#ffffff",
              borderRadius: 8,
              borderWidth: 1,
              borderColor: "rgba(15,23,42,0.12)",
              padding: 18,
            }}
          >
            <Text style={{ color: "#0f172a", fontSize: 17, fontWeight: "800" }}>
              {t("No Sattvic Logic payload is available for this verse.")}
            </Text>
            {error ? <Text style={{ color: "#64748b", marginTop: 8 }}>{error}</Text> : null}
          </View>
        )}

        <View style={{ marginTop: 16 }}>
          <TouchableOpacity
            onPress={() => router.push("/about-sattvic-logic")}
            style={{
              minHeight: 48,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: "rgba(22,101,52,0.28)",
              backgroundColor: "#ffffff",
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 14,
              marginBottom: 14,
            }}
          >
            <Text style={{ color: "#166534", fontSize: 15, fontWeight: "900", textAlign: "center" }}>
              {t("What is Sattvic Logic")}
            </Text>
          </TouchableOpacity>
          <PageBottomMeta />
        </View>
      </ScrollView>

      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(248,250,252,0.96)",
          borderTopWidth: 1,
          borderTopColor: "rgba(15,23,42,0.12)",
          paddingHorizontal: isCompact ? 14 : 24,
          paddingVertical: 12,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 980,
            alignSelf: "center",
            flexDirection: "row",
            gap: 10,
          }}
        >
          <TouchableOpacity
            onPress={() => goToVerse(previousTarget.chapter, previousTarget.verse)}
            style={{
              flex: 1,
              minHeight: 48,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: "rgba(15,23,42,0.18)",
              backgroundColor: "#ffffff",
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 10,
            }}
          >
            <Text style={{ color: "#0f172a", fontWeight: "800", textAlign: "center" }}>
              {t("Previous Shloka")}
            </Text>
            <Text style={{ color: "#64748b", marginTop: 2, fontSize: 12 }}>
              {previousTarget.chapter}.{previousTarget.verse}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => goToVerse(nextTarget.chapter, nextTarget.verse)}
            style={{
              flex: 1,
              minHeight: 48,
              borderRadius: 8,
              backgroundColor: "#166534",
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 10,
            }}
          >
            <Text style={{ color: "#ffffff", fontWeight: "800", textAlign: "center" }}>
              {t("Next Shloka")}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.78)", marginTop: 2, fontSize: 12 }}>
              {nextTarget.chapter}.{nextTarget.verse}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
