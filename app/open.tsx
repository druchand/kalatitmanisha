import React, { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

type OpenParams = {
  path?: string | string[];
};

const toSingle = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
};

const ALLOWED_PATHS = new Set([
  "/home",
  "/explore",
  "/gitaverse",
  "/gitaverse-old",
  "/gitaverse-new",
  "/dilemma",
  "/aichat",
  "/myfavourates",
  "/profile",
  "/about",
  "/about-sattvic-logic",
]);

const normalizeInternalPath = (value: string): string => {
  const raw = String(value || "").trim();
  if (!raw) return "/home";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  if (/^https?:\/\//i.test(decoded) || decoded.startsWith("//") || /^javascript:/i.test(decoded)) {
    return "/home";
  }
  const withSlash = decoded.startsWith("/") ? decoded : `/${decoded}`;
  try {
    const parsed = new URL(withSlash, "https://kalatitmanisha.com");
    const pathname = String(parsed.pathname || "/home");
    const loweredPathname = pathname.toLowerCase();
    const normalizedPathname =
      loweredPathname === "/gitaverse"
        ? "/gitaverse"
        : loweredPathname === "/gitaverse-old"
        ? "/gitaverse-old"
        : loweredPathname === "/gitaverse-new"
        ? "/gitaverse-new"
        : pathname;
    if (!ALLOWED_PATHS.has(normalizedPathname)) return "/home";
    return `${normalizedPathname}${parsed.search || ""}`;
  } catch {
    return "/home";
  }
};

export default function OpenRoute(): React.ReactElement {
  const params = useLocalSearchParams<OpenParams>();
  const router = useRouter();
  const redirectedRef = useRef(false);

  const requestedPath = useMemo(() => toSingle(params.path), [params.path]);

  useEffect(() => {
    if (redirectedRef.current) return;
    redirectedRef.current = true;
    const target = normalizeInternalPath(requestedPath);
    router.replace(target as any);
  }, [requestedPath, router]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#f8fafc",
        paddingHorizontal: 20,
      }}
    >
      <ActivityIndicator size="small" color="#0ea5e9" />
      <Text style={{ marginTop: 12, color: "#334155", textAlign: "center" }}>
        Opening link...
      </Text>
    </View>
  );
}
