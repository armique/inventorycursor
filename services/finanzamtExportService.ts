/**
 * Finanzamt-oriented export: styled multi-sheet workbook (Excel .xlsx) for Google Sheets upload.
 * German column labels; bundles/PCs explained without double-counting revenue.
 */
import ExcelJS from 'exceljs';
import { Expense, InventoryItem, ItemStatus } from '../types';
import type { DateBounds } from '../utils/exportDateRange';
import {
  filterExpensesForRange,
  filterInventoryForFinanzamtRange,
  formatBoundsForFilename,
  formatBoundsGerman,
} from '../utils/exportDateRange';
import {
  roundMoney,
  getChildren,
  isSoldWithProportionalChildren,
  shouldSkipContainerRow,
  shouldSkipCompositionChild,
  isBundleSoldOnParentOnly,
} from './financialAggregation';

const round2 = roundMoney;

const SHEET_WARE = 'Ware_Buchungen';
const SHEET_AUSGABEN = 'Betriebsausgaben';
const SHEET_PAKETE = 'Pakete_Uebersicht';
const SHEET_ANLEITUNG = 'Anleitung';

/** Status values shown to German authorities / accountants. */
const STATUS_DE: Record<ItemStatus, string> = {
  [ItemStatus.IN_STOCK]: 'Im Bestand',
  [ItemStatus.SOLD]: 'Verkauft',
  [ItemStatus.ORDERED]: 'Bestellt',
  [ItemStatus.IN_COMPOSITION]: 'Im Paket / Zusammenbau',
  [ItemStatus.TRADED]: 'Getauscht',
};

const PAYMENT_DE: Partial<Record<string, string>> = {
  Cash: 'Bar',
  'Bank Transfer': 'Überweisung',
  'ebay.de': 'eBay',
  'Kleinanzeigen (Cash)': 'Kleinanzeigen (Bar)',
  'Kleinanzeigen (Direkt Kaufen)': 'Kleinanzeigen (Direkt kaufen)',
  'Kleinanzeigen (Paypal)': 'Kleinanzeigen (PayPal)',
  'Kleinanzeigen (Wire Transfer)': 'Kleinanzeigen (Überweisung)',
  Paypal: 'PayPal',
  Trade: 'Tausch',
  Other: 'Sonstiges',
};

const PLATFORM_DE: Partial<Record<string, string>> = {
  'ebay.de': 'eBay',
  'kleinanzeigen.de': 'Kleinanzeigen',
  Amazon: 'Amazon',
  Other: 'Sonstiges',
};

function dePayment(v?: string): string {
  if (!v) return '';
  return PAYMENT_DE[v] ?? v;
}

function dePlatform(v?: string): string {
  if (!v) return '';
  return PLATFORM_DE[v] ?? v;
}

function formatStückliste(children: InventoryItem[]): string {
  return children.map((c, i) => `${i + 1}. ${c.name}`).join(' | ');
}

export type FinanzamtWareRow = {
  Zeilenart: string;
  Bezeichnung: string;
  Kategorie: string;
  Unterkategorie: string;
  Status: string;
  Einkaufsdatum: string;
  Verkaufsdatum: string;
  Einkaufspreis_EUR: number | '';
  Verkaufspreis_EUR: number | '';
  'Gebühren_Verkauf_EUR': number | '';
  Gewinn_EUR: number | '';
  Paket_oder_PC: string;
  Rolle_im_Paket: string;
  Stückliste_Komponenten: string;
  Verkaufsplattform: string;
  Zahlungsart_Verkauf: string;
  Einkauf_Lieferant: string;
  Rechnungsnummer: string;
  Kunde_Name: string;
  Bemerkung: string;
};

function buildWareRow(
  item: InventoryItem,
  items: InventoryItem[],
  ctx: { paketName: string; rolle: string; stückliste: string }
): FinanzamtWareRow {
  const parent = item.parentContainerId ? items.find((i) => i.id === item.parentContainerId) : undefined;
  const paketFromParent = parent && (parent.isBundle || parent.isPC) ? parent.name : '';

  let paketName = ctx.paketName || paketFromParent;
  let rolle = ctx.rolle;
  let stückliste = ctx.stückliste;

  if ((item.isBundle || item.isPC) && getChildren(item, items).length > 0) {
    const ch = getChildren(item, items);
    stückliste = stückliste || formatStückliste(ch);
  }

  let zeilenart = 'Einzelartikel';
  if (item.isPC) zeilenart = 'PC-Zusammenbau';
  if (item.isBundle) zeilenart = 'Paket / Bundle';

  const comment = [item.comment1, item.comment2].filter(Boolean).join(' — ').slice(0, 500);

  return {
    Zeilenart: zeilenart,
    Bezeichnung: item.name,
    Kategorie: item.category || '',
    Unterkategorie: item.subCategory || '',
    Status: STATUS_DE[item.status] ?? item.status,
    Einkaufsdatum: item.buyDate || '',
    Verkaufsdatum: item.sellDate || item.containerSoldDate || '',
    Einkaufspreis_EUR: item.buyPrice !== undefined && item.buyPrice !== null ? round2(Number(item.buyPrice)) : '',
    Verkaufspreis_EUR:
      item.sellPrice !== undefined && item.sellPrice !== null ? round2(Number(item.sellPrice)) : '',
    'Gebühren_Verkauf_EUR':
      item.feeAmount !== undefined && item.feeAmount !== null && Number(item.feeAmount) !== 0
        ? round2(Number(item.feeAmount))
        : '',
    Gewinn_EUR:
      item.profit !== undefined && item.profit !== null ? round2(Number(item.profit)) : '',
    Paket_oder_PC: paketName,
    Rolle_im_Paket: rolle,
    Stückliste_Komponenten: stückliste,
    Verkaufsplattform: dePlatform(item.platformSold),
    Zahlungsart_Verkauf: dePayment(item.paymentType),
    Einkauf_Lieferant: item.vendor || '',
    Rechnungsnummer: item.invoiceNumber || '',
    Kunde_Name: item.customer?.name || '',
    Bemerkung: comment,
  };
}

/**
 * Rows for the main ware sheet: no double-counting of bundle revenue.
 */
export function buildFinanzamtWareRows(items: InventoryItem[]): FinanzamtWareRow[] {
  const list = items.filter((i) => !i.isDraft);
  const rows: FinanzamtWareRow[] = [];

  for (const item of list) {
    if (shouldSkipContainerRow(item, list)) continue;
    if (shouldSkipCompositionChild(item, list)) continue;

    const parent = item.parentContainerId ? list.find((i) => i.id === item.parentContainerId) : undefined;
    let rolle = '—';
    let paketName = '';
    let stückliste = '';

    if (parent && (parent.isBundle || parent.isPC)) {
      paketName = parent.name;
      if (isSoldWithProportionalChildren(parent, list) && item.status === ItemStatus.SOLD) {
        rolle =
          'Paketbestandteil (Verkauf als Paket; Umsatz und Gewinn sind auf die Komponentenzeilen nach Einkaufspreis-Anteil aufgeteilt.)';
      } else if (parent.status === ItemStatus.SOLD && item.status === ItemStatus.IN_COMPOSITION) {
        rolle = 'Paketbestandteil (Umsatz nur auf Paketzeile; diese Zeile dient der Stückliste / EK-Nachweis)';
      } else if (item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED) {
        rolle = 'Paketbestandteil (Bestand über übergeordnetes Paket gebucht)';
      } else {
        rolle = 'Paketbestandteil';
      }
    }

    if ((item.isBundle || item.isPC) && getChildren(item, list).length > 0) {
      const ch = getChildren(item, list);
      stückliste = formatStückliste(ch);
      if (isBundleSoldOnParentOnly(item, list)) {
        rolle = 'Paket gesamt (ein Verkaufspreis; Komponenten nur in Stückliste, kein eigener Umsatz)';
      } else if (item.status !== ItemStatus.SOLD || !isSoldWithProportionalChildren(item, list)) {
        rolle =
          item.status === ItemStatus.SOLD
            ? 'Paket gesamt (Verkauf)'
            : 'Paket gesamt (Bestand; EK = Summe der Komponenten)';
      }
    }

    rows.push(buildWareRow(item, list, { paketName, rolle, stückliste }));
  }

  return rows;
}

export type FinanzamtPaketRow = {
  Bezeichnung: string;
  Typ: string;
  Status: string;
  Anzahl_Komponenten: number;
  Stückliste: string;
  Summe_EK_Komponenten_EUR: number | '';
  Verkaufspreis_Paket_EUR: number | '';
  Verkaufsdatum: string;
  Hinweis_Buchung: string;
};

export function buildFinanzamtPaketSummaryRows(items: InventoryItem[]): FinanzamtPaketRow[] {
  const list = items.filter((i) => !i.isDraft);
  const containers = list.filter((i) => (i.isBundle || i.isPC) && getChildren(i, list).length > 0);

  return containers.map((parent) => {
    const children = getChildren(parent, list);
    const sumEk = round2(children.reduce((s, c) => s + Number(c.buyPrice || 0), 0));
    const proportional = isSoldWithProportionalChildren(parent, list);
    let hinweis =
      'Einzelbuchungen für dieses Paket siehe Blatt „Ware_Buchungen“. Umsätze nicht mit Paketzeile addieren, wenn dort nur Komponentenzeilen den Verkauf tragen.';
    if (proportional) {
      hinweis =
        'Verkauf: Umsatz und Gewinn sind auf die Komponentenzeilen verteilt (anteilig nach Einkaufspreis). Die Paketzeile im Ware-Blatt ist ausgeblendet, um Doppelzählung zu vermeiden.';
    }
    if (isBundleSoldOnParentOnly(parent, list)) {
      hinweis =
        'Verkauf als ein Paket: Umsatz und Gewinn stehen auf der Paketzeile im Ware-Blatt; Komponenten sind nur der Stückliste zugeordnet.';
    }

    return {
      Bezeichnung: parent.name,
      Typ: parent.isPC ? 'PC' : 'Paket / Bundle',
      Status: STATUS_DE[parent.status] ?? parent.status,
      Anzahl_Komponenten: children.length,
      Stückliste: formatStückliste(children),
      Summe_EK_Komponenten_EUR: sumEk,
      Verkaufspreis_Paket_EUR:
        parent.sellPrice !== undefined && parent.sellPrice !== null
          ? round2(Number(parent.sellPrice))
          : '',
      Verkaufsdatum: parent.sellDate || '',
      Hinweis_Buchung: hinweis,
    };
  });
}

function buildAusgabenRows(expenses: Expense[]): Record<string, string | number>[] {
  return expenses.map((e) => ({
    Datum: e.date || '',
    Beschreibung: e.description || '',
    Betrag_EUR: round2(Number(e.amount || 0)),
    Kategorie: e.category || '',
    Beleg_URL: e.attachmentUrl || '',
    Dateiname_Beleg: e.attachmentName || '',
  }));
}

function instructionSheetRows(companyName: string, exportedAt: string, periodNote: string): string[][] {
  return [
    ['Finanzamt-Export — Kurzanleitung', ''],
    ['', ''],
    ['Erstellt am (UTC):', exportedAt],
    ['Firma / Name (aus App-Einstellungen):', companyName || '—'],
    ['Export-Zeitraum:', periodNote],
    ['', ''],
    ['Blätter in dieser Datei', ''],
    ['1) Anleitung', 'Diese Übersicht.'],
    ['2) Ware_Buchungen', 'Alle buchungsrelevanten Positionen: Bestand, verkaufte Einzelteile, Pakete.'],
    ['3) Pakete_Uebersicht', 'Eine Zeile pro Paket/PC mit Stückliste und Hinweis, wie der Verkauf in den Daten gebucht ist.'],
    ['4) Betriebsausgaben', 'Ihre erfassten Ausgaben inkl. Kategorie und optional Beleg-Link.'],
    ['', ''],
    ['Wichtig: Pakete und PCs', ''],
    [
      'Verkauf über Dialog',
      'Wenn Sie ein Paket über den Verkaufsdialog verkaufen, verteilt die App den Verkaufspreis und die Gebühren anteilig auf die Komponenten (nach Verhältnis der Einkaufspreise). Im Export erscheinen dann die KOMPONENTENZEILEN mit Verkaufspreis und Gewinn; die leere Paket-Hülle wird weggelassen, damit Sie den Umsatz nicht doppelt zählen.',
    ],
    [
      'Retro-Paket',
      'Wenn Sie ein Paket nachträglich (Retro-Bundle) als einen Verkauf erfassen, stehen Umsatz und Gewinn auf der PAKETZEILE; die Komponenten bleiben „Im Paket“ und erscheinen nicht als eigene Verkaufszeilen.',
    ],
    ['Spaltenhilfe', '„Rolle_im_Paket“ und „Stückliste_Komponenten“ erklären jede Zeile im Ware-Blatt.'],
    ['', ''],
    ['Spalten Ware_Buchungen (Auszug)', ''],
    ['Bezeichnung', 'Artikelbezeichnung wie in der App.'],
    ['Einkaufsdatum / Verkaufsdatum', 'Nachweis Zeitraum; leer, wenn noch nicht verkauft.'],
    ['Einkaufspreis_EUR / Verkaufspreis_EUR', 'Netto-Beträge wie erfasst (Steuerlogik bitte mit Steuerberater abstimmen).'],
    ['Gebühren_Verkauf_EUR', 'z. B. Marktplatzgebühren, auf die Komponente oder das Paket verteilt.'],
    ['Gewinn_EUR', 'Wie in der App berechnet (Verkauf − EK − Gebühr, falls erfasst).'],
    ['Paket_oder_PC', 'Name des übergeordneten Pakets/PCs, falls zutreffend.'],
    ['', ''],
    ['Google Tabellen', ''],
    [
      'Upload',
      'Diese Datei ist .xlsx. In Google Drive: „Neu“ → „Datei hochladen“, dann mit Google Tabellen öffnen. Kein Google-Konto in der App nötig.',
    ],
    ['', ''],
    ['Hinweis', ''],
    [
      'Steuerrecht',
      'Dieser Export ist eine strukturierte Übersicht Ihrer App-Daten. Für steuerliche Bewertung (Kleinunternehmer, Differenzbesteuerung usw.) ist Ihr Steuerberater zuständig.',
    ],
  ];
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF0F172A' },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
const BODY_FONT: Partial<ExcelJS.Font> = { size: 11, name: 'Calibri', color: { argb: 'FF1E293B' } };
const ZEBRA_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF8FAFC' },
};
const BORDER_LIGHT: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
};
const MONEY_FMT = '#,##0.00';

const WARE_HEADER_ORDER: (keyof FinanzamtWareRow)[] = [
  'Zeilenart',
  'Bezeichnung',
  'Kategorie',
  'Unterkategorie',
  'Status',
  'Einkaufsdatum',
  'Verkaufsdatum',
  'Einkaufspreis_EUR',
  'Verkaufspreis_EUR',
  'Gebühren_Verkauf_EUR',
  'Gewinn_EUR',
  'Paket_oder_PC',
  'Rolle_im_Paket',
  'Stückliste_Komponenten',
  'Verkaufsplattform',
  'Zahlungsart_Verkauf',
  'Einkauf_Lieferant',
  'Rechnungsnummer',
  'Kunde_Name',
  'Bemerkung',
];

function wareRowToArray(row: FinanzamtWareRow): (string | number | null)[] {
  return WARE_HEADER_ORDER.map((key) => {
    const v = row[key];
    if (v === '' || v === undefined) return null;
    return v as string | number;
  });
}

const PAKET_HEADER_ORDER: (keyof FinanzamtPaketRow)[] = [
  'Bezeichnung',
  'Typ',
  'Status',
  'Anzahl_Komponenten',
  'Stückliste',
  'Summe_EK_Komponenten_EUR',
  'Verkaufspreis_Paket_EUR',
  'Verkaufsdatum',
  'Hinweis_Buchung',
];

function paketRowToArray(row: FinanzamtPaketRow): (string | number | null)[] {
  return PAKET_HEADER_ORDER.map((key) => {
    const v = row[key];
    if (v === '' || v === undefined) return null;
    return v as string | number;
  });
}

function styleHeaderRow(row: ExcelJS.Row, colCount: number): void {
  row.height = 26;
  row.font = HEADER_FONT;
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF334155' } },
      top: { style: 'thin', color: { argb: 'FF1E293B' } },
      left: { style: 'thin', color: { argb: 'FF334155' } },
      right: { style: 'thin', color: { argb: 'FF334155' } },
    };
  }
}

function styleDataRows(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  rowCount: number,
  colCount: number,
  moneyCols0: number[]
): void {
  const moneySet = new Set(moneyCols0.map((i) => i + 1));
  for (let r = 0; r < rowCount; r++) {
    const row = sheet.getRow(startRow + r);
    row.height = 20;
    const zebra = r % 2 === 1;
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      cell.font = BODY_FONT;
      cell.border = BORDER_LIGHT;
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: 'left' };
      if (zebra) cell.fill = ZEBRA_FILL;
      if (moneySet.has(c) && typeof cell.value === 'number') {
        cell.numFmt = MONEY_FMT;
        cell.alignment = { ...cell.alignment, horizontal: 'right' };
      }
    }
  }
}

function setColumnWidths(sheet: ExcelJS.Worksheet, widths: number[]): void {
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
}

function addStyledTableSheet(
  wb: ExcelJS.Workbook,
  name: string,
  headers: string[],
  dataRows: (string | number | null)[][],
  moneyColumnIndices0: number[],
  columnWidths: number[]
): void {
  const ws = wb.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 20 },
  });
  const colCount = headers.length;
  ws.addRow(headers);
  styleHeaderRow(ws.getRow(1), colCount);
  dataRows.forEach((cells) => ws.addRow(cells));
  styleDataRows(ws, 2, dataRows.length, colCount, moneyColumnIndices0);
  setColumnWidths(ws, columnWidths);
}

function buildAnleitungSheet(wb: ExcelJS.Workbook, companyName: string, exportedAt: string, periodNote: string): void {
  const ws = wb.addWorksheet(SHEET_ANLEITUNG, {
    views: [{ state: 'frozen', ySplit: 4 }],
  });
  ws.mergeCells(1, 1, 1, 2);
  const title = ws.getCell('A1');
  title.value = 'Finanzamt-Export';
  title.font = { bold: true, size: 18, name: 'Calibri', color: { argb: 'FFFFFFFF' } };
  title.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF047857' },
  };
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 40;

  ws.mergeCells(2, 1, 2, 2);
  const sub = ws.getCell('A2');
  sub.value = `Erstellt: ${exportedAt}  ·  ${companyName || '—'}`;
  sub.font = { size: 11, italic: true, name: 'Calibri', color: { argb: 'FF64748B' } };
  sub.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFECFDF5' },
  };
  sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(2).height = 28;

  ws.addRow(['', '']);
  ws.getRow(3).height = 8;

  const body = instructionSheetRows(companyName, exportedAt, periodNote).slice(2);
  let rowIndex = 4;
  const sectionTitles = new Set([
    'Blätter in dieser Datei',
    'Wichtig: Pakete und PCs',
    'Spalten Ware_Buchungen (Auszug)',
    'Google Tabellen',
    'Hinweis',
    'Spaltenhilfe',
  ]);
  for (const [a, b] of body) {
    const row = ws.getRow(rowIndex);
    row.getCell(1).value = a;
    row.getCell(2).value = b;
    const section = sectionTitles.has(a);
    row.getCell(1).font = {
      bold: section || (b.length > 0 && b.length < 80),
      size: section ? 12 : 11,
      name: 'Calibri',
      color: { argb: section ? 'FF047857' : 'FF0F172A' },
    };
    row.getCell(2).font = { size: 11, name: 'Calibri', color: { argb: 'FF475569' } };
    row.getCell(1).alignment = { vertical: 'top', wrapText: true, horizontal: 'left' };
    row.getCell(2).alignment = { vertical: 'top', wrapText: true, horizontal: 'left' };
    if (a === '' && b === '') {
      row.height = 10;
    } else if (b.length > 120) {
      row.height = undefined;
    } else {
      row.height = 22;
    }
    const zebra = rowIndex % 2 === 0;
    if (zebra && a) {
      row.getCell(1).fill = ZEBRA_FILL;
      row.getCell(2).fill = ZEBRA_FILL;
    }
    row.getCell(1).border = BORDER_LIGHT;
    row.getCell(2).border = BORDER_LIGHT;
    rowIndex++;
  }
  ws.getColumn(1).width = 30;
  ws.getColumn(2).width = 96;
}

/**
 * Download a styled workbook (upload to Google Sheets / Excel).
 */
export async function exportFinanzamtWorkbook(
  items: InventoryItem[],
  expenses: Expense[],
  options?: {
    companyName?: string;
    /** Inclusive YYYY-MM-DD; omit or null = export all data */
    dateRange?: DateBounds | null;
    /** Shown on the Anleitung sheet (German, full sentence) */
    dateRangeDescription?: string;
  }
): Promise<void> {
  const exportedAt = new Date().toISOString();
  const companyName = options?.companyName?.trim() || '';
  const bounds = options?.dateRange ?? null;
  const exportItems = bounds ? filterInventoryForFinanzamtRange(items, bounds) : items;
  const exportExpenses = bounds ? filterExpensesForRange(expenses, bounds) : expenses;
  const periodNote =
    options?.dateRangeDescription ??
    (bounds
      ? `${formatBoundsGerman(bounds)} — gefiltert nach Einkaufs-, Verkaufs- bzw. Container-Verkaufsdatum (Ware) und Buchungsdatum (Ausgaben).`
      : 'Alle Daten — kein Datumsfilter.');

  const wb = new ExcelJS.Workbook();
  wb.creator = 'DeInventory';
  wb.created = new Date();

  buildAnleitungSheet(wb, companyName, exportedAt, periodNote);

  const wareRows = buildFinanzamtWareRows(exportItems);
  const wareHeaders = WARE_HEADER_ORDER.map(String);
  const wareData = wareRows.map(wareRowToArray);
  const wareMoneyIdx = [7, 8, 9, 10];
  addStyledTableSheet(
    wb,
    SHEET_WARE,
    wareHeaders,
    wareData,
    wareMoneyIdx,
    [16, 28, 14, 14, 14, 12, 12, 12, 12, 12, 12, 22, 40, 48, 14, 18, 16, 14, 22, 36]
  );

  const paketRows = buildFinanzamtPaketSummaryRows(exportItems);
  const paketHeaders = PAKET_HEADER_ORDER.map(String);
  const paketData = paketRows.map(paketRowToArray);
  addStyledTableSheet(
    wb,
    SHEET_PAKETE,
    paketHeaders,
    paketData,
    [5, 6],
    [28, 12, 14, 10, 56, 14, 14, 12, 52]
  );

  const ausRows = buildAusgabenRows(exportExpenses);
  const ausHeaders =
    ausRows.length > 0
      ? ['Datum', 'Beschreibung', 'Betrag_EUR', 'Kategorie', 'Beleg_URL', 'Dateiname_Beleg']
      : ['Hinweis'];
  const ausData =
    ausRows.length > 0
      ? ausRows.map((r) => [
          r.Datum,
          r.Beschreibung,
          typeof r.Betrag_EUR === 'number' ? r.Betrag_EUR : null,
          r.Kategorie,
          r.Beleg_URL || null,
          r.Dateiname_Beleg || null,
        ])
      : [['Keine Ausgaben erfasst.', null, null, null, null, null]];
  addStyledTableSheet(wb, SHEET_AUSGABEN, ausHeaders, ausData, ausRows.length > 0 ? [2] : [], [12, 40, 14, 18, 48, 24]);

  const date = new Date().toISOString().slice(0, 10);
  const fileStem = bounds ? `Finanzamt-Export-${formatBoundsForFilename(bounds)}` : `Finanzamt-Export-${date}`;
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileStem}.xlsx`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
