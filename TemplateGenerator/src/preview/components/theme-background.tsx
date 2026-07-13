"use client";

import { usePreviewStore } from "@/hooks/use-preview-store";
import { getBackgroundTexture } from "@/themes/background-textures";

const NOISE_SVG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

export function ThemeBackground() {
  const backgroundTextureId = usePreviewStore((s) => s.backgroundTextureId);
  const texture = getBackgroundTexture(backgroundTextureId);

  return (
    <>
      <div
        className="absolute inset-0"
        style={{
          background: "var(--t-bg-gradient, var(--t-base))",
        }}
      />

      {texture.image && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url("${texture.image}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      )}

      <div
        className="absolute inset-0 opacity-70"
        style={{
          background: `
            radial-gradient(ellipse 50% 38% at 50% 42%, rgba(var(--t-bloom), 0.1) 0%, transparent 68%),
            radial-gradient(ellipse 35% 28% at 12% 18%, rgba(var(--t-glow-primary), 0.14) 0%, transparent 62%),
            radial-gradient(ellipse 32% 26% at 88% 82%, rgba(var(--t-glow-secondary), 0.12) 0%, transparent 58%)
          `,
        }}
      />

      {texture.layers.map((layer, i) => (
        <div key={i} className="absolute inset-0" style={layer} />
      ))}

      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 92% 80% at 50% 50%, transparent 42%, var(--t-vignette) 100%)`,
        }}
      />

      <div
        className="absolute inset-0 opacity-60"
        style={{
          background: `linear-gradient(180deg, var(--t-glass) 0%, transparent 22%, transparent 78%, rgba(0,0,0,0.06) 100%)`,
        }}
      />

      <div
        className="absolute inset-0 mix-blend-overlay"
        style={{
          opacity: "var(--t-noise-opacity)",
          backgroundImage: NOISE_SVG,
          backgroundSize: "200px 200px",
        }}
      />
    </>
  );
}
