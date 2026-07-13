import type { SpecLayoutMode } from "@/hooks/use-preview-store";
import { placementsToHudLines } from "@/lib/spec-layout";
import type { SpecPlacement } from "@/lib/spec-layout";

type HudConnectorsProps = {
  layout: SpecLayoutMode;
  placements: Record<string, SpecPlacement>;
  cardIds: string[];
  productCenter?: { x: number; y: number };
};

export function HudConnectors({
  layout,
  placements,
  cardIds,
  productCenter = { x: 50, y: 50 },
}: HudConnectorsProps) {
  if (layout === "bottom") return null;

  const lines = placementsToHudLines(placements, cardIds, productCenter);

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[4] h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="hud-line" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(var(--t-glow-primary), 0.35)" />
          <stop offset="100%" stopColor="rgba(var(--t-glow-secondary), 0.15)" />
        </linearGradient>
      </defs>

      {lines.map((line, i) => (
        <g key={i}>
          <line
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke="url(#hud-line)"
            strokeWidth="0.06"
            strokeOpacity="0.4"
          />
          <circle
            cx={line.x2}
            cy={line.y2}
            r="0.3"
            fill="rgba(var(--t-glow-primary), 0.3)"
          />
          <circle
            cx={line.x1}
            cy={line.y1}
            r="0.22"
            fill="rgba(var(--t-glow-secondary), 0.22)"
          />
        </g>
      ))}
    </svg>
  );
}
