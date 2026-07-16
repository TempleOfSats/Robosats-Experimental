import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

function variablesFor(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
  );
}

const dark = variablesFor(":root");
const light = { ...dark, ...variablesFor(':root[data-theme="light"]') };

function resolve(tokens: Record<string, string>, key: string, seen = new Set<string>()): string {
  if (seen.has(key)) throw new Error(`Circular color token: ${key}`);
  seen.add(key);
  const value = tokens[key];
  if (!value) throw new Error(`Missing color token: ${key}`);
  const alias = value.match(/^var\(--([\w-]+)\)$/)?.[1];
  return alias ? resolve(tokens, alias, seen) : value;
}

function rgb(hex: string) {
  const value = hex.replace("#", "");
  if (!/^[\da-f]{6}$/i.test(value)) throw new Error(`Expected a six-digit color, received ${hex}`);
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
}

function luminance(hex: string) {
  const channels = rgb(hex).map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(tokens: Record<string, string>, foreground: string, background: string) {
  const a = luminance(resolve(tokens, foreground));
  const b = luminance(resolve(tokens, background));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const textPairs = [
  ["text-primary", "canvas"],
  ["text-primary", "surface"],
  ["text-secondary", "surface"],
  ["text-supporting", "surface"],
  ["brand-amber-foreground", "brand-amber"],
  ["success-foreground", "success-surface"],
  ["danger-foreground", "danger-surface"],
  ["warning-foreground", "warning-surface"],
  ["info-foreground", "info-surface"],
  ["pending-foreground", "pending-surface"],
  ["buy-foreground", "buy"],
  ["sell-foreground", "sell"],
  ["danger-button-foreground", "danger"],
  ["success-solid-foreground", "success"],
  ["warning-solid-foreground", "warning"],
] as const;

const graphicalPairs = [
  ["border-strong", "surface"],
  ["focus-ring", "surface"],
  ["focus-ring", "canvas"],
  ["success-border", "success-surface"],
  ["danger-border", "danger-surface"],
  ["warning-border", "warning-surface"],
  ["info-border", "info-surface"],
  ["pending-border", "pending-surface"],
] as const;

describe.each([
  ["dark", dark],
  ["light", light],
])("%s color palette", (_, tokens) => {
  it.each(textPairs)("keeps %s readable on %s", (foreground, background) => {
    expect(contrast(tokens, foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(graphicalPairs)("keeps %s visible on %s", (foreground, background) => {
    expect(contrast(tokens, foreground, background)).toBeGreaterThanOrEqual(3);
  });
});

it("retains the approved anchor families", () => {
  expect(resolve(light, "brand-amber")).toBe("#ffb23f");
  expect(resolve(light, "secondary")).toBe("#8f3b68");
  expect(resolve(light, "success-border")).toBe("#008f8a");
  expect(resolve(light, "danger-border")).toBe("#d55e00");
  expect(resolve(light, "info-border")).toBe("#0072b2");
});
