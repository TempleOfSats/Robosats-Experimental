import type { CoordinatorInfo } from "@/domains/coordinators/coordinator.types";

const PRE_CHAT_STATUS = 6;

export function coordinatorSupportsPreChat(info?: Pick<CoordinatorInfo, "features">): boolean {
  return info?.features?.pre_chat === true;
}

export function shouldOfferPreChat(
  status: number,
  info?: Pick<CoordinatorInfo, "features">
): boolean {
  return status === PRE_CHAT_STATUS && coordinatorSupportsPreChat(info);
}

export function visiblePreChatMessages<T extends { mine: boolean }>(messages: T[]): T[] {
  return messages.filter((message) => message.mine);
}

export function hasSentPreChatMessage(messages: Array<{ mine: boolean }>): boolean {
  return messages.some((message) => message.mine);
}

export function isOwnChatMessage(
  messageNick: string,
  ownCoordinatorNick: string,
  senderOnlyResponse = false
): boolean {
  if (senderOnlyResponse) return true;
  return messageNick.trim() === ownCoordinatorNick.trim();
}

export function usablePeerPublicKey(candidate: string, ownPublicKey: string): string {
  const normalizedCandidate = normalizeArmoredKey(candidate);
  if (!normalizedCandidate.startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----")) return "";
  return normalizedCandidate === normalizeArmoredKey(ownPublicKey) ? "" : candidate;
}

function normalizeArmoredKey(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}
