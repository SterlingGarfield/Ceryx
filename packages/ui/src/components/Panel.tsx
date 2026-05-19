import { ceryxColors, ceryxRadii } from "@ceryx/design-tokens";
import { type CSSProperties, type HTMLAttributes } from "react";

type PanelSize = "desktop" | "ipad";

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  size?: PanelSize;
}

const radiusBySize: Record<PanelSize, number> = {
  desktop: ceryxRadii.desktopPanel,
  ipad: ceryxRadii.ipadPanel
};

export function Panel({ size = "desktop", style, ...props }: PanelProps) {
  return (
    <div
      style={{
        backgroundColor: ceryxColors.surfaceContainerLowest,
        border: `1px solid ${ceryxColors.outlineVariant}`,
        borderRadius: radiusBySize[size],
        color: ceryxColors.onSurface,
        padding: 16,
        ...style
      } satisfies CSSProperties}
      {...props}
    />
  );
}
