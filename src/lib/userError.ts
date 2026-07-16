const preferredMessageKeys = [
  "bad_invoice",
  "bad_request",
  "detail",
  "message",
  "error",
  "reason"
] as const;

export function toUserMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  const extracted = extractMessage(error);
  if (!extracted) return fallback;

  const normalized = normalizeKnownTechnicalMessage(extracted);
  if (!normalized || looksTechnical(normalized)) return fallback;
  return sentence(normalized);
}

function extractMessage(value: unknown): string | undefined {
  if (typeof value === "string") return extractFromString(value);
  if (value instanceof Error) return extractFromString(value.message);
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of preferredMessageKeys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate === "object") {
      const nested = extractMessage(candidate);
      if (nested) return nested;
    }
  }
  return undefined;
}

function extractFromString(value: string): string | undefined {
  const text = value.trim();
  if (!text) return undefined;

  const apiMatch = text.match(/^RoboSats API\s+\d+\s*:\s*([\s\S]+)$/i);
  const possibleJson = apiMatch?.[1] ?? text;
  if (/^[{[]/.test(possibleJson)) {
    try {
      return extractMessage(JSON.parse(possibleJson)) ?? undefined;
    } catch {
      if (apiMatch) return undefined;
    }
  }
  return text.replace(/^RoboSats API\s+\d+\s*:\s*/i, "").trim();
}

function normalizeKnownTechnicalMessage(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (/timeout|timed out/i.test(text)) return "The request took too long. Please try again";
  if (/networkerror|failed to fetch|fetch resource|connection refused|network request failed|transport is unavailable|unknownhost|connectexception|socketexception|sslhandshake|unable to resolve/i.test(text)) {
    return "Could not reach the coordinator. Check your connection and try again";
  }
  if (/aborterror|request aborted/i.test(text)) return "The request was interrupted. Please try again";
  return text.replace(/\blightning\b/gi, "Lightning");
}

function looksTechnical(value: string): boolean {
  return (
    value === "[object Object]" ||
    /^[{[]/.test(value) ||
    /<\/?[a-z][\s\S]*>/i.test(value) ||
    /\b(?:stack trace|typeerror|syntaxerror|referenceerror|[a-z]+exception)\b/i.test(value)
  );
}

function sentence(value: string): string {
  if (/[.!?]$/.test(value)) return value;
  return `${value}.`;
}
