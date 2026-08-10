import type { PointerEvent as ReactPointerEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StateUpdate<T> = T | ((current: T) => T);
type HookRuntime = {
  useRef: <T>(initial: T) => { current: T };
  useState: <T>(initial: T | (() => T)) => [T, (update: StateUpdate<T>) => void];
};

const activeRuntime = vi.hoisted(() => ({
  current: undefined as HookRuntime | undefined
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useEffect: () => undefined,
    useMemo: <T>(factory: () => T) => factory(),
    useRef: <T>(initial: T) => {
      if (!activeRuntime.current) throw new Error("Hook rendered without a test runtime");
      return activeRuntime.current.useRef(initial);
    },
    useState: <T>(initial: T | (() => T)) => {
      if (!activeRuntime.current) throw new Error("Hook rendered without a test runtime");
      return activeRuntime.current.useState(initial);
    }
  };
});

import { useF2FWorldMap } from "@/domains/location/useF2FWorldMap";

type MapOptions = Parameters<typeof useF2FWorldMap>[0];
type MapResult = ReturnType<typeof useF2FWorldMap>;

describe("F2F world map pointer interactions", () => {
  let animationFrames: ReturnType<typeof stubAnimationFrames>;

  beforeEach(() => {
    animationFrames = stubAnimationFrames();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps movement at the location threshold as a click", () => {
    const runtime = createHookRuntime();
    const onMapClick = vi.fn();
    const options = locationOptions(onMapClick);
    const map = renderMap(runtime, options);
    const svg = createSvg();
    map.svgRef.current = svg.element;
    stubDomPoint();

    map.handlePointerDown(pointerEvent(svg.element, 1, 180, 75));
    map.handlePointerMove(pointerEvent(svg.element, 1, 183, 77));
    map.handlePointerUp(pointerEvent(svg.element, 1, 183, 77));

    expect(onMapClick).toHaveBeenCalledOnce();
    expect(onMapClick).toHaveBeenCalledWith([13, 3]);
    expect(renderMap(runtime, options).center).toEqual([15, 0]);
  });

  it("pans and suppresses location selection beyond the threshold", () => {
    const runtime = createHookRuntime();
    const onMapClick = vi.fn();
    const options = locationOptions(onMapClick);
    const map = renderMap(runtime, options);
    const svg = createSvg();
    map.svgRef.current = svg.element;
    stubDomPoint();

    map.handlePointerDown(pointerEvent(svg.element, 1, 180, 75));
    map.handlePointerMove(pointerEvent(svg.element, 1, 187, 75));
    map.handlePointerUp(pointerEvent(svg.element, 1, 187, 75));

    expect(onMapClick).not.toHaveBeenCalled();
    expect(renderMap(runtime, options).center).toEqual([15, -0.875]);
  });

  it("pans the offers map on its first nonzero movement", () => {
    const runtime = createHookRuntime();
    const options: MapOptions = {
      dragThreshold: 0,
      initialCenter: [15, 0],
      initialZoom: 2,
      maxZoom: 16,
      minZoom: 1
    };
    const map = renderMap(runtime, options);
    const svg = createSvg();
    map.svgRef.current = svg.element;

    map.handlePointerDown(pointerEvent(svg.element, 1, 180, 75));
    map.handlePointerMove(pointerEvent(svg.element, 1, 181, 75));
    animationFrames.flush();

    expect(renderMap(runtime, options).center).toEqual([15, -0.5]);
  });

  it("coalesces repeated pan movements into one frame using the latest position", () => {
    const runtime = createHookRuntime();
    const options: MapOptions = {
      dragThreshold: 0,
      initialCenter: [15, 0],
      initialZoom: 2,
      maxZoom: 16,
      minZoom: 1
    };
    const map = renderMap(runtime, options);
    const svg = createSvg();
    map.svgRef.current = svg.element;

    map.handlePointerDown(pointerEvent(svg.element, 1, 180, 75));
    map.handlePointerMove(pointerEvent(svg.element, 1, 181, 75));
    map.handlePointerMove(pointerEvent(svg.element, 1, 182, 75));
    map.handlePointerMove(pointerEvent(svg.element, 1, 183, 75));

    expect(animationFrames.request).toHaveBeenCalledOnce();
    animationFrames.flush();
    expect(renderMap(runtime, options).center).toEqual([15, -1.5]);
  });

  it("reads geometry only for the pointer that owns an active drag", () => {
    const runtime = createHookRuntime();
    const options: MapOptions = {
      dragThreshold: 0,
      initialCenter: [15, 0],
      initialZoom: 2,
      maxZoom: 16,
      minZoom: 1
    };
    const map = renderMap(runtime, options);
    const svg = createSvg();
    map.svgRef.current = svg.element;

    map.handlePointerMove(pointerEvent(svg.element, 1, 181, 75));
    map.handlePointerDown(pointerEvent(svg.element, 1, 180, 75));
    map.handlePointerMove(pointerEvent(svg.element, 2, 181, 75));

    expect(svg.getBoundingClientRect).not.toHaveBeenCalled();

    map.handlePointerMove(pointerEvent(svg.element, 1, 181, 75));
    animationFrames.flush();

    expect(svg.getBoundingClientRect).toHaveBeenCalledOnce();
    expect(renderMap(runtime, options).center).toEqual([15, -0.5]);
  });

  it("zooms through a pinch without turning either release into a click", () => {
    const runtime = createHookRuntime();
    const onMapClick = vi.fn();
    const options = locationOptions(onMapClick);
    let map = renderMap(runtime, options);
    const svg = createSvg();
    map.svgRef.current = svg.element;
    stubDomPoint();

    map.handlePointerDown(pointerEvent(svg.element, 1, 100, 75));
    map.handlePointerDown(pointerEvent(svg.element, 2, 200, 75));
    map.handlePointerMove(pointerEvent(svg.element, 2, 220, 75));
    animationFrames.flush();

    map = renderMap(runtime, options);
    expect(map.zoom).toBeCloseTo(9.6);
    map.handlePointerUp(pointerEvent(svg.element, 2, 220, 75));
    map.handlePointerUp(pointerEvent(svg.element, 1, 100, 75));

    expect(onMapClick).not.toHaveBeenCalled();
  });

  it("clears a cancelled pointer and accepts the next click", () => {
    const runtime = createHookRuntime();
    const onMapClick = vi.fn();
    const options = locationOptions(onMapClick);
    const map = renderMap(runtime, options);
    const svg = createSvg();
    map.svgRef.current = svg.element;
    stubDomPoint();

    map.handlePointerDown(pointerEvent(svg.element, 1, 180, 75));
    map.handlePointerCancel(pointerEvent(svg.element, 1, 180, 75));
    map.handlePointerUp(pointerEvent(svg.element, 1, 180, 75));
    expect(onMapClick).not.toHaveBeenCalled();

    map.handlePointerDown(pointerEvent(svg.element, 2, 180, 75));
    map.handlePointerUp(pointerEvent(svg.element, 2, 180, 75));
    expect(onMapClick).toHaveBeenCalledOnce();
    expect(onMapClick).toHaveBeenCalledWith([15, 0]);
  });
});

function locationOptions(onMapClick: (position: [number, number]) => void): MapOptions {
  return {
    dragThreshold: 5,
    initialCenter: [15, 0],
    initialZoom: 8,
    maxZoom: 32,
    minZoom: 1,
    onMapClick
  };
}

function renderMap(runtime: ReturnType<typeof createHookRuntime>, options: MapOptions): MapResult {
  return runtime.render(() => useF2FWorldMap(options));
}

function createHookRuntime() {
  const slots: unknown[] = [];
  let cursor = 0;
  const runtime: HookRuntime = {
    useRef<T>(initial: T) {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index] as { current: T };
    },
    useState<T>(initial: T | (() => T)) {
      const index = cursor++;
      if (!(index in slots)) {
        slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      }
      return [
        slots[index] as T,
        (update: StateUpdate<T>) => {
          const current = slots[index] as T;
          slots[index] = typeof update === "function" ? (update as (value: T) => T)(current) : update;
        }
      ];
    }
  };

  return {
    render<T>(hook: () => T): T {
      cursor = 0;
      activeRuntime.current = runtime;
      try {
        return hook();
      } finally {
        activeRuntime.current = undefined;
      }
    }
  };
}

function createSvg(): {
  element: SVGSVGElement;
  getBoundingClientRect: ReturnType<typeof vi.fn>;
} {
  const capturedPointers = new Set<number>();
  const getBoundingClientRect = vi.fn(() => ({
    height: 150,
    left: 0,
    top: 0,
    width: 360
  }));
  const element = {
    getBoundingClientRect,
    getScreenCTM: () => ({
      inverse: () => ({})
    }),
    hasPointerCapture: (pointerId: number) => capturedPointers.has(pointerId),
    releasePointerCapture: (pointerId: number) => capturedPointers.delete(pointerId),
    setPointerCapture: (pointerId: number) => capturedPointers.add(pointerId)
  } as unknown as SVGSVGElement;
  return { element, getBoundingClientRect };
}

function pointerEvent(
  currentTarget: SVGSVGElement,
  pointerId: number,
  clientX: number,
  clientY: number
): ReactPointerEvent<SVGSVGElement> {
  return {
    clientX,
    clientY,
    currentTarget,
    pointerId
  } as ReactPointerEvent<SVGSVGElement>;
}

function stubDomPoint() {
  vi.stubGlobal(
    "DOMPoint",
    class {
      readonly x: number;
      readonly y: number;

      constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
      }

      matrixTransform() {
        return this;
      }
    }
  );
}

function stubAnimationFrames() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const request = vi.fn((callback: FrameRequestCallback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => callbacks.delete(id))
  );
  return {
    flush() {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      pending.forEach(([, callback]) => callback(0));
    },
    request
  };
}
