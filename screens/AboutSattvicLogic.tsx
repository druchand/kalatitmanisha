import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";

import AppIcon from "../components/AppIcon";
import PageBottomMeta from "../components/layout/PageBottomMeta";
import { useLanguage } from "../context/LanguageContext";
import { functionUrl } from "../utils/functionApi";

const SATTVIC_LOGIC_PAGE_CONTENT_ENDPOINT = functionUrl("SattvicLogicPageContent");

type ContentLayer = {
  section_id?: string;
  heading?: string;
  sub_heading?: string;
  body_text?: string;
  body_text_p1?: string;
  body_text_p2?: string;
  list_items?: Array<{ label?: string; description?: string }>;
  closing_text?: string;
  intro_text?: string;
  component_definitions?: Array<{ term?: string; definition?: string }>;
  footer_text?: string;
};

type PagePayload = {
  lang?: string;
  page_metadata?: {
    slug?: string;
    last_updated?: string;
  };
  content_layers?: ContentLayer[];
};

const normalizeLangCode = (value: any, fallback = "EN") => {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return raw.split("-")[0].toUpperCase();
};

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

const textValue = (value: any) => String(value ?? "").trim();

export default function AboutSattvicLogic() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { lang: appLang, t } = useLanguage();
  const isCompact = width < 720;
  const requestedLang = normalizeLangCode(appLang);
  const [payload, setPayload] = useState<PagePayload | null>(null);
  const [deliveredLang, setDeliveredLang] = useState(requestedLang);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setPayload(null);

    (async () => {
      try {
        const url = new URL(SATTVIC_LOGIC_PAGE_CONTENT_ENDPOINT);
        url.searchParams.set("slug", "why-sattvic-logic");
        url.searchParams.set("lang", requestedLang);
        const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = parseEndpointResponse(await response.text());
        if (!active) return;
        setDeliveredLang(normalizeLangCode(parsed?.lang, requestedLang));
        setPayload(parsed?.payload ?? null);
      } catch (err: any) {
        if (!active) return;
        setError(err?.message || String(err));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [requestedLang]);

  const layers = useMemo(() => payload?.content_layers ?? [], [payload]);
  const headerLayer = layers.find((layer) => layer.section_id === "header") ?? layers[0];
  const remainingLayers = layers.filter((layer) => layer !== headerLayer);
  const lastUpdated = textValue(payload?.page_metadata?.last_updated);

  const renderParagraph = (value: any, key: string) => {
    const text = textValue(value);
    if (!text) return null;
    return (
      <Text key={key} style={{ color: "#334155", fontSize: 15, lineHeight: 24, marginTop: 10 }}>
        {text}
      </Text>
    );
  };

  const renderLayer = (layer: ContentLayer) => (
    <View
      key={layer.section_id || layer.heading}
      style={{
        backgroundColor: "#ffffff",
        borderRadius: 8,
        borderWidth: 1,
        borderColor: "rgba(15,23,42,0.12)",
        padding: isCompact ? 16 : 20,
        marginTop: 14,
      }}
    >
      {textValue(layer.heading) ? (
        <Text style={{ color: "#0f172a", fontSize: isCompact ? 21 : 24, fontWeight: "900", lineHeight: isCompact ? 27 : 31 }}>
          {textValue(layer.heading)}
        </Text>
      ) : null}
      {renderParagraph(layer.body_text, "body_text")}
      {renderParagraph(layer.body_text_p1, "body_text_p1")}
      {renderParagraph(layer.body_text_p2, "body_text_p2")}
      {renderParagraph(layer.intro_text, "intro_text")}

      {Array.isArray(layer.list_items) && layer.list_items.length ? (
        <View style={{ marginTop: 12, gap: 10 }}>
          {layer.list_items.map((item, index) => (
            <View key={`${item.label || "item"}-${index}`} style={{ borderLeftWidth: 3, borderLeftColor: "#166534", paddingLeft: 12 }}>
              <Text style={{ color: "#0f172a", fontSize: 15, fontWeight: "800" }}>{textValue(item.label)}</Text>
              <Text style={{ color: "#475569", fontSize: 14, lineHeight: 22, marginTop: 3 }}>{textValue(item.description)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {renderParagraph(layer.closing_text, "closing_text")}

      {Array.isArray(layer.component_definitions) && layer.component_definitions.length ? (
        <View style={{ marginTop: 12, gap: 10 }}>
          {layer.component_definitions.map((item, index) => (
            <View key={`${item.term || "component"}-${index}`} style={{ backgroundColor: "#f8fafc", borderRadius: 8, padding: 12 }}>
              <Text style={{ color: "#166534", fontSize: 15, fontWeight: "900" }}>{textValue(item.term)}</Text>
              <Text style={{ color: "#334155", fontSize: 14, lineHeight: 22, marginTop: 4 }}>{textValue(item.definition)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {renderParagraph(layer.footer_text, "footer_text")}
    </View>
  );

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
        <TouchableOpacity
          onPress={() => router.push("/sattviclogic")}
          style={{
            alignSelf: "flex-start",
            minHeight: 42,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: "rgba(15,23,42,0.14)",
            backgroundColor: "#ffffff",
            paddingHorizontal: 12,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 8,
            marginBottom: 16,
          }}
        >
          <AppIcon family="feather" name="arrow-left" size={18} color="#0f172a" />
          <Text style={{ color: "#0f172a", fontWeight: "800" }}>{t("Back to Sattvic Logic")}</Text>
        </TouchableOpacity>

        {loading ? (
          <View style={{ paddingVertical: 54, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ color: "#334155", marginTop: 10 }}>{t("Loading...")}</Text>
          </View>
        ) : payload ? (
          <>
            <View style={{ marginBottom: 4 }}>
              <Text style={{ color: "#0f172a", fontSize: isCompact ? 30 : 40, fontWeight: "900", lineHeight: isCompact ? 36 : 48 }}>
                {textValue(headerLayer?.heading) || "The Need for SattvicLogic"}
              </Text>
              {textValue(headerLayer?.sub_heading) ? (
                <Text style={{ color: "#166534", marginTop: 8, fontSize: isCompact ? 17 : 20, fontWeight: "800", lineHeight: isCompact ? 24 : 28 }}>
                  {textValue(headerLayer?.sub_heading)}
                </Text>
              ) : null}
              {renderParagraph(headerLayer?.body_text, "header_body")}
              <Text style={{ color: "#64748b", marginTop: 10, fontSize: 13, fontWeight: "700" }}>
                {deliveredLang}{lastUpdated ? ` - Updated ${lastUpdated}` : ""}
              </Text>
            </View>
            {remainingLayers.map(renderLayer)}
          </>
        ) : (
          <View style={{ backgroundColor: "#ffffff", borderRadius: 8, borderWidth: 1, borderColor: "rgba(15,23,42,0.12)", padding: 18 }}>
            <Text style={{ color: "#0f172a", fontSize: 17, fontWeight: "800" }}>
              {t("Content is not available right now.")}
            </Text>
            {error ? <Text style={{ color: "#64748b", marginTop: 8 }}>{error}</Text> : null}
          </View>
        )}

        <View style={{ marginTop: 16 }}>
          <PageBottomMeta />
        </View>
      </ScrollView>
    </View>
  );
}
