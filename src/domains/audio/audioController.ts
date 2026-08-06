import type { TradeAudioEvent } from "@/domains/audio/audioAssets";
import { playChatOpen, playLockedInvoice, playSuccessful, playTakerFound } from "@/domains/audio/tradeSounds";

export async function playTradeAudio(event: TradeAudioEvent): Promise<void> {
  if (typeof window === "undefined") return;
  switch (event) {
    case "chat-open":
      await playChatOpen();
      break;
    case "locked-invoice":
      await playLockedInvoice();
      break;
    case "successful":
      await playSuccessful();
      break;
    case "taker-found":
      await playTakerFound();
      break;
  }
}
