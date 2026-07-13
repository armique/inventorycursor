export type AspectRatioId = "1:1" | "4:5" | "16:9";

export type LayoutId =
  | "gaming-hero"
  | "marketplace"
  | "minimal"
  | "gaming"
  | "premium"
  | "white"
  | "apple-style";

export type SpecIconType =
  | "cpu"
  | "ram"
  | "memory"
  | "socket"
  | "plug"
  | "chipset"
  | "circuit"
  | "pcie"
  | "zap"
  | "storage"
  | "nvme"
  | "hard-drive"
  | "wifi"
  | "usb";

export type SpecCardData = {
  id: string;
  value: string;
  description: string;
  icon?: SpecIconType;
};

export type TechBadgeData = {
  id: string;
  label: string;
  icon: string;
};

export type ProductCardData = {
  title: string;
  subtitle: string;
  specCardsLeft: SpecCardData[];
  specCardsRight: SpecCardData[];
  badges: TechBadgeData[];
};

export type TemplateLayoutProps = {
  data: ProductCardData;
};
