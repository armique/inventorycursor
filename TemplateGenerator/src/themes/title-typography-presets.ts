import type { CSSProperties } from "react";

export type TitleTypographyId =
  | "apple-hero"
  | "stripe-display"
  | "linear-bold"
  | "gaming-poster"
  | "luxury-serif";

export type TitleTypographyPreset = {
  id: TitleTypographyId;
  label: string;
  usedBy: string;
  preview: string;
  title: CSSProperties;
  subtitle: CSSProperties;
};

export const TITLE_TYPOGRAPHY_PRESETS: TitleTypographyPreset[] = [
  {
    id: "apple-hero",
    label: "Apple Hero",
    usedBy: "apple.com",
    preview: "Thin · tight · elegant",
    title: {
      fontFamily: "var(--font-inter)",
      fontWeight: 700,
      letterSpacing: "-0.03em",
      lineHeight: 1.05,
      textTransform: "none",
    },
    subtitle: {
      fontFamily: "var(--font-inter)",
      fontWeight: 500,
      letterSpacing: "-0.01em",
      lineHeight: 1.3,
      opacity: 0.55,
    },
  },
  {
    id: "stripe-display",
    label: "Stripe Display",
    usedBy: "stripe.com",
    preview: "Geometric · confident",
    title: {
      fontFamily: "var(--font-space-grotesk)",
      fontWeight: 700,
      letterSpacing: "-0.04em",
      lineHeight: 1.02,
      textTransform: "none",
    },
    subtitle: {
      fontFamily: "var(--font-space-grotesk)",
      fontWeight: 500,
      letterSpacing: "-0.02em",
      lineHeight: 1.35,
      opacity: 0.6,
    },
  },
  {
    id: "linear-bold",
    label: "Linear Bold",
    usedBy: "linear.app",
    preview: "Sharp · product UI",
    title: {
      fontFamily: "var(--font-plus-jakarta)",
      fontWeight: 800,
      letterSpacing: "-0.035em",
      lineHeight: 1.04,
      textTransform: "none",
    },
    subtitle: {
      fontFamily: "var(--font-plus-jakarta)",
      fontWeight: 500,
      letterSpacing: "-0.01em",
      lineHeight: 1.35,
      opacity: 0.52,
    },
  },
  {
    id: "gaming-poster",
    label: "Gaming Poster",
    usedBy: "ROG · MSI style",
    preview: "Impact · uppercase",
    title: {
      fontFamily: "var(--font-oswald)",
      fontWeight: 700,
      letterSpacing: "0.04em",
      lineHeight: 1.0,
      textTransform: "uppercase",
    },
    subtitle: {
      fontFamily: "var(--font-rajdhani)",
      fontWeight: 600,
      letterSpacing: "0.08em",
      lineHeight: 1.3,
      textTransform: "uppercase",
      opacity: 0.65,
    },
  },
  {
    id: "luxury-serif",
    label: "Luxury Serif",
    usedBy: "Premium brands",
    preview: "Editorial · refined",
    title: {
      fontFamily: "var(--font-playfair)",
      fontWeight: 700,
      letterSpacing: "-0.01em",
      lineHeight: 1.08,
      textTransform: "none",
    },
    subtitle: {
      fontFamily: "var(--font-dm-sans)",
      fontWeight: 500,
      letterSpacing: "0.06em",
      lineHeight: 1.4,
      textTransform: "uppercase",
      opacity: 0.5,
    },
  },
];

export function getTitleTypographyPreset(
  id: TitleTypographyId
): TitleTypographyPreset {
  return (
    TITLE_TYPOGRAPHY_PRESETS.find((p) => p.id === id) ??
    TITLE_TYPOGRAPHY_PRESETS[0]
  );
}

export function getTitleTextStyle(id: TitleTypographyId): CSSProperties {
  return getTitleTypographyPreset(id).title;
}

export function getSubtitleTextStyle(id: TitleTypographyId): CSSProperties {
  return getTitleTypographyPreset(id).subtitle;
}
