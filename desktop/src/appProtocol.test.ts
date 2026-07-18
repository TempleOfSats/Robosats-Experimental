import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAppAsset } from "./appProtocol";

describe("resolveAppAsset", () => {
  const root = path.resolve("/tmp/robosats-web");

  it("maps the application root to index.html", () => {
    expect(resolveAppAsset(root, "/")).toBe(path.join(root, "index.html"));
  });

  it("maps static assets below the web root", () => {
    expect(resolveAppAsset(root, "/assets/app.js")).toBe(path.join(root, "assets/app.js"));
  });

  it("rejects encoded path traversal", () => {
    expect(resolveAppAsset(root, "/%2e%2e/secret")).toBeUndefined();
  });
});
