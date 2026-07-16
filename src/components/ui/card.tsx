import type { HTMLAttributes, PropsWithChildren } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, children, ...props }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <section className={cn("ui-card", className)} {...props}>
      {children}
    </section>
  );
}

export function CardHeader({ className, children, ...props }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div className={cn("ui-card-header", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: PropsWithChildren<HTMLAttributes<HTMLHeadingElement>>) {
  return (
    <h2 className={cn("ui-card-title", className)} {...props}>
      {children}
    </h2>
  );
}

export function CardContent({ className, children, ...props }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div className={cn("ui-card-content", className)} {...props}>
      {children}
    </div>
  );
}
