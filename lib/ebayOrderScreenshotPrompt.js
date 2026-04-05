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
  "phone": string | null,
  "amountReceivedNetEur": number | null
}

Rules:
- ebayOrderId: ID like "19-11447-34715" (digits and dashes) next to Bestellung or Order.
- ebayUsername: ONLY the eBay member id. If the buyer line is "Name (handle)", use "handle". Never put the real name here.
- buyerFullName: recipient name from the shipping address block.
- shippingAddress: street, postal code + city, country as plain text; use newline characters between lines. Do not put phone here.
- phone: only if clearly shown (e.g. +49 ...).
- amountReceivedNetEur: What the **seller actually receives in EUR after all visible deductions** — eBay selling fees, promoted listing / ad fees, and similar platform charges. This is usually the **bottom / final payout line** in the payment or fee breakdown (Zahlung / Gebühren), **not** the buyer's gross order total at the top. German UI may label it like "Auszahlungsbetrag", "Sie erhalten", "Auszahlung", net amount after "Verkaufsgebühr", "Anzeigengebühr", etc. If several euro amounts appear, pick the seller's **net** total after fees (often the last or lowest summary line). Use a JSON number in euros with a dot as decimal separator (e.g. 167.23). null if not visible or ambiguous.

Use null for anything not visible. Do not invent data.`;
