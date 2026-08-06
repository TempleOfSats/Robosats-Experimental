import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkDesktopFrontendAssets } from "./check-frontend-assets.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("desktop frontend assets", () => {
  it("accepts stable packaged payment and coordinator image URLs", async () => {
    const directory = await desktopFixture();

    await expect(checkDesktopFrontendAssets(directory)).resolves.toEqual([
      "static/assets/payment-methods/pix.png",
      "static/federation/avatars/lake.webp"
    ]);
  });

  it("rejects web-only versioned static URLs", async () => {
    const directory = await desktopFixture();
    await writeFile(
      path.join(directory, "assets", "app.js"),
      'const payment = "/static/0123456789abcdef/assets/payment-methods/";\n' +
        'const avatar = "/static/federation/avatars/";\n'
    );

    await expect(checkDesktopFrontendAssets(directory)).rejects.toThrow(/versioned static asset URLs/);
  });

  it("rejects a referenced asset family that is absent from the package", async () => {
    const directory = await desktopFixture();
    await rm(path.join(directory, "static", "federation", "avatars", "lake.webp"));

    await expect(checkDesktopFrontendAssets(directory)).rejects.toThrow(
      /missing packaged asset: static\/federation\/avatars\/lake\.webp/
    );
  });
});

async function desktopFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "robosats-desktop-assets-"));
  temporaryDirectories.push(directory);
  await mkdir(path.join(directory, "assets"), { recursive: true });
  await mkdir(path.join(directory, "static", "assets", "payment-methods"), { recursive: true });
  await mkdir(path.join(directory, "static", "federation", "avatars"), { recursive: true });
  await writeFile(path.join(directory, "index.html"), '<script src="/assets/app.js"></script>\n');
  await writeFile(
    path.join(directory, "assets", "app.js"),
    'const payment = "/static/assets/payment-methods/";\n' +
      'const avatar = "/static/federation/avatars/";\n'
  );
  await writeFile(path.join(directory, "static", "assets", "payment-methods", "pix.png"), "payment");
  await writeFile(path.join(directory, "static", "federation", "avatars", "lake.webp"), "avatar");
  return directory;
}
