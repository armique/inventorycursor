import { createTheme } from "@/themes/create-theme";

export const EXTRA_THEMES = [
  createTheme(
    "neon-synth",
    "Neon Synth",
    "Magenta · Cyan · Retro Wave",
    "linear-gradient(135deg, #12001f 0%, #ff00aa 45%, #00f0ff 100%)",
    {
      mode: "dark",
      base: "#0a0014",
      bgGradient:
        "linear-gradient(145deg, #0a0014 0%, #1a0030 35%, #0d1a3d 70%, #001a2e 100%)",
      glowPrimary: "255, 0, 170",
      glowSecondary: "0, 240, 255",
      glowTertiary: "180, 0, 255",
      bloom: "255, 0, 170",
      text: "#fdf4ff",
      textMuted: "rgba(253, 244, 255, 0.5)",
      accentPrimary: "#ff00aa",
      accentSecondary: "#00f0ff",
    }
  ),
  createTheme(
    "arctic-frost",
    "Arctic Frost",
    "Ice · Silver · Polar Blue",
    "linear-gradient(135deg, #e8f4fc 0%, #b8d4e8 50%, #6ba3c7 100%)",
    {
      mode: "light",
      base: "#e8f4fc",
      bgGradient:
        "linear-gradient(160deg, #f0f8ff 0%, #d4e8f5 40%, #a8cce8 100%)",
      glowPrimary: "59, 130, 246",
      glowSecondary: "147, 197, 253",
      glowTertiary: "191, 219, 254",
      bloom: "191, 219, 254",
      text: "#0c2d48",
      textMuted: "rgba(12, 45, 72, 0.55)",
      accentPrimary: "#3b82f6",
      accentSecondary: "#93c5fd",
    }
  ),
  createTheme(
    "sunset-flame",
    "Sunset Flame",
    "Orange · Red · Warm Glow",
    "linear-gradient(135deg, #1a0500 0%, #ff4500 50%, #ff8c00 100%)",
    {
      mode: "dark",
      base: "#140800",
      bgGradient:
        "linear-gradient(150deg, #140800 0%, #3d1200 40%, #1a0800 80%, #0d0400 100%)",
      glowPrimary: "255, 69, 0",
      glowSecondary: "255, 140, 0",
      glowTertiary: "255, 99, 71",
      bloom: "255, 100, 0",
      text: "#fff5eb",
      textMuted: "rgba(255, 245, 235, 0.52)",
      accentPrimary: "#ff4500",
      accentSecondary: "#ff8c00",
    }
  ),
  createTheme(
    "forest-moss",
    "Forest Moss",
    "Green · Earth · Natural",
    "linear-gradient(135deg, #0a1408 0%, #2d5a27 50%, #4a7c43 100%)",
    {
      mode: "dark",
      base: "#0a1408",
      bgGradient:
        "linear-gradient(145deg, #0a1408 0%, #152a12 45%, #1e3d1a 100%)",
      glowPrimary: "74, 124, 67",
      glowSecondary: "134, 184, 127",
      glowTertiary: "45, 90, 39",
      bloom: "74, 124, 67",
      text: "#e8f5e6",
      textMuted: "rgba(232, 245, 230, 0.5)",
      accentPrimary: "#4a7c43",
      accentSecondary: "#86b87f",
    }
  ),
  createTheme(
    "royal-gold",
    "Royal Gold",
    "Black · Gold · Luxury",
    "linear-gradient(135deg, #0d0a00 0%, #c9a227 50%, #f0d875 100%)",
    {
      mode: "dark",
      base: "#0d0a00",
      bgGradient:
        "linear-gradient(150deg, #0d0a00 0%, #1a1400 35%, #2a2008 70%, #0d0a00 100%)",
      glowPrimary: "201, 162, 39",
      glowSecondary: "240, 216, 117",
      glowTertiary: "180, 140, 30",
      bloom: "201, 162, 39",
      text: "#faf6e8",
      textMuted: "rgba(250, 246, 232, 0.55)",
      accentPrimary: "#c9a227",
      accentSecondary: "#f0d875",
    }
  ),
  createTheme(
    "electric-lime",
    "Electric Lime",
    "Neon Green · Black · Tech",
    "linear-gradient(135deg, #050a00 0%, #39ff14 50%, #00ff88 100%)",
    {
      mode: "dark",
      base: "#050a00",
      bgGradient:
        "linear-gradient(140deg, #050a00 0%, #0a1a05 50%, #001a0a 100%)",
      glowPrimary: "57, 255, 20",
      glowSecondary: "0, 255, 136",
      glowTertiary: "34, 197, 94",
      bloom: "57, 255, 20",
      text: "#f0fff0",
      textMuted: "rgba(240, 255, 240, 0.48)",
      accentPrimary: "#39ff14",
      accentSecondary: "#00ff88",
    }
  ),
  createTheme(
    "blood-crimson",
    "Blood Crimson",
    "Deep Red · Dark · Aggressive",
    "linear-gradient(135deg, #0a0000 0%, #8b0000 50%, #dc143c 100%)",
    {
      mode: "dark",
      base: "#0a0000",
      bgGradient:
        "linear-gradient(150deg, #0a0000 0%, #1a0505 40%, #2a0808 100%)",
      glowPrimary: "220, 20, 60",
      glowSecondary: "139, 0, 0",
      glowTertiary: "255, 69, 0",
      bloom: "220, 20, 60",
      text: "#fff0f0",
      textMuted: "rgba(255, 240, 240, 0.5)",
      accentPrimary: "#dc143c",
      accentSecondary: "#8b0000",
    }
  ),
  createTheme(
    "ocean-depths",
    "Ocean Depths",
    "Teal · Deep Blue · Aqua",
    "linear-gradient(135deg, #001a2e 0%, #006994 50%, #00ced1 100%)",
    {
      mode: "dark",
      base: "#001a2e",
      bgGradient:
        "linear-gradient(160deg, #001a2e 0%, #003d5c 45%, #001f33 100%)",
      glowPrimary: "0, 206, 209",
      glowSecondary: "0, 105, 148",
      glowTertiary: "64, 224, 208",
      bloom: "0, 206, 209",
      text: "#e0f7fa",
      textMuted: "rgba(224, 247, 250, 0.5)",
      accentPrimary: "#00ced1",
      accentSecondary: "#006994",
    }
  ),
  createTheme(
    "lavender-haze",
    "Lavender Haze",
    "Purple · Lilac · Soft",
    "linear-gradient(135deg, #f5f0ff 0%, #c4b5fd 50%, #8b5cf6 100%)",
    {
      mode: "light",
      base: "#f5f0ff",
      bgGradient:
        "linear-gradient(150deg, #faf8ff 0%, #ede9fe 50%, #ddd6fe 100%)",
      glowPrimary: "139, 92, 246",
      glowSecondary: "196, 181, 253",
      glowTertiary: "167, 139, 250",
      bloom: "196, 181, 253",
      text: "#3b1f6e",
      textMuted: "rgba(59, 31, 110, 0.55)",
      accentPrimary: "#8b5cf6",
      accentSecondary: "#c4b5fd",
    }
  ),
  createTheme(
    "copper-forge",
    "Copper Forge",
    "Bronze · Rust · Industrial",
    "linear-gradient(135deg, #1a0f0a 0%, #b87333 50%, #cd7f32 100%)",
    {
      mode: "dark",
      base: "#1a0f0a",
      bgGradient:
        "linear-gradient(145deg, #1a0f0a 0%, #2a1a10 50%, #1a1008 100%)",
      glowPrimary: "184, 115, 51",
      glowSecondary: "205, 127, 50",
      glowTertiary: "160, 90, 40",
      bloom: "184, 115, 51",
      text: "#faf0e6",
      textMuted: "rgba(250, 240, 230, 0.52)",
      accentPrimary: "#b87333",
      accentSecondary: "#cd7f32",
    }
  ),
  createTheme(
    "matrix-green",
    "Matrix Green",
    "Terminal · Code · Hacker",
    "linear-gradient(135deg, #000800 0%, #00ff41 40%, #003b00 100%)",
    {
      mode: "dark",
      base: "#000800",
      bgGradient:
        "linear-gradient(160deg, #000800 0%, #001a05 50%, #000500 100%)",
      glowPrimary: "0, 255, 65",
      glowSecondary: "0, 180, 45",
      glowTertiary: "0, 120, 30",
      bloom: "0, 255, 65",
      text: "#ccffcc",
      textMuted: "rgba(204, 255, 204, 0.45)",
      accentPrimary: "#00ff41",
      accentSecondary: "#00b42d",
    }
  ),
  createTheme(
    "sakura-bloom",
    "Sakura Bloom",
    "Pink · Cherry · Spring",
    "linear-gradient(135deg, #fff5f7 0%, #ffb7c5 50%, #ff69b4 100%)",
    {
      mode: "light",
      base: "#fff5f7",
      bgGradient:
        "linear-gradient(150deg, #fffafb 0%, #ffe4ec 45%, #ffd6e0 100%)",
      glowPrimary: "255, 105, 180",
      glowSecondary: "255, 183, 197",
      glowTertiary: "255, 182, 193",
      bloom: "255, 183, 197",
      text: "#6b2040",
      textMuted: "rgba(107, 32, 64, 0.55)",
      accentPrimary: "#ff69b4",
      accentSecondary: "#ffb7c5",
    }
  ),
  createTheme(
    "void-purple",
    "Void Purple",
    "Deep Void · Ultraviolet",
    "linear-gradient(135deg, #050010 0%, #4c1d95 50%, #7c3aed 100%)",
    {
      mode: "dark",
      base: "#050010",
      bgGradient:
        "linear-gradient(150deg, #050010 0%, #1a0530 40%, #0d0020 100%)",
      glowPrimary: "124, 58, 237",
      glowSecondary: "76, 29, 149",
      glowTertiary: "167, 139, 250",
      bloom: "124, 58, 237",
      text: "#f3e8ff",
      textMuted: "rgba(243, 232, 255, 0.48)",
      accentPrimary: "#7c3aed",
      accentSecondary: "#4c1d95",
    }
  ),
  createTheme(
    "steel-grey",
    "Steel Grey",
    "Graphite · Chrome · Pro",
    "linear-gradient(135deg, #1a1d21 0%, #4a5568 50%, #718096 100%)",
    {
      mode: "dark",
      base: "#1a1d21",
      bgGradient:
        "linear-gradient(145deg, #1a1d21 0%, #2d3748 50%, #1a202c 100%)",
      glowPrimary: "113, 128, 150",
      glowSecondary: "74, 85, 104",
      glowTertiary: "160, 174, 192",
      bloom: "113, 128, 150",
      text: "#e2e8f0",
      textMuted: "rgba(226, 232, 240, 0.5)",
      accentPrimary: "#718096",
      accentSecondary: "#4a5568",
    }
  ),
  createTheme(
    "tropical-punch",
    "Tropical Punch",
    "Coral · Mango · Vibrant",
    "linear-gradient(135deg, #ff6b6b 0%, #feca57 50%, #48dbfb 100%)",
    {
      mode: "light",
      base: "#fff8f0",
      bgGradient:
        "linear-gradient(135deg, #fff8f0 0%, #ffe8d6 35%, #ffd4e5 70%, #e8f4ff 100%)",
      glowPrimary: "255, 107, 107",
      glowSecondary: "254, 202, 87",
      glowTertiary: "72, 219, 251",
      bloom: "254, 202, 87",
      text: "#2d1f1f",
      textMuted: "rgba(45, 31, 31, 0.55)",
      accentPrimary: "#ff6b6b",
      accentSecondary: "#feca57",
    }
  ),
  createTheme(
    "midnight-wine",
    "Midnight Wine",
    "Burgundy · Plum · Velvet",
    "linear-gradient(135deg, #1a0510 0%, #6b1a3a 50%, #9b2d5a 100%)",
    {
      mode: "dark",
      base: "#1a0510",
      bgGradient:
        "linear-gradient(150deg, #1a0510 0%, #2d0a1a 45%, #1a0812 100%)",
      glowPrimary: "155, 45, 90",
      glowSecondary: "107, 26, 58",
      glowTertiary: "190, 80, 120",
      bloom: "155, 45, 90",
      text: "#fce8f0",
      textMuted: "rgba(252, 232, 240, 0.5)",
      accentPrimary: "#9b2d5a",
      accentSecondary: "#6b1a3a",
    }
  ),
  createTheme(
    "ice-crystal",
    "Ice Crystal",
    "Frozen · Diamond · Cool",
    "linear-gradient(135deg, #0c1929 0%, #38bdf8 50%, #e0f2fe 100%)",
    {
      mode: "dark",
      base: "#0c1929",
      bgGradient:
        "linear-gradient(160deg, #0c1929 0%, #0f2847 40%, #0a1f35 100%)",
      glowPrimary: "56, 189, 248",
      glowSecondary: "125, 211, 252",
      glowTertiary: "14, 165, 233",
      bloom: "56, 189, 248",
      text: "#e0f2fe",
      textMuted: "rgba(224, 242, 254, 0.48)",
      accentPrimary: "#38bdf8",
      accentSecondary: "#7dd3fc",
    }
  ),
  createTheme(
    "solar-amber",
    "Solar Amber",
    "Honey · Amber · Radiant",
    "linear-gradient(135deg, #1a1000 0%, #f59e0b 50%, #fbbf24 100%)",
    {
      mode: "dark",
      base: "#1a1000",
      bgGradient:
        "linear-gradient(150deg, #1a1000 0%, #2a1a05 45%, #1a1208 100%)",
      glowPrimary: "245, 158, 11",
      glowSecondary: "251, 191, 36",
      glowTertiary: "217, 119, 6",
      bloom: "245, 158, 11",
      text: "#fffbeb",
      textMuted: "rgba(255, 251, 235, 0.52)",
      accentPrimary: "#f59e0b",
      accentSecondary: "#fbbf24",
    }
  ),
  createTheme(
    "deep-space",
    "Deep Space",
    "Cosmos · Stars · Nebula",
    "linear-gradient(135deg, #030014 0%, #1e1b4b 40%, #4c1d95 70%, #7c3aed 100%)",
    {
      mode: "dark",
      base: "#030014",
      bgGradient:
        "radial-gradient(ellipse 80% 60% at 50% 40%, #1e1b4b 0%, #030014 70%), linear-gradient(180deg, #030014 0%, #0f0a2e 100%)",
      glowPrimary: "99, 102, 241",
      glowSecondary: "124, 58, 237",
      glowTertiary: "167, 139, 250",
      bloom: "99, 102, 241",
      text: "#e8e6ff",
      textMuted: "rgba(232, 230, 255, 0.48)",
      accentPrimary: "#6366f1",
      accentSecondary: "#7c3aed",
    }
  ),
  createTheme(
    "candy-pop",
    "Candy Pop",
    "Pastel · Pop · Playful",
    "linear-gradient(135deg, #fef3c7 0%, #fda4af 50%, #c4b5fd 100%)",
    {
      mode: "light",
      base: "#fef9f3",
      bgGradient:
        "linear-gradient(135deg, #fef9f3 0%, #fce7f3 30%, #e0e7ff 70%, #fef3c7 100%)",
      glowPrimary: "253, 164, 175",
      glowSecondary: "196, 181, 253",
      glowTertiary: "252, 211, 77",
      bloom: "253, 164, 175",
      text: "#4a3040",
      textMuted: "rgba(74, 48, 64, 0.52)",
      accentPrimary: "#fda4af",
      accentSecondary: "#c4b5fd",
    }
  ),
] as const;
