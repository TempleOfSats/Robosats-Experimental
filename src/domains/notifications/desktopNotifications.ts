import { showDesktopNotification } from "@/domains/transport/tauriBridge";

export function showDesktopOrderNotification(
  orderId: number,
  shortAlias: string,
  message: string
): Promise<boolean> {
  if (!Number.isInteger(orderId) || orderId < 1 || !/^[a-z0-9-]+$/i.test(shortAlias)) {
    return Promise.resolve(false);
  }
  return showDesktopNotification({
    title: `Order #${orderId}`,
    body: message,
    route: `/order/${shortAlias}/${orderId}`
  }).catch(() => false);
}
