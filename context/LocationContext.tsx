import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { functionUrl } from "../utils/functionApi";

type GeoCoords = { lat: number; lng: number };
type LocationStatus = "unknown" | "ready" | "error";

type LocationCtx = {
  coords: GeoCoords | null;
  place: string | null;
  status: LocationStatus;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  geoSessionId: string | null;
};

const LOCATION_SESSION_KEY = "@gita-app/geo-session-id";
const GEO_ENDPOINT = functionUrl("geoContext");
const IP_API_URL = "https://ipapi.co/json/";

async function ensureGeoSessionId(): Promise<string> {
  const existing = await AsyncStorage.getItem(LOCATION_SESSION_KEY);
  if (existing?.trim()) return existing;
  const next = `geo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await AsyncStorage.setItem(LOCATION_SESSION_KEY, next);
  return next;
}

const LocationContext = createContext<LocationCtx>({
  coords: null,
  place: null,
  status: "unknown",
  loading: false,
  error: null,
  refresh: async () => {},
  geoSessionId: null,
});

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [coords, setCoords] = useState<GeoCoords | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [status, setStatus] = useState<LocationStatus>("unknown");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoSessionId, setGeoSessionId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(IP_API_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const nextCoords =
        typeof data.latitude === "number" && typeof data.longitude === "number"
          ? { lat: data.latitude, lng: data.longitude }
          : null;

      setCoords(nextCoords);
      const label = [data.city, data.region, data.country_name].filter(Boolean).join(", ");
      setPlace(label || null);
      setStatus("ready");

      const session = await ensureGeoSessionId();
      setGeoSessionId(session);

      try {
        await fetch(GEO_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: nextCoords?.lat ?? null,
            lng: nextCoords?.lng ?? null,
            place: label || null,
            session,
          }),
        });
      } catch (geoErr) {
        if (__DEV__) console.debug("[location] geoContext post failed", geoErr);
      }
    } catch (err: any) {
      setError(err?.message ?? "location-error");
      setStatus("error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const session = await ensureGeoSessionId();
        if (active) setGeoSessionId(session);
      } catch (err) {
        if (__DEV__) console.debug("[location] geo session init failed", err);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      coords,
      place,
      status,
      loading,
      error,
      refresh,
      geoSessionId,
    }),
    [coords, place, status, loading, error, refresh, geoSessionId]
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation() {
  return useContext(LocationContext);
}
