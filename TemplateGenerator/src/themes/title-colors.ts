import type { CSSProperties } from "react";

export type TitleColorId =
  | "white"
  | "gold"
  | "cyan"
  | "violet"
  | "sunset"
  | "rose"
  | "ice"
  | "lime"
  | "theme"
  | "aurora"
  | "fire"
  | "ocean";

export type TitleColorPreset = {
  id: TitleColorId;
  label: string;
  swatch: string;
  gradient?: boolean;
};

export const TITLE_COLORS: TitleColorPreset[] = [
  { id: "white", label: "White", swatch: "#f8fafc" },
  { id: "gold", label: "Gold", swatch: "linear-gradient(135deg, #f0d875, #c9a227)" },
  { id: "cyan", label: "Cyan", swatch: "#22d3ee" },
  { id: "violet", label: "Violet", swatch: "#a78bfa" },
  { id: "sunset", label: "Sunset", swatch: "#fb923c" },
  { id: "rose", label: "Rose", swatch: "#fb7185" },
  { id: "ice", label: "Ice", swatch: "#7dd3fc" },
  { id: "lime", label: "Lime", swatch: "#a3e635" },
  { id: "theme", label: "Theme", swatch: "linear-gradient(135deg, rgb(var(--t-glow-primary)), rgb(var(--t-glow-secondary)))", gradient: true },
  { id: "aurora", label: "Aurora", swatch: "linear-gradient(135deg, #8b5cf6, #06b6d4, #ec4899)", gradient: true },
  { id: "fire", label: "Fire", swatch: "linear-gradient(135deg, #fbbf24, #f97316, #ef4444)", gradient: true },
  { id: "ocean", label: "Ocean", swatch: "linear-gradient(135deg, #06b6d4, #3b82f6, #6366f1)", gradient: true },
];

export function getTitleColorStyle(id: TitleColorId): CSSProperties {
  switch (id) {
    case "white":
      return { color: "#f8fafc" };
    case "gold":
      return {
        color: "transparent",
        backgroundImage: "linear-gradient(135deg, #f0d875 0%, #c9a227 100%)",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
      };
    case "cyan":
      return { color: "#22d3ee" };
    case "violet":
      return { color: "#a78bfa" };
    case "sunset":
      return { color: "#fb923c" };
    case "rose":
      return { color: "#fb7185" };
    case "ice":
      return { color: "#7dd3fc" };
    case "lime":
      return { color: "#a3e635" };
    case "theme":
      return {
        color: "transparent",
        backgroundImage:
          "linear-gradient(135deg, rgb(var(--t-glow-primary)) 0%, rgb(var(--t-glow-secondary)) 100%)",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
      };
    case "aurora":
      return {
        color: "transparent",
        backgroundImage:
          "linear-gradient(135deg, #8b5cf6 0%, #06b6d4 50%, #ec4899 100%)",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
      };
    case "fire":
      return {
        color: "transparent",
        backgroundImage:
          "linear-gradient(135deg, #fbbf24 0%, #f97316 50%, #ef4444 100%)",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
      };
    case "ocean":
      return {
        color: "transparent",
        backgroundImage:
          "linear-gradient(135deg, #06b6d4 0%, #3b82f6 50%, #6366f1 100%)",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
      };
    default:
      return { color: "#f8fafc" };
  }
}

export function getSubtitleColorStyle(id: TitleColorId): CSSProperties {
  const base = getTitleColorStyle(id);
  if (base.backgroundImage) {
    return { color: "var(--t-text-muted)" };
  }
  return {
    color: base.color,
    opacity: 0.55,
  };
}
