import { isAndroidApp, isIOSApp } from "@/domains/transport/androidBridge";
import type { RequestPriority, RequestSource } from "@/domains/transport/apiClient";

export type ScheduleRequestOptions = {
  key?: string;
  origin: string;
  method: string;
  priority: RequestPriority;
  source: RequestSource;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ScheduledRequest<T> = {
  promise: Promise<T>;
  promote(priority: RequestPriority): void;
  cancel(reason?: string): void;
};

type SchedulerCapacity = {
  total: number;
  background: number;
  perOrigin: number;
};

type SchedulerTask = {
  id: number;
  key?: string;
  origin: string;
  method: string;
  priority: RequestPriority;
  source: RequestSource;
  execute: (signal: AbortSignal) => Promise<unknown>;
  controller: AbortController;
  queuedAt: number;
  started: boolean;
  startedAt?: number;
  settled: boolean;
  timeout?: ReturnType<typeof setTimeout>;
  timeoutMs?: number;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  detachExternalAbort?: () => void;
};

const MOBILE_CAPACITY: SchedulerCapacity = { total: 3, background: 2, perOrigin: 2 };
const DESKTOP_CAPACITY: SchedulerCapacity = { total: 4, background: 3, perOrigin: 2 };
const PRIORITY_RANK: Record<RequestPriority, number> = {
  action: 0,
  foreground: 1,
  visible: 2,
  background: 3,
  maintenance: 4
};

export class CoordinatorRequestScheduler {
  private readonly queued: SchedulerTask[] = [];
  private readonly keyed = new Map<string, SchedulerTask>();
  private readonly activeByOrigin = new Map<string, number>();
  private active = 0;
  private activeBackground = 0;
  private sequence = 0;
  private highPriorityAdmissions = 0;

  schedule<T>(
    options: ScheduleRequestOptions,
    execute: (signal: AbortSignal) => Promise<T>
  ): ScheduledRequest<T> {
    if (options.key) {
      const existing = this.keyed.get(options.key);
      if (existing) {
        this.promoteTask(existing, options.priority);
        this.extendTimeout(existing, options.timeoutMs);
        return this.publicHandle<T>(existing);
      }
    }

    let resolveTask: (value: unknown) => void = () => undefined;
    let rejectTask: (reason: unknown) => void = () => undefined;
    const promise = new Promise<unknown>((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });
    const task: SchedulerTask = {
      id: ++this.sequence,
      key: options.key,
      origin: options.origin,
      method: options.method.toUpperCase(),
      priority: options.priority,
      source: options.source,
      execute,
      controller: new AbortController(),
      queuedAt: performanceNow(),
      started: false,
      settled: false,
      timeoutMs: options.timeoutMs,
      promise,
      resolve: resolveTask,
      reject: rejectTask
    };

    const externalSignal = options.signal;
    if (externalSignal) {
      const abort = () => this.cancelTask(task, abortReason(externalSignal));
      if (externalSignal.aborted) {
        abort();
        return this.publicHandle<T>(task);
      }
      externalSignal.addEventListener("abort", abort, { once: true });
      task.detachExternalAbort = () => externalSignal.removeEventListener("abort", abort);
    }

    this.queued.push(task);
    if (task.key) this.keyed.set(task.key, task);
    this.drain();
    return this.publicHandle<T>(task);
  }

  resetForTests(): void {
    for (const task of [...this.queued]) this.cancelTask(task, "Scheduler reset");
    this.queued.length = 0;
    this.keyed.clear();
    this.activeByOrigin.clear();
    this.active = 0;
    this.activeBackground = 0;
    this.highPriorityAdmissions = 0;
  }

  private publicHandle<T>(task: SchedulerTask): ScheduledRequest<T> {
    return {
      promise: task.promise as Promise<T>,
      promote: (priority) => this.promoteTask(task, priority),
      cancel: (reason) => this.cancelTask(task, reason)
    };
  }

  private promoteTask(task: SchedulerTask, priority: RequestPriority): void {
    if (task.settled || task.started || PRIORITY_RANK[priority] >= PRIORITY_RANK[task.priority]) return;
    task.priority = priority;
    this.drain();
  }

  private cancelTask(task: SchedulerTask, reason = "Request cancelled"): void {
    if (task.settled) return;
    if (task.started) {
      task.controller.abort(reason);
      return;
    }
    task.settled = true;
    this.removeQueued(task);
    this.removeKey(task);
    task.detachExternalAbort?.();
    task.reject(new DOMException(reason, "AbortError"));
  }

  private extendTimeout(task: SchedulerTask, timeoutMs?: number): void {
    if (!timeoutMs || timeoutMs <= (task.timeoutMs ?? 0) || task.settled) return;
    task.timeoutMs = timeoutMs;
    if (task.started) this.armTimeout(task);
  }

  private drain(): void {
    const capacity = schedulerCapacity();
    while (this.active < capacity.total) {
      const next = this.pickNext(capacity);
      if (!next) return;
      this.start(next, capacity);
    }
  }

  private pickNext(capacity: SchedulerCapacity): SchedulerTask | undefined {
    const waitingAction = this.queued.some((task) => task.priority === "action");
    const candidates = this.queued.filter((task) => {
      if ((this.activeByOrigin.get(task.origin) ?? 0) >= capacity.perOrigin) return false;
      if (isBackground(task.priority) && this.activeBackground >= capacity.background) return false;
      if (waitingAction && task.priority !== "action") return false;
      return true;
    });
    if (candidates.length === 0) return undefined;

    const visibleCandidate = this.highPriorityAdmissions >= 5
      ? candidates.find((task) => task.priority === "visible")
      : undefined;
    if (visibleCandidate && !waitingAction) return visibleCandidate;

    return candidates.sort((left, right) =>
      PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] || left.id - right.id
    )[0];
  }

  private start(task: SchedulerTask, _capacity: SchedulerCapacity): void {
    this.removeQueued(task);
    task.started = true;
    task.startedAt = performanceNow();
    this.armTimeout(task);
    this.active += 1;
    if (isBackground(task.priority)) this.activeBackground += 1;
    this.activeByOrigin.set(task.origin, (this.activeByOrigin.get(task.origin) ?? 0) + 1);
    if (task.priority === "action" || task.priority === "foreground") {
      this.highPriorityAdmissions += 1;
    } else if (task.priority === "visible") {
      this.highPriorityAdmissions = 0;
    }

    void task.execute(task.controller.signal).then(
      (value) => task.resolve(value),
      (error) => task.reject(error)
    ).finally(() => {
      task.settled = true;
      if (task.timeout !== undefined) globalThis.clearTimeout(task.timeout);
      task.detachExternalAbort?.();
      this.removeKey(task);
      this.active -= 1;
      if (isBackground(task.priority)) this.activeBackground -= 1;
      const originCount = (this.activeByOrigin.get(task.origin) ?? 1) - 1;
      if (originCount <= 0) this.activeByOrigin.delete(task.origin);
      else this.activeByOrigin.set(task.origin, originCount);
      this.drain();
    });
  }

  private armTimeout(task: SchedulerTask): void {
    if (task.startedAt === undefined || !task.timeoutMs) return;
    if (task.timeout !== undefined) globalThis.clearTimeout(task.timeout);
    const remainingMs = Math.max(0, task.startedAt + task.timeoutMs - performanceNow());
    task.timeout = globalThis.setTimeout(() => {
      task.controller.abort(new Error(`Tor request timeout after ${task.timeoutMs}ms`));
    }, remainingMs);
  }

  private removeQueued(task: SchedulerTask): void {
    const index = this.queued.indexOf(task);
    if (index >= 0) this.queued.splice(index, 1);
  }

  private removeKey(task: SchedulerTask): void {
    if (task.key && this.keyed.get(task.key) === task) this.keyed.delete(task.key);
  }
}

function schedulerCapacity(): SchedulerCapacity {
  return isAndroidApp() || isIOSApp() ? MOBILE_CAPACITY : DESKTOP_CAPACITY;
}

function isBackground(priority: RequestPriority): boolean {
  return priority === "background" || priority === "maintenance";
}

function abortReason(signal: AbortSignal): string {
  return typeof signal.reason === "string" ? signal.reason : "Request cancelled";
}

function performanceNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export const coordinatorRequestScheduler = new CoordinatorRequestScheduler();
