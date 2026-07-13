"use client";

import type { TemplateLayoutProps } from "@/types/template";

type PlaceholderLayoutProps = TemplateLayoutProps & {
  name: string;
};

export function PlaceholderLayout({ name }: PlaceholderLayoutProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-2xl bg-[#0a0e18] ring-1 ring-white/[0.08]">
      <div className="text-center">
        <p className="text-sm font-semibold text-white/60">{name}</p>
        <p className="mt-1 text-xs text-white/30">Coming soon</p>
      </div>
    </div>
  );
}
