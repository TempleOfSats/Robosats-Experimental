import { describe, expect, it } from "vitest";
import { buildAuthHeaders, buildJsonHeaders } from "@/domains/transport/apiClient";

describe("buildAuthHeaders", () => {
  it("matches current token-only auth header", () => {
    expect(buildAuthHeaders({ tokenSHA256: "abc" })).toEqual({
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
      Authorization: "Token abc | Public pub\\key | Private priv\\key | Nostr nostr"
    });
  });

  it("adds the JSON content type only for requests with a JSON body", () => {
    expect(buildJsonHeaders({ tokenSHA256: "abc" })).toEqual({
      Authorization: "Token abc",
      "Content-Type": "application/json"
    });
    expect(buildAuthHeaders()).toEqual({});
  });
});
