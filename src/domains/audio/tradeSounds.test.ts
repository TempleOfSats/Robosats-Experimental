import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeParam {
  readonly calls: Array<{ method: string; values: number[] }> = [];
  value = 0;
  setValueAtTime(value: number, at: number): void {
    this.calls.push({ method: "set", values: [value, at] });
  }
  linearRampToValueAtTime(value: number, at: number): void {
    this.calls.push({ method: "linear", values: [value, at] });
  }
  exponentialRampToValueAtTime(value: number, at: number): void {
    this.calls.push({ method: "exponential", values: [value, at] });
  }
  setTargetAtTime(value: number, at: number, time: number): void {
    this.calls.push({ method: "target", values: [value, at, time] });
  }
  cancelScheduledValues(at: number): void {
    this.calls.push({ method: "cancel", values: [at] });
  }
}

class FakeNode {
  connected = false;
  disconnected = false;
  connect(): void {
    this.connected = true;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakeFilter extends FakeNode {
  type = "";
  frequency = { value: 0 };
  Q = { value: 0 };
}
class FakeOscillator extends FakeNode {
  type: OscillatorType = "sine";
  frequency = new FakeParam();
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  start(at: number): void {
    this.started = true;
    this.frequency.calls.push({ method: "start", values: [at] });
  }
  stop(at: number): void {
    this.stopped = true;
    this.frequency.calls.push({ method: "stop", values: [at] });
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static initialState: AudioContextState = "running";
  static rejectResume = false;
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly filters: FakeFilter[] = [];
  readonly oscillators: FakeOscillator[] = [];
  readonly currentTime = 1;
  readonly sampleRate = 44100;
  state: AudioContextState = FakeAudioContext.initialState;
  resume = vi.fn(async () => {
    if (FakeAudioContext.rejectResume) throw new Error("blocked");
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createGain(): FakeGain {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }
  createBiquadFilter(): FakeFilter {
    const node = new FakeFilter();
    this.filters.push(node);
    return node;
  }
  createOscillator(): FakeOscillator {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node;
  }
}

function installContext(ctor: typeof FakeAudioContext = FakeAudioContext): void {
  FakeAudioContext.instances = [];
  FakeAudioContext.initialState = "running";
  FakeAudioContext.rejectResume = false;
  Object.assign(globalThis, { window: { AudioContext: ctor } });
}

describe("procedural trade sounds", () => {
  let originalWindow: typeof globalThis.window;

  beforeEach(() => {
    originalWindow = globalThis.window;
    vi.resetModules();
    installContext();
  });

  afterEach(() => Object.assign(globalThis, { window: originalWindow }));

  it("creates the context lazily and resumes suspended contexts", async () => {
    const sounds = await import("./tradeSounds");
    expect(FakeAudioContext.instances).toHaveLength(0);
    FakeAudioContext.initialState = "suspended";
    await expect(sounds.playChatOpen()).resolves.toBe(true);
    const context = FakeAudioContext.instances[0];
    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.oscillators).toHaveLength(3);
  });

  it("returns false after resume rejection without creating voices", async () => {
    const sounds = await import("./tradeSounds");
    FakeAudioContext.initialState = "suspended";
    FakeAudioContext.rejectResume = true;
    await expect(sounds.playSuccessful()).resolves.toBe(false);
    const context = FakeAudioContext.instances[0];
    expect(context.oscillators).toHaveLength(0);
  });

  it.each([
    ["playTakerFound", 12],
    ["playLockedInvoice", 7],
    ["playSuccessful", 11],
    ["playChatOpen", 3],
    ["playOrderPaused", 4],
    ["playOrderResumed", 4],
    ["playOrderCancelled", 4],
    ["playOrderCollabCancelled", 5],
    ["playOrderDisputeOpened", 6],
    ["playRewardsWithdrawalSuccess", 6]
  ] as const)("%s schedules the supplied recipe (%i oscillators)", async (name, count) => {
    const sounds = await import("./tradeSounds");
    const played = await sounds[name]();
    const context = FakeAudioContext.instances[0];
    expect(played).toBe(true);
    expect(context.oscillators).toHaveLength(count);
    expect(context.oscillators.every((oscillator) => oscillator.started && oscillator.stopped)).toBe(true);
    if (name === "playChatOpen") {
      expect(
        context.gains.slice(2).map((gain) => gain.gain.calls.find((call) => call.method === "linear")?.values[0])
      ).toEqual([1.2, 0.675, 0.1125]);
      expect(
        context.oscillators[0].frequency.calls.some((call) => call.method === "exponential" && call.values[0] === 925)
      ).toBe(true);
    }
    if (name === "playLockedInvoice") {
      expect(context.oscillators[0].frequency.calls.some((call) => call.values[0] === 1238)).toBe(true);
    }
  });

  it("supports Safari fallback and disconnects a completed voice", async () => {
    Object.assign(globalThis, { window: { webkitAudioContext: FakeAudioContext } });
    const sounds = await import("./tradeSounds");
    await sounds.playTakerFound();
    const context = FakeAudioContext.instances[0];
    context.oscillators.forEach((oscillator) => oscillator.onended?.());
    expect(context.filters[0].disconnected).toBe(true);
    expect(context.gains[1].disconnected).toBe(true);
  });
});
