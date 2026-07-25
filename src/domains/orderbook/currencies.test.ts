import { describe, expect, it } from "vitest";
import { orderCurrencyCodes } from "@/domains/orderbook/currencies";

describe("orderCurrencyCodes", () => {
  it("uses the create-order currency sequence and removes duplicates", () => {
    expect(orderCurrencyCodes(["BRL", "USD", "ARS", "EUR", "USD", "BTC"])).toEqual([
      "USD",
      "EUR",
      "BRL",
      "ARS",
      "BTC"
    ]);
  });

  it("places unknown currencies after known currencies in alphabetical order", () => {
    expect(orderCurrencyCodes(["ZZZ", "EUR", "AAA"])).toEqual(["EUR", "AAA", "ZZZ"]);
  });
});
