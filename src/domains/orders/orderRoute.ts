export function loadOrderPage() {
  return import("@/domains/orders/OrderPage");
}

export function preloadOrderRoute(): void {
  // Warm-up only: a chunk that cannot be fetched now is retried when the user
  // actually navigates, where the route error boundary can report it.
  void loadOrderPage().catch(() => undefined);
}
