import { describe, expect, it, vi } from "vitest";
import { requestReviewToken } from "@/domains/reviews/reviewApi";
import type { ApiClient, Auth } from "@/domains/transport/apiClient";

describe("reviewApi", () => {
  it("requests review tokens with the current pubkey field", async () => {
    const auth: Auth = { tokenSHA256: "robot-token" };
    const client = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({ pubkey: "nostr", token: "review-token" }),
      put: vi.fn(),
      delete: vi.fn()
    } satisfies ApiClient;

    await expect(requestReviewToken("https://coordinator", "nostr", auth, client)).resolves.toEqual({
      pubkey: "nostr",
      token: "review-token"
    });
    expect(client.post).toHaveBeenCalledWith("https://coordinator", "/api/review/", { pubkey: "nostr" }, auth);
  });
});
