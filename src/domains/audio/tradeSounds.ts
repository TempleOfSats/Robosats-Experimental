type Tone = readonly [number, number, number, number, OscillatorType, number?, number?];
type Recipe = { lowPassHz: number; tones: readonly Tone[] };
type SafariWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

const RECIPES: Readonly<Record<"takerFound" | "lockedInvoice" | "successful" | "chatOpen", Recipe>> = {
  takerFound: {
    lowPassHz: 7000,
    tones: [
      [0, 231, 0.68, 0.07, "sine", 0.014],
      [0, 312, 0.82, 0.18, "sine", 0.012],
      [0, 393, 0.86, 0.225, "sine", 0.012],
      [0, 622, 0.62, 0.105, "sine", 0.008],
      [0.48, 932, 0.74, 0.17, "sine", 0.008],
      [0.48, 1244, 1.02, 0.27, "sine", 0.008],
      [0.48, 1566, 0.7, 0.135, "sine", 0.006],
      [0.482, 2488, 0.42, 0.08, "sine", 0.004],
      [1, 466, 1.48, 0.285, "sine", 0.012],
      [1, 622, 1.34, 0.165, "sine", 0.012],
      [1, 783, 1.22, 0.215, "sine", 0.01],
      [1.004, 469.2, 1.12, 0.046, "sine", 0.016]
    ]
  },
  lockedInvoice: {
    lowPassHz: 12000,
    tones: [
      [0, 1244, 0.82, 0.105, "sine", 0.006, 1238],
      [0, 1663, 0.62, 0.39, "sine", 0.004, 1650],
      [0.002, 3790, 0.22, 0.07, "sine", 0.003, 3760],
      [0, 7041, 0.13, 0.095, "sine", 0.002, 6950],
      [0.006, 8635, 0.1, 0.07, "sine", 0.002, 8500],
      [0.13, 2091, 1.22, 0.51, "sine", 0.004, 2075],
      [0.132, 6115, 0.2, 0.065, "sine", 0.002, 6040]
    ]
  },
  successful: {
    lowPassHz: 12000,
    tones: [
      [0, 699, 0.42, 0.19, "sine", 0.006, 695],
      [0, 2097, 0.36, 0.185, "sine", 0.004, 2085],
      [0.004, 4888, 0.18, 0.05, "sine", 0.002, 4820],
      [0.11, 880, 0.62, 0.215, "sine", 0.006, 875],
      [0.11, 2640, 0.54, 0.285, "sine", 0.004, 2625],
      [0.114, 6158, 0.2, 0.055, "sine", 0.002, 6060],
      [0.25, 1397, 1.42, 0.3, "sine", 0.008, 1388],
      [0.25, 4191, 1.14, 0.325, "sine", 0.004, 4155],
      [0.254, 3138, 0.8, 0.125, "sine", 0.004, 3115],
      [0.258, 7327, 0.3, 0.052, "sine", 0.002, 7200],
      [0.26, 9776, 0.18, 0.044, "sine", 0.002, 9600]
    ]
  },
  chatOpen: {
    lowPassHz: 6000,
    tones: [
      [0, 840, 0.01, 1.2, "sine", 0.0012, 925],
      [0.006, 925, 0.019, 0.675, "sine", 0.0008, 750],
      [0, 3040, 0.007, 0.1125, "sine", 0.0004, 2700]
    ]
  }
};
type Voice = { gain: GainNode; filter: BiquadFilterNode; oscillators: Set<OscillatorNode>; stopped: boolean };
let context: AudioContext | null = null;
let master: GainNode | null = null;
const voices = new Set<Voice>();
const MAX_VOICES = 8;
function getContext(): AudioContext {
  if (context && context.state !== "closed") return context;
  const Ctor = window.AudioContext || (window as SafariWindow).webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio API is not supported.");
  context = new Ctor({ latencyHint: "interactive" });
  master = context.createGain();
  master.gain.value = 0;
  master.connect(context.destination);
  updateMaster(false);
  return context;
}
function updateMaster(smooth = true): void {
  if (!context || !master) return;
  const target = 0.72;
  const now = context.currentTime;
  master.gain.cancelScheduledValues(now);
  if (smooth) master.gain.setTargetAtTime(target, now, 0.015);
  else master.gain.setValueAtTime(target, now);
}
function stopVoice(voice: Voice): void {
  if (voice.stopped) return;
  voice.stopped = true;
  for (const oscillator of voice.oscillators) {
    oscillator.onended = null;
    try {
      oscillator.stop();
    } catch {}
    oscillator.disconnect();
  }
  voice.oscillators.clear();
  voice.filter.disconnect();
  voice.gain.disconnect();
  voices.delete(voice);
  rebalance();
}
function rebalance(): void {
  if (!context) return;
  const target = voices.size === 1 ? 0.9 : 0.72 / Math.sqrt(Math.max(1, voices.size));
  const now = context.currentTime;
  for (const voice of voices) {
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(target, now, 0.012);
  }
}
async function ensureRunning(): Promise<AudioContext | null> {
  const audio = getContext();
  if (["suspended", "interrupted"].includes(String(audio.state))) {
    try {
      await audio.resume();
    } catch {
      return null;
    }
  }
  return audio.state === "running" ? audio : null;
}
async function playRecipe(recipe: Recipe): Promise<boolean> {
  const audio = await ensureRunning();
  if (!audio || !master) return false;
  if (voices.size >= MAX_VOICES) {
    const oldest = voices.values().next().value as Voice | undefined;
    if (oldest) stopVoice(oldest);
  }
  const gain = audio.createGain();
  const filter = audio.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = Math.min(recipe.lowPassHz, audio.sampleRate * 0.45);
  filter.Q.value = 0.707;
  filter.connect(gain);
  gain.connect(master);
  const voice: Voice = { gain, filter, oscillators: new Set(), stopped: false };
  voices.add(voice);
  rebalance();
  const base = audio.currentTime + 0.015;
  let remaining = recipe.tones.length;
  for (const [delay, frequency, duration, peak, waveform, attack = 0.008, endFrequency] of recipe.tones) {
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    const start = base + delay;
    const stop = start + duration;
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, stop);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(peak, start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, stop);
    oscillator.connect(envelope);
    envelope.connect(filter);
    voice.oscillators.add(oscillator);
    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
      voice.oscillators.delete(oscillator);
      if (--remaining === 0) stopVoice(voice);
    };
    oscillator.start(start);
    oscillator.stop(stop + 0.025);
  }
  return true;
}
export const playTakerFound = (): Promise<boolean> => playRecipe(RECIPES.takerFound);
export const playLockedInvoice = (): Promise<boolean> => playRecipe(RECIPES.lockedInvoice);
export const playSuccessful = (): Promise<boolean> => playRecipe(RECIPES.successful);
export const playChatOpen = (): Promise<boolean> => playRecipe(RECIPES.chatOpen);
