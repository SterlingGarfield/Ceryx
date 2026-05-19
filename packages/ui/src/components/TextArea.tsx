import { ceryxColors, ceryxRadii } from "@ceryx/design-tokens";
import { useId, type CSSProperties, type TextareaHTMLAttributes } from "react";

export interface TextAreaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  id?: string;
  label: string;
  hint?: string;
  error?: string;
}

export function TextArea({ id, label, hint, error, style, ...props }: TextAreaProps) {
  const generatedId = useId();
  const resolvedId = id ?? generatedId;
  const hintId = hint ? `${resolvedId}-hint` : undefined;
  const errorId = error ? `${resolvedId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label htmlFor={resolvedId} style={{ color: ceryxColors.onSurface, fontWeight: 600 }}>
        {label}
      </label>
      <textarea
        id={resolvedId}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        style={{
          backgroundColor: ceryxColors.surfaceContainerLowest,
          border: `1px solid ${error ? ceryxColors.error : ceryxColors.outlineVariant}`,
          borderRadius: ceryxRadii.desktopPanel,
          color: ceryxColors.onSurface,
          font: "inherit",
          minHeight: 96,
          outline: "none",
          padding: "10px 12px",
          resize: "vertical",
          width: "100%",
          ...style
        } satisfies CSSProperties}
        {...props}
      />
      {hint ? (
        <small id={hintId} style={{ color: ceryxColors.onSurfaceVariant }}>
          {hint}
        </small>
      ) : null}
      {error ? (
        <small id={errorId} style={{ color: ceryxColors.error }}>
          {error}
        </small>
      ) : null}
    </div>
  );
}
