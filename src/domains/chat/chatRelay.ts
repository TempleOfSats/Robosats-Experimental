import { wrapEvent } from "nostr-tools/nip59";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";
import { getSharedRelayPool } from "@/domains/nostr/sharedRelayPool";
import { buildNostrRelayUrl } from "@/domains/orderbook/nostrOrderbook";

export async function publishChatMessageToRelay({
  content,
  baseUrl,
  shortAlias,
  orderId,
  token,
  ownPublicKey,
  peerPublicKey,
  signal
}: {
  content: string;
  baseUrl: string;
  shortAlias: string;
  orderId: number;
  token: string;
  ownPublicKey: string;
  peerPublicKey: string;
  signal?: AbortSignal;
}): Promise<void> {
  const identity = deriveRobotIdentity(token);
  try {
    if (identity.nostrPubKey !== ownPublicKey || !/^[a-f0-9]{64}$/.test(peerPublicKey)) {
      throw new Error("The trade's chat identity does not match this robot.");
    }
    const relay = buildNostrRelayUrl({ url: baseUrl });
    if (!relay) throw new Error("This coordinator has no chat relay.");
    const message = {
      kind: 14,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["order_id", `${shortAlias}/${orderId}`],
        ["p", peerPublicKey, relay],
        ["p", ownPublicKey, relay]
      ],
      content
    };
    // Match upstream's NIP-17 recipients, including the sender's history copy.
    const envelopes = [peerPublicKey, ownPublicKey].map((recipient) =>
      wrapEvent(message, identity.nostrSecKey, recipient)
    );
    const abort = new AbortController();
    let rejectCancellation: (reason: Error) => void = () => undefined;
    const cancellation = new Promise<never>((_, reject) => {
      rejectCancellation = reject;
    });
    const cancel = () => {
      abort.abort();
      rejectCancellation(new Error("Chat relay delivery cancelled."));
    };
    signal?.addEventListener("abort", cancel, { once: true });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      signal?.throwIfAborted();
      const publishing = Promise.all(
        envelopes.map(async (event) => {
          const pool = getSharedRelayPool();
          const connection = await pool.ensureRelay(relay, { connectionTimeout: 20_000, abort: abort.signal });
          abort.signal.throwIfAborted();
          await connection.publish(event);
        })
      );
      await Promise.race([
        publishing,
        cancellation,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            abort.abort();
            reject(new Error("Chat relay acknowledgement timed out."));
          }, 20_000);
        })
      ]);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    }
  } finally {
    identity.nostrSecKey.fill(0);
  }
}
