type SessionCacheEntry = {
  sessionId: string;
  payload?: any;
  storedAt: number;
};

const sessionCache = new Map<string, SessionCacheEntry>();

export function cacheSessionPayload(sessionId: string, payload?: any): void {
  if (!sessionId) return;
  sessionCache.set(sessionId, { sessionId, payload, storedAt: Date.now() });
}

export function getSessionPayload(sessionId?: string): any | undefined {
  if (!sessionId) return undefined;
  return sessionCache.get(sessionId)?.payload;
}

export function removeSessionCacheEntry(sessionId?: string): void {
  if (!sessionId) return;
  sessionCache.delete(sessionId);
}

export function clearSessionCache(): void {
  sessionCache.clear();
}
