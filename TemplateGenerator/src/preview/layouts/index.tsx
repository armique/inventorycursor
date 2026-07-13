"use client";

import { GamingHeroLayout } from "./gaming-hero-layout";
import { PlaceholderLayout } from "./placeholder-layout";
import type { LayoutId } from "@/types/template";
import type { ComponentType } from "react";
import type { TemplateLayoutProps } from "@/types/template";

function createPlaceholder(name: string): ComponentType<TemplateLayoutProps> {
  return function Layout(props: TemplateLayoutProps) {
    return <PlaceholderLayout {...props} name={name} />;
  };
}

export const GamingLayout = GamingHeroLayout;

export const MarketplaceLayout = createPlaceholder("Marketplace Layout");
export const MinimalLayout = createPlaceholder("Minimal Layout");
export const PremiumLayout = createPlaceholder("Premium Layout");
export const WhiteLayout = createPlaceholder("White Layout");
export const AppleStyleLayout = createPlaceholder("Apple Style Layout");

export const LAYOUT_COMPONENTS: Record<
  LayoutId,
  ComponentType<TemplateLayoutProps>
> = {
  "gaming-hero": GamingHeroLayout,
  marketplace: MarketplaceLayout,
  minimal: MinimalLayout,
  gaming: GamingLayout,
  premium: PremiumLayout,
  white: WhiteLayout,
  "apple-style": AppleStyleLayout,
};

export function getLayoutComponent(id: LayoutId) {
  return LAYOUT_COMPONENTS[id] ?? GamingHeroLayout;
}

export { GamingHeroLayout, PlaceholderLayout };
