# DeInventory Pro — Improvement Roadmap

## Feature Ideas

### High priority
- **Bulk invoice generation** — Select multiple date ranges and generate one invoice per buyer
- **eBay order import** — Fetch sold orders from eBay API, auto-fill buyer + address
- **SMS/Email notifications** — Alert when store inquiry arrives or item sells
- **Stock alerts** — Notify when items in composition run low
- [x] **Quick actions from inventory** — "Generate invoice" button on sold item row — DONE

### Medium priority
- **Export to Kleinanzeigen** — One-click export to CSV matching Kleinanzeigen template
- **Barcode / QR scanning** — Add items by scanning (mobile)
- **Recurring price checks** — Schedule AI price suggestions for in-stock items
- **Profit by category** — Dashboard widget showing best/worst performing categories
- **Inventory valuation** — Total value of in-stock items (buy price × quantity)

### Nice to have
- **Multi-currency** — Support EUR, USD, etc.
- **Vendor management** — Track repeat vendors, notes
- **Low stock warnings** — When quantity &lt; N for store items
- **PDF export for invoices** — Client-side PDF generation (jsPDF / html2canvas)

---

## Code & Performance Optimizations

### Build & bundle
- [x] **Code splitting** — Lazy-load heavy routes (Dashboard, InventoryList, etc.) — DONE
- [ ] **Chunk splitting** — Vendor chunk for React, Firebase, Recharts
- [ ] **Tree shaking** — Ensure unused exports are dropped
- [ ] **Compression** — Enable gzip/brotli on Vercel

### React performance
- [ ] **React.memo** on InventoryList row cells and ItemThumbnail
- [ ] **Virtualization** — Use `react-window` for long inventory lists (1000+ items)
- [ ] **Debounce search** — 150–200ms on inventory search input
- [ ] **Stable keys** — Ensure list items use `item.id` not index

### Firebase / network
- [ ] **Pagination** — Fetch store catalog in pages if large
- [ ] **Optimistic updates** — Update UI before Firestore confirm
- [ ] **Retry logic** — Exponential backoff for failed writes

### Misc
- [x] **Filters persistence** — Keep filters when switching tabs or leaving page — DONE
- [ ] **Extract date range logic** — Shared `getDateRangeForFilter()` used by InvoiceManager + InventoryList
- [ ] **Shared types** — Ensure `TimeFilter` is defined once

---

## Visual & Design Improvements

### Storefront
- [x] **Typography** — Outfit + display font — DONE
- [x] **Color accent** — Brand teal (brand-500/600) for Sale, back-to-top, CTA — DONE
- [ ] **Card hover** — Lift + shadow on product cards
- [ ] **Hero / empty state** — Refined loading skeleton, empty catalog illustration
- [ ] **Micro-interactions** — Button press feedback, smooth filter transitions
- [x] **Search autocomplete** — Live search suggestions as you type (inventory) — DONE

### Admin panel
- [x] **Sidebar** — Gradient, brand accent, improved active state — DONE
- [ ] **Page headers** — Consistent spacing, breadcrumbs where useful
- [ ] **Tables** — Alternating row subtle bg, sticky headers
- [x] **Column customisation** — Show/hide and reorder table columns — DONE
- [x] **Compact/list view** — Denser list for power users — DONE
- [x] **Recent items** — Quick access to last edited or viewed items — DONE
- [ ] **Dark mode option** — Optional dark theme for admin

### Accessibility
- [ ] **Focus rings** — Visible focus for keyboard nav
- [ ] **ARIA labels** — On icon-only buttons
- [ ] **Color contrast** — Meet WCAG AA for text
