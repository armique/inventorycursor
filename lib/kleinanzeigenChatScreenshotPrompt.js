/** Shared between Vite client and Vercel API — keep in sync if edited. */
export const KLEINANZEIGEN_CHAT_SCREENSHOT_EXTRACTION_PROMPT = `You are reading a Kleinanzeigen.de (formerly eBay Kleinanzeigen) chat screenshot about a completed or agreed sale.

Return one JSON object only (no markdown):
{
  "buyerName": string | null,
  "agreedPriceEur": number | null,
  "paymentMethod": string | null,
  "saleDate": string | null,
  "chatUrl": string | null,
  "itemTitle": string | null
}

Rules:
- buyerName: The other person's display name in the chat (not the seller).
- agreedPriceEur: Final agreed price in EUR (number with dot decimal). Look for "€", "EUR", "VB", "Preis", agreed amount in messages.
- paymentMethod: One of: "Cash", "PayPal", "Direkt Kaufen", "Wire Transfer", "Other" — infer from chat (Barzahlung, PayPal, Direkt kaufen, Überweisung).
- saleDate: Date of agreement or last relevant message as YYYY-MM-DD. German formats like "18. Jun 2026" or "19.06.2025" → ISO. null if unclear.
- chatUrl: Full https://www.kleinanzeigen.de/... URL if visible in browser bar or message. null otherwise.
- itemTitle: Listing title if visible at top of chat. null if not visible.

Use null for anything not visible. Do not invent data.`;

export { parseExtractedSaleDate } from './ebayOrderScreenshotPrompt.js';
