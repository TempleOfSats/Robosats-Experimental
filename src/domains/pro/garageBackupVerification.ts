import type { SimplePool } from "nostr-tools/pool";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { orderRelays } from "@/domains/nostr/relayHealth";
import { withRelayQueryPool } from "@/domains/nostr/sharedRelayPool";
import {
  garageBackupVerificationInput,
  garageRecordsCoverExpected,
  garageRelayUrls,
  garageSyncEngine,
  queryGarageRecordsDetailed
} from "@/domains/pro/garageSync";
import type { GarageSyncRecord } from "@/domains/pro/garageSyncRecords";

const BACKUP_VERIFICATION_RELAY_TIMEOUT_MS = 20_000;

export type GarageBackupVerification = {
  reachableRelays: number;
  requiredRelays: number;
  totalRelays: number;
  verified: boolean;
  verifiedRelays: number;
};

let verificationInFlight: Promise<GarageBackupVerification> | undefined;

export function verifyGarageBackup(coordinators: CoordinatorSummary[]): Promise<GarageBackupVerification> {
  if (verificationInFlight) return verificationInFlight;
  verificationInFlight = runGarageBackupVerification(coordinators).finally(() => {
    verificationInFlight = undefined;
  });
  return verificationInFlight;
}

async function runGarageBackupVerification(coordinators: CoordinatorSummary[]): Promise<GarageBackupVerification> {
  let synchronizationError: unknown;
  try {
    await garageSyncEngine.synchronize({ forcePublish: true, awaitReplication: true });
  } catch (error) {
    synchronizationError = error;
  }
  const { expectedRecords, secret } = garageBackupVerificationInput();
  const relays = garageRelayUrls(coordinators);
  if (relays.length === 0) {
    throw synchronizationError ?? new Error("No coordinator relay is available.");
  }
  try {
    return await withRelayQueryPool((pool) => verifyGarageBackupWithPool(pool, secret, expectedRecords, relays));
  } catch (error) {
    throw synchronizationError ?? error;
  }
}

export async function verifyGarageBackupWithPool(
  pool: SimplePool,
  secret: Uint8Array,
  expectedRecords: GarageSyncRecord[],
  relays: string[]
): Promise<GarageBackupVerification> {
  const orderedRelays = [...new Set(orderRelays(relays))];
  if (orderedRelays.length === 0) throw new Error("No coordinator relay is available.");
  const relayResults = await Promise.all(
    orderedRelays.map(async (relay) => {
      try {
        const result = await queryGarageRecordsDetailed(pool, secret, [relay], BACKUP_VERIFICATION_RELAY_TIMEOUT_MS);
        return {
          reachable: result.reachableRelays.length > 0,
          verified: result.completeRelays.includes(relay) && garageRecordsCoverExpected(result.records, expectedRecords)
        };
      } catch {
        return { reachable: false, verified: false };
      }
    })
  );
  const verifiedRelays = relayResults.filter((result) => result.verified).length;
  const requiredRelays = Math.min(2, orderedRelays.length);
  return {
    reachableRelays: relayResults.filter((result) => result.reachable).length,
    requiredRelays,
    totalRelays: orderedRelays.length,
    verified: verifiedRelays >= requiredRelays,
    verifiedRelays
  };
}
