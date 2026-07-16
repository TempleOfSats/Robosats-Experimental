import { describe, expect, it, vi } from "vitest";
import { fetchRobot, normalizeRobotResponse, updateRobotWebhook, updateStealthInvoices } from "@/domains/garage/robotApi";
import type { ApiClient, Auth } from "@/domains/transport/apiClient";

describe("robotApi", () => {
  it("normalizes current /api/robot/ responses", () => {
    expect(
      normalizeRobotResponse({
        nickname: "HelpfulVeranda735",
        hash_id: "hash",
        public_key: "pub",
        encrypted_private_key: "priv",
        earned_rewards: "6289",
        wants_stealth: "false",
        nostr_pubkey: "nostr",
        active_order_id: "89895",
        last_order_id: "89890",
        found: "true",
        last_login: "2026-07-05T00:00:00Z",
        tg_enabled: 1,
        tg_bot_name: "bot",
        tg_token: "token",
        webhook_url: "http://hook.onion/callback",
        webhook_enabled: "true",
        webhook_api_key: "secret"
      })
    ).toEqual({
      nickname: "HelpfulVeranda735",
      hashId: "hash",
      pubKey: "pub",
      encPrivKey: "priv",
      earnedRewards: 6289,
      stealthInvoices: false,
      nostrPubKey: "nostr",
      activeOrderId: 89895,
      lastOrderId: 89890,
      found: true,
      lastLogin: "2026-07-05T00:00:00Z",
      tgEnabled: true,
      tgBotName: "bot",
      tgToken: "token",
      webhookUrl: "http://hook.onion/callback",
      webhookEnabled: true,
      webhookApiKey: "secret",
      badRequest: undefined
    });
  });

  it("fetches through the current robot endpoint", async () => {
    const auth: Auth = { tokenSHA256: "robot" };
    const client = {
      get: vi.fn().mockResolvedValue({ nickname: "Robot", earned_rewards: 0 }),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn()
    } satisfies ApiClient;

    await expect(fetchRobot("https://coordinator", auth, client)).resolves.toMatchObject({
      nickname: "Robot",
      earnedRewards: 0
    });
    expect(client.get).toHaveBeenCalledWith("https://coordinator", "/api/robot/", auth);
  });

  it("updates webhook settings through the current robot endpoint", async () => {
    const auth: Auth = { tokenSHA256: "robot" };
    const client = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn().mockResolvedValue({
        webhook_url: "http://hook.onion/callback",
        webhook_enabled: true,
        webhook_api_key: "secret"
      }),
      delete: vi.fn()
    } satisfies ApiClient;

    await expect(
      updateRobotWebhook(
        "https://coordinator",
        { webhook_url: "http://hook.onion/callback", webhook_enabled: true, webhook_api_key: "secret" },
        auth,
        client
      )
    ).resolves.toEqual({
      webhookUrl: "http://hook.onion/callback",
      webhookEnabled: true,
      webhookApiKey: "secret"
    });

    expect(client.put).toHaveBeenCalledWith(
      "https://coordinator",
      "/api/robot/",
      { webhook_url: "http://hook.onion/callback", webhook_enabled: true, webhook_api_key: "secret" },
      auth
    );
  });

  it("updates stealth invoice preference through the current stealth endpoint", async () => {
    const auth: Auth = { tokenSHA256: "robot" };
    const client = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({ wantsStealth: false }),
      put: vi.fn(),
      delete: vi.fn()
    } satisfies ApiClient;

    await expect(updateStealthInvoices("https://coordinator", false, auth, client)).resolves.toBe(false);
    expect(client.post).toHaveBeenCalledWith("https://coordinator", "/api/stealth/", { wantsStealth: false }, auth, {
      timeoutProfile: "action"
    });
  });
});
