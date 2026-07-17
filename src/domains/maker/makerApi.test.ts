import { describe, expect, it, vi } from "vitest";
import { sha256 } from "js-sha256";
import {
  buildCreateOrderPayload,
  buildRenewOrderPayload,
  createOrder,
  validateCreateOrderPayload
} from "@/domains/maker/makerApi";
import type { CreateOrderDraft } from "@/domains/maker/maker.types";
import type { OrderDto } from "@/domains/orders/order.types";
import type { ApiClient, Auth } from "@/domains/transport/apiClient";

const draft: CreateOrderDraft = {
  type: 0,
  currency: 840,
  amount: "100",
  hasRange: false,
  minAmount: "",
  maxAmount: "",
  paymentMethod: "  Revolut  ",
  isSwap: false,
  isExplicit: false,
  premium: "1.5",
  satoshis: "0",
  publicDuration: "86340",
  escrowDuration: "10800",
  bondSize: "3",
  latitude: "0",
  longitude: "0",
  password: "secret",
  description: "  fast trade  "
};

describe("makerApi", () => {
  it("builds the current /api/make/ payload shape", () => {
    expect(buildCreateOrderPayload(draft)).toEqual({
      type: 0,
      currency: 840,
      amount: 100,
      has_range: false,
      min_amount: null,
      max_amount: null,
      payment_method: "Revolut",
      is_explicit: false,
      premium: 1.5,
      satoshis: null,
      public_duration: 86340,
      escrow_duration: 10800,
      bond_size: 3,
      latitude: 0,
      longitude: 0,
      password: sha256("secret"),
      description: "fast trade"
    });
  });

  it("uses min and max amount for range orders", () => {
    const payload = buildCreateOrderPayload({ ...draft, hasRange: true, minAmount: "50", maxAmount: "150" });
    expect(payload.amount).toBeNull();
    expect(payload.has_range).toBe(true);
    expect(payload.min_amount).toBe(50);
    expect(payload.max_amount).toBe(150);
  });

  it("sends only explicit satoshis when explicit pricing is enabled", () => {
    const payload = buildCreateOrderPayload({ ...draft, isExplicit: true, satoshis: "25000" });
    expect(payload.premium).toBeNull();
    expect(payload.satoshis).toBe(25000);
  });

  it("uses null for empty optional coordinator fields", () => {
    const payload = buildCreateOrderPayload({ ...draft, password: "", description: "   " });
    expect(payload.password).toBeNull();
    expect(payload.description).toBeNull();
  });

  it("recreates an expired range order with its original terms", () => {
    const payload = buildRenewOrderPayload({
      type: 1,
      currency: 978,
      amount: null,
      has_range: true,
      min_amount: 50,
      max_amount: 150,
      payment_method: "SEPA",
      is_explicit: false,
      premium: -1.25,
      satoshis: 0,
      public_duration: 43_200,
      escrow_duration: 7_200,
      bond_size: 4,
      latitude: 12.5,
      longitude: -8.4,
      description: "  renewed offer  "
    } as OrderDto);

    expect(payload).toEqual({
      type: 1,
      currency: 978,
      amount: null,
      has_range: true,
      min_amount: 50,
      max_amount: 150,
      payment_method: "SEPA",
      is_explicit: false,
      premium: -1.25,
      satoshis: null,
      public_duration: 43_200,
      escrow_duration: 7_200,
      bond_size: 4,
      latitude: 12.5,
      longitude: -8.4,
      password: null,
      description: "renewed offer"
    });
  });

  it("preserves explicit pricing and hashes a renewed order password", () => {
    const payload = buildRenewOrderPayload({
      type: 0,
      currency: 1000,
      amount: 0.01,
      has_range: false,
      payment_method: "On-Chain BTC",
      is_explicit: true,
      premium: 0,
      satoshis: 250_000,
      public_duration: 86_340,
      escrow_duration: 10_800,
      bond_size: 3
    } as OrderDto, " same secret ");

    expect(payload.premium).toBeNull();
    expect(payload.satoshis).toBe(250_000);
    expect(payload.password).toBe(sha256("same secret"));
  });

  it("validates required customer-facing fields", () => {
    expect(
      validateCreateOrderPayload(
        buildCreateOrderPayload({ ...draft, paymentMethod: "", hasRange: true, minAmount: "200", maxAmount: "100" })
      )
    ).toEqual(["Add a payment method.", "Minimum amount must be below maximum amount."]);
  });

  it("matches the current timer ranges", () => {
    expect(validateCreateOrderPayload(buildCreateOrderPayload({ ...draft, publicDuration: "599" }))).toContain(
      "Public duration must be between 00:10 and 23:59."
    );
    expect(validateCreateOrderPayload(buildCreateOrderPayload({ ...draft, publicDuration: "86400" }))).toContain(
      "Public duration must be between 00:10 and 23:59."
    );
    expect(validateCreateOrderPayload(buildCreateOrderPayload({ ...draft, escrowDuration: "3599" }))).toContain(
      "Escrow duration must be between 01:00 and 08:00."
    );
    expect(validateCreateOrderPayload(buildCreateOrderPayload({ ...draft, escrowDuration: "28801" }))).toContain(
      "Escrow duration must be between 01:00 and 08:00."
    );
    expect(validateCreateOrderPayload(buildCreateOrderPayload({ ...draft, escrowDuration: "28800" }))).not.toContain(
      "Escrow duration must be between 01:00 and 08:00."
    );
  });

  it("posts to the current make endpoint", async () => {
    const auth: Auth = { tokenSHA256: "robot" };
    const payload = buildCreateOrderPayload(draft);
    const client = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({ id: 77 }),
      put: vi.fn(),
      delete: vi.fn()
    } satisfies ApiClient;

    await expect(createOrder("https://coordinator", payload, auth, client)).resolves.toEqual({ id: 77 });
    expect(client.post).toHaveBeenCalledWith("https://coordinator", "/api/make/", payload, auth, {
      timeoutProfile: "action"
    });
  });
});
