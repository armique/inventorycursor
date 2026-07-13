export type {
  AspectRatioId,
  LayoutId,
  ProductCardData,
  SpecCardData,
  TechBadgeData,
  TemplateLayoutProps,
} from "./template";

export type TemplateDimensions = {
  width: number;
  height: number;
};

export type TemplateTheme = {
  id: string;
  name: string;
  description?: string;
};

export type EditorPanel = "layers" | "properties" | "assets" | "themes";

export type TemplateProject = {
  id: string;
  name: string;
  dimensions: TemplateDimensions;
  themeId: string;
  createdAt: string;
  updatedAt: string;
};

export type EditorState = {
  activePanel: EditorPanel;
  selectedElementId: string | null;
  zoom: number;
  isPreviewMode: boolean;
};
