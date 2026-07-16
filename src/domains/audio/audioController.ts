import { tradeAudioAssets, type TradeAudioEvent } from "@/domains/audio/audioAssets";

const audioElements = new Map<TradeAudioEvent, HTMLAudioElement>();

export async function playTradeAudio(event: TradeAudioEvent): Promise<void> {
  if (typeof Audio === "undefined") return;
  const audio = getAudio(event);
  await audio.play();
}

export function preloadTradeAudio(events: TradeAudioEvent[] = Object.keys(tradeAudioAssets) as TradeAudioEvent[]): void {
  if (typeof Audio === "undefined") return;
  events.forEach((event) => {
    getAudio(event).load();
  });
}

function getAudio(event: TradeAudioEvent): HTMLAudioElement {
  const cached = audioElements.get(event);
  if (cached) return cached;
  const audio = new Audio(tradeAudioAssets[event]);
  audio.preload = "auto";
  audioElements.set(event, audio);
  return audio;
}
