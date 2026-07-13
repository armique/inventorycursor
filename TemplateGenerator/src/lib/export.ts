/**
 * Canvas export pipeline — html-to-image integration point.
 * Implementation will be added when export functionality is wired.
 */
export type ExportFormat = "png" | "jpeg" | "svg";

export type ExportOptions = {
  format: ExportFormat;
  quality?: number;
  pixelRatio?: number;
};

export async function exportCanvas(
  _element: HTMLElement,
  _options: ExportOptions
): Promise<string> {
  throw new Error("Export pipeline not yet implemented");
}
