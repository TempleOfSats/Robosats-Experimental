import type { TradeAudioEvent } from "@/domains/audio/audioAssets";
import {
  playChatOpen,
  playLockedInvoice,
  playOrderCancelled,
  playOrderCollabCancelled,
  playOrderDisputeOpened,
  playOrderPaused,
  playOrderResumed,
  playRewardsWithdrawalSuccess,
  playSuccessful,
  playTakerFound
} from "@/domains/audio/tradeSounds";

export async function playTradeAudio(event: TradeAudioEvent): Promise<void> {
  if (typeof window === "undefined") return;
  switch (event) {
    case "chat-open":
      await playChatOpen();
      break;
    case "locked-invoice":
      await playLockedInvoice();
      break;
    case "order-cancelled":
      await playOrderCancelled();
      break;
    case "order-collab-cancelled":
      await playOrderCollabCancelled();
      break;
    case "order-dispute-opened":
      await playOrderDisputeOpened();
      break;
    case "order-paused":
      await playOrderPaused();
      break;
    case "order-resumed":
      await playOrderResumed();
      break;
    case "rewards-withdrawal-success":
      await playRewardsWithdrawalSuccess();
      break;
    case "successful":
      await playSuccessful();
      break;
    case "taker-found":
      await playTakerFound();
      break;
  }
}
