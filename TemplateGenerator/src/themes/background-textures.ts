import type { CSSProperties } from "react";

/**
 * Premium background textures. Each texture is a stack of CSS layers that
 * sit between the base theme gradient and the vignette/noise finish.
 * Colors reference the active theme's CSS vars (--t-glow-*, --t-bloom, etc.)
 * so every texture automatically recolors to match the selected theme.
 */
export type BackgroundTexture = {
  id: string;
  label: string;
  description: string;
  swatch: string;
  /** When set, an AI-generated image is used as the full background surface. */
  image?: string;
  layers: CSSProperties[];
};

function bt(
  id: string,
  label: string,
  description: string,
  swatch: string,
  layers: CSSProperties[]
): BackgroundTexture {
  return { id, label, description, swatch, layers };
}

/** Image-based texture (AI generated, served from /public/textures). */
function img(
  id: string,
  label: string,
  description: string,
  image: string,
  layers: CSSProperties[] = []
): BackgroundTexture {
  return {
    id,
    label,
    description,
    swatch: `url("${image}") center / cover`,
    image,
    layers,
  };
}

export const BACKGROUND_TEXTURES: BackgroundTexture[] = [
  bt(
    "studio",
    "Studio",
    "Clean micro-grid · default",
    "linear-gradient(135deg, #1a1a2e, #16213e)",
    [
      {
        opacity: 0.08,
        backgroundImage: `
          repeating-linear-gradient(0deg, transparent, transparent 2px, var(--t-carbon) 2px, var(--t-carbon) 4px),
          repeating-linear-gradient(90deg, transparent, transparent 2px, var(--t-carbon) 2px, var(--t-carbon) 4px)
        `,
        backgroundSize: "3px 3px",
      },
      {
        opacity: 0.028,
        backgroundImage: `
          linear-gradient(var(--t-grid) 1px, transparent 1px),
          linear-gradient(90deg, var(--t-grid) 1px, transparent 1px)
        `,
        backgroundSize: "48px 48px",
      },
      {
        opacity: 0.018,
        backgroundImage: `repeating-linear-gradient(-45deg, transparent, transparent 20px, var(--t-diagonal) 20px, var(--t-diagonal) 21px)`,
      },
    ]
  ),
  bt(
    "aurora-mesh",
    "Aurora Mesh",
    "Soft multi-color blobs",
    "radial-gradient(circle at 25% 25%, #8b5cf6, transparent 55%), radial-gradient(circle at 80% 30%, #06b6d4, transparent 55%), radial-gradient(circle at 60% 85%, #ec4899, transparent 60%), #0b0f1e",
    [
      {
        opacity: 0.9,
        background: `
          radial-gradient(60% 50% at 18% 22%, rgba(var(--t-glow-primary), 0.28) 0%, transparent 60%),
          radial-gradient(55% 48% at 84% 26%, rgba(var(--t-glow-secondary), 0.24) 0%, transparent 60%),
          radial-gradient(62% 56% at 72% 84%, rgba(var(--t-glow-tertiary), 0.22) 0%, transparent 66%),
          radial-gradient(50% 44% at 30% 78%, rgba(var(--t-bloom), 0.16) 0%, transparent 62%)
        `,
      },
    ]
  ),
  bt(
    "silk-waves",
    "Silk Waves",
    "Flowing conic sheen",
    "conic-gradient(from 210deg, #6366f1, #06b6d4, #a855f7, #6366f1)",
    [
      {
        opacity: 0.55,
        background: `conic-gradient(from 210deg at 40% 45%, rgba(var(--t-glow-primary),0.16), rgba(var(--t-glow-secondary),0.12), rgba(var(--t-glow-tertiary),0.16), rgba(var(--t-bloom),0.12), rgba(var(--t-glow-primary),0.16))`,
      },
      {
        opacity: 0.6,
        background: `radial-gradient(70% 50% at 50% 8%, rgba(255,255,255,0.06) 0%, transparent 60%)`,
        mixBlendMode: "overlay",
      },
    ]
  ),
  bt(
    "carbon-fiber",
    "Carbon Fiber",
    "Woven twill weave",
    "repeating-linear-gradient(45deg, #1a1a1a 0 3px, #2a2a2a 3px 6px)",
    [
      {
        opacity: 0.5,
        backgroundImage: `
          repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0 2px, transparent 2px 4px),
          repeating-linear-gradient(-45deg, rgba(0,0,0,0.28) 0 2px, transparent 2px 4px)
        `,
        backgroundSize: "4px 4px",
      },
      {
        opacity: 0.4,
        background: `radial-gradient(80% 60% at 50% 30%, rgba(var(--t-glow-primary),0.10) 0%, transparent 65%)`,
      },
    ]
  ),
  bt(
    "brushed-metal",
    "Brushed Metal",
    "Fine anisotropic sheen",
    "linear-gradient(105deg, #3a3f47, #6b7280 50%, #3a3f47)",
    [
      {
        opacity: 0.35,
        backgroundImage: `repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 3px)`,
      },
      {
        opacity: 0.5,
        background: `linear-gradient(100deg, transparent 28%, rgba(255,255,255,0.10) 50%, transparent 72%)`,
        mixBlendMode: "overlay",
      },
    ]
  ),
  bt(
    "marble-luxe",
    "Marble Luxe",
    "Veined stone · premium",
    "radial-gradient(circle at 30% 30%, #f5f5f0, #d8d4c8 60%, #b8b2a0)",
    [
      {
        opacity: 0.7,
        background: `
          radial-gradient(40% 30% at 25% 30%, rgba(var(--t-bloom),0.14) 0%, transparent 55%),
          radial-gradient(45% 35% at 75% 70%, rgba(var(--t-glow-secondary),0.12) 0%, transparent 60%)
        `,
      },
      {
        opacity: 0.5,
        backgroundImage: `repeating-radial-gradient(circle at 20% 25%, transparent 0 26px, rgba(var(--t-glow-primary),0.05) 26px 27px, transparent 27px 40px)`,
      },
      {
        opacity: 0.4,
        backgroundImage: `repeating-radial-gradient(circle at 80% 75%, transparent 0 32px, rgba(var(--t-glow-tertiary),0.05) 32px 33px, transparent 33px 48px)`,
      },
    ]
  ),
  bt(
    "spotlight",
    "Spotlight",
    "Studio product light",
    "radial-gradient(ellipse at 50% 0%, #4b5563, #111827 70%)",
    [
      {
        opacity: 0.9,
        background: `radial-gradient(ellipse 62% 46% at 50% -4%, rgba(var(--t-bloom),0.30) 0%, transparent 60%)`,
      },
      {
        opacity: 1,
        background: `radial-gradient(ellipse 95% 80% at 50% 44%, transparent 30%, rgba(0,0,0,0.42) 100%)`,
      },
    ]
  ),
  bt(
    "blueprint",
    "Blueprint",
    "Technical glowing grid",
    "linear-gradient(135deg, #071a2e, #0a2540)",
    [
      {
        opacity: 0.5,
        backgroundImage: `
          linear-gradient(rgba(var(--t-glow-primary),0.12) 1px, transparent 1px),
          linear-gradient(90deg, rgba(var(--t-glow-primary),0.12) 1px, transparent 1px)
        `,
        backgroundSize: "38px 38px",
      },
      {
        opacity: 0.35,
        backgroundImage: `
          linear-gradient(rgba(var(--t-glow-secondary),0.20) 1px, transparent 1px),
          linear-gradient(90deg, rgba(var(--t-glow-secondary),0.20) 1px, transparent 1px)
        `,
        backgroundSize: "190px 190px",
      },
      {
        opacity: 0.6,
        background: `radial-gradient(70% 60% at 50% 42%, rgba(var(--t-glow-primary),0.10) 0%, transparent 68%)`,
      },
    ]
  ),
  bt(
    "dot-matrix",
    "Dot Matrix",
    "Precision dot grid",
    "radial-gradient(#3b82f6 1.4px, transparent 1.5px) 0 0 / 14px 14px, #0b1220",
    [
      {
        opacity: 0.4,
        backgroundImage: `radial-gradient(rgba(var(--t-glow-primary),0.4) 1.1px, transparent 1.3px)`,
        backgroundSize: "22px 22px",
      },
      {
        opacity: 1,
        background: `radial-gradient(ellipse 80% 70% at 50% 45%, transparent 32%, rgba(0,0,0,0.30) 100%)`,
      },
    ]
  ),
  bt(
    "prism-rays",
    "Prism Rays",
    "Diagonal light streaks",
    "linear-gradient(115deg, #1a1030, #3b1a6b 60%, #1a1030)",
    [
      {
        opacity: 0.4,
        backgroundImage: `repeating-linear-gradient(115deg, transparent 0 42px, rgba(var(--t-glow-primary),0.06) 42px 44px)`,
      },
      {
        opacity: 0.7,
        background: `linear-gradient(115deg, transparent 20%, rgba(var(--t-glow-secondary),0.14) 48%, transparent 62%)`,
        mixBlendMode: "screen",
      },
    ]
  ),
  bt(
    "topographic",
    "Topographic",
    "Contour line map",
    "repeating-radial-gradient(circle at 40% 40%, #0f2027 0 12px, #203a43 12px 13px)",
    [
      {
        opacity: 0.4,
        backgroundImage: `repeating-radial-gradient(circle at 32% 34%, transparent 0 18px, rgba(var(--t-glow-secondary),0.10) 18px 19px, transparent 19px 34px)`,
      },
      {
        opacity: 0.35,
        backgroundImage: `repeating-radial-gradient(circle at 78% 72%, transparent 0 22px, rgba(var(--t-glow-primary),0.09) 22px 23px, transparent 23px 42px)`,
      },
    ]
  ),

  // AI-generated photographic textures (served from /public/textures)
  img(
    "ai-black-marble",
    "Black Marble",
    "AI · black stone + gold veins",
    "/textures/tex-black-marble-gold.png"
  ),
  img(
    "ai-carbon-fiber",
    "Carbon Weave",
    "AI · woven carbon fiber",
    "/textures/tex-carbon-fiber.png"
  ),
  img(
    "ai-brushed-metal",
    "Titanium",
    "AI · brushed dark metal",
    "/textures/tex-brushed-metal.png"
  ),
  img(
    "ai-aurora-nebula",
    "Aurora Nebula",
    "AI · violet · cyan · magenta glow",
    "/textures/tex-aurora-nebula.png"
  ),
  img(
    "ai-velvet",
    "Emerald Velvet",
    "AI · plush luxury fabric",
    "/textures/tex-velvet.png"
  ),
  img(
    "ai-concrete",
    "Microcement",
    "AI · matte architectural concrete",
    "/textures/tex-concrete.png"
  ),
  img(
    "ai-soft-silk",
    "Pastel Silk",
    "AI · light airy gradient",
    "/textures/tex-soft-silk-light.png"
  ),
];

export type BackgroundTextureId = (typeof BACKGROUND_TEXTURES)[number]["id"];

export const BACKGROUND_TEXTURE_MAP = Object.fromEntries(
  BACKGROUND_TEXTURES.map((t) => [t.id, t])
) as Record<string, BackgroundTexture>;

export function getBackgroundTexture(id: string): BackgroundTexture {
  return BACKGROUND_TEXTURE_MAP[id] ?? BACKGROUND_TEXTURES[0];
}
