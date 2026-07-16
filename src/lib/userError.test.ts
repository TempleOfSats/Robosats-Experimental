import { describe, expect, it } from "vitest";
import { toUserMessage } from "@/lib/userError";

describe("toUserMessage", () => {
  it("extracts a human API validation message", () => {
    expect(toUserMessage(new Error('RoboSats API 400: {"bad_invoice":"Does not look like a valid lightning invoice","successful_withdrawal":false}')))
      .toBe("Does not look like a valid Lightning invoice.");
  });

  it("turns transport failures into an actionable sentence", () => {
    expect(toUserMessage(new Error("NetworkError when attempting to fetch resource.")))
      .toBe("Could not reach the coordinator. Check your connection and try again.");
  });

  it("does not expose malformed response payloads", () => {
    expect(toUserMessage(new Error('RoboSats API 500: {"broken"'), "Could not save the order."))
      .toBe("Could not save the order.");
  });
});
