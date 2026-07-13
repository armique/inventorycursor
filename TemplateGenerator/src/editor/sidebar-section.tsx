"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type SidebarSectionProps = {
  id: string;
  active?: boolean;
  children: ReactNode;
  className?: string;
};

export function SidebarSection({
  id,
  active = false,
  children,
  className,
}: SidebarSectionProps) {
  return (
    <section
      id={id}
      data-sidebar-section
      className={cn(
        "rounded-2xl transition-[box-shadow,background-color,border-color] duration-300",
        active &&
          "ring-1 ring-violet-400/35 bg-violet-500/[0.03] shadow-[0_0_0_1px_rgba(139,92,246,0.12)]",
        className
      )}
    >
      {children}
    </section>
  );
}

export function scrollSidebarToSection(sectionId: string) {
  document.getElementById(sectionId)?.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
  });
}
