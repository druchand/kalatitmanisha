import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, Text, View } from "react-native";
import Constants from "expo-constants";
import appConfig from "../app.json";
import { useLanguage } from "../context/LanguageContext";
import TapToSpeakContainer from "../components/TapToSpeakContainer";
import PageBottomMeta from "../components/layout/PageBottomMeta";
import { functionUrl } from "../utils/functionApi";

const GITA_ABOUT_ENDPOINT = functionUrl("gitaAbout");

type AboutPayload = {
  title?: string;
  subTitle?: string;
  aboutText?: string;
  lang?: string;
};

export default function About() {
  const { lang } = useLanguage();
  const safeLang = useMemo(
    () => (typeof lang === "string" && lang.trim() ? lang.trim().toUpperCase() : "EN"),
    [lang]
  );
  const appVersion = useMemo(
    () =>
      String(
        Constants.expoConfig?.version ||
          (appConfig as any)?.expo?.version ||
          "unknown"
      ).trim() || "unknown",
    []
  );
  const buildNumber = useMemo(() => {
    const nativeBuild = String((Constants as any)?.nativeBuildVersion || "").trim();
    if (nativeBuild) return nativeBuild;
    const extraBuild = String((Constants.expoConfig as any)?.extra?.buildNumber || "").trim();
    if (extraBuild) return extraBuild;
    const configBuild = String(
      (Constants.expoConfig as any)?.ios?.buildNumber ||
        (Constants.expoConfig as any)?.android?.versionCode ||
        (appConfig as any)?.expo?.extra?.buildNumber ||
        (appConfig as any)?.expo?.ios?.buildNumber ||
        (appConfig as any)?.expo?.android?.versionCode ||
        ""
    ).trim();
    return configBuild || "dev";
  }, []);
  const platformLabel = useMemo(() => {
    if (Platform.OS === "ios") return "iOS";
    if (Platform.OS === "android") return "Android";
    if (Platform.OS === "web") return "Web";
    return String(Platform.OS || "unknown");
  }, []);
  const versionLabel = useMemo(
    () => `${platformLabel} • Version ${appVersion} (${buildNumber})`,
    [appVersion, buildNumber, platformLabel]
  );

  const [data, setData] = useState<AboutPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const url = new URL(GITA_ABOUT_ENDPOINT);
        url.searchParams.set("lang", safeLang);
        const response = await fetch(url.toString(), {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const body = payload?.body ?? payload;
        const parsed = (typeof body === "string" ? JSON.parse(body) : body) ?? {};
        if (cancelled) return;
        setData({
          title: typeof parsed?.title === "string" ? parsed.title : undefined,
          subTitle: typeof parsed?.subTitle === "string" ? parsed.subTitle : undefined,
          aboutText: typeof parsed?.aboutText === "string" ? parsed.aboutText : undefined,
          lang: typeof parsed?.lang === "string" ? parsed.lang : safeLang,
        });
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message ?? "Unable to load About content");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [safeLang]);

  return (
    <ScrollView className="flex-1 bg-slate-50 px-4 py-5">
      <View className="rounded-2xl bg-white p-5 shadow-sm border border-slate-100">
        {loading ? (
          <View className="flex-row items-center">
            <ActivityIndicator />
            <Text className="ml-2 text-slate-700">Loading…</Text>
          </View>
        ) : null}

        {error ? <Text className="text-red-700">{error}</Text> : null}

        {!loading && !error ? (
          <>
            <Text className="text-2xl font-semibold text-slate-900">
              {data?.title || "About"}
            </Text>
            {!!data?.subTitle && (
              <Text className="mt-1 text-base font-medium text-slate-700">
                {data.subTitle}
              </Text>
            )}
            <View className="mt-3 self-start rounded-full border border-slate-200 bg-slate-100 px-3 py-1">
              <Text className="text-xs font-semibold tracking-wide text-slate-600">
                {versionLabel}
              </Text>
            </View>
            <TapToSpeakContainer
              text={`${data?.title || ""}\n${data?.subTitle || ""}\n${data?.aboutText || ""}`}
              lang={safeLang}
              ttsHeader={data?.title || "About"}
              ttsSubheader={data?.subTitle || ""}
              style={{ marginTop: 10, borderRadius: 12 }}
            >
              <Text className="text-base leading-6 text-slate-700">
                {data?.aboutText || "About content is unavailable right now."}
              </Text>
            </TapToSpeakContainer>
          </>
        ) : null}
      </View>
      <View style={{ marginTop: 8 }}>
        <PageBottomMeta />
      </View>
    </ScrollView>
  );
}
