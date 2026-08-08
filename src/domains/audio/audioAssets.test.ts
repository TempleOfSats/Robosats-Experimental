import { describe, expect, it } from "vitest";
import {
  tradeAudioEventForOrderTransition
} from "@/domains/audio/audioAssets";

describe("current trade audio", () => {
  it("keeps raw status transitions separate from success-panel audio", () => {
    for (let status = 0; status <= 18; status += 1) {
      expect(tradeAudioEventForOrderTransition(99, status)).toBe(status === 6 ? "taker-found" : "locked-invoice");
    }
  });

  it("does not play before an initial status or when the status is unchanged", () => {
    expect(tradeAudioEventForOrderTransition(undefined, 1)).toBeNull();
    expect(tradeAudioEventForOrderTransition(1, 1)).toBeNull();
  });
});
