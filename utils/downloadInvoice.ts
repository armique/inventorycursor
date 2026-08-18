/**
 * Save a Rechnung from the on-screen invoice sheet to this PC (Save As / Downloads).
 */

export function invoiceFileStem(invoiceNumber: string): string {
  const safe = String(invoiceNumber || 'Rechnung')
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `Rechnung-${safe || 'download'}`;
}

/** Scale a captured invoice image so it always occupies a single A4 page. */
export function fitInvoiceImageOnA4(
  canvasWidth: number,
  canvasHeight: number,
  pageWidth: number,
  pageHeight: number
): { width: number; height: number } {
  const imgWidth = pageWidth;
  const imgHeight = (canvasHeight * pageWidth) / canvasWidth;
  if (imgHeight <= pageHeight) return { width: imgWidth, height: imgHeight };
  const scale = pageHeight / imgHeight;
  return { width: imgWidth * scale, height: pageHeight };
}

function triggerAnchorDownload(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2500);
  }
}

async function saveBlobToComputer(blob: Blob, fileName: string, mime: string): Promise<void> {
  const w = window as Window & {
    showSaveFilePicker?: (opts: {
      suggestedName?: string;
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<{
      createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
    }>;
  };

  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: 'Rechnung PDF',
            accept: { [mime]: ['.pdf'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
    }
  }

  triggerAnchorDownload(blob, fileName);
}

async function renderInvoicePdfBlob(source: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const canvas = await html2canvas(source, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
    windowWidth: Math.max(source.scrollWidth, source.clientWidth),
    windowHeight: Math.max(source.scrollHeight, source.clientHeight),
    onclone: (_doc, cloned) => {
      cloned.style.height = 'auto';
      cloned.style.maxHeight = 'none';
      cloned.style.overflow = 'visible';
      cloned.querySelectorAll('[data-invoice-toolbar]').forEach((node) => node.remove());
    },
  });

  const img = canvas.toDataURL('image/jpeg', 0.92);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const fit = fitInvoiceImageOnA4(canvas.width, canvas.height, pageWidth, pageHeight);
  pdf.addImage(img, 'JPEG', 0, 0, fit.width, fit.height);

  return pdf.output('blob');
}

/** Capture the invoice sheet and save a PDF on this computer. */
export async function saveInvoiceElementToPc(
  root: HTMLElement,
  invoiceNumber: string
): Promise<void> {
  const sheet =
    (root.querySelector('[data-invoice-sheet]') as HTMLElement | null) || root;
  const prev = {
    height: sheet.style.height,
    maxHeight: sheet.style.maxHeight,
    overflow: sheet.style.overflow,
    rootHeight: root.style.height,
    rootOverflow: root.style.overflow,
    rootMaxHeight: root.style.maxHeight,
  };
  sheet.style.height = 'auto';
  sheet.style.maxHeight = 'none';
  sheet.style.overflow = 'visible';
  root.style.height = 'auto';
  root.style.maxHeight = 'none';
  root.style.overflow = 'visible';
  try {
    const blob = await renderInvoicePdfBlob(sheet);
    await saveBlobToComputer(blob, `${invoiceFileStem(invoiceNumber)}.pdf`, 'application/pdf');
  } finally {
    sheet.style.height = prev.height;
    sheet.style.maxHeight = prev.maxHeight;
    sheet.style.overflow = prev.overflow;
    root.style.height = prev.rootHeight;
    root.style.overflow = prev.rootOverflow;
    root.style.maxHeight = prev.rootMaxHeight;
  }
}
