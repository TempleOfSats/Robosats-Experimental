/// <reference types="vite/client" />

interface RoboSatsNativeBridge {
    getStorage(key: string): string | null;
    setStorage(key: string, value: string): void;
    deleteStorage(key: string): void;
    getTorStatus(): string;
    getTorDiagnostics(): string;
    getNotificationState(): string;
    setNotificationsEnabled(enabled: boolean): void;
    performHaptic?(intent: "selection" | "commit" | "success" | "reject"): void;
    httpRequest(requestId: string, method: string, url: string, headersJson: string, body: string): void;
    cancelHttpRequest?(requestId: string): void;
    recoverTorTransport?(): void;
    reconnectTorTransport?(): void;
    resetTorTransport?(): void;
    openWebSocket(socketId: string, url: string, protocolsJson: string): void;
    sendWebSocket(socketId: string, message: string): boolean;
    closeWebSocket(socketId: string, code: number, reason: string): void;
    copyToClipboard(value: string): void;
    openExternal(url: string): void;
    saveFile?(filename: string, mimeType: string, contentBase64: string): boolean;
}

interface Window {
  RobosatsSettings?: string;
  AndroidAppRobosats?: RoboSatsNativeBridge;
  IOSAppRobosats?: RoboSatsNativeBridge;
  __robosatsNativeTransport?: {
    reset(message: string): void;
    resolve(requestId: string, result: import("@/domains/transport/androidBridge").NativeHttpResult): void;
    reject(requestId: string, message: string): void;
    webSocketOpen(socketId: string, protocol: string): void;
    webSocketMessage(socketId: string, message: string): void;
    webSocketClosing(socketId: string, code: number, reason: string): void;
    webSocketClosed(socketId: string, code: number, reason: string): void;
    webSocketError(socketId: string, message: string): void;
  };
}
