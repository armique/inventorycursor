import type { CSSProperties } from "react";

export type SpecCardStyleCategory =
  | "bordered"
  | "borderless"
  | "neon"
  | "premium";

export type SpecCardStylePreset = {
  id: string;
  label: string;
  description: string;
  category: SpecCardStyleCategory;
  swatch: string;
  className?: string;
  vars: Record<string, string>;
};

function sc(
  id: string,
  label: string,
  description: string,
  category: SpecCardStyleCategory,
  swatch: string,
  vars: Record<string, string>,
  className?: string
): SpecCardStylePreset {
  return { id, label, description, category, swatch, vars, className };
}

const defaults = {
  "--sc-radius": "12px",
  "--sc-backdrop": "blur(12px)",
  "--sc-value-size": "14px",
  "--sc-desc-size": "10px",
  "--sc-value-weight": "700",
  "--sc-icon-size": "40px",
  "--sc-icon-radius": "12px",
  "--sc-accent": "linear-gradient(90deg, var(--t-spec-accent-l), transparent)",
};

export const SPEC_CARD_STYLES: SpecCardStylePreset[] = [
  sc("glass-outline", "Glass Outline", "Frosted · thin stroke", "bordered",
    "linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))",
    { ...defaults, "--sc-bg": "rgba(255,255,255,0.06)", "--sc-border": "rgba(255,255,255,0.18)", "--sc-border-width": "1px", "--sc-shadow": "0 4px 20px rgba(0,0,0,0.2)", "--sc-icon-bg": "rgba(255,255,255,0.08)", "--sc-icon-border": "rgba(255,255,255,0.15)" }),
  sc("solid-border", "Solid Border", "Clean · defined edge", "bordered",
    "linear-gradient(135deg, rgba(139,92,246,0.25), rgba(59,130,246,0.15))",
    { ...defaults, "--sc-bg": "rgba(0,0,0,0.35)", "--sc-border": "rgba(var(--t-glow-primary),0.35)", "--sc-border-width": "1px", "--sc-shadow": "0 2px 12px rgba(0,0,0,0.25)", "--sc-icon-bg": "rgba(var(--t-glow-primary),0.12)", "--sc-icon-border": "rgba(var(--t-glow-primary),0.25)" }),
  sc("double-ring", "Double Ring", "Twin outline", "bordered",
    "linear-gradient(135deg, #1a1a2e, #8b5cf6)",
    { ...defaults, "--sc-bg": "rgba(0,0,0,0.4)", "--sc-border": "rgba(255,255,255,0.25)", "--sc-border-width": "2px", "--sc-shadow": "0 0 0 1px rgba(var(--t-glow-primary),0.2), 0 4px 16px rgba(0,0,0,0.3)", "--sc-icon-bg": "rgba(var(--t-glow-primary),0.1)", "--sc-icon-border": "rgba(255,255,255,0.2)" }),
  sc("neon-outline", "Neon Outline", "Glowing edge", "neon",
    "linear-gradient(135deg, #0a0014, #ff00aa)",
    { ...defaults, "--sc-bg": "rgba(0,0,0,0.5)", "--sc-border": "rgba(var(--t-glow-primary),0.7)", "--sc-border-width": "1px", "--sc-shadow": "0 0 16px rgba(var(--t-glow-primary),0.35), inset 0 0 12px rgba(var(--t-glow-primary),0.05)", "--sc-icon-bg": "rgba(var(--t-glow-primary),0.15)", "--sc-icon-border": "rgba(var(--t-glow-primary),0.5)" }),
  sc("gradient-frame", "Gradient Frame", "Color border glow", "bordered",
    "linear-gradient(135deg, #6366f1, #ec4899, #f59e0b)",
    { ...defaults, "--sc-bg": "rgba(0,0,0,0.45)", "--sc-border": "rgba(var(--t-glow-primary),0.55)", "--sc-border-width": "1.5px", "--sc-shadow": "0 0 20px rgba(var(--t-glow-secondary),0.2)", "--sc-icon-bg": "linear-gradient(135deg, rgba(var(--t-glow-primary),0.2), rgba(var(--t-glow-secondary),0.1))", "--sc-icon-border": "rgba(var(--t-glow-primary),0.4)" }),
  sc("pill-bordered", "Pill Bordered", "Rounded capsule", "bordered",
    "linear-gradient(90deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))",
    { ...defaults, "--sc-radius": "999px", "--sc-icon-radius": "999px", "--sc-bg": "rgba(255,255,255,0.07)", "--sc-border": "rgba(255,255,255,0.2)", "--sc-border-width": "1px", "--sc-shadow": "0 4px 14px rgba(0,0,0,0.2)", "--sc-icon-bg": "rgba(255,255,255,0.1)", "--sc-icon-border": "rgba(255,255,255,0.18)" }),
  sc("corner-brackets", "Corner Brackets", "HUD corners", "bordered",
    "linear-gradient(135deg, #0d1220, #3b82f6)",
    { ...defaults, "--sc-radius": "4px", "--sc-bg": "rgba(0,0,0,0.55)", "--sc-border": "rgba(var(--t-glow-primary),0.4)", "--sc-border-width": "1px", "--sc-shadow": "none", "--sc-icon-bg": "rgba(var(--t-glow-primary),0.08)", "--sc-icon-border": "rgba(var(--t-glow-primary),0.3)", "--sc-icon-radius": "4px" },
    "spec-card--brackets"),
  sc("thick-stroke", "Thick Stroke", "Bold 2px frame", "bordered",
    "linear-gradient(135deg, #111, #444)",
    { ...defaults, "--sc-bg": "rgba(20,20,20,0.85)", "--sc-border": "rgba(255,255,255,0.35)", "--sc-border-width": "2px", "--sc-shadow": "0 6px 20px rgba(0,0,0,0.35)", "--sc-icon-bg": "rgba(255,255,255,0.06)", "--sc-icon-border": "rgba(255,255,255,0.25)" }),
  sc("dashed-tech", "Dashed Tech", "Blueprint dash", "bordered",
    "repeating-linear-gradient(45deg, #1e293b, #1e293b 4px, #334155 4px, #334155 8px)",
    { ...defaults, "--sc-radius": "8px", "--sc-bg": "rgba(15,23,42,0.7)", "--sc-border": "rgba(148,163,184,0.45)", "--sc-border-width": "1px", "--sc-shadow": "none", "--sc-icon-bg": "rgba(148,163,184,0.1)", "--sc-icon-border": "rgba(148,163,184,0.3)" },
    "spec-card--dashed"),
  sc("inset-glow", "Inset Glow", "Inner light rim", "bordered",
    "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.3))",
    { ...defaults, "--sc-bg": "rgba(0,0,0,0.5)", "--sc-border": "rgba(255,255,255,0.12)", "--sc-border-width": "1px", "--sc-shadow": "inset 0 1px 0 rgba(255,255,255,0.15), 0 4px 16px rgba(0,0,0,0.25)", "--sc-icon-bg": "rgba(255,255,255,0.06)", "--sc-icon-border": "rgba(255,255,255,0.12)" }),
  sc("glass-blur", "Glass Blur", "No border · frosted", "borderless",
    "linear-gradient(135deg, rgba(255,255,255,0.15), rgba(255,255,255,0.03))",
    { ...defaults, "--sc-bg": "rgba(255,255,255,0.08)", "--sc-border": "transparent", "--sc-border-width": "0", "--sc-shadow": "0 8px 32px rgba(0,0,0,0.2)", "--sc-backdrop": "blur(16px)", "--sc-icon-bg": "rgba(255,255,255,0.1)", "--sc-icon-border": "transparent" }),
  sc("solid-flat", "Solid Flat", "Matte panel", "borderless",
    "linear-gradient(135deg, rgba(30,30,40,0.9), rgba(20,20,28,0.95))",
    { ...defaults, "--sc-bg": "rgba(0,0,0,0.55)", "--sc-border": "transparent", "--sc-border-width": "0", "--sc-shadow": "0 2px 8px rgba(0,0,0,0.2)", "--sc-icon-bg": "rgba(var(--t-glow-primary),0.15)", "--sc-icon-border": "transparent" }),
  sc("ghost", "Ghost", "Ultra minimal", "borderless",
    "linear-gradient(135deg, transparent, rgba(255,255,255,0.05))",
    { ...defaults, "--sc-bg": "rgba(255,255,255,0.03)", "--sc-border": "transparent", "--sc-border-width": "0", "--sc-shadow": "none", "--sc-icon-bg": "rgba(255,255,255,0.05)", "--sc-icon-border": "transparent" }),
  sc("soft-shadow", "Soft Shadow", "Floating depth", "borderless",
    "linear-gradient(135deg, #1a1a2e, #16213e)",
    { ...defaults, "--sc-bg": "rgba(0,0,0,0.4)", "--sc-border": "transparent", "--sc-border-width": "0", "--sc-shadow": "0 12px 40px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.2)", "--sc-icon-bg": "rgba(var(--t-glow-primary),0.12)", "--sc-icon-border": "transparent" }),
  sc("gradient-fill", "Gradient Fill", "Color wash", "borderless",
    "linear-gradient(135deg, rgba(var(--t-glow-primary),0.25), rgba(var(--t-glow-secondary),0.15))",
    { ...defaults, "--sc-bg": "linear-gradient(135deg, rgba(var(--t-glow-primary),0.18), rgba(var(--t-glow-secondary),0.08))", "--sc-border": "transparent", "--sc-border-width": "0", "--sc-shadow": "0 4px 20px rgba(var(--t-glow-primary),0.15)", "--sc-icon-bg": "rgba(255,255,255,0.1)", "--sc-icon-border": "transparent" }),
  sc("pill-soft", "Pill Soft", "Soft capsule", "borderless",
    "linear-gradient(90deg, rgba(139,92,246,0.2), rgba(59,130,246,0.1))",
    { ...defaults, "--sc-radius": "999px", "--sc-icon-radius": "999px", "--sc-bg": "rgba(var(--t-glow-primary),0.12)", "--sc-border": "transparent", "--sc-border-width": "0", "--sc-shadow": "0 4px 16px rgba(0,0,0,0.15)", "--sc-icon-bg": "rgba(255,255,255,0.08)", "--sc-icon-border": "transparent" }),
  sc("minimal-chip", "Minimal Chip", "Tiny badge feel", "borderless",
    "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))",
    { ...defaults, "--sc-radius": "8px", "--sc-value-size": "13px", "--sc-bg": "rgba(255,255,255,0.05)", "--sc-border": "transparent", "--sc-border-width": "0", "--sc-shadow": "none", "--sc-icon-size": "36px", "--sc-icon-radius": "8px", "--sc-icon-bg": "rgba(var(--t-glow-primary),0.1)", "--sc-icon-border": "transparent" }),
  sc("frosted-heavy", "Frosted Heavy", "Deep blur glass", "borderless",
    "linear-gradient(135deg, rgba(255,255,255,0.2), rgba(255,255,255,0.05))",
    { ...defaults, "--sc-bg": "rgba(255,255,255,0.12)", "--sc-border": "transparent", "--sc-border-width": "0", "--sc-backdrop": "blur(24px)", "--sc-shadow": "0 8px 32px rgba(0,0,0,0.25)", "--sc-icon-bg": "rgba(255,255,255,0.15)", "--sc-icon-border": "transparent" }),
  sc("carbon-panel", "Carbon Panel", "Textured dark", "borderless",
    "repeating-linear-gradient(0deg, #1a1a1a, #1a1a1a 2px, #222 2px, #222 4px)",
    { ...defaults, "--sc-bg": "rgba(18,18,18,0.9)", "--sc-border": "transparent", "--sc-border-width": "0", "--sc-shadow": "0 4px 12px rgba(0,0,0,0.4)", "--sc-icon-bg": "rgba(255,255,255,0.05)", "--sc-icon-border": "transparent" }),
  sc("neon-glow", "Neon Glow", "Outer aura only", "neon",
    "radial-gradient(circle, rgba(139,92,246,0.4), rgba(0,0,0,0.6))",
    { ...defaults, "--sc-bg": "rgba(0,0,0,0.6)", "--sc-border": "transparent", "--sc-border-width": "0", "--sc-shadow": "0 0 24px rgba(var(--t-glow-primary),0.4), 0 0 48px rgba(var(--t-glow-primary),0.15)", "--sc-icon-bg": "rgba(var(--t-glow-primary),0.2)", "--sc-icon-border": "transparent" }),
  sc("cyber-slash", "Cyber Slash", "Diagonal cut", "premium",
    "linear-gradient(135deg, #0f0f1a 50%, rgba(139,92,246,0.3) 50%)",
    { ...defaults, "--sc-radius": "6px", "--sc-bg": "rgba(0,0,0,0.6)", "--sc-border": "rgba(var(--t-glow-primary),0.3)", "--sc-border-width": "1px", "--sc-shadow": "4px 4px 0 rgba(var(--t-glow-primary),0.2)", "--sc-accent": "linear-gradient(135deg, rgba(var(--t-glow-primary),0.15), transparent 60%)", "--sc-icon-bg": "rgba(var(--t-glow-primary),0.12)", "--sc-icon-border": "rgba(var(--t-glow-primary),0.25)" }),
  sc("hud-tactical", "HUD Tactical", "Military terminal", "premium",
    "linear-gradient(180deg, #0a1a0a, #1a2a1a)",
    { ...defaults, "--sc-radius": "2px", "--sc-icon-radius": "2px", "--sc-bg": "rgba(10,26,10,0.85)", "--sc-border": "rgba(74,222,128,0.35)", "--sc-border-width": "1px", "--sc-shadow": "none", "--sc-value-weight": "600", "--sc-icon-bg": "rgba(74,222,128,0.08)", "--sc-icon-border": "rgba(74,222,128,0.3)" }),
  sc("luxury-gold", "Luxury Gold", "Gold trim frame", "premium",
    "linear-gradient(135deg, #1a1408, #c9a227)",
    { ...defaults, "--sc-bg": "rgba(10,8,0,0.85)", "--sc-border": "rgba(201,162,39,0.55)", "--sc-border-width": "1px", "--sc-shadow": "0 4px 20px rgba(201,162,39,0.15)", "--sc-icon-bg": "rgba(201,162,39,0.12)", "--sc-icon-border": "rgba(201,162,39,0.35)" }),
  sc("apple-card", "Apple Card", "Clean light panel", "premium",
    "linear-gradient(180deg, #ffffff, #f5f5f7)",
    { ...defaults, "--sc-bg": "rgba(255,255,255,0.88)", "--sc-border": "rgba(0,0,0,0.06)", "--sc-border-width": "1px", "--sc-shadow": "0 4px 24px rgba(0,0,0,0.08)", "--sc-backdrop": "blur(8px)", "--sc-icon-bg": "rgba(0,0,0,0.04)", "--sc-icon-border": "rgba(0,0,0,0.06)" }),
  sc("brutalist", "Brutalist", "Sharp · raw", "premium",
    "linear-gradient(135deg, #e8e8e8, #ffffff)",
    { ...defaults, "--sc-radius": "0", "--sc-icon-radius": "0", "--sc-bg": "#f0f0f0", "--sc-border": "#111", "--sc-border-width": "2px", "--sc-shadow": "4px 4px 0 #111", "--sc-value-weight": "800", "--sc-icon-bg": "#111", "--sc-icon-border": "#111" },
    "spec-card--brutalist"),
  sc("underline-accent", "Underline Accent", "Bottom stripe", "borderless",
    "linear-gradient(180deg, rgba(0,0,0,0.4), rgba(var(--t-glow-primary),0.3))",
    { ...defaults, "--sc-bg": "rgba(0,0,0,0.35)", "--sc-border": "transparent", "--sc-border-width": "0", "--sc-shadow": "inset 0 -3px 0 rgba(var(--t-glow-primary),0.7)", "--sc-icon-bg": "rgba(var(--t-glow-primary),0.1)", "--sc-icon-border": "transparent" }),
  sc("left-accent-bar", "Left Accent", "Color sidebar", "borderless",
    "linear-gradient(90deg, rgba(var(--t-glow-primary),0.5), rgba(0,0,0,0.4))",
    { ...defaults, "--sc-bg": "rgba(0,0,0,0.4)", "--sc-border": "transparent", "--sc-border-width": "0", "--sc-shadow": "inset 4px 0 0 rgba(var(--t-glow-primary),0.8)", "--sc-icon-bg": "rgba(var(--t-glow-primary),0.12)", "--sc-icon-border": "transparent" }),
  sc("holographic", "Holographic", "Iridescent sheen", "premium",
    "linear-gradient(135deg, #ff6b9d, #c44dff, #6e8efb, #38f9d7)",
    { ...defaults, "--sc-bg": "linear-gradient(135deg, rgba(255,107,157,0.12), rgba(110,142,251,0.12), rgba(56,249,215,0.08))", "--sc-border": "rgba(255,255,255,0.2)", "--sc-border-width": "1px", "--sc-shadow": "0 4px 24px rgba(196,77,255,0.2)", "--sc-icon-bg": "linear-gradient(135deg, rgba(255,107,157,0.2), rgba(110,142,251,0.2))", "--sc-icon-border": "rgba(255,255,255,0.25)" }),
  sc("outline-minimal", "Outline Minimal", "Hairline only", "bordered",
    "linear-gradient(135deg, transparent, rgba(255,255,255,0.08))",
    { ...defaults, "--sc-bg": "transparent", "--sc-border": "rgba(255,255,255,0.22)", "--sc-border-width": "1px", "--sc-shadow": "none", "--sc-icon-bg": "transparent", "--sc-icon-border": "rgba(255,255,255,0.2)" }),
  sc("elevated-dark", "Elevated Dark", "Raised dark tile", "borderless",
    "linear-gradient(145deg, #2a2a35, #1a1a22)",
    { ...defaults, "--sc-bg": "linear-gradient(145deg, rgba(42,42,53,0.95), rgba(26,26,34,0.98))", "--sc-border": "transparent", "--sc-border-width": "0", "--sc-shadow": "0 1px 0 rgba(255,255,255,0.06) inset, 0 8px 24px rgba(0,0,0,0.45)", "--sc-icon-bg": "rgba(255,255,255,0.06)", "--sc-icon-border": "transparent" }),
];

export type SpecCardStyleId = (typeof SPEC_CARD_STYLES)[number]["id"];

export const SPEC_CARD_STYLE_MAP = Object.fromEntries(
  SPEC_CARD_STYLES.map((s) => [s.id, s])
) as Record<SpecCardStyleId, SpecCardStylePreset>;

export function getSpecCardStyle(id: SpecCardStyleId): SpecCardStylePreset {
  return SPEC_CARD_STYLE_MAP[id] ?? SPEC_CARD_STYLES[0];
}

export function getSpecCardStyleVars(id: SpecCardStyleId): CSSProperties {
  return getSpecCardStyle(id).vars as CSSProperties;
}
