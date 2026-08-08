import { isTauriDesktop, showDesktopNotification } from "@/domains/transport/tauriBridge";

export function showDesktopOrderNotification(
  orderId: number,
  shortAlias: string,
  message: string,
  robotHashId?: string
): Promise<boolean> {
  if (!isTauriDesktop()) return Promise.resolve(false);
  if (!Number.isInteger(orderId) || orderId < 1 || !/^[a-z0-9-]+$/i.test(shortAlias)) {
    return Promise.resolve(false);
  }
  const request = {
    title: `Order #${orderId}`,
    body: message,
    route: `/order/${shortAlias}/${orderId}`
  };
  if (!/^[a-f0-9]{64}$/i.test(robotHashId ?? "")) {
    return showDesktopNotification(request).catch(() => false);
  }
  return import("@/domains/identity/roboidentitiesClient")
    .then(({ generateRobohash }) => generateRobohash(robotHashId!))
    .then(rasterizeNotificationAvatar)
    .then((dataUrl) => ({ cacheKey: robotHashId!, dataUrl }))
    .catch(() => undefined)
    .then((avatar) => showDesktopNotification(avatar ? { ...request, avatar } : request))
    .catch(() => false);
}

function rasterizeNotificationAvatar(source: string): Promise<string> {
  if (source.startsWith("data:image/png;base64,")) return Promise.resolve(source);
  if (!source.startsWith("data:image/svg+xml;base64,")) return Promise.reject(new Error("Unsupported avatar format"));
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 80;
      canvas.height = 80;
      const context = canvas.getContext("2d");
      if (!context) return reject(new Error("Canvas unavailable"));
      context.drawImage(image, 0, 0, 80, 80);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("Avatar could not be rasterized"));
    image.src = source;
  });
}
