import { isNativeApp, nativeAppBridge } from "@/domains/transport/androidBridge";
import {
  isTauriDesktop,
  loadDesktopSecret,
  removeDesktopSecret,
  saveDesktopSecret
} from "@/domains/transport/tauriBridge";

const GARAGE_SECRET_KEY = "robosats_exp_garage_secret_v3";
const DATABASE_NAME = "robosats-exp-secrets";
const STORE_NAME = "secrets";
const AES_KEY_ID = "garage-aes-key-v3";
const CIPHERTEXT_ID = "garage-secret-v3";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type EncryptedSecret = {
  version: 1;
  nonce: string;
  ciphertext: string;
};

export const garageSecretStore = {
  async load(): Promise<string | null> {
    if (isTauriDesktop()) return loadDesktopSecret(GARAGE_SECRET_KEY);
    if (isNativeApp()) return requireNativeSecretBridge().getStorage(GARAGE_SECRET_KEY);
    requireBrowserSecretStorage(true);
    let database: IDBDatabase | undefined;
    try {
      database = await openDatabase();
      const [key, encrypted] = await readSecret(database);
      if (!encrypted) return null;
      if (!key || encrypted.version !== 1) throw 0;
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(encrypted.nonce).buffer as ArrayBuffer },
        key,
        fromBase64(encrypted.ciphertext).buffer as ArrayBuffer
      );
      return decoder.decode(plaintext);
    } catch {
      throw new Error("Fleet storage failed.");
    } finally {
      database?.close();
    }
  },

  async save(value: string): Promise<void> {
    if (isTauriDesktop()) {
      await saveDesktopSecret(GARAGE_SECRET_KEY, value);
      return;
    }
    if (isNativeApp()) {
      requireNativeSecretBridge().setStorage(GARAGE_SECRET_KEY, value);
      return;
    }
    requireBrowserSecretStorage(true);
    let database: IDBDatabase | undefined;
    try {
      database = await openDatabase();
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce.buffer as ArrayBuffer },
        key,
        encoder.encode(value).buffer as ArrayBuffer
      );
      await writeSecret(database, key, {
        version: 1,
        nonce: toBase64(nonce),
        ciphertext: toBase64(new Uint8Array(ciphertext))
      });
    } catch {
      throw new Error("Fleet storage failed.");
    } finally {
      database?.close();
    }
  },

  async remove(): Promise<void> {
    if (isTauriDesktop()) {
      await removeDesktopSecret(GARAGE_SECRET_KEY);
      return;
    }
    if (isNativeApp()) {
      requireNativeSecretBridge().deleteStorage(GARAGE_SECRET_KEY);
      return;
    }
    requireBrowserSecretStorage(false);
    let database: IDBDatabase | undefined;
    try {
      database = await openDatabase();
      await deleteSecret(database);
    } catch {
      throw new Error("Fleet storage failed.");
    } finally {
      database?.close();
    }
  }
};

function requireBrowserSecretStorage(requireCryptography: boolean): void {
  if (!globalThis.indexedDB || (requireCryptography && !globalThis.crypto?.subtle))
    throw new Error("Storage unavailable.");
}

function requireNativeSecretBridge(): RoboSatsNativeBridge {
  const bridge = nativeAppBridge();
  if (!bridge) throw new Error("Storage unavailable.");
  return bridge;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readSecret(database: IDBDatabase): Promise<[CryptoKey | undefined, EncryptedSecret | undefined]> {
  return new Promise((resolve, reject) => {
    const store = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
    const key = store.get(AES_KEY_ID);
    const encrypted = store.get(CIPHERTEXT_ID);
    let pending = 2;
    const complete = () => {
      pending -= 1;
      if (pending === 0)
        resolve([key.result as CryptoKey | undefined, encrypted.result as EncryptedSecret | undefined]);
    };
    key.onsuccess = complete;
    encrypted.onsuccess = complete;
    key.onerror = () => reject(key.error);
    encrypted.onerror = () => reject(encrypted.error);
  });
}

function writeSecret(database: IDBDatabase, key: CryptoKey, encrypted: EncryptedSecret): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.put(key, AES_KEY_ID);
    store.put(encrypted, CIPHERTEXT_ID);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function deleteSecret(database: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(CIPHERTEXT_ID);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function toBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
