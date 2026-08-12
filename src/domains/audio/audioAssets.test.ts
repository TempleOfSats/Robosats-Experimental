import { describe, expect, it } from "vitest";
import {
  tradeAudioEventForOrderTransition
} from "@/domains/audio/audioAssets";

describe("current trade audio", () => {
  it("maps definitive order outcomes to their semantic sounds", () => {
    expect(tradeAudioEventForOrderTransition(1, 2)).toBe("order-paused");
    expect(tradeAudioEventForOrderTransition(2, 1)).toBe("order-resumed");
    expect(tradeAudioEventForOrderTransition(1, 4)).toBe("order-cancelled");
    expect(tradeAudioEventForOrderTransition(9, 12)).toBe("order-collab-cancelled");
    expect(tradeAudioEventForOrderTransition(10, 11)).toBe("order-dispute-opened");
  });

  it("keeps the existing taker-found and locked-invoice transition sounds", () => {
    expect(tradeAudioEventForOrderTransition(3, 6)).toBe("taker-found");
    expect(tradeAudioEventForOrderTransition(3, 7)).toBe("locked-invoice");
    expect(tradeAudioEventForOrderTransition(3, 1)).toBe("locked-invoice");
  });

  it("does not play before an initial status or when the status is unchanged", () => {
    expect(tradeAudioEventForOrderTransition(undefined, 1)).toBeNull();
    expect(tradeAudioEventForOrderTransition(1, 1)).toBeNull();
  });
});
