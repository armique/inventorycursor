import type { CSSProperties } from "react";

export type TypographyId =
  | "apple-clean"
  | "stripe-pro"
  | "linear-sharp"
  | "gaming-tech"
  | "luxury-soft";

export type TypographyPreset = {
  id: TypographyId;
  label: string;
  usedBy: string;
  family: string;
  sample: string;
  vars: Record<string, string>;
};

export const TYPOGRAPHY_PRESETS: TypographyPreset[] = [
  {
    id: "apple-clean",
    label: "Apple Clean",
    usedBy: "Apple · SF style",
    family: "var(--font-inter)",
    sample: "Aa",
    vars: {
      "--t-font-family": "var(--font-inter)",
      "--t-font-weight": "500",
      "--t-letter-spacing": "-0.01em",
    },
  },
  {
    id: "stripe-pro",
    label: "Stripe Pro",
    usedBy: "Stripe · Fintech",
    family: "var(--font-space-grotesk)",
    sample: "Aa",
    vars: {
      "--t-font-family": "var(--font-space-grotesk)",
      "--t-font-weight": "500",
      "--t-letter-spacing": "-0.02em",
    },
  },
  {
    id: "linear-sharp",
    label: "Linear Sharp",
    usedBy: "Linear · SaaS",
    family: "var(--font-plus-jakarta)",
    sample: "Aa",
    vars: {
      "--t-font-family": "var(--font-plus-jakarta)",
      "--t-font-weight": "600",
      "--t-letter-spacing": "-0.015em",
    },
  },
  {
    id: "gaming-tech",
    label: "Gaming Tech",
    usedBy: "ASUS · ROG",
    family: "var(--font-rajdhani)",
    sample: "Aa",
    vars: {
      "--t-font-family": "var(--font-rajdhani)",
      "--t-font-weight": "600",
      "--t-letter-spacing": "0.02em",
    },
  },
  {
    id: "luxury-soft",
    label: "Luxury Soft",
    usedBy: "Premium retail",
    family: "var(--font-dm-sans)",
    sample: "Aa",
    vars: {
      "--t-font-family": "var(--font-dm-sans)",
      "--t-font-weight": "500",
      "--t-letter-spacing": "0",
    },
  },
];

export function getTypographyPreset(id: TypographyId): TypographyPreset {
  return TYPOGRAPHY_PRESETS.find((p) => p.id === id) ?? TYPOGRAPHY_PRESETS[0];
}

export function getTypographyStyle(id: TypographyId): CSSProperties {
  const preset = getTypographyPreset(id);
  return {
    fontFamily: preset.family,
    ...(preset.vars as CSSProperties),
  };
}

export function getTypographyFamily(id: TypographyId): string {
  return getTypographyPreset(id).family;
}
