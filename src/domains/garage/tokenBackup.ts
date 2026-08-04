import { downloadTextFile } from "@/domains/transport/downloadFile";

export interface RobotTokenBackup {
  format: "robosats-exp-robot-token";
  version: 1;
  robotName: string;
  token: string;
}

export function buildRobotTokenBackup(token: string, robotName: string): RobotTokenBackup {
  return {
    format: "robosats-exp-robot-token",
    version: 1,
    robotName: robotName.trim(),
    token: token.trim()
  };
}

export function robotTokenBackupFilename(robotName: string): string {
  const safeName = robotName
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "");
  return `${safeName || "robosats-robot"}.json`;
}

export function downloadRobotTokenBackup(token: string, robotName: string): void {
  const backup = buildRobotTokenBackup(token, robotName);
  downloadTextFile(robotTokenBackupFilename(robotName), JSON.stringify(backup, null, 2), "application/json");
}
