import { Skeleton } from "@/components/ui/skeleton";

export function AppLoadingSkeleton({
  label = "Loading RoboSats",
  variant = "route"
}: {
  label?: string;
  variant?: "route" | "robot";
}) {
  return (
    <div className={`app-loading-skeleton app-loading-skeleton-${variant}`} role="status" aria-live="polite" aria-label={label}>
      <div className="app-loading-skeleton-heading" aria-hidden>
        <Skeleton className="app-loading-skeleton-eyebrow" />
        <Skeleton className="app-loading-skeleton-title" />
      </div>
      <div className="app-loading-skeleton-card" aria-hidden>
        <Skeleton className="app-loading-skeleton-card-title" />
        <Skeleton className="app-loading-skeleton-line" />
        <Skeleton className="app-loading-skeleton-line app-loading-skeleton-line-short" />
        <Skeleton className="app-loading-skeleton-action" />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
