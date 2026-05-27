import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "./LocationContext";
import { useAuth } from "../auth/AuthModalContext";
import { functionUrl } from "../utils/functionApi";

type LanguageOption = {
  code: string;
  name: string;
  emoji?: string;
  flag?: string;
  englishName?: string;
  nativeName?: string;
  displayName?: string;
  direction?: "ltr" | "rtl";
  voice?: boolean;
};

type CountryOption = {
  code: string;
  name: string;
  emoji?: string;
};

type LanguageCtx = {
  t: (key: string, vars?: Record<string, any>) => string;
  lang: string;
  langName: string;
  direction: "ltr" | "rtl";
  availableLangs: LanguageOption[];
  loading: boolean;
  isLanguageOpen: boolean;
  openLanguage: () => void;
  closeLanguage: () => void;
  selectLanguage: (code: string) => void;
  country: string | null;
  availableCountries: CountryOption[];
  countryListLoading: boolean;
  isCountryOpen: boolean;
  openCountry: () => void;
  closeCountry: () => void;
  selectCountry: (code: string) => void;
};

const LANG_ENDPOINT = functionUrl("AppLanguages");
const LANG_STORAGE_KEY = "@gita-app/lang";
const COUNTRY_STORAGE_KEY = "@gita-app/lang-country";
const COUNTRY_ENDPOINT = functionUrl("Countries");
const LANG_CACHE_PREFIX = "@gita-app/cache/langs";
const COUNTRIES_CACHE_KEY = "@gita-app/cache/countries";
const LOOKUP_CACHE_VERSION = 4;
const LOOKUP_CACHE_TTL_MS = 6 * 24 * 60 * 60 * 1000; // 6 days
const DEFAULT_LANG = "EN";
const DEFAULT_DIRECTION: LanguageCtx["direction"] = "ltr";
const LANGUAGE_DEBUG = false;
const GUEST_ALLOWED_LANGUAGE_CODES = new Set(["EN", "HI", "TA"]);
const TMS_PROJECT_KEY = "kalatitmanisha";
const TMS_I18N_ENDPOINT_BASE = functionUrl("i18n");
const TMS_I18N_NAMESPACES = [
  "common",
  "home",
  "explore",
  "gitaverse",
  "dilemma",
  "aichat",
  "myfavourates",
  "profile",
  "about",
  "contact",
  "forgotpassword",
  "resetpassword",
  "privacypolicy",
  "datadeletion",
  "authbridge",
  "oauthredirect",
  "open",
];
const I18N_CACHE_PREFIX = "@gita-app/cache/i18n";

const LANG_OPTIONS: LanguageOption[] = [
  { code: "EN", name: "English", emoji: "🇬🇧", direction: DEFAULT_DIRECTION },
  { code: "HI", name: "Hindi", emoji: "🇮🇳", direction: DEFAULT_DIRECTION },
  { code: "BN", name: "Bengali", emoji: "🇧🇩", direction: DEFAULT_DIRECTION },
  { code: "TA", name: "Tamil", emoji: "🇮🇳", direction: DEFAULT_DIRECTION },
  { code: "TE", name: "Telugu", emoji: "🇮🇳", direction: DEFAULT_DIRECTION },
];

const LANGUAGE_FALLBACK_NAMES: Record<
  string,
  { englishName: string; nativeName?: string }
> = {
  EN: { englishName: "English" },
  HI: { englishName: "Hindi", nativeName: "हिन्दी" },
  AS: { englishName: "Assamese", nativeName: "অসমীয়া" },
  BN: { englishName: "Bengali", nativeName: "বাংলা" },
  GU: { englishName: "Gujarati", nativeName: "ગુજરાતી" },
  KN: { englishName: "Kannada", nativeName: "ಕನ್ನಡ" },
  KS: { englishName: "Kashmiri", nativeName: "کٲشُر" },
  ML: { englishName: "Malayalam", nativeName: "മലയാളം" },
  MR: { englishName: "Marathi", nativeName: "मराठी" },
  NE: { englishName: "Nepali", nativeName: "नेपाली" },
  OR: { englishName: "Odia", nativeName: "ଓଡ଼ିଆ" },
  PA: { englishName: "Punjabi", nativeName: "ਪੰਜਾਬੀ" },
  SA: { englishName: "Sanskrit", nativeName: "संस्कृतम्" },
  TA: { englishName: "Tamil", nativeName: "தமிழ்" },
  TE: { englishName: "Telugu", nativeName: "తెలుగు" },
  UR: { englishName: "Urdu", nativeName: "اردو" },
};

const LANGUAGE_FALLBACK_EMOJIS: Record<string, string> = {
  EN: "🇬🇧",
  HI: "🇮🇳",
  AS: "🇮🇳",
  BN: "🇧🇩",
  GU: "🇮🇳",
  KN: "🇮🇳",
  KS: "🇮🇳",
  ML: "🇮🇳",
  MR: "🇮🇳",
  NE: "🇳🇵",
  OR: "🇮🇳",
  PA: "🇮🇳",
  SA: "📜",
  TA: "🇮🇳",
  TE: "🇮🇳",
  UR: "🇵🇰",
};

const normalizeCode = (code?: string) => {
  const raw = String(code ?? "").trim();
  if (!raw) return DEFAULT_LANG;
  return raw.split("-")[0].toUpperCase();
};

const normalizeDirection = (value?: string): "ltr" | "rtl" => {
  if (!value) return DEFAULT_DIRECTION;
  const normalized = value.trim().toLowerCase();
  if (normalized === "rtl") return "rtl";
  return "ltr";
};

const toDisplayLanguageName = (code: string, item: Partial<LanguageOption> = {}) => {
  const normalizedCode = normalizeCode(code);
  const fallback = LANGUAGE_FALLBACK_NAMES[normalizedCode] || {};
  const englishName = String(
    item.englishName ??
      item.displayName ??
      item.name ??
      fallback.englishName ??
      normalizedCode
  ).trim() || normalizedCode;
  const nativeName = String(item.nativeName ?? "").trim() || String(fallback.nativeName ?? "").trim();
  const safeNativeName = nativeName && nativeName !== englishName ? nativeName : "";
  const displayName = safeNativeName ? `${englishName} / ${safeNativeName}` : englishName;

  return {
    code: normalizedCode,
    englishName,
    nativeName: safeNativeName,
    displayName,
    name: englishName,
    emoji: String(item.emoji ?? item.flag ?? LANGUAGE_FALLBACK_EMOJIS[normalizedCode] ?? "").trim(),
    flag: String(item.flag ?? item.emoji ?? LANGUAGE_FALLBACK_EMOJIS[normalizedCode] ?? "").trim(),
  };
};

const deriveDirectionForLang = (langCode: string, languages: LanguageOption[]) => {
  const normalized = normalizeCode(langCode);
  const match = languages.find((option) => option.code === normalized);
  return match?.direction ?? DEFAULT_DIRECTION;
};

type CachedLookup<T> = {
  version: number;
  fetchedAt: number;
  data: T;
};

const isLookupCacheFresh = (fetchedAt?: number) => {
  if (!Number.isFinite(fetchedAt)) return false;
  return Date.now() - Number(fetchedAt) < LOOKUP_CACHE_TTL_MS;
};

const buildLangCacheKey = (countryCode?: string) => {
  const normalized = String(countryCode || "AUTO").trim().toUpperCase() || "AUTO";
  return `${LANG_CACHE_PREFIX}:${normalized}`;
};
const buildI18nCacheKey = (langCode: string) =>
  `${I18N_CACHE_PREFIX}:${normalizeCode(langCode)}`;

const readLookupCache = async <T,>(key: string): Promise<CachedLookup<T> | null> => {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedLookup<T>;
    if (!parsed || typeof parsed !== "object") return null;
    if (Number(parsed.version) !== LOOKUP_CACHE_VERSION) return null;
    if (!("data" in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeLookupCache = async <T,>(key: string, data: T) => {
  const payload: CachedLookup<T> = {
    version: LOOKUP_CACHE_VERSION,
    fetchedAt: Date.now(),
    data,
  };
  try {
    await AsyncStorage.setItem(key, JSON.stringify(payload));
  } catch {
    /* ignore cache write failures */
  }
};

const formatWithVars = (value: string, vars: Record<string, any> = {}) => {
  const base = String(value ?? "");
  return base.replace(/\{(\w+)\}/g, (_m, name) =>
    vars[name] === undefined || vars[name] === null ? `{${name}}` : String(vars[name])
  );
};

const t = (key: string, vars: Record<string, any> = {}) =>
  formatWithVars(String(key ?? ""), vars);

const LanguageContext = createContext<LanguageCtx>({
  t,
  lang: DEFAULT_LANG,
  langName: LANG_OPTIONS[0].name,
  direction: DEFAULT_DIRECTION,
  availableLangs: LANG_OPTIONS,
  loading: false,
  isLanguageOpen: false,
  openLanguage: () => {},
  closeLanguage: () => {},
  selectLanguage: () => {},
  country: null,
  availableCountries: [],
  countryListLoading: false,
  isCountryOpen: false,
  openCountry: () => {},
  closeCountry: () => {},
  selectCountry: () => {},
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const auth = useAuth();
  const [lang, setLang] = useState(DEFAULT_LANG);
  const [availableLangs, setAvailableLangs] = useState<LanguageOption[]>(LANG_OPTIONS);
  const [isLanguageOpen, setIsLanguageOpen] = useState(false);
  const [langListLoading, setLangListLoading] = useState(false);
  const [country, setCountry] = useState<string | null>(null);
  const [availableCountries, setAvailableCountries] = useState<CountryOption[]>([]);
  const [countryListLoading, setCountryListLoading] = useState(false);
  const [isCountryOpen, setIsCountryOpen] = useState(false);
  const [i18nStrings, setI18nStrings] = useState<Record<string, string>>({});
  const defaultSimulatorCountry = useMemo<string | null>(() => {
    if (!__DEV__) return null;
    return "IN";
  }, []);
  const lastSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (auth.initializing) return;
    const currentSessionId = auth.sessionId || null;
    const previousSessionId = lastSessionIdRef.current;
    lastSessionIdRef.current = currentSessionId;

    if (currentSessionId || previousSessionId === null) return;

    setLang(DEFAULT_LANG);
    setCountry(null);
    setIsLanguageOpen(false);
    setIsCountryOpen(false);
    AsyncStorage.multiRemove([LANG_STORAGE_KEY, COUNTRY_STORAGE_KEY]).catch(() => {});
  }, [auth.initializing, auth.sessionId]);

  useEffect(() => {
    if (auth.initializing) return;
    if (!auth.sessionId) {
      setLang(DEFAULT_LANG);
      AsyncStorage.removeItem(LANG_STORAGE_KEY).catch(() => {});
      return;
    }
    let active = true;
    AsyncStorage.getItem(LANG_STORAGE_KEY)
      .then((value) => {
        if (active && value) {
          setLang(normalizeCode(value));
        }
      })
      .catch(() => {})
      .finally(() => {
        active = false;
      });
  }, [auth.initializing, auth.sessionId]);

  useEffect(() => {
    if (auth.initializing) return;
    if (!auth.sessionId) {
      setCountry(null);
      AsyncStorage.removeItem(COUNTRY_STORAGE_KEY).catch(() => {});
      return;
    }
    let active = true;
    AsyncStorage.getItem(COUNTRY_STORAGE_KEY)
      .then((value) => {
        if (active && value) {
          setCountry(value ? value.toUpperCase() : null);
        }
      })
      .catch(() => {})
      .finally(() => {
        active = false;
      });
  }, [auth.initializing, auth.sessionId]);

  const openLanguage = useCallback(() => setIsLanguageOpen(true), []);
  const closeLanguage = useCallback(() => setIsLanguageOpen(false), []);
  const openCountry = useCallback(() => setIsCountryOpen(true), []);
  const closeCountry = useCallback(() => setIsCountryOpen(false), []);
  const selectLanguage = useCallback(async (code: string) => {
    const normalized = normalizeCode(code);
    setLang(normalized);
    try {
      await AsyncStorage.setItem(LANG_STORAGE_KEY, normalized);
    } catch {
      /* ignore */
    }
    setIsLanguageOpen(false);
  }, []);
  const fetchLanguages = useCallback(
    async (overrideCountry?: string) => {
      const sessionId = location.geoSessionId;
      if (!sessionId) return;

      const candidates = [
        overrideCountry,
        country,
        defaultSimulatorCountry,
      ]
        .filter(Boolean)
        .map((value) => value?.toUpperCase?.() ?? "")
        .filter(Boolean);
      const selectedCountry = candidates[0] ?? "";
      const cacheKey = buildLangCacheKey(selectedCountry);
      const cachedLanguages = await readLookupCache<LanguageOption[]>(cacheKey);
      const hasFreshCachedLanguages =
        Array.isArray(cachedLanguages?.data) &&
        cachedLanguages!.data.length > 0 &&
        isLookupCacheFresh(cachedLanguages?.fetchedAt);

      if (hasFreshCachedLanguages) {
        setAvailableLangs(cachedLanguages!.data);
      }

      setLangListLoading(!hasFreshCachedLanguages);

      try {
        if (LANGUAGE_DEBUG && __DEV__) {
          console.debug("[language] fetching", {
            sessionId,
            selectedCountry,
            coords: location.coords,
            place: location.place,
          });
        }

        const headers: Record<string, string> = {
          Accept: "application/json",
          "x-session-id": sessionId,
        };
        if (location.coords?.lat != null && location.coords?.lng != null) {
          headers["x-geo-lat"] = String(location.coords.lat);
          headers["x-geo-lng"] = String(location.coords.lng);
        }
        if (location.place) {
          headers["x-geo-place"] = location.place;
        }

        const url =
          `${LANG_ENDPOINT}?session=${encodeURIComponent(sessionId)}` +
          (selectedCountry ? `&country=${encodeURIComponent(selectedCountry)}` : "");

        const response = await fetch(url, { headers });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const json = await response.json();
        if (!Array.isArray(json)) throw new Error("Invalid language payload");

        const mapped = json
          .map((item: any): LanguageOption | null => {
            const code = String(item.id ?? item.code ?? "").trim().toUpperCase();
            if (!code) return null;
            const labels = toDisplayLanguageName(code, item);
            const flag = String(item.flag ?? item.emoji ?? item.countryEmojiName ?? item.countryFalgEmoji ?? "").trim();
            return {
              code: labels.code,
              name: labels.name,
              displayName: labels.displayName,
              englishName: labels.englishName,
              nativeName: labels.nativeName,
              emoji: labels.emoji || flag || LANGUAGE_FALLBACK_EMOJIS[code] || "",
              flag: labels.flag || flag || LANGUAGE_FALLBACK_EMOJIS[code] || "",
              direction: normalizeDirection(item.direction),
              voice: Boolean(item.voice),
            };
          })
          .filter((item): item is LanguageOption => Boolean(item));

        const derivedCountry = response.headers?.get?.("x-app-country");
        if (derivedCountry) {
          const normalized = derivedCountry.trim().toUpperCase();
          if (normalized && normalized !== country) {
            setCountry(normalized);
            AsyncStorage.setItem(COUNTRY_STORAGE_KEY, normalized).catch(() => {});
          }
        }

        if (mapped.length) {
          setAvailableLangs(mapped);
          const derivedKey = buildLangCacheKey(derivedCountry || selectedCountry);
          void writeLookupCache(derivedKey, mapped);
        }
      } catch (error) {
        if (
          !hasFreshCachedLanguages &&
          Array.isArray(cachedLanguages?.data) &&
          cachedLanguages.data.length
        ) {
          setAvailableLangs(cachedLanguages.data);
        }
        if (LANGUAGE_DEBUG && __DEV__) {
          console.debug("[language] fetch failed", error);
        }
      } finally {
        setLangListLoading(false);
      }
    },
    [
      country,
      defaultSimulatorCountry,
      location.coords?.lat,
      location.coords?.lng,
      location.geoSessionId,
      location.place,
    ]
  );

  useEffect(() => {
    if (!location.geoSessionId) return;
    void fetchLanguages();
  }, [fetchLanguages, location.geoSessionId]);

  const selectCountry = useCallback(
    (code: string) => {
      const normalized = code?.trim()?.toUpperCase() || null;
      setCountry(normalized);
      if (normalized) {
        AsyncStorage.setItem(COUNTRY_STORAGE_KEY, normalized).catch(() => {});
      } else {
        AsyncStorage.removeItem(COUNTRY_STORAGE_KEY).catch(() => {});
      }
      void fetchLanguages(normalized ?? undefined);
      setIsCountryOpen(false);
    },
    [fetchLanguages]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cachedCountries = await readLookupCache<CountryOption[]>(COUNTRIES_CACHE_KEY);
        const hasFreshCachedCountries =
          Array.isArray(cachedCountries?.data) &&
          cachedCountries!.data.length > 0 &&
          isLookupCacheFresh(cachedCountries?.fetchedAt);
        if (!cancelled && hasFreshCachedCountries) {
          setAvailableCountries(cachedCountries!.data);
        }

        setCountryListLoading(!hasFreshCachedCountries);
        const res = await fetch(COUNTRY_ENDPOINT, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!Array.isArray(json)) throw new Error("Invalid response");
        const mapped = json
          .map((item: any) => ({
            code: String(item.code || "").trim().toUpperCase(),
            name: item.name ?? item.code,
            emoji: item.emoji,
          }))
          .filter((countryOption) => Boolean(countryOption.code));
        if (!cancelled) {
          if (mapped.length) {
            setAvailableCountries(mapped);
            void writeLookupCache(COUNTRIES_CACHE_KEY, mapped);
          } else {
            setAvailableCountries([
              { code: "IN", name: "India", emoji: "🇮🇳" },
              { code: "US", name: "United States", emoji: "🇺🇸" },
              { code: "GB", name: "United Kingdom", emoji: "🇬🇧" },
            ]);
          }
        }
      } catch (err) {
        if (__DEV__) console.debug("[language] fetch countries failed", err);
        if (!cancelled) {
          const cachedCountries = await readLookupCache<CountryOption[]>(COUNTRIES_CACHE_KEY);
          if (Array.isArray(cachedCountries?.data) && cachedCountries.data.length) {
            setAvailableCountries(cachedCountries.data);
          } else {
            setAvailableCountries([
              { code: "IN", name: "India", emoji: "🇮🇳" },
              { code: "US", name: "United States", emoji: "🇺🇸" },
              { code: "GB", name: "United Kingdom", emoji: "🇬🇧" },
            ]);
          }
        }
      } finally {
        if (!cancelled) setCountryListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!availableLangs.length) return;
    const normalizedLang = normalizeCode(lang);
    if (availableLangs.some((option) => option.code === normalizedLang)) return;
    const fallback = availableLangs[0];
    setLang(fallback.code);
    AsyncStorage.setItem(LANG_STORAGE_KEY, fallback.code).catch(() => {});
  }, [availableLangs, lang]);

  const effectiveAvailableLangs = useMemo(() => {
    if (auth.sessionId) return availableLangs;
    const filtered = availableLangs.filter((option) =>
      GUEST_ALLOWED_LANGUAGE_CODES.has(normalizeCode(option.code))
    );
    return filtered.length ? filtered : availableLangs.slice(0, 3);
  }, [auth.sessionId, availableLangs]);

  useEffect(() => {
    if (!effectiveAvailableLangs.length) return;
    const normalizedLang = normalizeCode(lang);
    if (effectiveAvailableLangs.some((option) => option.code === normalizedLang)) return;
    const fallback = effectiveAvailableLangs[0];
    setLang(fallback.code);
    AsyncStorage.setItem(LANG_STORAGE_KEY, fallback.code).catch(() => {});
  }, [effectiveAvailableLangs, lang]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const normalizedLang = normalizeCode(lang);
      const cacheKey = buildI18nCacheKey(normalizedLang);
      const cached = await readLookupCache<Record<string, string>>(cacheKey);
      const hasFreshCached =
        cached?.data &&
        typeof cached.data === "object" &&
        isLookupCacheFresh(cached?.fetchedAt) &&
        Object.keys(cached.data).length > 0;

      if (hasFreshCached && !cancelled) {
        setI18nStrings(cached!.data);
      }

      try {
        const responses = await Promise.all(
          TMS_I18N_NAMESPACES.map(async (namespace) => {
            const url = `${TMS_I18N_ENDPOINT_BASE}/${encodeURIComponent(TMS_PROJECT_KEY)}/${encodeURIComponent(
              normalizedLang
            )}/${encodeURIComponent(namespace)}?v=latest`;
            const res = await fetch(url, { headers: { Accept: "application/json" } });
            if (!res.ok) return { namespace, strings: {} as Record<string, string> };
            const payload = await res.json().catch(() => null);
            const strings =
              payload && typeof payload === "object" && payload.strings && typeof payload.strings === "object"
                ? (payload.strings as Record<string, string>)
                : {};
            return { namespace, strings };
          })
        );

        const merged: Record<string, string> = {};
        responses.forEach(({ namespace, strings }) => {
          Object.entries(strings || {}).forEach(([k, v]) => {
            const value = String(v ?? "");
            const key = String(k || "").trim();
            if (!key) return;
            merged[`${namespace}.${key}`] = value;
            if (!merged[key]) merged[key] = value;
          });
        });

        if (!cancelled) {
          setI18nStrings(merged);
          if (Object.keys(merged).length) {
            void writeLookupCache(cacheKey, merged);
          }
        }
      } catch {
        if (!cancelled && !hasFreshCached) {
          setI18nStrings({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const langName =
    effectiveAvailableLangs.find((option) => option.code === normalizeCode(lang))?.name ??
    effectiveAvailableLangs[0]?.name ??
    DEFAULT_LANG;

  const translate = useCallback(
    (key: string, vars: Record<string, any> = {}) => {
      const raw = String(key ?? "").trim();
      if (!raw) return "";
      const aliases: Record<string, string> = {
        Home: "home.title",
        Explore: "explore.title",
        "Gita Verse": "gitaverse.title",
        Previous: "gitaverse.previous",
        Next: "gitaverse.next",
        Privacy: "privacypolicy.title",
        "Data Deletion": "datadeletion.title",
        About: "about.title",
        Contact: "contact.title",
      };
      const candidates = [raw, aliases[raw], raw.toLowerCase(), raw.replace(/\s+/g, "").toLowerCase()].filter(
        Boolean
      ) as string[];
      for (const candidate of candidates) {
        const fromMap = i18nStrings[candidate];
        if (typeof fromMap === "string" && fromMap.trim()) {
          return formatWithVars(fromMap, vars);
        }
      }
      return formatWithVars(raw, vars);
    },
    [i18nStrings]
  );

  const value = useMemo(
    () => ({
      lang,
      langName,
      t: translate,
      direction: deriveDirectionForLang(lang, effectiveAvailableLangs),
      availableLangs: effectiveAvailableLangs,
      loading: langListLoading,
      isLanguageOpen,
      openLanguage,
      closeLanguage,
      selectLanguage,
      country,
      availableCountries,
      countryListLoading,
      isCountryOpen,
      openCountry,
      closeCountry,
      selectCountry,
    }),
    [
      lang,
      langName,
      translate,
      effectiveAvailableLangs,
      langListLoading,
      isLanguageOpen,
      openLanguage,
      closeLanguage,
      selectLanguage,
      country,
      availableCountries,
      countryListLoading,
      isCountryOpen,
      openCountry,
      closeCountry,
      selectCountry,
    ]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}
