import React, { useEffect, useState } from "react";
import { Image, ImageStyle } from "react-native";


type MediaImageProps = {
  url?: string | null;
  style?: ImageStyle;
};

function normalizeMediaUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  const trimmed = String(url).trim();
  if (!trimmed) return undefined;

  // protocol-relative
  if (trimmed.startsWith("//")) return `https:${trimmed}`;

  // already absolute
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  // keep as-is (caller/base URL logic can handle if needed)
  return trimmed;
}

export default function MediaImage({ url, style }: MediaImageProps) {
  const normalized = normalizeMediaUrl(url);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [normalized]);

  if (!normalized || failed) return null;

  return (
    <Image
      source={{ uri: normalized }}
      style={style}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}
