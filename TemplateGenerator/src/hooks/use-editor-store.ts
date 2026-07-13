import { create } from "zustand";
import type { EditorPanel } from "@/types";

interface EditorStore {
  activePanel: EditorPanel;
  selectedElementId: string | null;
  zoom: number;
  isPreviewMode: boolean;
  setActivePanel: (panel: EditorPanel) => void;
  setSelectedElementId: (id: string | null) => void;
  setZoom: (zoom: number) => void;
  setPreviewMode: (enabled: boolean) => void;
}

export const useEditorStore = create<EditorStore>((set) => ({
  activePanel: "layers",
  selectedElementId: null,
  zoom: 100,
  isPreviewMode: false,
  setActivePanel: (panel) => set({ activePanel: panel }),
  setSelectedElementId: (id) => set({ selectedElementId: id }),
  setZoom: (zoom) => set({ zoom }),
  setPreviewMode: (enabled) => set({ isPreviewMode: enabled }),
}));
