import type { ProductCardData } from "@/types/template";

export const APP_NAME = "TemplateGenerator";
export const APP_DESCRIPTION =
  "Premium template editor for product cards and visual assets";

export const LAYOUT = {
  sidebarWidth: 420,
} as const;

export const ASPECT_RATIOS = {
  "1:1": { width: 1600, height: 1600, label: "Square" },
  "4:5": { width: 1600, height: 2000, label: "Portrait" },
  "16:9": { width: 1600, height: 900, label: "Landscape" },
} as const;

export const PREVIEW_CANVAS = ASPECT_RATIOS["1:1"];

export const MOCK_PROJECT = {
  name: "Z790 Gaming Bundle",
  theme: "cyber-gaming" as const,
  layout: "gaming-hero" as const,
  aspectRatio: "1:1" as const,
} as const;

export const MOCK_PRODUCT_CARD: ProductCardData = {
  title: "ASUS ROG STRIX Z790-E",
  subtitle: "Intel Core i7-12700K Bundle",
  specCardsLeft: [
    { id: "cpu", value: "i7-12700K", description: "12C • 20T" },
    { id: "ram", value: "32GB", description: "DDR5 Memory" },
    { id: "socket", value: "LGA1700", description: "Alder Lake" },
  ],
  specCardsRight: [
    { id: "chipset", value: "Z790", description: "ROG Chipset" },
    { id: "pcie", value: "PCIe 5", description: "Latest Generation" },
    { id: "storage", value: "NVMe", description: "Gen4 x4" },
  ],
  badges: [
    { id: "cpu", label: "i7-12700K", icon: "cpu" },
    { id: "ddr5", label: "DDR5", icon: "memory" },
    { id: "socket", label: "LGA1700", icon: "plug" },
    { id: "chipset", label: "Z790", icon: "circuit" },
    { id: "pcie", label: "PCIe 5", icon: "zap" },
    { id: "nvme", label: "NVMe", icon: "hard-drive" },
    { id: "wifi", label: "WiFi 6", icon: "wifi" },
    { id: "usbc", label: "USB-C", icon: "usb" },
  ],
};

export const MOCK_MAIN_SPECS = `Intel Core i7-12700K
32GB DDR5-6000
LGA1700 Socket`;

export const MOCK_ADDITIONAL_SPECS = `ASUS ROG STRIX Z790-E
PCIe 5.0 x16
NVMe Gen4 x4`;

export const THEME_OPTIONS = [
  { id: "cyber-gaming", label: "Cyber Gaming", accent: "#8B5CF6" },
  { id: "premium-black", label: "Premium Black", accent: "#C4CBD6" },
  { id: "midnight-navy", label: "Midnight Navy", accent: "#6366F1" },
  { id: "minimal-white", label: "Minimal White", accent: "#1D1D1F" },
  { id: "soft-blue", label: "Soft Blue", accent: "#3B82F6" },
  { id: "rose-quartz", label: "Rose Quartz", accent: "#F472B6" },
] as const;

export const LAYOUT_OPTIONS = [
  { id: "gaming-hero", label: "Hero Layout", status: "active" },
  { id: "marketplace", label: "Marketplace", status: "soon" },
  { id: "minimal", label: "Minimal", status: "soon" },
  { id: "gaming", label: "Gaming", status: "soon" },
  { id: "premium", label: "Premium", status: "soon" },
  { id: "white", label: "White", status: "soon" },
  { id: "apple-style", label: "Apple Style", status: "soon" },
] as const;
