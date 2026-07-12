/**
 * Fallback path with no eBay API calls: parse an order/transaction CSV
 * exported from eBay Seller Hub ("Orders" report) or Payments
 * ("All transactions" report). Column names vary across eBay's UI
 * revisions and locales, so headers are matched via a normalized alias
 * table rather than exact strings.
 */

import type { EbayOrderLineItem, EbayOrderRecord } from './ebayOrderIndex';

export interface EbayOrderCsvParseResult {
  orders: EbayOrderRecord[];
  rowCount: number;
  matchedRowCount: number;
  skippedRowCount: number;
  detectedColumns: string[];
  warnings: string[];
}

type CanonicalField =
  | 'orderId'
  | 'salesRecordNumber'
  | 'buyerUsername'
  | 'buyerName'
  | 'shipToName'
  | 'shipToPhone'
  | 'addr1'
  | 'addr2'
  | 'city'
  | 'state'
  | 'zip'
  | 'country'
  | 'email'
  | 'listingId'
  | 'title'
  | 'sku'
  | 'quantity'
  | 'soldFor'
  | 'shipping'
  | 'tax'
  | 'total'
  | 'saleDate'
  | 'netAmount'
  | 'fee';

const HEADER_ALIASES: Record<string, CanonicalField> = {
  ordernumber: 'orderId',
  orderid: 'orderId',
  orderreferencenumber: 'orderId',
  bestellnummer: 'orderId',
  salesrecordnumber: 'salesRecordNumber',
  verkaufsdatensatznummer: 'salesRecordNumber',
  buyeruserid: 'buyerUsername',
  buyerusername: 'buyerUsername',
  kaeufername: 'buyerUsername',
  kaufername: 'buyerUsername',
  buyername: 'buyerName',
  shiptoname: 'shipToName',
  nameempfaenger: 'shipToName',
  lieferadressename: 'shipToName',
  shiptophone: 'shipToPhone',
  telefonnummerempfaenger: 'shipToPhone',
  shiptoaddress1: 'addr1',
  lieferadressestrasse1: 'addr1',
  shiptoaddress2: 'addr2',
  lieferadressestrasse2: 'addr2',
  shiptocity: 'city',
  lieferadresseort: 'city',
  shiptostate: 'state',
  lieferadressebundesland: 'state',
  shiptozip: 'zip',
  shiptozipcode: 'zip',
  lieferadresseplz: 'zip',
  shiptocountry: 'country',
  lieferadresseland: 'country',
  shiptoemail: 'email',
  buyeremail: 'email',
  emailadresse: 'email',
  itemnumber: 'listingId',
  artikelnummer: 'listingId',
  itemtitle: 'title',
  artikelbezeichnung: 'title',
  artikeltitel: 'title',
  customlabel: 'sku',
  customlabelsku: 'sku',
  eigeneartikelnummer: 'sku',
  sku: 'sku',
  quantity: 'quantity',
  menge: 'quantity',
  soldfor: 'soldFor',
  verkaufspreis: 'soldFor',
  itemsubtotal: 'soldFor',
  artikelpreis: 'soldFor',
  shippingandhandling: 'shipping',
  versandkosten: 'shipping',
  salestax: 'tax',
  ebaycollectedtax: 'tax',
  umsatzsteuer: 'tax',
  totalprice: 'total',
  gesamtpreis: 'total',
  ordertotal: 'total',
  gesamtbetrag: 'total',
  bruttobetrag: 'total',
  saledate: 'saleDate',
  transactioncreationdate: 'saleDate',
  verkaufsdatum: 'saleDate',
  transaktionsdatum: 'saleDate',
  date: 'saleDate',
  netamount: 'netAmount',
  nettobetrag: 'netAmount',
  auszahlungsbetrag: 'netAmount',
  netto: 'netAmount',
  finalvaluefee: 'fee',
  gebuehr: 'fee',
  transactionfee: 'fee',
  fee: 'fee',
  verkaufsgebuehr: 'fee',
};

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function detectDelimiter(headerLine: string): string {
  const commaCount = (headerLine.match(/,/g) || []).length;
  const semiCount = (headerLine.match(/;/g) || []).length;
  return semiCount > commaCount ? ';' : ',';
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

function parseMoney(raw: string | undefined): number | null {
  if (!raw) return null;
  let s = raw.replace(/[^0-9.,-]/g, '').trim();
  if (!s) return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma && !hasDot) {
    const parts = s.split(',');
    if (parts[parts.length - 1].length === 2) {
      s = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
    } else {
      s = s.replace(/,/g, '');
    }
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function parseDateGuess(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (a > 12) return `${m[3]}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    return `${m[3]}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
  }
  return null;
}

/** Parse a Seller Hub Orders / Payments Transaction CSV export into cacheable order records. */
export function parseEbayOrderCsv(text: string): EbayOrderCsvParseResult {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return {
      orders: [],
      rowCount: 0,
      matchedRowCount: 0,
      skippedRowCount: 0,
      detectedColumns: [],
      warnings: ['File appears empty or has no data rows.'],
    };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headerCells = parseCsvLine(lines[0], delimiter);
  const fieldByIndex: Record<number, CanonicalField> = {};
  const detectedColumns: string[] = [];
  headerCells.forEach((h, idx) => {
    const norm = normalizeHeader(h);
    const field = HEADER_ALIASES[norm];
    if (field) {
      fieldByIndex[idx] = field;
      detectedColumns.push(`${h.trim()} → ${field}`);
    }
  });

  if (!Object.values(fieldByIndex).includes('orderId') && !Object.values(fieldByIndex).includes('salesRecordNumber')) {
    warnings.push('No "Order Number" (or Sales Record Number) column detected — cannot group rows into orders.');
  }
  if (!Object.values(fieldByIndex).includes('title')) {
    warnings.push('No item title column detected — matching to inventory will be weaker.');
  }

  const byOrderId = new Map<string, EbayOrderRecord>();
  let matchedRowCount = 0;
  let skippedRowCount = 0;

  for (let r = 1; r < lines.length; r++) {
    const cells = parseCsvLine(lines[r], delimiter);
    const row: Partial<Record<CanonicalField, string>> = {};
    for (const [idxStr, field] of Object.entries(fieldByIndex)) {
      row[field] = cells[Number(idxStr)] ?? '';
    }

    const orderId = row.orderId?.trim() || row.salesRecordNumber?.trim();
    if (!orderId) {
      skippedRowCount++;
      continue;
    }

    const addrParts = [row.addr1, row.addr2, [row.zip, row.city].filter(Boolean).join(' '), row.state, row.country]
      .map((p) => p?.trim())
      .filter(Boolean);

    const lineItem: EbayOrderLineItem = {
      sku: row.sku?.trim() || null,
      title: row.title?.trim() || '(unknown item)',
      lineItemCost: parseMoney(row.soldFor) ?? parseMoney(row.total),
      listingId: row.listingId?.trim() || null,
      quantity: row.quantity ? parseInt(row.quantity, 10) || null : null,
    };

    let record = byOrderId.get(orderId);
    if (!record) {
      record = {
        orderId,
        creationDate: parseDateGuess(row.saleDate),
        buyer: {
          username: row.buyerUsername?.trim() || undefined,
          fullName: (row.shipToName || row.buyerName)?.trim() || undefined,
          address: addrParts.join('\n') || undefined,
          email: row.email?.trim() || undefined,
          phone: row.shipToPhone?.trim() || undefined,
        },
        lineItems: [],
        grossTotal: parseMoney(row.total),
        netTotal: parseMoney(row.netAmount),
        feeTotal: parseMoney(row.fee),
        shippingCost: parseMoney(row.shipping),
        taxTotal: parseMoney(row.tax),
        sources: ['csv'],
        importedAt: new Date().toISOString(),
      };
      byOrderId.set(orderId, record);
    } else {
      record.netTotal = record.netTotal ?? parseMoney(row.netAmount);
      record.feeTotal = record.feeTotal ?? parseMoney(row.fee);
      record.grossTotal = record.grossTotal ?? parseMoney(row.total);
      record.shippingCost = record.shippingCost ?? parseMoney(row.shipping);
      record.taxTotal = record.taxTotal ?? parseMoney(row.tax);
    }
    record.lineItems.push(lineItem);
    matchedRowCount++;
  }

  return {
    orders: Array.from(byOrderId.values()),
    rowCount: lines.length - 1,
    matchedRowCount,
    skippedRowCount,
    detectedColumns,
    warnings,
  };
}
