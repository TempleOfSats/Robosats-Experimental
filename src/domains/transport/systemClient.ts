import { isNativeApp, nativeAppBridge } from "@/domains/transport/androidBridge";

export interface SystemClient {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  deleteItem(key: string): void;
}

class WebSystemClient implements SystemClient {
  getItem(key: string): string | null {
    return globalThis.localStorage.getItem(key);
  }

  setItem(key: string, value: string): void {
    globalThis.localStorage.setItem(key, value);
  }

  deleteItem(key: string): void {
    globalThis.localStorage.removeItem(key);
  }
}

class NativeSystemClient implements SystemClient {
  getItem(key: string): string | null {
    return nativeAppBridge()?.getStorage(key) ?? null;
  }

  setItem(key: string, value: string): void {
    nativeAppBridge()?.setStorage(key, value);
  }

  deleteItem(key: string): void {
    nativeAppBridge()?.deleteStorage(key);
  }
}

export const systemClient: SystemClient = isNativeApp() ? new NativeSystemClient() : new WebSystemClient();
