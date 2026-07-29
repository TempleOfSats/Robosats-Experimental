import {
  createElement,
  type HTMLAttributes,
  type PropsWithChildren
} from "react";
import { cn } from "@/lib/cn";

type CardElement = "article" | "div" | "section";
type CardTitleElement = "div" | "h2" | "h3" | "h4" | "p";

export function Card({
  as = "div",
  className,
  children,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLElement> & { as?: CardElement }>) {
  return createElement(as, { className: cn("ui-card", className), ...props }, children);
}

export function CardHeader({ className, children, ...props }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div className={cn("ui-card-header", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({
  as = "h3",
  className,
  children,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLElement> & { as?: CardTitleElement }>) {
  return createElement(as, { className: cn("ui-card-title", className), ...props }, children);
}

export function CardContent({ className, children, ...props }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div className={cn("ui-card-content", className)} {...props}>
      {children}
    </div>
  );
}
