# Item card AI menu — 10 design concepts

Open [`index.html`](./index.html) in a browser, or open any numbered file alone.

Each concept keeps **exactly two AI blocks**:

1. **AI Titel** (eBay, max 80 chars)
2. **AI Beschreibung** (German listing body)

Removed from the listing menu across concepts: Parse Specs, Suggest Price as separate menu items, dual Copy AI Text / Copy Kleinanzeigen buttons.

| # | File | Concept |
|---|------|---------|
| 01 | `01-split-studio.html` | Side-by-side title + description |
| 02 | `02-row-inline.html` | Inline expand under inventory row |
| 03 | `03-slide-drawer.html` | Right drawer Listing AI |
| 04 | `04-popover-duo.html` | Compact popover with two cards |
| 05 | `05-listing-studio-modal.html` | Full Listing Studio modal |
| 06 | `06-twin-editors.html` | Twin editors + generate listing |
| 07 | `07-accordion-blocks.html` | Accordion title / description |
| 08 | `08-bottom-sheet.html` | Mobile bottom sheet |
| 09 | `09-operator-console.html` | Dense operator console |
| 10 | `10-rail-and-panels.html` | Icon rail + dual panels |

**Implemented in app:** Sparkles on the inventory row opens `ListingAiPanelModal` (stacked title + description, inspired by 01/05/06). Generation uses `services/marketplaceListingAI.ts` with the professional eBay.de / Kleinanzeigen DE prompt.
