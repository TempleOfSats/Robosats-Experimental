import {
  isAndroidApp,
  isNativeApp,
  resumeNativeTransport,
  suspendNativeTransport
} from "@/domains/transport/androidBridge";
import { coordinatorRequestScheduler } from "@/domains/transport/requestScheduler";
import { setTransportHealthActive } from "@/domains/transport/transportHealth";

let lifecycleCleanup: (() => void) | undefined;

export function installNativeTransportLifecycle(): () => void {
  if (lifecycleCleanup) return lifecycleCleanup;
  if (!isNativeApp()) return () => undefined;

  const initiallyVisible = document.visibilityState !== "hidden";
  let active = true;
  let resumeTimer: number | undefined;

  const suspend = () => {
    if (!active) return;
    active = false;
    setTransportHealthActive(false);
    coordinatorRequestScheduler.suspend("App backgrounded");
    suspendNativeTransport("App backgrounded");
  };
  const resume = () => {
    if (active) return;
    active = true;
    resumeNativeTransport();
    setTransportHealthActive(true);
    coordinatorRequestScheduler.resume();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      if (resumeTimer !== undefined) window.clearTimeout(resumeTimer);
      resumeTimer = undefined;
      suspend();
      return;
    }
    if (resumeTimer !== undefined) window.clearTimeout(resumeTimer);
    resumeTimer = window.setTimeout(() => {
      resumeTimer = undefined;
      if (document.visibilityState === "visible") resume();
    }, 0);
  };
  const onNativeResume = () => {
    if (!isAndroidApp() && document.visibilityState !== "visible") return;
    if (resumeTimer !== undefined) window.clearTimeout(resumeTimer);
    resumeTimer = undefined;
    resume();
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("robosats:native-resume", onNativeResume);
  if (!initiallyVisible) suspend();

  lifecycleCleanup = () => {
    if (resumeTimer !== undefined) window.clearTimeout(resumeTimer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("robosats:native-resume", onNativeResume);
    lifecycleCleanup = undefined;
  };
  return lifecycleCleanup;
}

export function resetNativeTransportLifecycleForTests(): void {
  lifecycleCleanup?.();
}
