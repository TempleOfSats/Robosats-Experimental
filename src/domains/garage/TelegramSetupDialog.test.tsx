import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TelegramSetupDialog, telegramSetupLinks } from "@/domains/garage/TelegramSetupDialog";

describe("TelegramSetupDialog", () => {
  it("builds the current Telegram bot enrollment links", () => {
    expect(telegramSetupLinks("@RoboSatsBot", "robot token")).toEqual({
      app: "tg://resolve?domain=RoboSatsBot&start=robot%20token",
      browser: "https://t.me/RoboSatsBot?start=robot%20token"
    });
  });

  it("renders a scannable QR and both enrollment actions", () => {
    const html = renderToStaticMarkup(<TelegramSetupDialog botName="RoboSatsBot" token="abc123" onClose={() => undefined} />);

    expect(html).toContain("<svg");
    expect(html).toContain("tg://resolve?domain=RoboSatsBot&amp;start=abc123");
    expect(html).toContain("Browser");
    expect(html).toContain("reduce your anonymity");
  });
});
