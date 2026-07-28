import { toUserMessage } from "@/lib/userError";

export class RoboSatsApiError extends Error {
  readonly code?: number;

  constructor(readonly status: number, readonly response: unknown, fallback: string) {
    super(toUserMessage(response, fallback));
    this.name = "RoboSatsApiError";
    this.code = findApiErrorCode(response);
  }
}

export function hasRoboSatsApiErrorCode(error: unknown, code: number): boolean {
  return error instanceof RoboSatsApiError && error.code === code;
}

function findApiErrorCode(value: unknown, depth = 0): number | undefined {
  if (!value || depth > 4) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const code = findApiErrorCode(item, depth + 1);
      if (code !== undefined) return code;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  const direct = record.error_code;
  if (typeof direct === "number" && Number.isInteger(direct)) return direct;
  if (typeof direct === "string" && /^\d+$/.test(direct)) return Number(direct);

  for (const item of Object.values(record)) {
    const code = findApiErrorCode(item, depth + 1);
    if (code !== undefined) return code;
  }
  return undefined;
}
