type RoboSatsClient = "web" | "selfhosted" | "desktop" | "mobile";
type RoboSatsMode = "basic" | "pro";

export type RoboSatsPlatform = {
  client: RoboSatsClient;
  mode: RoboSatsMode;
  router: "browser" | "hash" | "memory";
};

export function parseRoboSatsSettings(value = window.RobosatsSettings || "web-basic"): RoboSatsPlatform {
  const [rawClient, rawMode] = value.split("-");
  const client = isClient(rawClient) ? rawClient : "web";
  const mode = rawMode === "pro" ? "pro" : "basic";
  const router = client === "desktop" || client === "mobile" ? "hash" : "browser";
  return { client, mode, router };
}

function isClient(value: string): value is RoboSatsClient {
  return ["web", "selfhosted", "desktop", "mobile"].includes(value);
}
