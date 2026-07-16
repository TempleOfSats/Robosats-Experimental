import { describe, expect, it } from "vitest";
import { roleBuysBitcoin, roleIntentLabel } from "@/domains/orders/orderRole";

describe("order roles", () => {
  it("presents type 0 from opposite maker and taker perspectives", () => {
    expect(roleBuysBitcoin(0, "maker")).toBe(true);
    expect(roleIntentLabel(0, false, "maker")).toBe("Buy BTC");
    expect(roleIntentLabel(0, true, "maker")).toBe("Swap In");

    expect(roleBuysBitcoin(0, "taker")).toBe(false);
    expect(roleIntentLabel(0, false, "taker")).toBe("Sell BTC");
    expect(roleIntentLabel(0, true, "taker")).toBe("Swap Out");
  });

  it("presents type 1 from opposite maker and taker perspectives", () => {
    expect(roleBuysBitcoin(1, "maker")).toBe(false);
    expect(roleIntentLabel(1, false, "maker")).toBe("Sell BTC");
    expect(roleIntentLabel(1, true, "maker")).toBe("Swap Out");

    expect(roleBuysBitcoin(1, "taker")).toBe(true);
    expect(roleIntentLabel(1, false, "taker")).toBe("Buy BTC");
    expect(roleIntentLabel(1, true, "taker")).toBe("Swap In");
  });
});
