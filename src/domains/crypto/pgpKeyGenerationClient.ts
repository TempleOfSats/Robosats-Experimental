import type { PgpKeyPair } from "@/domains/crypto/pgpKeyGeneration";

const KEY_GENERATION_TIMEOUT_MS = 60_000;
const pendingKeyGenerations = new Map<string, Promise<PgpKeyPair>>();

type GenerateKeyResponse = { ok: true; keyPair: PgpKeyPair } | { ok: false };

export async function generatePgpKeyPairOffMainThread(highEntropyToken: string): Promise<PgpKeyPair> {
  const pending = pendingKeyGenerations.get(highEntropyToken);
  if (pending) return pending;

  const generation = generatePgpKeyPair(highEntropyToken);
  pendingKeyGenerations.set(highEntropyToken, generation);
  try {
    return await generation;
  } finally {
    if (pendingKeyGenerations.get(highEntropyToken) === generation) {
      pendingKeyGenerations.delete(highEntropyToken);
    }
  }
}

async function generatePgpKeyPair(highEntropyToken: string): Promise<PgpKeyPair> {
  if (typeof Worker === "undefined") return generateOnCurrentThread(highEntropyToken);
  try {
    return await generateWithWorker(highEntropyToken);
  } catch {
    return generateOnCurrentThread(highEntropyToken);
  }
}

function generateWithWorker(highEntropyToken: string): Promise<PgpKeyPair> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pgpKeyGeneration.worker.ts", import.meta.url), { type: "module" });
    let settled = false;
    let timeout: ReturnType<typeof globalThis.setTimeout>;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      worker.terminate();
      callback();
    };
    timeout = globalThis.setTimeout(
      () => finish(() => reject(new Error("PGP key generation worker timed out"))),
      KEY_GENERATION_TIMEOUT_MS
    );
    worker.onmessage = (event: MessageEvent<GenerateKeyResponse>) => {
      finish(() => {
        if (event.data?.ok === true && isPgpKeyPair(event.data.keyPair)) resolve(event.data.keyPair);
        else reject(new Error("PGP key generation worker failed"));
      });
    };
    worker.onerror = () => finish(() => reject(new Error("PGP key generation worker unavailable")));
    try {
      worker.postMessage({ highEntropyToken });
    } catch {
      finish(() => reject(new Error("PGP key generation worker could not start")));
    }
  });
}

function isPgpKeyPair(value: unknown): value is PgpKeyPair {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PgpKeyPair>;
  return (
    typeof candidate.publicKeyArmored === "string" &&
    candidate.publicKeyArmored.length > 0 &&
    typeof candidate.encryptedPrivateKeyArmored === "string" &&
    candidate.encryptedPrivateKeyArmored.length > 0
  );
}

async function generateOnCurrentThread(highEntropyToken: string): Promise<PgpKeyPair> {
  const { generatePgpKeyPairOnCurrentThread } = await import("@/domains/crypto/pgpKeyGeneration");
  return generatePgpKeyPairOnCurrentThread(highEntropyToken);
}
