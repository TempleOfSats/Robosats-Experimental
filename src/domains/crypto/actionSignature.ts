import { signCleartextMessage } from "@/domains/crypto/pgp";

export interface RobotSigningCredentials {
  token: string;
  encPrivKey?: string;
}

export async function signRobotAction(
  content: string,
  credentials: RobotSigningCredentials | undefined
): Promise<string> {
  if (!credentials?.encPrivKey || !credentials.token) {
    throw new Error("This robot is missing its signing key. Recover it from Garage and try again.");
  }

  try {
    return await signCleartextMessage(content, credentials.encPrivKey, credentials.token);
  } catch {
    throw new Error("Could not sign with this robot’s key. Recover the robot from Garage and try again.");
  }
}

export function timedActionContent(action: "make" | "robot" | "stealth"): string {
  return `${action}:${Math.floor(Date.now() / 1000)}`;
}
