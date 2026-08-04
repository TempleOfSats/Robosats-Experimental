import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RobotAvatar } from "@/domains/identity/RobotAvatar";

describe("RobotAvatar", () => {
  it("uses the shared robot icon while the generated avatar is loading", () => {
    const html = renderToStaticMarkup(<RobotAvatar hashId="abcdef123456" label="Test Robot" />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('stroke-width="1.8"');
    expect(html).toContain('d="M20 9V7a2 2 0 0 0-2-2h-3a3 3 0 0 0-6 0H6');
    expect(html).toContain('d="M8 17h8"');
  });
});
