import { ceryxColors } from "@ceryx/design-tokens";
import { type CSSProperties, type HTMLAttributes } from "react";

type StatusChipTone = "neutral" | "success" | "warning" | "error";

export interface StatusChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusChipTone;
}

const toneStyles: Record<StatusChipTone, CSSProperties> = {
  neutral: {
    backgroundColor: ceryxColors.surfaceContainer,
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

export function StatusChip({ tone = "neutral", style, ...props }: StatusChipProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        padding: "2px 10px",
        fontSize: 12,
        fontWeight: 600,
        ...toneStyles[tone],
        ...style
      }}
      {...props}
    />
  );
}
