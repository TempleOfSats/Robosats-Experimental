/// <reference types="vite/client" />

declare module "robo-identities-wasm/robo_identities_wasm.js" {
  export function generate_roboname(initialString: string): string;
  export function async_generate_robohash(initialString: string, size: number): Promise<string>;
}

interface RoboSatsNativeBridge {
    getStorage(key: string): string | null;
    setStorage(key: string, value: string): void;
    deleteStorage(key: string): void;
    getTorStatus(): string;
    getTorDiagnostics(): string;
    getNotificationState(): string;
    setNotificationsEnabled(enabled: boolean): void;
    httpRequest(requestId: string, method: string, url: string, headersJson: string, body: string): void;
    cancelHttpRequest?(requestId: string): void;
    openWebSocket(socketId: string, url: string, protocolsJson: string): void;
    sendWebSocket(socketId: string, message: string): boolean;
    closeWebSocket(socketId: string, code: number, reason: string): void;
    copyToClipboard(value: string): void;
    openExternal(url: string): void;
    clientLog?(message: string): void;
}

interface Window {
  RobosatsSettings?: string;
  AndroidDataRobosats?: {
    navigateToPage?: string;
  };
  AndroidAppRobosats?: RoboSatsNativeBridge;
  IOSAppRobosats?: RoboSatsNativeBridge;
  __robosatsNativeTransport?: {
    resolve(requestId: string, result: import("@/domains/transport/androidBridge").NativeHttpResult): void;
    reject(requestId: string, message: string): void;
    webSocketOpen(socketId: string, protocol: string): void;
    webSocketMessage(socketId: string, message: string): void;
    webSocketClosing(socketId: string, code: number, reason: string): void;
    webSocketClosed(socketId: string, code: number, reason: string): void;
    webSocketError(socketId: string, message: string): void;
  };
}
