import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

export type ArtiProgress = {
  progress: number;
  stage: string;
};

type ArtiReady = {
  port: number;
  version: string;
};

type ArtiMessage =
  | ({ type: "progress" } & ArtiProgress)
  | ({ type: "ready" } & ArtiReady)
  | { type: "error"; message: string };

export class ArtiProcess {
  private child?: ChildProcessByStdio<null, Readable, Readable>;
  private stopping = false;

  constructor(
    private readonly executable: string,
    private readonly dataDirectory: string,
    private readonly onProgress: (progress: ArtiProgress) => void,
    private readonly onUnexpectedExit: (message: string) => void
  ) {}

  start(): Promise<ArtiReady> {
    if (this.child) return Promise.reject(new Error("Arti is already running"));
    this.stopping = false;

    return new Promise((resolve, reject) => {
      let settled = false;
      let lastError = "";
      const child = spawn(this.executable, ["--data-dir", this.dataDirectory], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
      this.child = child;

      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        const message = parseMessage(line);
        if (!message) return;
        if (message.type === "progress") {
          this.onProgress(message);
          return;
        }
        if (message.type === "error") {
          lastError = message.message;
          return;
        }
        if (!settled) {
          settled = true;
          resolve(message);
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const message = chunk.toString("utf8").trim();
        if (message) lastError = message;
      });

      child.once("error", (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      child.once("exit", (code, signal) => {
        this.child = undefined;
        lines.close();
        const reason = lastError || `Arti exited (${signal ?? code ?? "unknown"})`;
        if (!settled) {
          settled = true;
          reject(new Error(reason));
        } else if (!this.stopping) {
          this.onUnexpectedExit(reason);
        }
      });
    });
  }

  stop(): void {
    this.stopping = true;
    this.child?.kill();
    this.child = undefined;
  }
}

function parseMessage(line: string): ArtiMessage | undefined {
  try {
    const value = JSON.parse(line) as Partial<ArtiMessage>;
    if (value.type === "progress" && typeof value.progress === "number" && typeof value.stage === "string") {
      return {
        type: "progress",
        progress: Math.max(0, Math.min(100, value.progress)),
        stage: value.stage
      };
    }
    if (value.type === "ready" && typeof value.port === "number" && typeof value.version === "string") {
      return { type: "ready", port: value.port, version: value.version };
    }
    if (value.type === "error" && typeof value.message === "string") {
      return { type: "error", message: value.message };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
