import { create } from "zustand";

import {
  buildInitialSpecCards,
  createSpecUid,
  type EditableSpecCard,
} from "@/lib/spec-cards";
import {
  clampProductPosition,
  clampProductRotation,
  clampProductScale,
  hasProductImage,
} from "@/lib/product-image";
import {
  generateAlignedPlacements,
  type SpecPlacement,
} from "@/lib/spec-layout";
import { MOCK_PRODUCT_CARD } from "@/lib/constants";
import { extractSpecCardStylePatch, resolveCardTypographyId } from "@/lib/spec-card-typography";
import { getStylePreset } from "@/themes/style-presets";
import type { TitleColorId, TypographyId, TitleTypographyId, SpecCardStyleId, TitleFontId } from "@/themes";
import type { CardThemeId } from "@/themes/card-themes";

export type SpecLayoutMode = "around" | "left" | "right" | "bottom";

interface PreviewStore {
  activeTheme: CardThemeId;
  activeSpecCardStyle: SpecCardStyleId;
  specLayout: SpecLayoutMode;
  productTitle: string;
  productSubtitle: string;
  typographyId: TypographyId;
  titleTypographyId: TitleTypographyId;
  titleFontId: TitleFontId | null;
  titleColorId: TitleColorId;
  productImageSrc: string | null;
  autoRemoveBackground: boolean;
  isProcessingImage: boolean;
  imageProcessingStep: string | null;
  imageProcessingError: string | null;
  productX: number;
  productY: number;
  imageScaleX: number;
  imageScaleY: number;
  imageRotation: number;
  isProductSelected: boolean;
  iconOnlyCards: boolean;
  activePresetId: string | null;
  specCards: EditableSpecCard[];
  specPlacements: Record<string, SpecPlacement>;
  selectedCardUid: string | null;
  applyStylePreset: (presetId: string) => void;
  setIconOnlyCards: (enabled: boolean) => void;
  setActiveTheme: (theme: CardThemeId) => void;
  setActiveSpecCardStyle: (styleId: SpecCardStyleId) => void;
  setSpecLayout: (layout: SpecLayoutMode) => void;
  alignSpecCards: () => void;
  setSpecPlacement: (uid: string, placement: Partial<SpecPlacement>) => void;
  selectSpecCard: (uid: string | null) => void;
  selectProduct: () => void;
  clearSelection: () => void;
  updateSpecCard: (
    uid: string,
    patch: Partial<Omit<EditableSpecCard, "uid">>
  ) => void;
  resetSpecCardStyles: (uid: string) => void;
  applySpecCardStylesToAll: (sourceUid: string) => void;
  promoteCardTypographyToGlobal: (sourceUid: string) => void;
  deleteSpecCard: (uid: string) => void;
  duplicateSpecCard: (uid: string) => void;
  setProductTitle: (title: string) => void;
  setProductSubtitle: (subtitle: string) => void;
  setTypography: (id: TypographyId) => void;
  setTitleTypography: (id: TitleTypographyId) => void;
  setTitleFont: (id: TitleFontId | null) => void;
  setTitleColor: (colorId: TitleColorId) => void;
  setProductPlacement: (patch: { x?: number; y?: number }) => void;
  setProductImage: (src: string | null) => void;
  setAutoRemoveBackground: (enabled: boolean) => void;
  uploadProductImage: (file: File) => Promise<void>;
  setImageScale: (scaleX: number, scaleY: number) => void;
  setImageRotation: (degrees: number) => void;
  resetProductTransform: () => void;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const initialCards = buildInitialSpecCards();
const initialUids = initialCards.map((c) => c.uid);

export const usePreviewStore = create<PreviewStore>((set, get) => ({
  activeTheme: "cyber-gaming",
  activeSpecCardStyle: "glass-outline",
  specLayout: "around",
  productTitle: MOCK_PRODUCT_CARD.title,
  productSubtitle: MOCK_PRODUCT_CARD.subtitle,
  typographyId: "apple-clean",
  titleTypographyId: "apple-hero",
  titleFontId: null,
  titleColorId: "white",
  productImageSrc: null,
  autoRemoveBackground: true,
  isProcessingImage: false,
  imageProcessingStep: null,
  imageProcessingError: null,
  productX: 50,
  productY: 50,
  imageScaleX: 1,
  imageScaleY: 1,
  imageRotation: 0,
  isProductSelected: false,
  iconOnlyCards: false,
  activePresetId: null,
  specCards: initialCards,
  specPlacements: generateAlignedPlacements("around", initialUids),
  selectedCardUid: null,
  applyStylePreset: (presetId) => {
    const preset = getStylePreset(presetId);
    if (!preset) return;
    const uids = get().specCards.map((c) => c.uid);
    set({
      activePresetId: preset.id,
      activeTheme: preset.theme,
      activeSpecCardStyle: preset.specCardStyle,
      specLayout: preset.layout,
      specPlacements: generateAlignedPlacements(preset.layout, uids),
      typographyId: preset.typographyId,
      titleTypographyId: preset.titleTypographyId,
      titleColorId: preset.titleColorId,
      titleFontId: null,
      iconOnlyCards: preset.iconOnly ?? false,
      selectedCardUid: null,
      isProductSelected: false,
    });
  },
  setIconOnlyCards: (enabled) => set({ iconOnlyCards: enabled }),
  setActiveTheme: (theme) => set({ activeTheme: theme, activePresetId: null }),
  setActiveSpecCardStyle: (styleId) =>
    set({ activeSpecCardStyle: styleId, activePresetId: null }),
  setSpecLayout: (layout) => {
    const uids = get().specCards.map((c) => c.uid);
    set({
      specLayout: layout,
      specPlacements: generateAlignedPlacements(layout, uids),
      selectedCardUid: null,
      activePresetId: null,
    });
  },
  alignSpecCards: () => {
    const uids = get().specCards.map((c) => c.uid);
    set({
      specPlacements: generateAlignedPlacements(get().specLayout, uids),
      selectedCardUid: null,
    });
  },
  setSpecPlacement: (uid, placement) =>
    set((state) => ({
      specPlacements: {
        ...state.specPlacements,
        [uid]: {
          x:
            placement.x !== undefined
              ? clamp(placement.x, 4, 96)
              : (state.specPlacements[uid]?.x ?? 50),
          y:
            placement.y !== undefined
              ? clamp(placement.y, 8, 92)
              : (state.specPlacements[uid]?.y ?? 50),
          scale: 1,
        },
      },
    })),
  selectSpecCard: (uid) =>
    set({
      selectedCardUid: uid,
      isProductSelected: false,
    }),
  selectProduct: () =>
    set({
      isProductSelected: true,
      selectedCardUid: null,
    }),
  clearSelection: () =>
    set({
      isProductSelected: false,
      selectedCardUid: null,
    }),
  updateSpecCard: (uid, patch) =>
    set((state) => ({
      specCards: state.specCards.map((card) =>
        card.uid === uid ? { ...card, ...patch } : card
      ),
    })),
  resetSpecCardStyles: (uid) =>
    set((state) => ({
      specCards: state.specCards.map((card) =>
        card.uid === uid
          ? {
              ...card,
              typographyId: null,
              valueSize: null,
              descSize: null,
              valueColorId: null,
              descColorId: null,
            }
          : card
      ),
    })),
  applySpecCardStylesToAll: (sourceUid) => {
    const state = get();
    const source = state.specCards.find((c) => c.uid === sourceUid);
    if (!source) return;
    const patch = extractSpecCardStylePatch(source);
    set({
      specCards: state.specCards.map((card) => ({ ...card, ...patch })),
    });
  },
  promoteCardTypographyToGlobal: (sourceUid) => {
    const state = get();
    const source = state.specCards.find((c) => c.uid === sourceUid);
    if (!source) return;
    const effectiveId = resolveCardTypographyId(source, state.typographyId);
    set({
      typographyId: effectiveId,
      specCards: state.specCards.map((card) => ({
        ...card,
        typographyId: null,
      })),
    });
  },
  deleteSpecCard: (uid) => {
    const state = get();
    const nextCards = state.specCards.filter((c) => c.uid !== uid);
    const { [uid]: _, ...restPlacements } = state.specPlacements;
    set({
      specCards: nextCards,
      specPlacements: restPlacements,
      selectedCardUid:
        state.selectedCardUid === uid ? null : state.selectedCardUid,
    });
  },
  duplicateSpecCard: (uid) => {
    const state = get();
    const source = state.specCards.find((c) => c.uid === uid);
    const placement = state.specPlacements[uid];
    if (!source || !placement) return;

    const newUid = createSpecUid(source.id);
    const duplicate: EditableSpecCard = {
      ...source,
      uid: newUid,
      value: source.value,
      description: source.description,
    };

    set({
      specCards: [...state.specCards, duplicate],
      specPlacements: {
        ...state.specPlacements,
        [newUid]: {
          x: clamp(placement.x + 4, 4, 96),
          y: clamp(placement.y + 4, 8, 92),
          scale: 1,
        },
      },
      selectedCardUid: newUid,
    });
  },
  setProductTitle: (title) => set({ productTitle: title }),
  setProductSubtitle: (subtitle) => set({ productSubtitle: subtitle }),
  setTypography: (id) => set({ typographyId: id, activePresetId: null }),
  setTitleTypography: (id) =>
    set({ titleTypographyId: id, activePresetId: null }),
  setTitleFont: (id) => set({ titleFontId: id }),
  setTitleColor: (colorId) => set({ titleColorId: colorId, activePresetId: null }),
  setProductPlacement: (patch) =>
    set((state) => ({
      productX:
        patch.x !== undefined
          ? clampProductPosition(patch.x)
          : state.productX,
      productY:
        patch.y !== undefined
          ? clampProductPosition(patch.y)
          : state.productY,
    })),
  setProductImage: (src) => {
    const prev = get().productImageSrc;
    if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
    set({
      productImageSrc: src,
      isProductSelected: hasProductImage(src),
    });
  },
  setAutoRemoveBackground: (enabled) => set({ autoRemoveBackground: enabled }),
  uploadProductImage: async (file) => {
    const { autoRemoveBackground } = get();
    set({
      isProcessingImage: true,
      imageProcessingStep: "Starting…",
      imageProcessingError: null,
      isProductSelected: true,
    });

    try {
      const { processProductImage, blobToObjectUrl } = await import(
        "@/lib/process-product-image"
      );

      const result = await processProductImage(file, {
        removeBackground: autoRemoveBackground,
        onProgress: (step) => set({ imageProcessingStep: step }),
      });

      const prev = get().productImageSrc;
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);

      set({
        productImageSrc: blobToObjectUrl(result.blob),
        imageScaleX: 1,
        imageScaleY: 1,
        isProcessingImage: false,
        imageProcessingStep: null,
        imageProcessingError: result.backgroundRemoved
          ? null
          : "Background was not fully removed — try a plain white/dark backdrop or upload PNG with transparency.",
        isProductSelected: true,
      });
    } catch {
      const prev = get().productImageSrc;
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);

      set({
        productImageSrc: URL.createObjectURL(file),
        imageScaleX: 1,
        imageScaleY: 1,
        isProcessingImage: false,
        imageProcessingStep: null,
        imageProcessingError:
          "Background removal failed — showing the original file. Try a PNG with transparency or a plain white/dark background.",
        isProductSelected: true,
      });
    }
  },
  setImageScale: (scaleX, scaleY) =>
    set({
      imageScaleX: clampProductScale(scaleX),
      imageScaleY: clampProductScale(scaleY),
    }),
  setImageRotation: (degrees) =>
    set({ imageRotation: clampProductRotation(degrees) }),
  resetProductTransform: () =>
    set({
      productX: 50,
      productY: 50,
      imageScaleX: 1,
      imageScaleY: 1,
      imageRotation: 0,
    }),
}));
