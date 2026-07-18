export function showDesktopOrderNotification(
  orderId: number,
  shortAlias: string,
  message: string
): boolean {
  const bridge = typeof window === "undefined" ? undefined : window.RoboSatsDesktop;
  if (!bridge || !Number.isInteger(orderId) || orderId < 1 || !/^[a-z0-9-]+$/i.test(shortAlias)) return false;
  bridge.showNotification({
    title: `Order #${orderId}`,
    body: message,
    route: `/order/${shortAlias}/${orderId}`
  });
  return true;
}
