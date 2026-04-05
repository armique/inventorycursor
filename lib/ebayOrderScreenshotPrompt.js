/** Shared between Vite client and Vercel API — keep in sync if edited. */
export const EBAY_ORDER_SCREENSHOT_EXTRACTION_PROMPT = `You are reading an eBay or eBay.de order details screenshot. Labels may be German:
- "Bestellung" = order ID
- "Lieferadresse" / shipping section = delivery address
- "Käufer" = buyer line, often "Full Name (ebay_username)"

Return one JSON object only (no markdown):
{
  "ebayOrderId": string | null,
  "ebayUsername": string | null,
  "buyerFullName": string | null,
  "shippingAddress": string | null,
  "phone": string | null
}

Rules:
- ebayOrderId: ID like "19-11447-34715" (digits and dashes) next to Bestellung or Order.
- ebayUsername: ONLY the eBay member id. If the buyer line is "Name (handle)", use "handle". Never put the real name here.
- buyerFullName: recipient name from the shipping address block.
- shippingAddress: street, postal code + city, country as plain text; use newline characters between lines. Do not put phone here.
- phone: only if clearly shown (e.g. +49 ...).

Use null for anything not visible. Do not invent data.`;
