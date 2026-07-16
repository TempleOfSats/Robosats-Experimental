import { isNativeApp, transportRequest } from "@/domains/transport/androidBridge";

export interface LnProxyServer {
  name: string;
  url: string;
  relayType: "Tor" | "Clearnet";
  network: "mainnet";
}

const lnProxyServers: LnProxyServer[] = [
  { name: "Tor1 w3sqmn", url: "http://w3sqmns2ct7ai2wiwzq5uplp2pqglpm6qpeey4blvn6agj3jr5abthqd.onion/spec", relayType: "Tor", network: "mainnet" },
  { name: "Tor2 rdq6tv", url: "http://rdq6tvulanl7aqtupmoboyk2z3suzkdwurejwyjyjf4itr3zhxrm2lad.onion/spec", relayType: "Tor", network: "mainnet" },
  { name: "Clearnet lnproxy.org", url: "https://lnproxy.org/spec", relayType: "Clearnet", network: "mainnet" }
];

export function availableLnProxyServers(
  hostname = typeof window === "undefined" ? "" : window.location.hostname,
  nativeRuntime = isNativeApp()
): LnProxyServer[] {
  const relayType = nativeRuntime || hostname.endsWith(".onion") ? "Tor" : "Clearnet";
  return lnProxyServers.filter((server) => server.relayType === relayType);
}

export async function wrapLnProxyInvoice(server: LnProxyServer, invoice: string, routingSats: number): Promise<string> {
  const response = await transportRequest(server.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoice,
        description: "",
        ...(routingSats > 0 ? { routing_msat: String(Math.floor(routingSats * 1000)) } : {})
      })
    }, 30_000);
    const data = JSON.parse(response.body) as { proxy_invoice?: unknown; reason?: unknown };
    if (response.status < 200 || response.status >= 300 || typeof data.proxy_invoice !== "string") {
      throw new Error(typeof data.reason === "string" ? data.reason : `LNProxy returned HTTP ${response.status}`);
    }
    return data.proxy_invoice;
}
