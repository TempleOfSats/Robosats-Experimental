import { describe, expect, it } from "vitest";
import { isAbortError, toUserMessage } from "@/lib/userError";

describe("toUserMessage", () => {
  it("identifies lifecycle cancellation without depending on an Error subclass", () => {
    expect(isAbortError(new DOMException("App backgrounded", "AbortError"))).toBe(true);
    expect(isAbortError(Object.assign(new Error("cancelled"), { name: "AbortError" }))).toBe(true);
    expect(isAbortError(new Error("offline"))).toBe(false);
  });

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

  it("does not expose authentication headers or PGP keys", () => {
    const error = new Error(
      "Header 'Authorization' has invalid value: 'Token secret | Private -----BEGIN PGP PRIVATE KEY BLOCK-----'"
    );
    expect(toUserMessage(error, "Could not load the order.")).toBe("Could not load the order.");
  });
});
