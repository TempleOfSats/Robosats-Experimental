export function loadOrderPage() {
  return import("@/domains/orders/OrderPage");
}

export function preloadOrderRoute(): void {
  void loadOrderPage();
}
