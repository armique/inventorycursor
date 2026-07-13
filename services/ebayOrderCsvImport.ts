/**
 * Fallback path with no eBay API calls: parse an order/transaction CSV
 * exported from eBay Seller Hub ("Orders" report) or Payments
 * ("All transactions" report). Column names vary across eBay's UI
 * revisions and locales, so headers are matched via a normalized alias
 * table rather than exact strings.
 */

import type { EbayOrderFinancialEvent, EbayOrderLineItem, EbayOrderRecord } from './ebayOrderIndex';
import {
  classifyTransactionType,
  financialEventId,
} from '../utils/ebayOrderFinancial';

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
  | 'fee'
  | 'transactionType'
  | 'description';

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
  transactiontype: 'transactionType',
  transaktionstyp: 'transactionType',
  type: 'transactionType',
  typ: 'transactionType',
  description: 'description',
  beschreibung: 'description',
  memo: 'description',
  details: 'description',
  // eBay.de Transaktionsbericht (Payments → Berichte → Alle)
  datumdertransaktionserstellung: 'saleDate',
  nutzernamedeskaufers: 'buyerUsername',
  namedeskaufers: 'buyerName',
  versandzielort: 'city',
  versandnachprovinzregionbundesland: 'state',
  versandzielplz: 'zip',
  versandzielland: 'country',
  betragabzuglichkosten: 'netAmount',
  artikelnr: 'listingId',
  transaktionsnummer: 'salesRecordNumber',
  angebotstitel: 'title',
  bestandseinheit: 'sku',
  stuckzahl: 'quantity',
  zwischensummeartikel: 'soldFor',
  verpackungundversand: 'shipping',
  transaktionsbetraginklkosten: 'total',
  fixeranteilderverkaufsprovision: 'fee',
  variableranteilderverkaufsprovision: 'fee',
  vomverkaufereingezogenesteuern: 'tax',
  vonebayeingezogenesteuern: 'tax',
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
  const s = raw.trim().replace(/^"|"$/g, '');
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
  const deMonths: Record<string, string> = {
    jan: '01',
    feb: '02',
    mar: '03',
    mär: '03',
    apr: '04',
    mai: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    okt: '10',
    nov: '11',
    dez: '12',
  };
  m = s.match(/^([A-Za-zäöüÄÖÜ]+)\s+(\d{1,2}),\s+(\d{4})/);
  if (m) {
    const mon = deMonths[m[1].toLowerCase().slice(0, 3).replace('ä', 'a').replace('ö', 'o').replace('ü', 'u')];
    if (mon) return `${m[3]}-${mon}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

function isPlaceholderCell(value: string | undefined): boolean {
  const v = (value || '').trim();
  return !v || v === '--' || v === '-';
}

/** eBay Transaktionsbericht files start with disclaimer rows; header is ~10 lines in. */
function findHeaderRowIndex(lines: string[]): number {
  for (let i = 0; i < Math.min(lines.length, 60); i++) {
    const line = lines[i];
    if (!line.trim() || /^--[,;]/.test(line)) continue;
    for (const delim of [';', ',']) {
      const cells = parseCsvLine(line, delim);
      const hasOrderCol = cells.some((h) => {
        const field = HEADER_ALIASES[normalizeHeader(h)];
        return field === 'orderId' || field === 'salesRecordNumber';
      });
      if (hasOrderCol) return i;
    }
  }
  return 0;
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

  const headerRowIndex = findHeaderRowIndex(lines);
  const delimiter = detectDelimiter(lines[headerRowIndex] || lines[0]);
  const headerCells = parseCsvLine(lines[headerRowIndex], delimiter);
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

  if (headerRowIndex > 0) {
    warnings.push(`Skipped ${headerRowIndex} preamble row(s) (eBay Transaktionsbericht header detected).`);
  }

  if (!Object.values(fieldByIndex).includes('orderId') && !Object.values(fieldByIndex).includes('salesRecordNumber')) {
    warnings.push('No "Order Number" (or Sales Record Number) column detected — cannot group rows into orders.');
  }
  if (!Object.values(fieldByIndex).includes('title')) {
    warnings.push('No item title column detected — matching to inventory will be weaker.');
  }

  const byOrderId = new Map<string, EbayOrderRecord>();
  let matchedRowCount = 0;
  let skippedRowCount = 0;

  for (let r = headerRowIndex + 1; r < lines.length; r++) {
    const cells = parseCsvLine(lines[r], delimiter);
    const row: Partial<Record<CanonicalField, string>> = {};
    for (const [idxStr, field] of Object.entries(fieldByIndex)) {
      row[field] = cells[Number(idxStr)] ?? '';
    }

    const orderIdRaw = row.orderId?.trim() || row.salesRecordNumber?.trim();
    if (isPlaceholderCell(orderIdRaw)) {
      skippedRowCount++;
      continue;
    }
    const orderId = orderIdRaw!;

    const addrParts = [row.addr1, row.addr2, [row.zip, row.city].filter(Boolean).join(' '), row.state, row.country]
      .map((p) => p?.trim())
      .filter(Boolean);

    const net = parseMoney(row.netAmount);
    const fee = parseMoney(row.fee);
    const gross = parseMoney(row.total) ?? parseMoney(row.soldFor);
    const txType = row.transactionType?.trim();
    const desc = row.description?.trim() || row.title?.trim();
    const eventDate = parseDateGuess(row.saleDate);
    const eventKind = classifyTransactionType(txType, net ?? gross);
    const eventAmount = net ?? gross ?? 0;

    const financialEvent: EbayOrderFinancialEvent | null =
      Math.abs(eventAmount) >= 0.001 || eventKind !== 'sale'
        ? {
            id: financialEventId({
              orderId,
              date: eventDate,
              amount: eventAmount,
              kind: eventKind,
              description: desc || txType,
            }),
            date: eventDate,
            kind: eventKind,
            amount: eventAmount,
            grossAmount: gross,
            feeAmount: fee,
            description: desc || txType,
            transactionType: txType,
            source: 'csv',
            importedAt: new Date().toISOString(),
          }
        : null;

    const lineItem: EbayOrderLineItem | null =
      eventKind === 'sale' || (eventAmount > 0 && row.title?.trim())
        ? {
            sku: row.sku?.trim() || null,
            title: row.title?.trim() || '(unknown item)',
            lineItemCost: parseMoney(row.soldFor) ?? gross,
            listingId: row.listingId?.trim() || null,
            quantity: row.quantity ? parseInt(row.quantity, 10) || null : null,
          }
        : null;

    let record = byOrderId.get(orderId);
    if (!record) {
      record = {
        orderId,
        creationDate: eventDate,
        buyer: {
          username: row.buyerUsername?.trim() || undefined,
          fullName: (row.shipToName || row.buyerName)?.trim() || undefined,
          address: addrParts.join('\n') || undefined,
          email: row.email?.trim() || undefined,
          phone: row.shipToPhone?.trim() || undefined,
        },
        lineItems: [],
        grossTotal: gross,
        netTotal: net,
        feeTotal: fee,
        shippingCost: parseMoney(row.shipping),
        taxTotal: parseMoney(row.tax),
        financialEvents: [],
        sources: ['csv'],
        importedAt: new Date().toISOString(),
      };
      byOrderId.set(orderId, record);
    } else {
      if (net != null) record.netTotal = (record.netTotal ?? 0) + net;
      if (fee != null) record.feeTotal = (record.feeTotal ?? 0) + fee;
      if (gross != null && record.grossTotal == null) record.grossTotal = gross;
      record.shippingCost = record.shippingCost ?? parseMoney(row.shipping);
      record.taxTotal = record.taxTotal ?? parseMoney(row.tax);
    }

    if (lineItem) record.lineItems.push(lineItem);
    if (financialEvent) {
      record.financialEvents = record.financialEvents || [];
      if (!record.financialEvents.some((e) => e.id === financialEvent.id)) {
        record.financialEvents.push(financialEvent);
      }
    }
    matchedRowCount++;
  }

  const orders = Array.from(byOrderId.values()).map((record) => {
    if (record.financialEvents?.length) {
      const sum = record.financialEvents.reduce((s, e) => s + e.amount, 0);
      record.netTotal = Math.round(sum * 100) / 100;
    }
    if (!record.financialEvents?.length) delete record.financialEvents;
    return record;
  });

  return {
    orders,
    rowCount: Math.max(0, lines.length - headerRowIndex - 1),
    matchedRowCount,
    skippedRowCount,
    detectedColumns,
    warnings,
  };
}
