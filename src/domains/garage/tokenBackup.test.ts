import { describe, expect, it } from "vitest";
import { buildRobotTokenBackup, robotTokenBackupFilename } from "@/domains/garage/tokenBackup";

describe("robot token backup", () => {
  it("exports a versioned backup with the robot name and token", () => {
    expect(buildRobotTokenBackup(" private-token ", " CopperRiver842 ")).toEqual({
      format: "robosats-exp-robot-token",
      version: 1,
      robotName: "CopperRiver842",
      token: "private-token"
    });
  });

  it("uses the robot name as a portable JSON filename", () => {
    expect(robotTokenBackupFilename("Copper River 842")).toBe("Copper River 842.json");
    expect(robotTokenBackupFilename("Robot:One/Two. ")).toBe("Robot-One-Two.json");
    expect(robotTokenBackupFilename("  ")).toBe("robosats-robot.json");
  });
});
