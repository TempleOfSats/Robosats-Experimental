export function loadStatisticsPage() {
  return import("@/domains/statistics/StatisticsPage");
}

export function preloadStatisticsRoute(): void {
  // Warm-up only: a chunk that cannot be fetched now is retried when the user
  // actually navigates, where the route error boundary can report it.
  void loadStatisticsPage().catch(() => undefined);
}
