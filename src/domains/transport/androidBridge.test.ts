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

  it("parses a coordinator/order native hint and supports unsubscribe", async () => {
    const windowTarget = new EventTarget();
    vi.stubGlobal("window", windowTarget);
    const { subscribeNativeOrderHints } = await import("./androidBridge");
    const listener = vi.fn();
    const unsubscribe = subscribeNativeOrderHints(listener);
    const hint = new Event("robosats:native-order-hint");
    Object.defineProperty(hint, "detail", { value: { orderId: "lake/91330" } });

    windowTarget.dispatchEvent(hint);
    unsubscribe();
    windowTarget.dispatchEvent(hint);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ shortAlias: "lake", orderId: 91330 });
  });

  it("accepts a positive numeric native order hint without an alias", async () => {
    const windowTarget = new EventTarget();
    vi.stubGlobal("window", windowTarget);
    const { subscribeNativeOrderHints } = await import("./androidBridge");
    const listener = vi.fn();
    subscribeNativeOrderHints(listener);
    const hint = new Event("robosats:native-order-hint");
    Object.defineProperty(hint, "detail", { value: { orderId: 91330 } });

    windowTarget.dispatchEvent(hint);

    expect(listener).toHaveBeenCalledWith({ orderId: 91330 });
  });

  it("preserves a missing or invalid native order id as a broad hint", async () => {
    const windowTarget = new EventTarget();
    vi.stubGlobal("window", windowTarget);
    const { subscribeNativeOrderHints } = await import("./androidBridge");
    const listener = vi.fn();
    subscribeNativeOrderHints(listener);
    const missing = new Event("robosats:native-order-hint");
    Object.defineProperty(missing, "detail", { value: { orderId: null } });
    const invalid = new Event("robosats:native-order-hint");
    Object.defineProperty(invalid, "detail", { value: { orderId: "not-an-order" } });

    windowTarget.dispatchEvent(missing);
    windowTarget.dispatchEvent(invalid);

    expect(listener.mock.calls).toEqual([[{}], [{}]]);
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

  it("cancels a native HTTP call when the browser timeout expires", async () => {
    vi.useFakeTimers();
    const cancelHttpRequest = vi.fn();
    vi.stubGlobal("window", {
      AndroidAppRobosats: {
        httpRequest: vi.fn(),
        cancelHttpRequest
      }
    });

    const { nativeHttpRequest } = await import("./androidBridge");
    const request = nativeHttpRequest("http://coordinator.onion/api/", {}, 1_000);
    const rejection = expect(request).rejects.toThrow("Tor request timeout after 1000ms");
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    expect(cancelHttpRequest).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("preserves an external cancellation reason", async () => {
    const cancelHttpRequest = vi.fn();
    vi.stubGlobal("window", {
      AndroidAppRobosats: {
        httpRequest: vi.fn(),
        cancelHttpRequest
      }
    });
    const controller = new AbortController();
    const { nativeHttpRequest } = await import("./androidBridge");
    const request = nativeHttpRequest("http://coordinator.onion/api/", {}, 90_000, controller.signal);

    controller.abort(new Error("Tor request timeout after 20000ms"));

    await expect(request).rejects.toThrow("Tor request timeout after 20000ms");
    expect(cancelHttpRequest).toHaveBeenCalledOnce();
  });

  it("atomically rejects pending requests when native transport restarts", async () => {
    const bridgeWindow = {
      AndroidAppRobosats: {
        httpRequest: vi.fn(),
        cancelHttpRequest: vi.fn()
      },
      __robosatsNativeTransport: undefined as Window["__robosatsNativeTransport"]
    };
    vi.stubGlobal("window", bridgeWindow);
    const { nativeHttpRequest } = await import("./androidBridge");
    const request = nativeHttpRequest("http://coordinator.onion/api/", {}, 90_000);
    const rejection = expect(request).rejects.toMatchObject({
      name: "AbortError",
      message: "App resumed"
    });

    bridgeWindow.__robosatsNativeTransport?.reset("App resumed");

    await rejection;
  });

  it("cancels pending native requests when the app transport is suspended", async () => {
    const cancelHttpRequest = vi.fn();
    vi.stubGlobal("window", {
      AndroidAppRobosats: {
        httpRequest: vi.fn(),
        cancelHttpRequest
      }
    });
    const {
      nativeHttpRequest,
      resumeNativeTransport,
      suspendNativeTransport
    } = await import("./androidBridge");
    const request = nativeHttpRequest("http://coordinator.onion/api/");
    const rejection = expect(request).rejects.toMatchObject({
      name: "AbortError",
      message: "App backgrounded"
    });

    suspendNativeTransport();

    await rejection;
    expect(cancelHttpRequest).toHaveBeenCalledOnce();
    resumeNativeTransport();
  });

  it("fails direct native requests fast while the app transport is suspended", async () => {
    const httpRequest = vi.fn();
    vi.stubGlobal("window", {
      AndroidAppRobosats: {
        httpRequest,
        cancelHttpRequest: vi.fn()
      }
    });
    const {
      nativeHttpRequest,
      resumeNativeTransport,
      suspendNativeTransport
    } = await import("./androidBridge");

    suspendNativeTransport();
    await expect(nativeHttpRequest("http://coordinator.onion/api/")).rejects.toMatchObject({
      name: "AbortError",
      message: "Native transport is suspended"
    });
    expect(httpRequest).not.toHaveBeenCalled();

    resumeNativeTransport();
  });

  it("closes tracked native sockets when the app transport is suspended", async () => {
    const bridgeWindow = {
      IOSAppRobosats: {
        httpRequest: vi.fn(),
        openWebSocket: vi.fn(),
        sendWebSocket: vi.fn(() => true),
        closeWebSocket: vi.fn()
      },
      __robosatsNativeTransport: undefined as Window["__robosatsNativeTransport"]
    };
    vi.stubGlobal("window", bridgeWindow);
    const { NativeWebSocket, suspendNativeTransport } = await import("./androidBridge");
    const socket = new NativeWebSocket("ws://relay.onion/relay/");
    const closed = vi.fn();
    socket.addEventListener("close", closed);
    const socketId = bridgeWindow.IOSAppRobosats.openWebSocket.mock.calls[0]?.[0] as string;

    suspendNativeTransport();
    bridgeWindow.__robosatsNativeTransport?.webSocketClosed(socketId, 1000, "late callback");

    expect(bridgeWindow.IOSAppRobosats.closeWebSocket).toHaveBeenCalledWith(
      socketId,
      1001,
      "App backgrounded"
    );
    expect(socket.readyState).toBe(NativeWebSocket.CLOSED);
    expect(closed).toHaveBeenCalledOnce();
  });

  it("does not open a native socket while transport is suspended", async () => {
    const openWebSocket = vi.fn();
    vi.stubGlobal("window", {
      AndroidAppRobosats: {
        httpRequest: vi.fn(),
        openWebSocket,
        sendWebSocket: vi.fn(() => true),
        closeWebSocket: vi.fn()
      }
    });
    const { NativeWebSocket, resumeNativeTransport, suspendNativeTransport } = await import("./androidBridge");

    suspendNativeTransport();
    const socket = new NativeWebSocket("ws://relay.onion/relay/");
    const closed = vi.fn();
    socket.addEventListener("close", closed);
    await Promise.resolve();

    expect(openWebSocket).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(NativeWebSocket.CLOSED);
    expect(closed).toHaveBeenCalledOnce();
    resumeNativeTransport();
  });

  it("closes native sockets once when transport restarts", async () => {
    const bridgeWindow = {
      AndroidAppRobosats: {
        httpRequest: vi.fn(),
        openWebSocket: vi.fn(),
        sendWebSocket: vi.fn(() => true),
        closeWebSocket: vi.fn()
      },
      __robosatsNativeTransport: undefined as Window["__robosatsNativeTransport"]
    };
    vi.stubGlobal("window", bridgeWindow);
    const { NativeWebSocket } = await import("./androidBridge");
    const socket = new NativeWebSocket("ws://relay.onion/relay/");
    const closed = vi.fn();
    socket.addEventListener("close", closed);
    const socketId = bridgeWindow.AndroidAppRobosats.openWebSocket.mock.calls[0]?.[0] as string;
    bridgeWindow.__robosatsNativeTransport?.webSocketOpen(socketId, "");

    bridgeWindow.__robosatsNativeTransport?.reset("App resumed");
    bridgeWindow.__robosatsNativeTransport?.webSocketClosed(socketId, 1000, "late callback");

    expect(socket.readyState).toBe(NativeWebSocket.CLOSED);
    expect(closed).toHaveBeenCalledOnce();
    expect(closed.mock.calls[0]?.[0]).toMatchObject({
      code: 1001,
      reason: "App resumed",
      wasClean: false
    });
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
      getNativeNotificationState,
      getNativeTorDiagnostics,
      setNativeNotificationsEnabled
    } = await import("./androidBridge");

    expect(getNativeNotificationState()?.enabled).toBe(true);
    expect(getNativeTorDiagnostics()?.socksPort).toBe(17392);
    setNativeNotificationsEnabled(false);
    expect(setNotificationsEnabled).toHaveBeenCalledWith(false);
  });

  it("requests an explicit native Tor reconnect when supported", async () => {
    const reconnectTorTransport = vi.fn();
    const recoverTorTransport = vi.fn();
    vi.stubGlobal("window", {
      AndroidAppRobosats: {
        httpRequest: vi.fn(),
        reconnectTorTransport,
        recoverTorTransport
      }
    });

    const { requestNativeTorReconnect } = await import("./androidBridge");

    expect(requestNativeTorReconnect()).toBe(true);
    expect(reconnectTorTransport).toHaveBeenCalledOnce();
    expect(recoverTorTransport).not.toHaveBeenCalled();
  });

  it("requests a destructive native Tor reset only when explicitly supported", async () => {
    const resetTorTransport = vi.fn();
    vi.stubGlobal("window", {
      AndroidAppRobosats: {
        httpRequest: vi.fn(),
        resetTorTransport
      }
    });

    const { requestNativeTorReset } = await import("./androidBridge");

    expect(requestNativeTorReset()).toBe(true);
    expect(resetTorTransport).toHaveBeenCalledOnce();
  });

  it("reports when destructive native Tor reset is unavailable", async () => {
    vi.stubGlobal("window", {
      IOSAppRobosats: {
        httpRequest: vi.fn(),
        reconnectTorTransport: vi.fn()
      }
    });

    const { requestNativeTorReset } = await import("./androidBridge");

    expect(requestNativeTorReset()).toBe(false);
  });

  it("requests an explicit iOS Tor reconnect when supported", async () => {
    const reconnectTorTransport = vi.fn();
    vi.stubGlobal("window", {
      IOSAppRobosats: {
        httpRequest: vi.fn(),
        reconnectTorTransport
      }
    });

    const { requestNativeTorReconnect } = await import("./androidBridge");

    expect(requestNativeTorReconnect()).toBe(true);
    expect(reconnectTorTransport).toHaveBeenCalledOnce();
  });

  it("does not substitute cooldown-protected automatic recovery", async () => {
    const recoverTorTransport = vi.fn();
    vi.stubGlobal("window", {
      IOSAppRobosats: {
        httpRequest: vi.fn(),
        recoverTorTransport
      }
    });

    const { requestNativeTorReconnect } = await import("./androidBridge");

    expect(requestNativeTorReconnect()).toBe(false);
    expect(recoverTorTransport).not.toHaveBeenCalled();
  });

  it("reports when native Tor reconnect is unavailable", async () => {
    vi.stubGlobal("window", {
      AndroidAppRobosats: {
        httpRequest: vi.fn()
      }
    });

    const { requestNativeTorReconnect } = await import("./androidBridge");

    expect(requestNativeTorReconnect()).toBe(false);
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
