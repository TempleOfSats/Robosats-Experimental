import { describe, expect, it, vi } from "vitest";
import { compactPayload, fetchOrder, submitOrderAction } from "@/domains/orders/orderApi";
import type { ApiClient, Auth } from "@/domains/transport/apiClient";
import type { OrderDto } from "@/domains/orders/order.types";

const auth: Auth = {
  tokenSHA256: "robot-token",
  nostrPubkey: "nostr-public-key",
  keys: { pubKey: "public-key", encPrivKey: "private-key" }
};
const order = { id: 123, status: 1 } as OrderDto;

describe("orderApi", () => {
  it("fetches an order through the current endpoint", async () => {
    const client = {
      get: vi.fn().mockResolvedValue(order),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    } satisfies ApiClient;

    await expect(fetchOrder("https://coordinator", 123, auth, client)).resolves.toMatchObject({
      id: 123,
      status: 1,
      satoshis: 0
    });
    expect(client.get).toHaveBeenCalledWith("https://coordinator", "/api/order/?order_id=123", auth);
  });

  it("submits current order action payloads", async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue(order),
      put: vi.fn(),
      delete: vi.fn()
    } satisfies ApiClient;

    await submitOrderAction(
      "https://coordinator",
      123,
      { action: "update_invoice", invoice: "signed", routing_budget_ppm: 1000, address: undefined },
      auth,
      client
    );

    expect(client.post).toHaveBeenCalledWith(
      "https://coordinator",
      "/api/order/?order_id=123",
      { action: "update_invoice", invoice: "signed", routing_budget_ppm: 1000 },
      { tokenSHA256: "robot-token" }
    );
  });

  it("normalizes action responses from the current endpoint", async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({ id: "123", status: "14", invoice_amount: "2500", satoshis: null }),
      put: vi.fn(),
      delete: vi.fn()
    } satisfies ApiClient;

    await expect(submitOrderAction("https://coordinator", 123, { action: "confirm" }, auth, client)).resolves.toMatchObject({
      id: 123,
      status: 14,
      invoice_amount: 2500,
      satoshis: 0
    });
  });

  it("removes undefined fields but keeps explicit zero values", () => {
    expect(compactPayload({ action: "cancel", cancel_status: 0, invoice: undefined })).toEqual({
      action: "cancel",
      cancel_status: 0
    });
  });
});
