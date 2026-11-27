import { readCleartextMessage, readKey, verify } from "openpgp/lightweight";
import { generatePgpKeyPairOnCurrentThread } from "@/domains/crypto/pgpKeyGeneration";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  compactPayload,
  fetchOrder,
  isCompleteOrderActionResponse,
  submitOrderAction
} from "@/domains/orders/orderApi";
import type { ApiClient, Auth } from "@/domains/transport/apiClient";
import type { OrderDto } from "@/domains/orders/order.types";

const auth: Auth = {
  tokenSHA256: "robot-token",
  nostrPubkey: "nostr-public-key",
  keys: { pubKey: "public-key", encPrivKey: "private-key" }
};
const order = { id: 123, status: 1 } as OrderDto;

const coordinator = { url: "https://coordinator", shortAlias: "bazaar" };
const token = "synthetic-passphrase-for-order-api-tests";
let signing: { token: string; encPrivKey: string };
let publicKeyArmored: string;

beforeAll(async () => {
  const keys = await generatePgpKeyPairOnCurrentThread(token);
  signing = { token, encPrivKey: keys.encryptedPrivateKeyArmored };
  publicKeyArmored = keys.publicKeyArmored;
});

async function expectSignedContent(armoredMessage: string, content: string) {
  expect(armoredMessage).toMatch(/^-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\n/);
  const message = await readCleartextMessage({ cleartextMessage: armoredMessage });
  const { data, signatures } = await verify({
    message,
    verificationKeys: await readKey({ armoredKey: publicKeyArmored })
  });
  await expect(signatures[0].verified).resolves.toBe(true);
  expect(data).toBe(content);
}

describe("orderApi", () => {
  it("fetches an order through the current endpoint", async () => {
    const client = {
      get: vi.fn().mockResolvedValue(order),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    } satisfies ApiClient;

    await expect(fetchOrder("https://coordinator", 123, auth, undefined, client)).resolves.toMatchObject({
      id: 123,
      status: 1,
      satoshis: 0
    });
    expect(client.get).toHaveBeenCalledWith("https://coordinator", "/api/order/?order_id=123", auth, undefined);
  });

  it("signs the payout invoice and the action with the same key", async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue(order),
      put: vi.fn(),
      delete: vi.fn()
    } satisfies ApiClient;

    await submitOrderAction(
      coordinator,
      123,
      { action: "update_invoice", invoice: "fixture-invoice", routing_budget_ppm: 1000, address: undefined },
      auth,
      signing,
      client
    );

    expect(client.post).toHaveBeenCalledWith(
      "https://coordinator",
      "/api/order/?order_id=123",
      { action: "update_invoice", invoice: expect.any(String), routing_budget_ppm: 1000, signature: expect.any(String) },
      { tokenSHA256: "robot-token" },
      { timeoutProfile: "action", priority: "action", source: "order-action" }
    );
    await expectSignedContent(client.post.mock.calls[0][2].signature, "update_invoice:123:bazaar");
    await expectSignedContent(client.post.mock.calls[0][2].invoice, "fixture-invoice");
  });

  it("signs the payout address and the action with the same key", async () => {
    const post = vi.fn().mockResolvedValue(order);
    const client = { get: vi.fn(), post, put: vi.fn(), delete: vi.fn() } satisfies ApiClient;
    const address = "fixture-address";

    await submitOrderAction(coordinator, 123, { action: "update_address", address }, auth, signing, client);

    await expectSignedContent(post.mock.calls[0][2].signature, "update_address:123:bazaar");
    await expectSignedContent(post.mock.calls[0][2].address, address);
  });

  it("signs the action and dispute statement separately", async () => {
    const post = vi.fn().mockResolvedValue(order);
    const client = { get: vi.fn(), post, put: vi.fn(), delete: vi.fn() } satisfies ApiClient;
    const statement = "Synthetic statement with Unicode Ω.\n\nSecond line.";

    await submitOrderAction(coordinator, 123, { action: "submit_statement", statement }, auth, signing, client);

    await expectSignedContent(post.mock.calls[0][2].signature, "submit_statement:123:bazaar");
    await expectSignedContent(post.mock.calls[0][2].statement, statement);
  });

  it("does not send a protected write with missing or unusable signing credentials", async () => {
    const client = { get: vi.fn(), post: vi.fn().mockResolvedValue(order), put: vi.fn(), delete: vi.fn() };
    const payload = { action: "confirm" } as const;

    await expect(submitOrderAction(coordinator, 123, payload, auth, undefined, client)).rejects.toThrow("Recover");
    await expect(
      submitOrderAction(coordinator, 123, payload, auth, { ...signing, token: "incorrect" }, client)
    ).rejects.toThrow("Recover");
    expect(client.post).not.toHaveBeenCalled();

    await submitOrderAction(coordinator, 123, payload, auth, signing, client);
    expect(client.post).toHaveBeenCalledTimes(1);
  });

  it("rejects a dispute statement over the coordinator cleartext limit", async () => {
    const client = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };

    await expect(submitOrderAction(
      coordinator, 123, { action: "submit_statement", statement: "a".repeat(50_001) }, auth, signing, client
    )).rejects.toThrow("exceed 50,000 characters");
    expect(client.post).not.toHaveBeenCalled();
  });

  it("normalizes action responses from the current endpoint", async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({ id: "123", status: "14", invoice_amount: "2500", satoshis: null }),
      put: vi.fn(),
      delete: vi.fn()
    } satisfies ApiClient;

    await expect(submitOrderAction(coordinator, 123, { action: "confirm" }, auth, signing, client)).resolves.toMatchObject({
      id: 123,
      status: 14,
      invoice_amount: 2500,
      satoshis: 0
    });
  });

  it("identifies action acknowledgements that require an authoritative follow-up GET", async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({ id: 123 }),
      put: vi.fn(),
      delete: vi.fn()
    } satisfies ApiClient;
    const response = await submitOrderAction(coordinator, 123, { action: "confirm" }, auth, signing, client);
    expect(isCompleteOrderActionResponse(response)).toBe(false);
  });

  it("does not treat a terminal acknowledgement without participant roles as a complete snapshot", async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({ id: 123, status: 14, is_maker: true }),
      put: vi.fn(),
      delete: vi.fn()
    } satisfies ApiClient;
    const response = await submitOrderAction(coordinator, 123, { action: "confirm" }, auth, signing, client);
    expect(isCompleteOrderActionResponse(response)).toBe(false);
  });

  it("accepts a complete action snapshot without an additional GET", async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({
        id: 123,
        status: 14,
        type: 0,
        amount: 100,
        currency: 1,
        payment_method: "SEPA",
        premium: 1,
        satoshis: 100_000,
        is_maker: true,
        is_taker: false,
        is_buyer: true,
        is_seller: false,
        expires_at: "2026-07-28T12:00:00Z"
      }),
      put: vi.fn(),
      delete: vi.fn()
    } satisfies ApiClient;
    const response = await submitOrderAction(coordinator, 123, { action: "confirm" }, auth, signing, client);
    expect(isCompleteOrderActionResponse(response)).toBe(true);
  });

  it("removes undefined fields but keeps explicit zero values", () => {
    expect(compactPayload({ action: "cancel", cancel_status: 0, invoice: undefined })).toEqual({
      action: "cancel",
      cancel_status: 0
    });
  });
});
