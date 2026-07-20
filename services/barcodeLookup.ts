/**
 * Client for /api/barcode — resolve EAN/UPC to product name/brand.
 */

export type BarcodeProduct = {
  barcode: string;
  name: string;
  brand?: string;
  category?: string;
  description?: string;
  imageUrl?: string;
  source?: string;
};

export type BarcodeLookupResult = {
  ok: true;
  product: BarcodeProduct;
  alternatives?: BarcodeProduct[];
};

export function normalizeBarcodeInput(raw: string): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 14) return null;
  return digits;
}

export async function lookupBarcode(raw: string): Promise<BarcodeProduct> {
  const barcode = normalizeBarcodeInput(raw);
  if (!barcode) {
    throw new Error('Enter a valid barcode (8–14 digits).');
  }
  const res = await fetch(`/api/barcode?barcode=${encodeURIComponent(barcode)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.product?.name) {
    throw new Error(
      data?.error ||
        data?.hint ||
        `No product found for ${barcode}. Try typing the name instead.`
    );
  }
  return data.product as BarcodeProduct;
}
