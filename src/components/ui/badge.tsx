import type { HTMLAttributes, PropsWithChildren } from "react";
import { cn } from "@/lib/cn";

type BadgeTone = "default" | "success" | "warning" | "danger" | "buy" | "sell" | "muted";

const toneClass: Record<BadgeTone, string> = {
  default: "badge-default",
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-danger",
  buy: "badge-buy",
  sell: "badge-sell",
  muted: "badge-muted"
};

export function Badge({
  tone = "default",
  icon,
  className,
  children,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  icon?: React.ReactNode;
}>) {
  return (
    <span className={cn("ui-badge", toneClass[tone], className)} {...props}>
      {icon ? <span className="badge-icon" aria-hidden="true">{icon}</span> : null}
      {children}
    </span>
  );
}
