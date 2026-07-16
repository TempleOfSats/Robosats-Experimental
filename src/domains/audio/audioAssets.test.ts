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

  it.each([
    [0, 1, "locked-invoice"],
    [7, 1, "locked-invoice"],
    [1, 4, "locked-invoice"],
    [2, 5, "locked-invoice"],
    [3, 6, "taker-found"],
    [6, 9, "locked-invoice"],
    [8, 9, "locked-invoice"],
    [9, 11, "locked-invoice"],
    [9, 12, "locked-invoice"],
    [10, 13, "successful"],
    [15, 13, "successful"],
    [10, 14, "successful"],
    [13, 15, "successful"],
    [11, 17, "locked-invoice"],
    [16, 18, "locked-invoice"]
  ] as const)("plays the current sound for transition %i -> %i", (previousStatus, status, expected) => {
    expect(tradeAudioEventForOrderTransition(previousStatus, status)).toBe(expected);
  });

  it.each([
    [undefined, 1],
    [1, 1],
    [1, 2],
    [2, 1],
    [1, 3],
    [0, 4],
    [6, 4],
    [0, 5],
    [6, 7],
    [6, 8],
    [9, 10],
    [10, 9],
    [11, 16],
    [13, 14]
  ] as const)("keeps the current silent transition %s -> %i silent", (previousStatus, status) => {
    expect(tradeAudioEventForOrderTransition(previousStatus, status)).toBeNull();
  });
});
