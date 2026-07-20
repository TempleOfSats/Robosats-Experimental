import { describe, expect, it } from "vitest";
import {
  notificationAudioEvent,
  tradeAudioEventForOrderTransition
} from "@/domains/audio/audioAssets";

describe("current trade audio", () => {
  it("matches the current notification status-to-sound mapping", () => {
    for (let status = 0; status <= 18; status += 1) {
      const expected = status === 6
        ? "taker-found"
        : [13, 14, 15].includes(status)
          ? "successful"
          : "locked-invoice";
      expect(notificationAudioEvent(status)).toBe(expected);
    }
  });

  it("plays the mapped sound for every observed status transition", () => {
    for (let status = 0; status <= 18; status += 1) {
      expect(tradeAudioEventForOrderTransition(99, status)).toBe(notificationAudioEvent(status));
    }
  });

  it("does not play before an initial status or when the status is unchanged", () => {
    expect(tradeAudioEventForOrderTransition(undefined, 1)).toBeNull();
    expect(tradeAudioEventForOrderTransition(1, 1)).toBeNull();
  });
});
