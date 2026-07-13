export type ThemeMode = "dark" | "light";

export type ThemePalette = {
  mode: ThemeMode;
  base: string;
  bgGradient: string;
  glowPrimary: string;
  glowSecondary: string;
  glowTertiary: string;
  bloom: string;
  text: string;
  textMuted: string;
  accentPrimary: string;
  accentSecondary: string;
};

export type CardThemeTokens = {
  id: string;
  label: string;
  description: string;
  swatch: string;
  vars: Record<string, string>;
};

function rgba(rgb: string, alpha: number) {
  return `rgba(${rgb}, ${alpha})`;
}

export function createTheme(
  id: string,
  label: string,
  description: string,
  swatch: string,
  palette: ThemePalette
): CardThemeTokens {
  const dark = palette.mode === "dark";
  const [pR, pG, pB] = palette.glowPrimary.split(",").map((v) => v.trim());
  const [sR, sG, sB] = palette.glowSecondary.split(",").map((v) => v.trim());

  return {
    id,
    label,
    description,
    swatch,
    vars: {
      "--t-base": palette.base,
      "--t-bg-gradient": palette.bgGradient,
      "--t-glow-primary": palette.glowPrimary,
      "--t-glow-secondary": palette.glowSecondary,
      "--t-glow-tertiary": palette.glowTertiary,
      "--t-bloom": palette.bloom,
      "--t-text": palette.text,
      "--t-text-muted": palette.textMuted,
      "--t-text-subtle": dark
        ? rgba(palette.glowPrimary, 0.28)
        : rgba("0, 0, 0", 0.32),
      "--t-spec-bg": dark
        ? "rgba(255, 255, 255, 0.045)"
        : "rgba(255, 255, 255, 0.72)",
      "--t-spec-border": dark
        ? rgba(palette.glowPrimary, 0.14)
        : rgba(palette.glowPrimary, 0.12),
      "--t-spec-accent-l": `rgba(${pR}, ${pG}, ${pB}, ${dark ? 0.1 : 0.06})`,
      "--t-spec-accent-r": `rgba(${sR}, ${sG}, ${sB}, ${dark ? 0.1 : 0.08})`,
      "--t-badge-bg": dark
        ? "rgba(255, 255, 255, 0.035)"
        : "rgba(255, 255, 255, 0.8)",
      "--t-badge-border": dark
        ? rgba(palette.glowPrimary, 0.1)
        : rgba(palette.glowPrimary, 0.12),
      "--t-badge-text": palette.textMuted,
      "--t-badge-icon": dark
        ? rgba(palette.glowPrimary, 0.55)
        : rgba(palette.glowPrimary, 0.5),
      "--t-photo-glow": rgba(palette.glowPrimary, dark ? 0.32 : 0.12),
      "--t-photo-glow-2": rgba(palette.glowSecondary, dark ? 0.16 : 0.2),
      "--t-photo-border": rgba(palette.glowPrimary, dark ? 0.16 : 0.14),
      "--t-photo-shine": dark
        ? "rgba(255, 255, 255, 0.1)"
        : "rgba(255, 255, 255, 0.75)",
      "--t-ring": rgba(palette.glowPrimary, dark ? 0.08 : 0.08),
      "--t-carbon": dark
        ? "rgba(255, 255, 255, 0.028)"
        : rgba(palette.glowPrimary, 0.02),
      "--t-grid": rgba(palette.glowPrimary, dark ? 0.04 : 0.035),
      "--t-diagonal": dark
        ? "rgba(255, 255, 255, 0.025)"
        : rgba(palette.glowPrimary, 0.02),
      "--t-vignette": dark
        ? "rgba(0, 0, 0, 0.58)"
        : rgba("0, 0, 0", 0.06),
      "--t-glass": dark
        ? "rgba(255, 255, 255, 0.035)"
        : "rgba(255, 255, 255, 0.5)",
      "--t-noise-opacity": dark ? "0.36" : "0.14",
      "--t-card-shadow": dark
        ? "0 28px 80px -24px rgba(0,0,0,0.75)"
        : "0 24px 60px -20px rgba(0,0,0,0.12)",
    },
  };
}
