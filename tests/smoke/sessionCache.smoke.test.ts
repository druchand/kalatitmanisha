import {
  cacheSessionPayload,
  clearSessionCache,
  getSessionPayload,
  removeSessionCacheEntry,
} from "../../utils/sessionCache";

describe("sessionCache smoke", () => {
  beforeEach(() => {
    clearSessionCache();
  });

  test("stores and reads a payload by session id", () => {
    cacheSessionPayload("abc123", { ok: true, memberId: "m1" });
    expect(getSessionPayload("abc123")).toEqual({ ok: true, memberId: "m1" });
  });

  test("removes a session payload", () => {
    cacheSessionPayload("abc123", { ok: true });
    removeSessionCacheEntry("abc123");
    expect(getSessionPayload("abc123")).toBeUndefined();
  });
});
