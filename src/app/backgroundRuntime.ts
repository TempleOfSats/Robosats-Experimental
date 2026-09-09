import { reportRuntimeUnavailable } from "@/app/runtimeNotice";

// Failed imports may remain cached, and throwing starters cannot return cleanup
// for partial work. Neither failure is retried: recovery requires a user reload.
export function startBackgroundRuntime<T>(
  load: () => Promise<T>,
  onStarted: (runtime: T) => (() => void) | undefined,
  unavailableMessage: string
): () => void {
  let stopped = false;
  let cleanup: (() => void) | undefined;

  void (async () => {
    let loaded = false;
    try {
      const runtime = await load();
      loaded = true;
      if (stopped) return;
      cleanup = onStarted(runtime);
    } catch (error) {
      if (stopped) return;
      cleanup = reportRuntimeUnavailable(unavailableMessage);
      if (import.meta.env.DEV) {
        console.warn(`[runtime] background runtime failed to ${loaded ? "start" : "load"}`, error);
      }
    }
  })();

  return () => {
    if (stopped) return;
    stopped = true;
    cleanup?.();
  };
}
