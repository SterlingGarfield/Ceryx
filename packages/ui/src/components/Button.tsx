import { ceryxColors, ceryxRadii, ceryxTouchTargets } from "@ceryx/design-tokens";
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties
} from "react";

type ButtonSize = "desktop" | "ipad";
type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: ButtonSize;
  variant?: ButtonVariant;
}

const variantStyles: Record<ButtonVariant, CSSProperties> = {
  primary: {
    backgroundColor: ceryxColors.primary,
    border: `1px solid ${ceryxColors.primary}`,
    color: ceryxColors.surfaceContainerLowest
  },
  secondary: {
    backgroundColor: ceryxColors.surfaceContainerLow,
    border: `1px solid ${ceryxColors.outlineVariant}`,
    color: ceryxColors.onSurface
  },
  ghost: {
    backgroundColor: "transparent",
    border: `1px solid ${ceryxColors.outlineVariant}`,
    color: ceryxColors.onSurface
  }
};

const sizeStyles: Record<ButtonSize, CSSProperties> = {
  desktop: {
    borderRadius: ceryxRadii.desktopButton,
    minHeight: ceryxTouchTargets.desktop,
    padding: "6px 12px"
  },
  ipad: {
    borderRadius: ceryxRadii.ipadButton,
    minHeight: ceryxTouchTargets.ipad,
    padding: "10px 16px"
  }
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { size = "desktop", variant = "primary", style, disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled}
      style={{
        font: "inherit",
        lineHeight: 1.3,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "opacity 0.15s ease",
        ...sizeStyles[size],
        ...variantStyles[variant],
        ...style
      }}
      {...props}
    />
  );
});
