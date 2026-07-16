import { sha256 } from "js-sha256";
import { sha256 as sha256Hash, sha512 } from "@noble/hashes/sha2.js";
import { getPublicKey } from "nostr-tools";
import { validateTokenEntropy } from "@/domains/garage/token";
import { hexToBase91 } from "@/lib/hexToBase91";

export type RobotIdentity = {
  token: string;
  hashId: string;
  tokenSHA256: string;
  nostrPubKey: string;
  nostrSecKey: Uint8Array;
  entropyBits: number;
  hasEnoughEntropy: boolean;
  shannonEntropy: number;
};

export function deriveRobotIdentity(token: string): RobotIdentity {
  const hashId = sha256(sha256(token));
  const tokenSHA256 = hexToBase91(sha256(token));
  const nostrSecKey = sha256Hash(sha512(new TextEncoder().encode(token)));
  const nostrPubKey = getPublicKey(nostrSecKey);
  const { bitsEntropy, hasEnoughEntropy, shannonEntropy } = validateTokenEntropy(token);
  return {
    token,
    hashId,
    tokenSHA256,
    nostrSecKey,
    nostrPubKey,
    entropyBits: bitsEntropy,
    hasEnoughEntropy,
    shannonEntropy
  };
}
