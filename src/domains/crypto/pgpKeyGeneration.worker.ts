import { generatePgpKeyPairOnCurrentThread } from "@/domains/crypto/pgpKeyGeneration";

interface GenerateKeyRequest {
  highEntropyToken: string;
}

type GenerateKeyResponse =
  | {
      ok: true;
      keyPair: Awaited<ReturnType<typeof generatePgpKeyPairOnCurrentThread>>;
    }
  | { ok: false };

const workerScope = self as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<GenerateKeyRequest>) => void): void;
  postMessage(message: GenerateKeyResponse): void;
};

workerScope.addEventListener("message", (event) => {
  void generatePgpKeyPairOnCurrentThread(event.data.highEntropyToken)
    .then((keyPair) => workerScope.postMessage({ ok: true, keyPair }))
    .catch(() => workerScope.postMessage({ ok: false }));
});
