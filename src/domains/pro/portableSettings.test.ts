import { describe, expect, it } from "vitest";
import {
  createPortableSettingsManifest,
  mergePortableSettings,
  removeOfferPreset,
  saveOfferPreset,
  updatePortablePreferences,
  validatePortableSettings
} from "@/domains/pro/portableSettings";
import { buildGarageRecordEvent } from "@/domains/pro/garageSync";
import { presetToSyncRecord } from "@/domains/pro/garageSyncRecords";

const deviceA = "00112233445566778899aabbccddeeff";
const deviceB = "ffeeddccbbaa99887766554433221100";

describe("portable PRO settings", () => {
  it("keeps the version 2 settings schema byte-for-byte stable", () => {
    const manifest = createPortableSettingsManifest(deviceA, { theme: "dark" }, 1);
    expect(JSON.stringify(manifest)).toBe(
      '{"format":"robosats-exp-portable-settings","version":2,"deviceId":"00112233445566778899aabbccddeeff","revision":0,"updatedAt":1,"theme":{"value":"dark","revision":1,"deviceId":"00112233445566778899aabbccddeeff"},"presets":[]}'
    );
  });

  it("merges preferences and preset tombstones deterministically", () => {
    const baseA = createPortableSettingsManifest(deviceA, { theme: "dark" }, 1);
    const baseB = createPortableSettingsManifest(deviceB, { theme: "dark" }, 1);
    const changedTheme = updatePortablePreferences(baseA, { theme: "light" }, 2);
    const preset = saveOfferPreset(baseB, {
      id: "1234567890abcdef1234567890abcdef",
      name: "Weekly buy",
      direction: 0,
      isSwap: false,
      currency: "eur",
      amount: "100",
      paymentMethods: ["SEPA"],
      premium: 1,
      bond: 3,
      publicDuration: 86400,
      escrowDuration: 10800,
      description: "Settle before lunch",
      password: "private"
    }, 2);
    const merged = mergePortableSettings([changedTheme, preset], deviceA, 3);
    expect(merged.theme.value).toBe("light");
    expect(merged.presets[0]).toMatchObject({
      name: "Weekly buy",
      direction: 0,
      isSwap: false,
      currency: "EUR",
      amount: "100",
      paymentMethods: ["SEPA"],
      premium: 1,
      bond: 3,
      publicDuration: 86_400,
      escrowDuration: 10_800,
      description: "Settle before lunch",
      password: "private"
    });
    expect(merged.presets[0]).not.toHaveProperty("minAmount");
    expect(merged.presets[0]).not.toHaveProperty("maxAmount");

    const removed = removeOfferPreset(merged, merged.presets[0].id, 4);
    expect(mergePortableSettings([preset, removed], deviceB, 5).presets[0].deleted).toBe(true);
  });

  it("rejects duplicate presets and malformed amounts", () => {
    const base = createPortableSettingsManifest(deviceA, { theme: "dark" }, 1);
    const withPreset = saveOfferPreset(base, {
      id: "1234567890abcdef1234567890abcdef",
      name: "Weekly buy",
      direction: 0,
      isSwap: false,
      currency: "EUR",
      amount: "100",
      paymentMethods: ["SEPA"],
      premium: 1,
      bond: 3,
      publicDuration: 86_340,
      escrowDuration: 10_800,
      description: "",
      password: ""
    }, 2);
    expect(() => validatePortableSettings({ ...withPreset, presets: [...withPreset.presets, ...withPreset.presets] }))
      .toThrow("Duplicate offer preset");
    expect(() => validatePortableSettings({
      ...withPreset,
      presets: [{ ...withPreset.presets[0], amount: "100 EUR" }]
    })).toThrow("Invalid preset amount");
    expect(() => validatePortableSettings({
      ...withPreset,
      presets: [{ ...withPreset.presets[0], amount: undefined }]
    })).toThrow("Incomplete preset amount");
  });

  it("rejects device and preset counts above the defensive limits", () => {
    const manifests = Array.from({ length: 33 }, (_, index) => createPortableSettingsManifest(
      index.toString(16).padStart(32, "0"),
      { theme: "dark" }
    ));
    expect(() => mergePortableSettings(manifests, deviceA)).toThrow("Too many settings devices");

    const manifest = createPortableSettingsManifest(deviceA, { theme: "dark" });
    expect(() => validatePortableSettings({
      ...manifest,
      presets: Array.from({ length: 129 })
    })).toThrow("Offer preset limit exceeded");
  });

  it("keeps each preset record below the serialized event limit", () => {
    let manifest = createPortableSettingsManifest(deviceA, { theme: "dark" }, 1);
    for (let index = 0; index < 96; index += 1) {
      manifest = saveOfferPreset(manifest, {
        id: index.toString(16).padStart(32, "0"),
        name: `Preset ${index}`,
        direction: index % 2 as 0 | 1,
        isSwap: false,
        currency: "EUR",
        amount: String(index + 1),
        paymentMethods: ["SEPA", "Revolut"],
        premium: 1,
        bond: 3,
        publicDuration: 86_400,
        escrowDuration: 10_800,
        description: "",
        password: ""
      }, index + 2);
    }
    const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const events = manifest.presets.map((preset, index) => buildGarageRecordEvent(secret, presetToSyncRecord(preset), 100 + index));
    expect(events.every((event) => new TextEncoder().encode(JSON.stringify(event)).length <= 16 * 1024)).toBe(true);
  });
});
