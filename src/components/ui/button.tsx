import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "outline";
type ButtonSize = "sm" | "md" | "lg" | "icon";

type ButtonProps = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
  }
>;

const variantClass: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary shadow-primary",
  secondary: "bg-muted text-foreground",
  ghost: "bg-transparent text-muted",
  destructive: "bg-destructive text-foreground",
  outline: "bg-transparent text-foreground border"
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-base",
  icon: "h-10 w-10 p-0"
};

export function Button({
  children,
  className,
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn("ui-button", variantClass[variant], sizeClass[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <span className="ui-spinner" aria-hidden /> : null}
      {children}
    </button>
  );
}
