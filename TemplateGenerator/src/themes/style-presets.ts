import type { SpecLayoutMode } from "@/hooks/use-preview-store";
import type { CardThemeId } from "@/themes/card-themes";
import type { SpecCardStyleId } from "@/themes/spec-card-styles";
import type {
  TitleColorId,
  TitleTypographyId,
  TypographyId,
} from "@/themes";

/**
 * A style preset is a one-click bundle that sets the background theme,
 * spec-card style, layout, typography, title style and colors together —
 * reproducing the 10 reference product-card looks.
 */
export type StylePreset = {
  id: string;
  index: string;
  label: string;
  description: string;
  swatch: string;
  theme: CardThemeId;
  specCardStyle: SpecCardStyleId;
  layout: SpecLayoutMode;
  typographyId: TypographyId;
  titleTypographyId: TitleTypographyId;
  titleColorId: TitleColorId;
  iconOnly?: boolean;
  backgroundTexture?: string;
};

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "minimal-white",
    index: "01",
    label: "Minimal White",
    description: "Clean white · Apple-like panels",
    swatch: "linear-gradient(135deg, #f5f5f7, #d1d5db)",
    theme: "minimal-white",
    specCardStyle: "apple-card",
    layout: "around",
    typographyId: "apple-clean",
    titleTypographyId: "apple-hero",
    titleColorId: "theme",
    backgroundTexture: "studio",
  },
  {
    id: "dark-gaming",
    index: "02",
    label: "Dark Gaming",
    description: "Dark · crimson accents · bold",
    swatch: "linear-gradient(135deg, #0a0000, #dc143c 90%)",
    theme: "blood-crimson",
    specCardStyle: "solid-border",
    layout: "around",
    typographyId: "gaming-tech",
    titleTypographyId: "gaming-poster",
    titleColorId: "white",
    backgroundTexture: "prism-rays",
  },
  {
    id: "premium-black",
    index: "03",
    label: "Premium Black",
    description: "Black · gold trim · luxury",
    swatch: "linear-gradient(135deg, #0d0a00, #c9a227 90%)",
    theme: "royal-gold",
    specCardStyle: "luxury-gold",
    layout: "around",
    typographyId: "luxury-soft",
    titleTypographyId: "luxury-serif",
    titleColorId: "gold",
    backgroundTexture: "marble-luxe",
  },
  {
    id: "carbon-style",
    index: "04",
    label: "Carbon Style",
    description: "Graphite carbon · steel blue",
    swatch: "linear-gradient(135deg, #1a1d21, #718096 90%)",
    theme: "steel-grey",
    specCardStyle: "carbon-panel",
    layout: "around",
    typographyId: "linear-sharp",
    titleTypographyId: "linear-bold",
    titleColorId: "white",
    backgroundTexture: "carbon-fiber",
  },
  {
    id: "neon-minimal",
    index: "05",
    label: "Neon Minimal",
    description: "Neon glow edges · synthwave",
    swatch: "linear-gradient(135deg, #12001f, #ff00aa 45%, #00f0ff 100%)",
    theme: "neon-synth",
    specCardStyle: "neon-outline",
    layout: "around",
    typographyId: "gaming-tech",
    titleTypographyId: "gaming-poster",
    titleColorId: "aurora",
    backgroundTexture: "aurora-mesh",
  },
  {
    id: "ultra-simple",
    index: "06",
    label: "Ultra Simple",
    description: "Barely-there chips · big title",
    swatch: "linear-gradient(135deg, #fafafa, #e5e7eb)",
    theme: "minimal-white",
    specCardStyle: "ghost",
    layout: "around",
    typographyId: "apple-clean",
    titleTypographyId: "apple-hero",
    titleColorId: "theme",
    backgroundTexture: "spotlight",
  },
  {
    id: "icon-focus",
    index: "07",
    label: "Icon Focus",
    description: "Icon-forward · soft blue chips",
    swatch: "linear-gradient(135deg, #eaf1f8, #93c5fd)",
    theme: "soft-blue",
    specCardStyle: "minimal-chip",
    layout: "around",
    typographyId: "apple-clean",
    titleTypographyId: "apple-hero",
    titleColorId: "theme",
    backgroundTexture: "dot-matrix",
  },
  {
    id: "futuristic-hud",
    index: "08",
    label: "Futuristic HUD",
    description: "HUD brackets · navy tech",
    swatch: "linear-gradient(135deg, #0a0f1e, #38bdf8 80%)",
    theme: "midnight-navy",
    specCardStyle: "corner-brackets",
    layout: "around",
    typographyId: "gaming-tech",
    titleTypographyId: "gaming-poster",
    titleColorId: "cyan",
    backgroundTexture: "blueprint",
  },
  {
    id: "diagonal-dynamic",
    index: "09",
    label: "Diagonal Dynamic",
    description: "Diagonal cut · dynamic blue",
    swatch: "linear-gradient(135deg, #f0f6fc, #3b82f6 90%)",
    theme: "soft-blue",
    specCardStyle: "cyber-slash",
    layout: "around",
    typographyId: "stripe-pro",
    titleTypographyId: "stripe-display",
    titleColorId: "ocean",
    backgroundTexture: "silk-waves",
  },
  {
    id: "no-text-iconic",
    index: "10",
    label: "No Text Iconic",
    description: "Colorful icon circles · no labels",
    swatch: "linear-gradient(135deg, #030014, #7c3aed 90%)",
    theme: "deep-space",
    specCardStyle: "neon-glow",
    layout: "around",
    typographyId: "gaming-tech",
    titleTypographyId: "gaming-poster",
    titleColorId: "aurora",
    iconOnly: true,
    backgroundTexture: "topographic",
  },
];

export type StylePresetId = (typeof STYLE_PRESETS)[number]["id"];

export const STYLE_PRESET_MAP = Object.fromEntries(
  STYLE_PRESETS.map((p) => [p.id, p])
) as Record<string, StylePreset>;

export function getStylePreset(id: string): StylePreset | undefined {
  return STYLE_PRESET_MAP[id];
}
