export type AudioTextKind = "tts" | "stream";

export type AudioTextLookupRecord = {
  pageKey: string;
  playerKey: string;
  kind: AudioTextKind;
  text: string;
  source?: string;
  updatedAt: number;
};

const store = new Map<string, AudioTextLookupRecord>();

const buildStoreKey = (pageKey: string, playerKey: string) => `${String(pageKey || "").trim()}::${String(playerKey || "").trim()}`;

export const upsertAudioTextLookup = (record: Omit<AudioTextLookupRecord, "updatedAt">) => {
  const pageKey = String(record.pageKey || "").trim();
  const playerKey = String(record.playerKey || "").trim();
  const text = String(record.text || "").trim();
  if (!pageKey || !playerKey || !text) return;
  store.set(buildStoreKey(pageKey, playerKey), {
    ...record,
    pageKey,
    playerKey,
    text,
    updatedAt: Date.now(),
  });
};

export const getAudioTextLookupByPage = (pageKey: string) => {
  const page = String(pageKey || "").trim();
  if (!page) return [] as AudioTextLookupRecord[];
  return Array.from(store.values()).filter((item) => item.pageKey === page);
};

export const getAudioTextLookup = (pageKey: string, playerKey: string) => {
  const key = buildStoreKey(pageKey, playerKey);
  return store.get(key) || null;
};

