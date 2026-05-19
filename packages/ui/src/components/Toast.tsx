import { ceryxColors, ceryxRadii } from "@ceryx/design-tokens";
import { type CSSProperties, type HTMLAttributes } from "react";

type ToastTone = "info" | "success" | "warning" | "error";

export interface ToastProps extends HTMLAttributes<HTMLDivElement> {
  tone?: ToastTone;
}

const toneStyles: Record<ToastTone, CSSProperties> = {
  info: {
    backgroundColor: ceryxColors.surfaceContainerLow,
    color: ceryxColors.onSurface
  },
  success: {
    backgroundColor: "#d5f5e3",
    color: "#0b4d2a"
  },
  warning: {
    backgroundColor: "#ffe8bf",
    color: "#7a4a00"
  },
  error: {
    backgroundColor: "#ffd9d6",
    color: ceryxColors.error
  }
};

export function Toast({ tone = "info", role, style, ...props }: ToastProps) {
  const resolvedRole = role ?? (tone === "error" ? "alert" : "status");

  return (
    <div
      role={resolvedRole}
      style={{
        borderRadius: ceryxRadii.desktopPanel,
        padding: "10px 12px",
        ...toneStyles[tone],
        ...style
      }}
      {...props}
    />
  );
}
