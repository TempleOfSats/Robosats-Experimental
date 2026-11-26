import { describe, expect, it, vi } from "vitest";
import { requestReviewToken } from "@/domains/reviews/reviewApi";
import type { ApiClient, Auth } from "@/domains/transport/apiClient";

vi.mock("@/domains/crypto/pgp", () => ({
  signCleartextMessage: vi.fn(async (content: string) => `signed:${content}`)
}));

const signing = { token: "test-passphrase", encPrivKey: "test-private-key" };

describe("reviewApi", () => {
  it("requests review tokens with the current pubkey field", async () => {
    const auth: Auth = {
      tokenSHA256: "robot-token",
      nostrPubkey: "nostr",
      keys: { pubKey: "test-public-key", encPrivKey: signing.encPrivKey }
    };
    const client = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({ pubkey: "nostr", token: "review-token" }),
      put: vi.fn(),
      delete: vi.fn()
    } satisfies ApiClient;

    await expect(requestReviewToken("https://coordinator", "nostr", auth, signing, client)).resolves.toEqual({
      pubkey: "nostr",
      token: "review-token"
    });
    expect(client.post).toHaveBeenCalledWith(
      "https://coordinator",
      "/api/review/",
      { pubkey: "nostr", signature: "signed:review:nostr" },
      {
        tokenSHA256: "robot-token"
      }
    );
  });
});
