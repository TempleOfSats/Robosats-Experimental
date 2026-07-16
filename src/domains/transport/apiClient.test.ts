import { describe, expect, it } from "vitest";
import { buildAuthHeaders } from "@/domains/transport/apiClient";

describe("buildAuthHeaders", () => {
  it("matches current token-only auth header", () => {
    expect(buildAuthHeaders({ tokenSHA256: "abc" })).toEqual({
      "Content-Type": "application/json",
      Authorization: "Token abc"
    });
  });

  it("matches current token/key/nostr auth header", () => {
    expect(
      buildAuthHeaders({
        tokenSHA256: "abc",
        nostrPubkey: "nostr",
        keys: {
          pubKey: "pub\nkey",
          encPrivKey: "priv\nkey"
        }
      })
    ).toEqual({
      "Content-Type": "application/json",
      Authorization: "Token abc | Public pub\\key | Private priv\\key | Nostr nostr"
    });
  });
});
