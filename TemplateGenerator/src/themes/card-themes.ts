import type { CSSProperties } from "react";

import { createTheme } from "@/themes/create-theme";
import { EXTRA_THEMES } from "@/themes/extra-themes";

export const BASE_THEMES = [
  createTheme(
    "cyber-gaming",
    "Cyber Gaming",
    "Dark · Purple · Blue Glow",
    "linear-gradient(135deg, #070b14, #8b5cf6 80%)",
    {
      mode: "dark",
      base: "#070b14",
      bgGradient:
        "linear-gradient(145deg, #070b14 0%, #0f1428 40%, #12082a 70%, #070b14 100%)",
      glowPrimary: "139, 92, 246",
      glowSecondary: "59, 130, 246",
      glowTertiary: "6, 182, 212",
      bloom: "139, 92, 246",
      text: "#f8fafc",
      textMuted: "rgba(248, 250, 252, 0.42)",
      accentPrimary: "#8b5cf6",
      accentSecondary: "#3b82f6",
    }
  ),
  createTheme(
    "premium-black",
    "Premium Black",
    "Black · Metallic · Cold Light",
    "linear-gradient(135deg, #050505, #c4cbd6 90%)",
    {
      mode: "dark",
      base: "#050505",
      bgGradient:
        "linear-gradient(160deg, #050505 0%, #0a0a0c 50%, #050505 100%)",
      glowPrimary: "180, 190, 210",
      glowSecondary: "120, 130, 150",
      glowTertiary: "90, 100, 120",
      bloom: "200, 210, 230",
      text: "#f1f3f6",
      textMuted: "rgba(200, 210, 220, 0.5)",
      accentPrimary: "#c4cbd6",
      accentSecondary: "#788696",
    }
  ),
  createTheme(
    "midnight-navy",
    "Midnight Navy",
    "Deep Navy · Silver · Aurora",
    "linear-gradient(135deg, #0a0f1e, #6366f1 75%)",
    {
      mode: "dark",
      base: "#0a0f1e",
      bgGradient:
        "linear-gradient(150deg, #0a0f1e 0%, #121a35 45%, #0d1228 100%)",
      glowPrimary: "99, 102, 241",
      glowSecondary: "56, 189, 248",
      glowTertiary: "129, 140, 248",
      bloom: "99, 102, 241",
      text: "#e8eaf6",
      textMuted: "rgba(200, 210, 240, 0.48)",
      accentPrimary: "#6366f1",
      accentSecondary: "#38bdf8",
    }
  ),
  createTheme(
    "minimal-white",
    "Minimal White",
    "White · Clean · Apple-like",
    "linear-gradient(135deg, #f5f5f7, #d1d5db)",
    {
      mode: "light",
      base: "#f5f5f7",
      bgGradient:
        "linear-gradient(180deg, #fafafa 0%, #f5f5f7 50%, #ebebed 100%)",
      glowPrimary: "0, 0, 0",
      glowSecondary: "100, 110, 130",
      glowTertiary: "60, 70, 90",
      bloom: "255, 255, 255",
      text: "#1d1d1f",
      textMuted: "rgba(29, 29, 31, 0.52)",
      accentPrimary: "#1d1d1f",
      accentSecondary: "#6b7280",
    }
  ),
  createTheme(
    "soft-blue",
    "Soft Blue",
    "Calm · Light · Office PC",
    "linear-gradient(135deg, #eaf1f8, #93c5fd)",
    {
      mode: "light",
      base: "#eaf1f8",
      bgGradient:
        "linear-gradient(160deg, #f0f6fc 0%, #eaf1f8 50%, #dbeafe 100%)",
      glowPrimary: "59, 130, 246",
      glowSecondary: "147, 197, 253",
      glowTertiary: "191, 219, 254",
      bloom: "147, 197, 253",
      text: "#1e3a5f",
      textMuted: "rgba(30, 58, 95, 0.55)",
      accentPrimary: "#3b82f6",
      accentSecondary: "#93c5fd",
    }
  ),
  createTheme(
    "rose-quartz",
    "Rose Quartz",
    "Pastel · Warm · Luxury",
    "linear-gradient(135deg, #faf5f7, #fbcfe8)",
    {
      mode: "light",
      base: "#faf5f7",
      bgGradient:
        "linear-gradient(150deg, #fdf8fa 0%, #faf5f7 50%, #fce7f3 100%)",
      glowPrimary: "244, 114, 182",
      glowSecondary: "251, 207, 232",
      glowTertiary: "216, 180, 254",
      bloom: "251, 207, 232",
      text: "#4a3040",
      textMuted: "rgba(74, 48, 64, 0.52)",
      accentPrimary: "#f472b6",
      accentSecondary: "#fbcfe8",
    }
  ),
] as const;

export const ALL_THEMES = [...BASE_THEMES, ...EXTRA_THEMES] as const;

export type CardThemeId = (typeof ALL_THEMES)[number]["id"];

export type CardThemeTokens = (typeof ALL_THEMES)[number];

export const CARD_THEMES = Object.fromEntries(
  ALL_THEMES.map((theme) => [theme.id, theme])
) as Record<CardThemeId, CardThemeTokens>;

export const THEME_LIST = ALL_THEMES;

export function getCardTheme(id: CardThemeId): CardThemeTokens {
  return CARD_THEMES[id];
}

export function getThemeStyle(id: CardThemeId): CSSProperties {
  return CARD_THEMES[id].vars as CSSProperties;
}
