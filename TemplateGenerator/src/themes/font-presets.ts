import type { CSSProperties } from "react";

export type TitleFontPreset = {
  id: string;
  label: string;
  family: string;
  sample: string;
  usedBy?: string;
};

export const TITLE_FONTS: TitleFontPreset[] = [
  { id: "geist", label: "Geist", family: "var(--font-geist-sans)", sample: "Aa", usedBy: "Vercel" },
  { id: "inter", label: "Inter", family: "var(--font-inter)", sample: "Aa", usedBy: "GitHub · Figma" },
  { id: "plus-jakarta", label: "Plus Jakarta", family: "var(--font-plus-jakarta)", sample: "Aa", usedBy: "Linear" },
  { id: "space-grotesk", label: "Space Grotesk", family: "var(--font-space-grotesk)", sample: "Aa", usedBy: "Stripe" },
  { id: "sora", label: "Sora", family: "var(--font-sora)", sample: "Aa", usedBy: "Uniswap" },
  { id: "figtree", label: "Figtree", family: "var(--font-figtree)", sample: "Aa", usedBy: "Notion-style" },
  { id: "instrument-sans", label: "Instrument Sans", family: "var(--font-instrument-sans)", sample: "Aa", usedBy: "Apple-like UI" },
  { id: "dm-sans", label: "DM Sans", family: "var(--font-dm-sans)", sample: "Aa", usedBy: "Figma UI" },
  { id: "manrope", label: "Manrope", family: "var(--font-manrope)", sample: "Aa", usedBy: "Crypto / Web3" },
  { id: "outfit", label: "Outfit", family: "var(--font-outfit)", sample: "Aa", usedBy: "Modern SaaS" },
  { id: "albert-sans", label: "Albert Sans", family: "var(--font-albert-sans)", sample: "Aa", usedBy: "Editorial SaaS" },
  { id: "poppins", label: "Poppins", family: "var(--font-poppins)", sample: "Aa", usedBy: "Spotify-style" },
  { id: "montserrat", label: "Montserrat", family: "var(--font-montserrat)", sample: "Aa", usedBy: "Premium retail" },
  { id: "work-sans", label: "Work Sans", family: "var(--font-work-sans)", sample: "Aa", usedBy: "Google Fonts classic" },
  { id: "ibm-plex", label: "IBM Plex", family: "var(--font-ibm-plex)", sample: "Aa", usedBy: "IBM · Enterprise" },
  { id: "lexend", label: "Lexend", family: "var(--font-lexend)", sample: "Aa", usedBy: "Readable UI" },
  { id: "urbanist", label: "Urbanist", family: "var(--font-urbanist)", sample: "Aa", usedBy: "Minimal apps" },
  { id: "rubik", label: "Rubik", family: "var(--font-rubik)", sample: "Aa", usedBy: "Friendly tech" },
  { id: "nunito-sans", label: "Nunito Sans", family: "var(--font-nunito-sans)", sample: "Aa", usedBy: "Soft product UI" },
  { id: "jost", label: "Jost", family: "var(--font-jost)", sample: "Aa", usedBy: "Fashion · Design" },
  { id: "archivo", label: "Archivo", family: "var(--font-archivo)", sample: "Aa", usedBy: "News · Editorial" },
  { id: "barlow", label: "Barlow", family: "var(--font-barlow)", sample: "Aa", usedBy: "Gaming retail" },
  { id: "raleway", label: "Raleway", family: "var(--font-raleway)", sample: "Aa", usedBy: "Luxury brands" },
  { id: "lato", label: "Lato", family: "var(--font-lato)", sample: "Aa", usedBy: "Airbnb-era web" },
  { id: "roboto", label: "Roboto", family: "var(--font-roboto)", sample: "Aa", usedBy: "Google · Android" },
  { id: "syne", label: "Syne", family: "var(--font-syne)", sample: "Aa", usedBy: "Creative studios" },
  { id: "bebas", label: "Bebas Neue", family: "var(--font-bebas-neue)", sample: "Aa", usedBy: "Posters · Hero" },
  { id: "oswald", label: "Oswald", family: "var(--font-oswald)", sample: "Aa", usedBy: "Sports · Bold" },
  { id: "rajdhani", label: "Rajdhani", family: "var(--font-rajdhani)", sample: "Aa", usedBy: "Sci-fi · Gaming" },
  { id: "orbitron", label: "Orbitron", family: "var(--font-orbitron)", sample: "Aa", usedBy: "Cyber · HUD" },
  { id: "exo-2", label: "Exo 2", family: "var(--font-exo-2)", sample: "Aa", usedBy: "Tech · Futuristic" },
  { id: "playfair", label: "Playfair", family: "var(--font-playfair)", sample: "Aa", usedBy: "Luxury serif" },
];

export type TitleFontId = (typeof TITLE_FONTS)[number]["id"];

export function getTitleFontFamily(id: TitleFontId): string {
  return TITLE_FONTS.find((f) => f.id === id)?.family ?? "var(--font-geist-sans)";
}

export function getTitleFontStyle(id: TitleFontId): CSSProperties {
  return { fontFamily: getTitleFontFamily(id) };
}

export function getTitleFontPreset(id: TitleFontId): TitleFontPreset {
  return TITLE_FONTS.find((f) => f.id === id) ?? TITLE_FONTS[0];
}
