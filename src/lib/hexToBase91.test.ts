import { describe, expect, it } from "vitest";
import { hexToBase91 } from "@/lib/hexToBase91";

describe("hexToBase91", () => {
  it("matches current base-ex vectors", () => {
    expect(hexToBase91("")).toBe("");
    expect(hexToBase91("00")).toBe("AA");
    expect(hexToBase91("ff")).toBe("/C");
    expect(hexToBase91("00010203040506070809")).toBe(":C#(:C?hVB$MA");
    expect(hexToBase91("9c222a0fb9f2233bfb1caf6ca36b23c31559b7c9")).toBe("fHU,LoTWl3*o$0q54J8n7!82M");
    expect(hexToBase91("cbe6beb26479b568e2eae501b6ba0399d430469fc4c79b4657c93b03b5aa0a69")).toBe(
      "KT.9:+.elSd8gVA$sKpNfi``0?Gn?[.+IJ_8tHcC"
    );
  });
});
