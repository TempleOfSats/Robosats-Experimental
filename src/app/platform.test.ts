import { describe, expect, it } from "vitest";
import { parseRoboSatsSettings } from "@/app/platform";

describe("parseRoboSatsSettings", () => {
  it("uses browser routing for web basic", () => {
    expect(parseRoboSatsSettings("web-basic")).toEqual({
      client: "web",
      mode: "basic",
      router: "browser"
    });
  });

  it("uses hash routing for desktop", () => {
    expect(parseRoboSatsSettings("desktop-basic").router).toBe("hash");
  });

  it("uses hash routing for Android deep links", () => {
    expect(parseRoboSatsSettings("mobile-basic").router).toBe("hash");
  });

  it("keeps pro mode", () => {
    expect(parseRoboSatsSettings("selfhosted-pro").mode).toBe("pro");
  });
});
