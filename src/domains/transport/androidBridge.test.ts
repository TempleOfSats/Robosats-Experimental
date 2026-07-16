import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Native transport bridge", () => {
  it("can be imported outside a browser", async () => {
    vi.stubGlobal("window", undefined);
    await expect(import("./androidBridge")).resolves.toBeDefined();
  });

  it("resolves native HTTP responses through the JNI callback", async () => {
    const bridgeWindow = {
      AndroidAppRobosats: {
        httpRequest: vi.fn((requestId: string) => {
          queueMicrotask(() => {
            bridgeWindow.__robosatsNativeTransport?.resolve(requestId, {
              status: 200,
              headers: { "content-type": "application/json" },
              body: '{"ok":true}'
            });
          });
        })
      },
      __robosatsNativeTransport: undefined as Window["__robosatsNativeTransport"]
    };
    vi.stubGlobal("window", bridgeWindow);

    const { nativeHttpRequest } = await import("./androidBridge");
    await expect(nativeHttpRequest("http://coordinator.onion/api/", {}, 1_000)).resolves.toEqual({
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"ok":true}'
    });
    expect(bridgeWindow.AndroidAppRobosats.httpRequest).toHaveBeenCalledOnce();
  });

  it("rejects native HTTP failures through the JNI callback", async () => {
    const bridgeWindow = {
      AndroidAppRobosats: {
        httpRequest: vi.fn((requestId: string) => {
          queueMicrotask(() => {
            bridgeWindow.__robosatsNativeTransport?.reject(requestId, "Tor request failed");
          });
        })
      },
      __robosatsNativeTransport: undefined as Window["__robosatsNativeTransport"]
    };
    vi.stubGlobal("window", bridgeWindow);

    const { nativeHttpRequest } = await import("./androidBridge");
    await expect(nativeHttpRequest("http://coordinator.onion/api/", {}, 1_000)).rejects.toThrow(
      "Tor request failed"
    );
  });

  it("discards sends after close like a browser WebSocket", async () => {
    const bridgeWindow = {
      AndroidAppRobosats: {
        httpRequest: vi.fn(),
        openWebSocket: vi.fn(),
        sendWebSocket: vi.fn(() => true),
        closeWebSocket: vi.fn()
      }
    };
    vi.stubGlobal("window", bridgeWindow);

    const { NativeWebSocket } = await import("./androidBridge");
    const socket = new NativeWebSocket("ws://relay.onion/relay/");
    expect(() => socket.send("before open")).toThrowError(DOMException);

    socket.close();
    expect(() => socket.send("after close")).not.toThrow();
    expect(bridgeWindow.AndroidAppRobosats.sendWebSocket).not.toHaveBeenCalled();
  });

  it("reads Android notification and Tor diagnostics", async () => {
    const setNotificationsEnabled = vi.fn();
    vi.stubGlobal("window", {
      AndroidAppRobosats: {
        httpRequest: vi.fn(),
        getNotificationState: () => JSON.stringify({
          enabled: true,
          permissionGranted: true,
          permissionRequired: true
        }),
        getTorDiagnostics: () => JSON.stringify({
          connected: true,
          state: "connected",
          socksHost: "127.0.0.1",
          socksPort: 17392,
          implementation: "Arti",
          artiVersion: "test",
          clientInitialized: true,
          proxyRunning: true,
          networkAvailable: true,
          routing: "Native Tor transport",
          appVersion: "test",
          error: null
        }),
        setNotificationsEnabled
      }
    });

    const {
      getAndroidNotificationState,
      getAndroidTorDiagnostics,
      setAndroidNotificationsEnabled
    } = await import("./androidBridge");

    expect(getAndroidNotificationState()?.enabled).toBe(true);
    expect(getAndroidTorDiagnostics()?.socksPort).toBe(17392);
    setAndroidNotificationsEnabled(false);
    expect(setNotificationsEnabled).toHaveBeenCalledWith(false);
  });

  it("uses the iOS bridge when Android is not present", async () => {
    const bridgeWindow = {
      IOSAppRobosats: {
        httpRequest: vi.fn((requestId: string) => {
          queueMicrotask(() => {
            bridgeWindow.__robosatsNativeTransport?.resolve(requestId, {
              status: 204,
              headers: {},
              body: ""
            });
          });
        })
      },
      __robosatsNativeTransport: undefined as Window["__robosatsNativeTransport"]
    };
    vi.stubGlobal("window", bridgeWindow);

    const { isIOSApp, isNativeApp, nativeHttpRequest } = await import("./androidBridge");
    expect(isIOSApp()).toBe(true);
    expect(isNativeApp()).toBe(true);
    await expect(nativeHttpRequest("http://coordinator.onion/api/", {}, 1_000)).resolves.toMatchObject({
      status: 204
    });
    expect(bridgeWindow.IOSAppRobosats.httpRequest).toHaveBeenCalledOnce();
  });
});
