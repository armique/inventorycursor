# Dealwatch KA Deals (local Chrome extension)

Parses your **logged-in** Kleinanzeigen chats and suggests:

- **Purchases** (things you likely bought)
- **Sales** (Direkt kaufen, PayPal, bank transfer, chat deals)

Nothing is saved until you **confirm**.

## Install

1. Start Dealwatch: `npm start` → http://localhost:3000
2. `chrome://extensions` → Developer mode → **Load unpacked** → `dealwatch-runtime/extension`
3. Pin **Dealwatch KA Purchases**

## Use

1. Log into kleinanzeigen.de (Nachrichten)
2. Open the extension → pick **Today / Yesterday / This week**
3. **Scan chats** — opens Nachrichten if needed, then:
   - reads the inbox list for dates + Direkt cues
   - loads chat messages via Kleinanzeigen’s **messagebox API** (parallel, uses auth captured from the page)
   - extracts prices without opening every chat
4. Tick/untick suggestions → **Confirm import** into Dealwatch

After updating extension files: `chrome://extensions` → **Reload** on Dealwatch KA Deals, then hard-refresh the Nachrichten tab once so the API hook is active.

## Price rules (Direkt kaufen)

- **Buy** (`Artikel bezahlt`): paid total is the euro amount **directly above** that line (e.g. `60,44 €`), including fees/shipping. Ignore Betrag / Käuferschutz / Versand below.
- **Sell** (`Geld ausgezahlt`): amount received is the euro amount **directly above** that line.
- `Verfügbarkeit bestätigt` alone is not treated as sold yet.

## Notes

- Heuristic only — always review before confirming
- DOM click-open is only a tiny fallback (a few chats) when API auth/messages are missing
- Other channels: `paypal`, `bank-transfer`, `cash`, `chat` from free-text when present in messages
- “This week” = Monday 00:00 → now (local time)
