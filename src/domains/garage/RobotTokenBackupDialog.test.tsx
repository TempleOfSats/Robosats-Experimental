import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RobotTokenBackupDialog } from "@/domains/garage/RobotTokenBackupDialog";

describe("RobotTokenBackupDialog", () => {
  it("shows the robot token with copy and JSON backup actions", () => {
    const html = renderToStaticMarkup(
      <RobotTokenBackupDialog
        onClose={() => undefined}
        robotName="PatientRobot123"
        token="test-token"
      />
    );

    expect(html).toContain("Store your robot token");
    expect(html).toContain("test-token");
    expect(html).toContain("Download PatientRobot123 token backup as JSON");
    expect(html).toContain("Copy robot token");
  });
});
