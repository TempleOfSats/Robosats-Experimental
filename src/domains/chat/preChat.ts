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
