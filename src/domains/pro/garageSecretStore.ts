import { isNativeApp } from "@/domains/transport/androidBridge";
import { systemClient } from "@/domains/transport/systemClient";
import { isTauriDesktop, loadDesktopSecret, removeDesktopSecret, saveDesktopSecret } from "@/domains/transport/tauriBridge";

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

let memorySecret: string | null = null;

export const garageSecretStore = {
  async load(): Promise<string | null> {
    if (isTauriDesktop()) return loadDesktopSecret(GARAGE_SECRET_KEY);
    if (isNativeApp()) return systemClient.getItem(GARAGE_SECRET_KEY);
    if (!globalThis.indexedDB || !globalThis.crypto?.subtle) return memorySecret;
    try {
      const database = await openDatabase();
      const [key, encrypted] = await Promise.all([
        readRecord<CryptoKey>(database, AES_KEY_ID),
        readRecord<EncryptedSecret>(database, CIPHERTEXT_ID)
      ]);
      database.close();
      if (!key || !encrypted || encrypted.version !== 1) return null;
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(encrypted.nonce).buffer as ArrayBuffer },
        key,
        fromBase64(encrypted.ciphertext).buffer as ArrayBuffer
      );
      return decoder.decode(plaintext);
    } catch {
      return memorySecret;
    }
  },

  async save(value: string): Promise<void> {
    if (isTauriDesktop()) {
      await saveDesktopSecret(GARAGE_SECRET_KEY, value);
      return;
    }
    if (isNativeApp()) {
      systemClient.setItem(GARAGE_SECRET_KEY, value);
      return;
    }
    if (!globalThis.indexedDB || !globalThis.crypto?.subtle) {
      memorySecret = value;
      return;
    }
    try {
      const database = await openDatabase();
      let key = await readRecord<CryptoKey>(database, AES_KEY_ID);
      if (!key) {
        key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        await writeRecord(database, AES_KEY_ID, key);
      }
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce.buffer as ArrayBuffer },
        key,
        encoder.encode(value).buffer as ArrayBuffer
      );
      await writeRecord(database, CIPHERTEXT_ID, {
        version: 1,
        nonce: toBase64(nonce),
        ciphertext: toBase64(new Uint8Array(ciphertext))
      } satisfies EncryptedSecret);
      database.close();
      memorySecret = null;
    } catch {
      memorySecret = value;
    }
  },

  async remove(): Promise<void> {
    if (isTauriDesktop()) {
      await removeDesktopSecret(GARAGE_SECRET_KEY);
      return;
    }
    if (isNativeApp()) {
      systemClient.deleteItem(GARAGE_SECRET_KEY);
      return;
    }
    memorySecret = null;
    if (!globalThis.indexedDB) return;
    try {
      const database = await openDatabase();
      await deleteRecord(database, CIPHERTEXT_ID);
      database.close();
    } catch {
      // The absence of an IndexedDB database already satisfies removal.
    }
  }
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open secure storage."));
  });
}

function readRecord<T>(database: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error ?? new Error("Could not read secure storage."));
  });
}

function writeRecord(database: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not write secure storage."));
  });
}

function deleteRecord(database: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not clear secure storage."));
  });
}

function toBase64(value: Uint8Array): string {
  let binary = "";
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
