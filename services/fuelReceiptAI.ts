import {
  parseExtractedFuelEurAmount,
  parseExtractedFuelReceiptDate,
} from '../lib/fuelReceiptPrompt.js';

export interface ParsedFuelReceipt {
  receiptDate: string | null;
  fuelAmountEur: number | null;
  stationName: string | null;
  fuelLabel: string | null;
}

function normalizeParsed(raw: unknown): ParsedFuelReceipt {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    receiptDate: parseExtractedFuelReceiptDate(o.receiptDate),
    fuelAmountEur: parseExtractedFuelEurAmount(o.fuelAmountEur),
    stationName: str(o.stationName),
    fuelLabel: str(o.fuelLabel),
  };
}

export async function parseFuelReceiptFromImageInput(rawInput: string): Promise<ParsedFuelReceipt> {
  const input = rawInput.trim();
  if (!input) throw new Error('Upload a fuel receipt image first.');
  if (!input.startsWith('data:') && !/^https?:\/\//i.test(input)) {
    throw new Error('Use an https image link or upload a file.');
  }

  let body: { imageUrl?: string; imageBase64?: string; mimeType?: string } = {};
  if (input.startsWith('data:')) {
    const m = input.match(/^data:([^;]*);base64,(.+)$/);
    if (!m) throw new Error('Invalid image data URL.');
    body = {
      imageBase64: m[2] ?? '',
      mimeType: m[1] && m[1].startsWith('image/') ? m[1] : 'image/jpeg',
    };
  } else {
    body = { imageUrl: input };
  }

  const res = await fetch('/api/gemini?route=fuel-receipt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as
    | { parsed?: ParsedFuelReceipt; error?: string }
    | null;
  if (!res.ok || !data?.parsed) {
    throw new Error(data?.error || `Fuel receipt parse failed (${res.status}).`);
  }
  const parsed = normalizeParsed(data.parsed);
  if (!parsed.receiptDate || parsed.fuelAmountEur == null || parsed.fuelAmountEur <= 0) {
    throw new Error('Could not confidently detect fuel date and amount. Try a clearer photo of the full receipt.');
  }
  return parsed;
}
