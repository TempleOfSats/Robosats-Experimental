import { parseFleetBackupFile } from "@/domains/pro/fleetKeyBackup";
import { activeGarageEntries, decodeGarageToken } from "@/domains/pro/garageVault";
import { invalidateGarageSyncCursors } from "@/domains/pro/garageSync";
import { useGarageVaultStore } from "@/domains/pro/garageVaultStore";

export async function restoreOfflineFleetBackup(content: string): Promise<{
  fleetKey: string;
  robotCount?: number;
}> {
  const parsed = parseFleetBackupFile(content);
  if (!parsed.robotSnapshot) return { fleetKey: parsed.fleetKey };
  invalidateGarageSyncCursors(decodeGarageToken(parsed.fleetKey));
  await useGarageVaultStore.getState().restoreRobotManifest(parsed.fleetKey, parsed.robotSnapshot.garage);
  return {
    fleetKey: parsed.fleetKey,
    robotCount: activeGarageEntries(parsed.robotSnapshot.garage).length
  };
}
