import AsyncStorage from "@react-native-async-storage/async-storage";

export type CachedWorldViewEntry = {
  name?: string;
  domain?: string;
  era?: string;
  category?: string;
  view?: string;
  source_note?: string;
  image_url?: string;
};

type WorldViewsCacheDoc = {
  version: number;
  fetchedAt: number;
  entries: CachedWorldViewEntry[];
};

const WORLD_VIEWS_CACHE_PREFIX = "@gita-app/cache/worldViews";
const WORLD_VIEWS_CACHE_VERSION = 3;
const WORLD_VIEWS_CACHE_TTL_MS = 6 * 24 * 60 * 60 * 1000; // 6 days
const PLACEHOLDER_IMAGE_HOSTS = new Set([
  "example.com",
  "www.example.com",
  "example.org",
  "www.example.org",
  "example.net",
  "www.example.net",
  "localhost",
  "127.0.0.1",
]);

const worldViewsCacheKey = (langCode: string) =>
  `${WORLD_VIEWS_CACHE_PREFIX}:${String(langCode || "EN").trim().toUpperCase() || "EN"}`;

const isFresh = (timestamp: number) =>
  Number.isFinite(timestamp) && Date.now() - timestamp < WORLD_VIEWS_CACHE_TTL_MS;

export const normalizeWorldImageUrl = (value?: string): string | undefined => {
  const raw = String(value || "").trim();
  if (!raw) return undefined;

  if (raw.startsWith("wix:image://v1/")) {
    const withoutPrefix = raw.replace("wix:image://v1/", "");
    const mediaId = withoutPrefix.split("/")[0]?.trim();
    if (!mediaId) return undefined;
    return `https://static.wixstatic.com/media/${mediaId}`;
  }

  if (raw.startsWith("//")) return `https:${raw}`;

  const normalized = raw.startsWith("http://") ? raw.replace("http://", "https://") : raw;
  try {
    const parsed = new URL(normalized);
    if (!/^https?:$/i.test(parsed.protocol)) return undefined;
    const hostname = String(parsed.hostname || "").toLowerCase();
    if (!hostname || PLACEHOLDER_IMAGE_HOSTS.has(hostname)) return undefined;
    if (hostname.endsWith(".wikipedia.org")) return undefined;
    // Keep this permissive: many CDNs use extensionless image URLs with signed query params.
    // We only block obvious placeholders/local hosts and unsupported protocols.
    return parsed.toString();
  } catch {
    return undefined;
  }
};

export const normalizeWorldEntries = <T extends CachedWorldViewEntry>(entries: T[]): T[] =>
  (Array.isArray(entries) ? entries : []).map((entry) => {
    const candidate =
      (entry as any)?.image_url ??
      (entry as any)?.imageUrl ??
      (entry as any)?.image ??
      (entry as any)?.image_uri ??
      (entry as any)?.imageUri ??
      (entry as any)?.thumbnail ??
      (entry as any)?.thumbnailUrl ??
      (entry as any)?.mediaUrl ??
      "";
    return {
      ...entry,
      image_url: normalizeWorldImageUrl(candidate),
    };
  });

export const mergeWorldEntriesPreserveImages = <T extends CachedWorldViewEntry>(
  previous: T[],
  next: T[]
): T[] => {
  const prevList = Array.isArray(previous) ? previous : [];
  const nextList = Array.isArray(next) ? next : [];
  return nextList.map((entry, index) => {
    if (entry?.image_url) return entry;
    const byName = prevList.find(
      (prev) =>
        String(prev?.name || "").trim().toLowerCase() ===
        String(entry?.name || "").trim().toLowerCase()
    );
    const byIndex = prevList[index];
    const fallbackImage = byName?.image_url || byIndex?.image_url;
    if (!fallbackImage) return entry;
    return { ...entry, image_url: fallbackImage };
  });
};

export const readCachedWorldViews = async (
  langCode: string
): Promise<{ entries: CachedWorldViewEntry[]; fresh: boolean }> => {
  try {
    const raw = await AsyncStorage.getItem(worldViewsCacheKey(langCode));
    if (!raw) return { entries: [], fresh: false };
    const parsed = JSON.parse(raw) as WorldViewsCacheDoc;
    if (!parsed || Number(parsed.version) !== WORLD_VIEWS_CACHE_VERSION) {
      return { entries: [], fresh: false };
    }
    const entries = normalizeWorldEntries(parsed.entries || []);
    return { entries, fresh: isFresh(Number(parsed.fetchedAt || 0)) };
  } catch {
    return { entries: [], fresh: false };
  }
};

export const writeCachedWorldViews = async (
  langCode: string,
  entries: CachedWorldViewEntry[]
): Promise<void> => {
  const normalizedEntries = normalizeWorldEntries(entries || []);
  const payload: WorldViewsCacheDoc = {
    version: WORLD_VIEWS_CACHE_VERSION,
    fetchedAt: Date.now(),
    entries: normalizedEntries,
  };
  try {
    await AsyncStorage.setItem(worldViewsCacheKey(langCode), JSON.stringify(payload));
  } catch {
    // ignore cache write errors
  }
};
