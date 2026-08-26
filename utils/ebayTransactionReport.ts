/**
 * eBay Seller Hub Transaktionsbericht (Payments → Berichte).
 * Keeps every row so Abrechnungsübersicht cards can be rebuilt from the CSV.
 */

import { roundMoney } from '../services/financialAggregation';

export type EbayTxKind =
  | 'order'
  | 'refund'
  | 'case'
  | 'dispute'
  | 'label'
  | 'other_fee'
  | 'payout'
  | 'hold'
  | 'transfer'
  | 'adjustment'
  | 'purchase'
  | 'other';

export type EbayTxRow = {
  id: string;
  createdAt: string;
  createdSort: string;
  typeRaw: string;
  kind: EbayTxKind;
  orderId: string;
  buyerUsername: string;
  buyerName: string;
  city: string;
  zip: string;
  country: string;
  netEur: number | null;
  payoutDate: string;
  payoutId: string;
  payoutMethod: string;
  payoutStatus: string;
  listingId: string;
  transactionId: string;
  title: string;
  sku: string;
  quantity: number | null;
  itemSubtotalEur: number | null;
  shippingEur: number | null;
  sellerTaxEur: number | null;
  ebayTaxEur: number | null;
  fixedFeeEur: number | null;
  variableFeeEur: number | null;
  otherOrderFeeEur: number | null;
  grossEur: number | null;
  currency: string;
  reference: string;
  description: string;
  /** Present on rows synthesized from inventory sales/restocks (not from CSV). */
  source?: 'inventory';
};

export type EbayTxMeta = {
  id: string;
  seller: string;
  startDate: string;
  endDate: string;
  fileName: string;
  importedAt: string;
};

export function formatEbayTxDay(raw?: string | null): string {
  const parsed = parseEbayTxDate(raw || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(parsed.sort)) {
    const [year, month, day] = parsed.sort.split('-');
    return `${day}.${month}.${year}`;
  }
  return (parsed.display || raw || '').split(/\s+/)[0] || '—';
}

/** Seller Hub start date for the next CSV: last imported day, not the day after. Later orders that same day would be missed if we skip ahead. */
export function nextEbayTxExportStart(endDate?: string | null): string {
  const day = formatEbayTxDay(endDate);
  return day === '—' ? '' : day;
}

export function ebayTxImportedCoverage(reports: EbayTxReport[]): {
  from: string;
  to: string;
  nextExportStart: string;
  reportCount: number;
} | null {
  if (!reports.length) return null;
  const starts = reports.map((r) => parseEbayTxDate(r.meta?.startDate).sort).filter(Boolean).sort();
  const ends = reports.map((r) => parseEbayTxDate(r.meta?.endDate).sort).filter(Boolean).sort();
  const fromSort = starts[0] || '';
  const toSort = ends[ends.length - 1] || '';
  return {
    from: formatEbayTxDay(fromSort || reports[0].meta?.startDate),
    to: formatEbayTxDay(toSort || reports[reports.length - 1].meta?.endDate),
    nextExportStart: nextEbayTxExportStart(toSort || reports[reports.length - 1].meta?.endDate),
    reportCount: reports.length,
  };
}

export function ebayTxReportId(startDate: string, endDate: string, fileName = ''): string {
  const start = parseEbayTxDate(startDate).sort || startDate;
  const end = parseEbayTxDate(endDate).sort || endDate;
  if (start || end) return `${start}_${end}`;
  return fileName || `report-${Date.now()}`;
}

export function mergeEbayTxReports(reports: EbayTxReport[]): EbayTxReport | null {
  if (!reports.length) return null;
  if (reports.length === 1) return reports[0];
  const seen = new Set<string>();
  const rows: EbayTxRow[] = [];
  for (const report of [...reports].sort((a, b) => (a.meta.id || '').localeCompare(b.meta.id || ''))) {
    for (const row of report.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  rows.sort((a, b) => (b.createdSort || '').localeCompare(a.createdSort || '') || a.id.localeCompare(b.id));
  const ordered = [...reports].sort((a, b) => (a.meta.id || '').localeCompare(b.meta.id || ''));
  return {
    meta: {
      id: 'all',
      seller: reports.find((r) => r.meta.seller)?.meta.seller || '',
      startDate: ordered[0].meta.startDate,
      endDate: ordered[ordered.length - 1].meta.endDate,
      fileName: reports.map((r) => r.meta.fileName).join(' + '),
      importedAt: reports.map((r) => r.meta.importedAt).sort().slice(-1)[0] || new Date().toISOString(),
    },
    rows,
    summary: summarizeEbayTxRows(rows),
  };
}

export type EbayTxTypeBucket = {
  kind: EbayTxKind;
  label: string;
  count: number;
  grossEur: number;
  netEur: number;
};

export type EbayTxFeeSlice = {
  label: string;
  count: number;
  amountEur: number;
};

export type EbayTxSummary = {
  rowCount: number;
  orderCount: number;
  uniqueOrders: number;
  /** Hub: Verkaufserlös — Bestellung Transaktionsbetrag inkl. Kosten */
  salesGrossEur: number;
  itemSubtotalEur: number;
  buyerShippingEur: number;
  sellerTaxEur: number;
  /** Hub: Rückerstattungen (inkl. Kosten) */
  refundGrossEur: number;
  caseGrossEur: number;
  disputeGrossEur: number;
  refundsTotalEur: number;
  /** Hub: Kosten → Gebühren (Andere Gebühr + FVF on the order row) */
  feeRowsEur: number;
  orderEmbeddedFeesEur: number;
  feesTotalEur: number;
  /** Hub: Kosten → Versandetiketten */
  labelsEur: number;
  costsTotalEur: number;
  payoutsEur: number;
  /** Sum of Betrag abzügl. Kosten except payouts (wallet movement before bank transfer) */
  walletNetEur: number;
  byKind: EbayTxTypeBucket[];
  feeSlices: EbayTxFeeSlice[];
};

export type EbayTxReport = {
  meta: EbayTxMeta;
  rows: EbayTxRow[];
  summary: EbayTxSummary;
};

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  mär: 3,
  maer: 3,
  apr: 4,
  mai: 5,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  okt: 10,
  oct: 10,
  nov: 11,
  dez: 12,
  dec: 12,
};

export const TX_KIND_LABEL: Record<EbayTxKind, string> = {
  order: 'Bestellung',
  refund: 'Rückerstattung',
  case: 'Fall',
  dispute: 'Zahlungsstreitfall',
  label: 'Versandetikett',
  other_fee: 'Andere Gebühr',
  payout: 'Auszahlung',
  hold: 'Einbehalten',
  transfer: 'Überweisung',
  adjustment: 'Anpassung',
  purchase: 'Kauf',
  other: 'Andere',
};

function normHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function parseDeMoney(raw: string | null | undefined): number | null {
  const s = String(raw ?? '')
    .trim()
    .replace(/\u00a0/g, '');
  if (!s || s === '--' || s === '-' || s === '—') return null;
  const signed = s.replace(/[−–]/g, '-');
  const neg = signed.startsWith('-');
  const body = signed.replace(/-/g, '');
  if (!body) return null;
  let n: number;
  if (/,\d{1,2}$/.test(body)) {
    n = Number(body.replace(/\./g, '').replace(',', '.'));
  } else if (/\.\d{1,2}$/.test(body) && !body.includes(',')) {
    n = Number(body.replace(/,/g, ''));
  } else {
    n = Number(body.replace(/[.,]/g, ''));
  }
  if (!Number.isFinite(n)) return null;
  return roundMoney(neg ? -n : n);
}

export function parseEbayTxDate(raw: string | null | undefined): { display: string; sort: string } {
  const s = String(raw ?? '').trim();
  if (!s || s === '--') return { display: '', sort: '' };
  const named = s.match(/^(\d{1,2})\.\s*([A-Za-zÄäÖöÜü.]+)\s+(\d{4})/);
  if (named) {
    const day = named[1].padStart(2, '0');
    const monKey = named[2].replace(/\./g, '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const month = MONTHS[monKey] || MONTHS[monKey.slice(0, 3)];
    const year = named[3];
    if (month) {
      const sort = `${year}-${String(month).padStart(2, '0')}-${day}`;
      return { display: s.split(/\s+\d{1,2}:/)[0] || s, sort };
    }
  }
  const dotted = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dotted) {
    const sort = `${dotted[3]}-${dotted[2].padStart(2, '0')}-${dotted[1].padStart(2, '0')}`;
    return { display: `${dotted[1].padStart(2, '0')}.${dotted[2].padStart(2, '0')}.${dotted[3]}`, sort };
  }
  return { display: s, sort: s };
}

/** ISO date (YYYY-MM-DD) from the CSV row — official eBay transaction creation date for sellDate. */
export function ebayTxOrderSellDate(row: Pick<EbayTxRow, 'createdAt' | 'createdSort'>): string {
  const sort = (row.createdSort || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(sort)) return sort.slice(0, 10);
  const parsed = parseEbayTxDate(row.createdAt || sort);
  if (/^\d{4}-\d{2}-\d{2}/.test(parsed.sort)) return parsed.sort.slice(0, 10);
  return '';
}

export function classifyEbayTxType(raw: string): EbayTxKind {
  const t = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (t.includes('bestellung') || t === 'order' || t === 'sale') return 'order';
  if (t.includes('ruckerstat') || t.includes('refund')) return 'refund';
  if (t.includes('zahlungsstreit') || t.includes('payment dispute')) return 'dispute';
  if (t === 'fall' || t.includes('case')) return 'case';
  if (t.includes('versandetikett') || t.includes('shipping label') || t.includes('label')) return 'label';
  if (t.includes('auszahlung') || t.includes('payout')) return 'payout';
  if (t.includes('einbehalt') || t.includes('hold') || t.includes('reserve')) return 'hold';
  if (t.includes('uberweis') || t.includes('transfer')) return 'transfer';
  if (t.includes('anpassung') || t.includes('adjustment')) return 'adjustment';
  if (t.includes('kauf') || t === 'purchase') return 'purchase';
  if (t.includes('gebuhr') || t.includes('fee') || t.includes('belastung')) return 'other_fee';
  return 'other';
}

export type EbayTxOrderRefundState = 'none' | 'partial' | 'full';

/** Sum of refund/case/dispute wallet hits per order id. */
export function buildEbayTxRefundNetByOrderId(rows: EbayTxRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.orderId) continue;
    if (row.kind !== 'refund' && row.kind !== 'case' && row.kind !== 'dispute') continue;
    map.set(row.orderId, roundMoney((map.get(row.orderId) || 0) + (row.netEur ?? 0)));
  }
  return map;
}

/** full = order pocket ≤ 0 (zero = fully refunded, negative = fee loss). partial = refund rows but pocket still > 0. */
export function classifyEbayTxOrderRefundState(
  ledger: EbayTxOrderLedger | null,
  row: EbayTxRow,
  refundNetOnOrder = 0
): EbayTxOrderRefundState {
  if (row.kind !== 'order') return 'none';
  const pocket = ledger?.pocketEur ?? row.netEur;
  if (pocket != null && pocket <= 0.005) return 'full';
  if (refundNetOnOrder < -0.005) return 'partial';
  return 'none';
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function cell(row: string[], idx: Map<string, number>, ...keys: string[]): string {
  for (const key of keys) {
    const i = idx.get(key);
    if (i == null) continue;
    const v = (row[i] || '').trim();
    if (v && v !== '--') return v;
  }
  return '';
}

function moneyCell(row: string[], idx: Map<string, number>, ...keys: string[]): number | null {
  return parseDeMoney(cell(row, idx, ...keys));
}

function detectDelimiter(headerLine: string): string {
  const commaCount = (headerLine.match(/,/g) || []).length;
  const semiCount = (headerLine.match(/;/g) || []).length;
  return semiCount > commaCount ? ';' : ',';
}

export function isEbayTxAdFee(row: Pick<EbayTxRow, 'kind' | 'description' | 'title'>): boolean {
  if (row.kind !== 'other_fee') return false;
  const d = `${row.description || ''} ${row.title || ''}`.toLowerCase();
  return /anzeigen|promoted|werbung/.test(d);
}

export type EbayTxOrderLedger = {
  orderId: string;
  itemEur: number;
  buyerShipEur: number;
  fvfEur: number;
  adsEur: number;
  labelEur: number;
  otherEur: number;
  grossEur: number;
  orderNetEur: number;
  /** Official wallet impact for this order: order net + ads + label + other linked rows. */
  pocketEur: number;
  csvLabelEur?: number;
  labelManual?: boolean;
};

export function buildEbayTxOrderLedgers(rows: EbayTxRow[]): Map<string, EbayTxOrderLedger> {
  const map = new Map<string, EbayTxOrderLedger>();
  const ensure = (orderId: string): EbayTxOrderLedger => {
    let cur = map.get(orderId);
    if (!cur) {
      cur = {
        orderId,
        itemEur: 0,
        buyerShipEur: 0,
        fvfEur: 0,
        adsEur: 0,
        labelEur: 0,
        otherEur: 0,
        grossEur: 0,
        orderNetEur: 0,
        pocketEur: 0,
      };
      map.set(orderId, cur);
    }
    return cur;
  };

  for (const row of rows) {
    if (!row.orderId || row.kind === 'payout') continue;
    const cur = ensure(row.orderId);
    const net = row.netEur ?? 0;
    cur.pocketEur = roundMoney(cur.pocketEur + net);
    if (row.kind === 'order') {
      cur.itemEur = roundMoney(cur.itemEur + (row.itemSubtotalEur ?? 0));
      cur.buyerShipEur = roundMoney(cur.buyerShipEur + (row.shippingEur ?? 0));
      cur.grossEur = roundMoney(cur.grossEur + (row.grossEur ?? 0));
      cur.orderNetEur = roundMoney(cur.orderNetEur + net);
      cur.fvfEur = roundMoney(
        cur.fvfEur + (row.fixedFeeEur ?? 0) + (row.variableFeeEur ?? 0) + (row.otherOrderFeeEur ?? 0)
      );
    } else if (row.kind === 'label') {
      cur.labelEur = roundMoney(cur.labelEur + net);
    } else if (isEbayTxAdFee(row)) {
      cur.adsEur = roundMoney(cur.adsEur + net);
    } else {
      cur.otherEur = roundMoney(cur.otherEur + net);
    }
  }
  return map;
}

export function summarizeEbayTxOrderLedgers(ledgers: Map<string, EbayTxOrderLedger>): {
  orderCount: number;
  pocketEur: number;
  adsEur: number;
  labelsEur: number;
  fvfEur: number;
  otherEur: number;
  grossEur: number;
} {
  let pocketEur = 0;
  let adsEur = 0;
  let labelsEur = 0;
  let fvfEur = 0;
  let otherEur = 0;
  let grossEur = 0;
  for (const ledger of ledgers.values()) {
    pocketEur += ledger.pocketEur;
    adsEur += ledger.adsEur;
    labelsEur += ledger.labelEur;
    fvfEur += ledger.fvfEur;
    otherEur += ledger.otherEur;
    grossEur += ledger.grossEur;
  }
  return {
    orderCount: ledgers.size,
    pocketEur: roundMoney(pocketEur),
    adsEur: roundMoney(adsEur),
    labelsEur: roundMoney(labelsEur),
    fvfEur: roundMoney(fvfEur),
    otherEur: roundMoney(otherEur),
    grossEur: roundMoney(grossEur),
  };
}

export function collectEbayTxLabelPrices(rows: EbayTxRow[]): number[] {
  const amounts = new Set<number>();
  for (const row of rows) {
    if (row.kind !== 'label') continue;
    const amount = Math.abs(row.netEur ?? row.grossEur ?? 0);
    if (amount >= 0.01) amounts.add(roundMoney(amount));
  }
  return [...amounts].sort((a, b) => a - b);
}

export function applyEbayTxLabelOverrides(
  ledgers: Map<string, EbayTxOrderLedger>,
  overrides: Record<string, { amountEur: number }>
): Map<string, EbayTxOrderLedger> {
  const next = new Map<string, EbayTxOrderLedger>();
  for (const [orderId, ledger] of ledgers) {
    const override = overrides[orderId];
    const csvLabelEur = ledger.labelEur;
    if (!override || !(Math.abs(override.amountEur) >= 0.01)) {
      next.set(orderId, { ...ledger, csvLabelEur, labelManual: false });
      continue;
    }
    const labelEur = -roundMoney(Math.abs(override.amountEur));
    next.set(orderId, {
      ...ledger,
      csvLabelEur,
      labelEur,
      pocketEur: roundMoney(ledger.pocketEur + (labelEur - csvLabelEur)),
      labelManual: true,
    });
  }
  return next;
}

function feeSliceLabel(description: string, kind: EbayTxKind): string {
  const d = description.toLowerCase();
  if (d.includes('basis-anzeigen') || d.includes('promoted')) return 'Basis-Anzeigen';
  if (d.includes('angebotsgebühr') || d.includes('angebotsgebuhr')) return 'Angebotsgebühr';
  if (kind === 'label' || d.includes('dhl') || d.includes('sendungsnr')) return 'Versandetikett';
  if (d) return description.replace(/\s+/g, ' ').slice(0, 48);
  return TX_KIND_LABEL[kind];
}

export function summarizeEbayTxRows(rows: EbayTxRow[]): EbayTxSummary {
  const unique = new Set<string>();
  let salesGross = 0;
  let itemSubtotal = 0;
  let buyerShipping = 0;
  let sellerTax = 0;
  let refundGross = 0;
  let caseGross = 0;
  let disputeGross = 0;
  let feeRows = 0;
  let embeddedFees = 0;
  let labels = 0;
  let payouts = 0;
  let walletNet = 0;
  let orderCount = 0;
  const kindMap = new Map<EbayTxKind, EbayTxTypeBucket>();
  const sliceMap = new Map<string, EbayTxFeeSlice>();

  const bumpKind = (kind: EbayTxKind, gross: number, net: number) => {
    const cur = kindMap.get(kind) || { kind, label: TX_KIND_LABEL[kind], count: 0, grossEur: 0, netEur: 0 };
    cur.count += 1;
    cur.grossEur = roundMoney(cur.grossEur + gross);
    cur.netEur = roundMoney(cur.netEur + net);
    kindMap.set(kind, cur);
  };

  for (const row of rows) {
    const gross = row.grossEur ?? 0;
    const net = row.netEur ?? 0;
    bumpKind(row.kind, gross, net);
    if (row.kind !== 'payout') walletNet += net;
    if (row.orderId) unique.add(row.orderId);

    if (row.kind === 'order') {
      orderCount += 1;
      salesGross += gross;
      itemSubtotal += row.itemSubtotalEur ?? 0;
      buyerShipping += row.shippingEur ?? 0;
      sellerTax += row.sellerTaxEur ?? 0;
      embeddedFees +=
        (row.fixedFeeEur ?? 0) + (row.variableFeeEur ?? 0) + (row.otherOrderFeeEur ?? 0);
    } else if (row.kind === 'refund') {
      refundGross += gross;
    } else if (row.kind === 'case') {
      caseGross += gross;
    } else if (row.kind === 'dispute') {
      disputeGross += gross;
    } else if (row.kind === 'other_fee') {
      feeRows += gross;
      const label = feeSliceLabel(row.description, row.kind);
      const slice = sliceMap.get(label) || { label, count: 0, amountEur: 0 };
      slice.count += 1;
      slice.amountEur = roundMoney(slice.amountEur + gross);
      sliceMap.set(label, slice);
    } else if (row.kind === 'label') {
      labels += gross;
    } else if (row.kind === 'payout') {
      payouts += gross;
    }
  }

  const feesTotal = roundMoney(feeRows + embeddedFees);
  const refundsTotal = roundMoney(refundGross + caseGross + disputeGross);
  const costsTotal = roundMoney(feesTotal + labels);

  return {
    rowCount: rows.length,
    orderCount,
    uniqueOrders: unique.size,
    salesGrossEur: roundMoney(salesGross),
    itemSubtotalEur: roundMoney(itemSubtotal),
    buyerShippingEur: roundMoney(buyerShipping),
    sellerTaxEur: roundMoney(sellerTax),
    refundGrossEur: roundMoney(refundGross),
    caseGrossEur: roundMoney(caseGross),
    disputeGrossEur: roundMoney(disputeGross),
    refundsTotalEur: refundsTotal,
    feeRowsEur: roundMoney(feeRows),
    orderEmbeddedFeesEur: roundMoney(embeddedFees),
    feesTotalEur: feesTotal,
    labelsEur: roundMoney(labels),
    costsTotalEur: costsTotal,
    payoutsEur: roundMoney(payouts),
    walletNetEur: roundMoney(walletNet),
    byKind: [...kindMap.values()].sort((a, b) => Math.abs(b.grossEur) - Math.abs(a.grossEur)),
    feeSlices: [...sliceMap.values()].sort((a, b) => Math.abs(b.amountEur) - Math.abs(a.amountEur)),
  };
}

export function parseEbayTransactionReport(text: string, fileName = 'transaction-report.csv'): EbayTxReport {
  const rawLines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const lines = rawLines.map((l) => l.replace(/\s+$/, '')).filter((l, i, arr) => l.length > 0 || i < arr.length - 1);

  let seller = '';
  let startDate = '';
  let endDate = '';
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const line = lines[i];
    if (/^"?Verkäufer"?|^"?Seller"?/i.test(line)) {
      seller = line.split(/[;,]/).slice(1).join(' ').replace(/"/g, '').trim();
    }
    if (/^"?Startdatum"?|^"?Start date"?/i.test(line)) {
      startDate = line.split(/[;,]/).slice(1).join(' ').replace(/"/g, '').trim();
    }
    if (/^"?Enddatum"?|^"?End date"?/i.test(line)) {
      endDate = line.split(/[;,]/).slice(1).join(' ').replace(/"/g, '').trim();
    }
    if (
      /Datum der Transaktionserstellung/i.test(line) &&
      /Typ/i.test(line) &&
      /Bestellnummer|Order/i.test(line)
    ) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error('Not an eBay Transaktionsbericht — missing the transaction header row.');
  }

  const delimiter = detectDelimiter(lines[headerIdx]);
  const headers = parseCsvLine(lines[headerIdx], delimiter).map((h) => h.replace(/"/g, '').trim());
  const idx = new Map<string, number>();
  headers.forEach((h, i) => idx.set(normHeader(h), i));

  const rows: EbayTxRow[] = [];
  const reportKey = ebayTxReportId(startDate, endDate, fileName);
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = parseCsvLine(line, delimiter).map((c) => c.replace(/^"|"$/g, '').trim());
    if (cols.every((c) => !c || c === '--')) continue;
    const typeRaw = cell(cols, idx, 'typ', 'type', 'transaktionstyp', 'transactiontype');
    if (!typeRaw) continue;
    const created = parseEbayTxDate(
      cell(cols, idx, 'datumdertransaktionserstellung', 'transaktionsdatum', 'date')
    );
    const kind = classifyEbayTxType(typeRaw);
    const extraFee = roundMoney(
      (moneyCell(cols, idx, 'gebuhrfurgesetzlichebetriebskosten') ?? 0) +
        (moneyCell(cols, idx, 'gebuhrfursehrhohequoteannichtwiebeschriebenenartikeln') ?? 0) +
        (moneyCell(cols, idx, 'gebuhrfurunterdurchschnittlichenservicestatus') ?? 0) +
        (moneyCell(cols, idx, 'internationalegebuhr') ?? 0)
    );
    rows.push({
      id: `${reportKey}-${created.sort}-${i}-${cell(cols, idx, 'referenznummer', 'transaktionsnummer', 'bestellnummer') || i}`,
      createdAt: created.display,
      createdSort: created.sort,
      typeRaw,
      kind,
      orderId: cell(cols, idx, 'bestellnummer', 'orderid', 'ordernumber'),
      buyerUsername: cell(cols, idx, 'nutzernamedeskaufers', 'buyerusername', 'kaeufername'),
      buyerName: cell(cols, idx, 'namedeskaufers', 'buyername'),
      city: cell(cols, idx, 'versandzielort', 'shiptocity'),
      zip: cell(cols, idx, 'versandzielplz', 'shiptozip'),
      country: cell(cols, idx, 'versandzielland', 'shiptocountry'),
      netEur: moneyCell(cols, idx, 'betragabzuglkosten', 'betragabzuglichkosten', 'nettobetrag'),
      payoutDate: parseEbayTxDate(cell(cols, idx, 'auszahlungsdatum', 'payoutdate')).display,
      payoutId: cell(cols, idx, 'auszahlungnr', 'payoutid'),
      payoutMethod: cell(cols, idx, 'auszahlungsmethode', 'payoutmethod'),
      payoutStatus: cell(cols, idx, 'auszahlungsstatus', 'payoutstatus'),
      listingId: cell(cols, idx, 'artikelnr', 'itemnumber'),
      transactionId: cell(cols, idx, 'transaktionsnummer', 'transactionid'),
      title: cell(cols, idx, 'angebotstitel', 'itemtitle'),
      sku: cell(cols, idx, 'bestandseinheit', 'sku', 'customlabel'),
      quantity: (() => {
        const q = parseDeMoney(cell(cols, idx, 'stuckzahl', 'quantity', 'menge'));
        return q == null ? null : q;
      })(),
      itemSubtotalEur: moneyCell(cols, idx, 'zwischensummeartikel', 'itemsubtotal'),
      shippingEur: moneyCell(cols, idx, 'verpackungundversand', 'shippingandhandling'),
      sellerTaxEur: moneyCell(cols, idx, 'vomverkaufereingezogenesteuer', 'vomverkaufereingezogenesteuern'),
      ebayTaxEur: moneyCell(cols, idx, 'vonebayeingezogenesteuer', 'vonebayeingezogenesteuern'),
      fixedFeeEur: moneyCell(cols, idx, 'fixeranteilderverkaufsprovision'),
      variableFeeEur: moneyCell(cols, idx, 'variableranteilderverkaufsprovision'),
      otherOrderFeeEur: extraFee || null,
      grossEur: moneyCell(cols, idx, 'transaktionsbetraginklkosten', 'transaktionsbetraginklusivkosten'),
      currency: cell(cols, idx, 'transaktionswahrung', 'auszahlungswahrung') || 'EUR',
      reference: cell(cols, idx, 'referenznummer'),
      description: cell(cols, idx, 'beschreibung', 'description'),
    });
  }

  return {
    meta: {
      id: ebayTxReportId(startDate, endDate, fileName),
      seller,
      startDate,
      endDate,
      fileName,
      importedAt: new Date().toISOString(),
    },
    rows,
    summary: summarizeEbayTxRows(rows),
  };
}

export function isInventoryProAbrechnungBackupText(text: string): boolean {
  return /inventory-pro eBay Abrechnung backup|inventory-pro-abrechnung-v1/i.test(text);
}

export function isEbayTransactionReportText(text: string): boolean {
  if (isInventoryProAbrechnungBackupText(text)) return false;
  return /Transaktionsbericht|Datum der Transaktionserstellung/i.test(text) && /Bestellnummer|Typ/i.test(text);
}
