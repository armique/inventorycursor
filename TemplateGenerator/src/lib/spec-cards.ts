import type { SpecCardData } from "@/types/template";
import type { TitleColorId, TypographyId } from "@/themes";
import type { SpecTextSizeId } from "@/lib/spec-card-typography";

export type EditableSpecCard = SpecCardData & {
  uid: string;
  typographyId?: TypographyId | null;
  valueSize?: SpecTextSizeId | null;
  descSize?: SpecTextSizeId | null;
  valueColorId?: TitleColorId | null;
  descColorId?: TitleColorId | null;
};

export const SPEC_CARD_SIZE = {
  width: 128,
  height: 104,
} as const;

export function buildInitialSpecCards(): EditableSpecCard[] {
  const left = [
    { id: "cpu", value: "i7-12700K", description: "12C • 20T", icon: "cpu" as const },
    { id: "ram", value: "32GB", description: "DDR5 Memory", icon: "ram" as const },
    { id: "socket", value: "LGA1700", description: "Alder Lake", icon: "socket" as const },
  ];
  const right = [
    { id: "chipset", value: "Z790", description: "ROG Chipset", icon: "chipset" as const },
    { id: "pcie", value: "PCIe 5", description: "Latest Generation", icon: "pcie" as const },
    { id: "storage", value: "NVMe", description: "Gen4 x4", icon: "storage" as const },
  ];
  return [...left, ...right].map((card) => ({
    ...card,
    uid: card.id,
  }));
}

export function createSpecUid(baseId: string) {
  return `${baseId}-${Date.now().toString(36)}`;
}
