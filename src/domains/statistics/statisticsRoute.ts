export function loadStatisticsPage() {
  return import("@/domains/statistics/StatisticsPage");
}

export function preloadStatisticsRoute(): void {
  void loadStatisticsPage();
}
