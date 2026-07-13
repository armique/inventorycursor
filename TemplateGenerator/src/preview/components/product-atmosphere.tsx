const PARTICLES = [
  { top: "28%", left: "22%", size: 2, opacity: 0.25 },
  { top: "35%", left: "78%", size: 1.5, opacity: 0.2 },
  { top: "48%", left: "18%", size: 1, opacity: 0.15 },
  { top: "52%", left: "84%", size: 2, opacity: 0.22 },
  { top: "62%", left: "30%", size: 1.5, opacity: 0.18 },
  { top: "58%", left: "70%", size: 1, opacity: 0.14 },
  { top: "40%", left: "50%", size: 1, opacity: 0.12 },
  { top: "70%", left: "55%", size: 1.5, opacity: 0.16 },
] as const;

export function ProductAtmosphere() {
  return (
    <div className="pointer-events-none absolute inset-0 z-[2] overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 55% 40% at 50% 44%, rgba(var(--t-glow-primary), 0.06) 0%, transparent 70%)`,
        }}
      />

      <div
        className="absolute left-0 right-0 top-[30%] h-[45%] opacity-[0.35]"
        style={{
          background: `linear-gradient(180deg, transparent, rgba(var(--t-glow-secondary), 0.04) 50%, transparent)`,
          filter: "blur(24px)",
        }}
      />

      {PARTICLES.map((p, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            top: p.top,
            left: p.left,
            width: p.size,
            height: p.size,
            opacity: p.opacity,
            background: "rgba(255, 255, 255, 0.8)",
            boxShadow: `0 0 ${p.size * 3}px rgba(var(--t-glow-primary), 0.3)`,
          }}
        />
      ))}

      <div
        className="absolute left-[12%] top-[38%] h-px w-[22%] opacity-[0.12]"
        style={{
          background: `linear-gradient(90deg, transparent, rgba(var(--t-glow-primary), 0.6), transparent)`,
          transform: "rotate(-8deg)",
        }}
      />
      <div
        className="absolute right-[10%] top-[50%] h-px w-[20%] opacity-[0.1]"
        style={{
          background: `linear-gradient(90deg, transparent, rgba(var(--t-glow-secondary), 0.5), transparent)`,
          transform: "rotate(6deg)",
        }}
      />
      <div
        className="absolute left-[40%] top-[72%] h-px w-[24%] opacity-[0.08]"
        style={{
          background: `linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)`,
        }}
      />
    </div>
  );
}
