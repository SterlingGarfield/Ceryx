import { ceryxColors, ceryxRadii } from "@ceryx/design-tokens";
import { useId, type ReactNode } from "react";

export interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  anchorLabel?: string;
  open?: boolean;
}

export function Tooltip({ children, content, anchorLabel, open = false }: TooltipProps) {
  const tooltipId = useId();

  return (
    <span
      style={{
        display: "inline-flex",
        position: "relative"
      }}
    >
      <span aria-describedby={tooltipId} aria-label={anchorLabel}>
        {children}
      </span>
      <span
        id={tooltipId}
        role="tooltip"
        aria-hidden={!open}
        style={{
          display: open ? "inline-block" : "none",
          backgroundColor: ceryxColors.codeBg,
          borderRadius: ceryxRadii.desktopButton,
          color: ceryxColors.surfaceContainerLowest,
          fontSize: 12,
          left: "50%",
          maxWidth: 280,
          pointerEvents: "none",
          padding: "6px 8px",
          position: "absolute",
          top: "calc(100% + 6px)",
          transform: "translateX(-50%)",
          whiteSpace: "nowrap",
          zIndex: 1000
        }}
      >
        {content}
      </span>
    </span>
  );
}
