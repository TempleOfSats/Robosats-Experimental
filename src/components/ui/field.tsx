import {
  Children,
  cloneElement,
  type ReactElement,
  type ReactNode,
  useId
} from "react";
import { cn } from "@/lib/cn";

type FieldControlProps = {
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  id?: string;
};

export function Field({
  children,
  className,
  error,
  hint,
  label,
  required = false
}: {
  children: ReactElement<FieldControlProps>;
  className?: string;
  error?: ReactNode;
  hint?: ReactNode;
  label: ReactNode;
  required?: boolean;
}) {
  const generatedId = useId();
  const control = Children.only(children);
  const controlId = control.props.id ?? `${generatedId}-control`;
  const hintId = hint ? `${generatedId}-hint` : undefined;
  const errorId = error ? `${generatedId}-error` : undefined;
  const describedBy = [
    control.props["aria-describedby"],
    hintId,
    errorId
  ].filter(Boolean).join(" ") || undefined;

  return (
    <label className={cn("field-block", className)} htmlFor={controlId}>
      <span className="field-label">
        {label}
        {required ? <span className="field-required" aria-hidden="true"> *</span> : null}
      </span>
      {cloneElement(control, {
        "aria-describedby": describedBy,
        "aria-invalid": Boolean(error) || undefined,
        id: controlId
      })}
      {hint ? <small className="field-hint" id={hintId}>{hint}</small> : null}
      {error ? <span className="field-error" id={errorId} role="alert">{error}</span> : null}
    </label>
  );
}
