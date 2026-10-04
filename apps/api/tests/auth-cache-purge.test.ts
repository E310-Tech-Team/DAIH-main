import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  clearPrivateCacheAndStorage,
  broadcastLogoutEvent,
} from "@daih/api-client";

describe("DAIH-QA-14: Frontend Session Expiry & Private Cache Invalidation", () => {
  let mockCaches: Record<string, { delete: any; keys: any }>;
  let mockLocalStorage: Record<string, string>;
  let mockSessionStorage: Record<string, string>;
  let postMessageToWorkerMock: any;
  let broadcastPostMessageMock: any;

  beforeEach(() => {
    vi.restoreAllMocks();

    mockLocalStorage = {
      daih_user_profile: JSON.stringify({
        id: "user-123",
        email: "user@daih.ng",
      }),
      daih_token: "jwt-token-123",
      user_preferences: "dark_mode",
      theme: "system", // non-auth key
    };

    mockSessionStorage = {
      pkce_verifier: "pkce-code-verifier-456",
    };

    postMessageToWorkerMock = vi.fn();
    broadcastPostMessageMock = vi.fn();

    // Mock Cache Storage
    const apiRequest = { url: "https://app.daih.ng/api/v1/bookings/active" };
    const identityRequest = { url: "https://app.daih.ng/identity/me" };
    const staticRequest = {
      url: "https://app.daih.ng/_next/static/chunks/app.js",
    };

    const cacheDeleteMock = vi
      .fn()
      .mockImplementation((req: any) => Promise.resolve(true));
    const cacheKeysMock = vi
      .fn()
      .mockResolvedValue([apiRequest, identityRequest, staticRequest]);

    mockCaches = {
      "daih-pwa-v1": {
        delete: cacheDeleteMock,
        keys: cacheKeysMock,
      },
    };

    // Global mock injection for Node / Vitest
    (global as any).window = {
      caches: {
        keys: vi.fn().mockResolvedValue(["daih-pwa-v1"]),
        open: vi
          .fn()
          .mockImplementation((name: string) =>
            Promise.resolve(mockCaches[name]),
          ),
      },
      BroadcastChannel: class {
        channelName: string;
        constructor(name: string) {
          this.channelName = name;
        }
        postMessage = broadcastPostMessageMock;
        close = vi.fn();
      },
      location: {
        pathname: "/dashboard",
        href: "/dashboard",
      },
    };

    (global as any).navigator = {
      serviceWorker: {
        controller: {
          postMessage: postMessageToWorkerMock,
        },
      },
    };

    (global as any).localStorage = {
      getItem: (key: string) => mockLocalStorage[key] || null,
      setItem: (key: string, val: string) => {
        mockLocalStorage[key] = val;
      },
      removeItem: (key: string) => {
        delete mockLocalStorage[key];
      },
      clear: () => {
        mockLocalStorage = {};
      },
      get length() {
        return Object.keys(mockLocalStorage).length;
      },
      key: (i: number) => Object.keys(mockLocalStorage)[i] || null,
    };

    (global as any).sessionStorage = {
      clear: vi.fn(() => {
        mockSessionStorage = {};
      }),
    };
  });

  it("purges private API cache entries while leaving static assets alone", async () => {
    await clearPrivateCacheAndStorage();

    const cache = mockCaches["daih-pwa-v1"];
    expect(cache.delete).toHaveBeenCalledTimes(2);
    expect(cache.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://app.daih.ng/api/v1/bookings/active",
      }),
    );
    expect(cache.delete).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://app.daih.ng/identity/me" }),
    );
    // Should NOT delete static chunk
    expect(cache.delete).not.toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://app.daih.ng/_next/static/chunks/app.js",
      }),
    );
  });

  it("signals active service worker controller with PURGE_PRIVATE_CACHE", async () => {
    await clearPrivateCacheAndStorage();
    expect(postMessageToWorkerMock).toHaveBeenCalledWith({
      type: "PURGE_PRIVATE_CACHE",
    });
  });

  it("purges auth and user scoped keys from localStorage and clears sessionStorage", async () => {
    await clearPrivateCacheAndStorage();

    expect(mockLocalStorage["daih_user_profile"]).toBeUndefined();
    expect(mockLocalStorage["daih_token"]).toBeUndefined();
    expect(mockLocalStorage["user_preferences"]).toBeUndefined();
    expect(mockLocalStorage["theme"]).toBe("system"); // non-auth key retained
    expect((global as any).sessionStorage.clear).toHaveBeenCalled();
  });

  it("broadcasts LOGOUT event to all open browser tabs via BroadcastChannel", () => {
    broadcastLogoutEvent();
    expect(broadcastPostMessageMock).toHaveBeenCalledWith("LOGOUT");
  });
});
