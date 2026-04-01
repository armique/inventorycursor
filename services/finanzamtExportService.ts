/**
 * Finanzamt-oriented export: multi-sheet workbook (Excel .xlsx) that opens in Google Sheets
 * via File → Upload. German column labels; bundles/PCs explained without double-counting revenue.
 */
import * as XLSX from 'xlsx';
import { Expense, InventoryItem, ItemStatus } from '../types';

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function getChildren(container: InventoryItem, items: InventoryItem[]): InventoryItem[] {
  const byIds = (container.componentIds || [])
    .map((id) => items.find((i) => i.id === id))
    .filter((x): x is InventoryItem => !!x);
  if (byIds.length > 0) return byIds;
  return items.filter((i) => i.parentContainerId === container.id);
}

/** Sold bundle/PC where the app stores revenue on each component (proportional split). */
function isSoldWithProportionalChildren(container: InventoryItem, items: InventoryItem[]): boolean {
  if (!container.isBundle && !container.isPC) return false;
  const children = getChildren(container, items);
  if (children.length === 0) return false;
  if (container.status !== ItemStatus.SOLD) return false;
  return children.every((c) => c.status === ItemStatus.SOLD && !!c.sellDate);
}

/** Skip the empty "container" row when children carry all sell prices and profit. */
function shouldSkipContainerRow(item: InventoryItem, items: InventoryItem[]): boolean {
  return isSoldWithProportionalChildren(item, items);
}

/** Component still inside an unsold bundle/PC — shown only on the Paket row, not as separate stock lines. */
function shouldSkipCompositionChild(item: InventoryItem, items: InventoryItem[]): boolean {
  if (item.status !== ItemStatus.IN_COMPOSITION) return false;
  if (!item.parentContainerId) return false;
  const p = items.find((i) => i.id === item.parentContainerId);
  if (!p || (!p.isBundle && !p.isPC)) return false;
  return true;
}

/** Retro or manual bundle: parent holds sale; children stay "In Composition". */
function isBundleSoldOnParentOnly(parent: InventoryItem, items: InventoryItem[]): boolean {
  if (!parent.isBundle && !parent.isPC) return false;
  if (parent.status !== ItemStatus.SOLD) return false;
  const children = getChildren(parent, items);
  if (children.length === 0) return false;
  return children.some((c) => c.status === ItemStatus.IN_COMPOSITION);
}

function formatStückliste(children: InventoryItem[]): string {
  return children.map((c, i) => `${i + 1}. ${c.name} (ID: ${c.id})`).join(' | ');
}

export type FinanzamtWareRow = {
  Zeilenart: string;
  Bezeichnung: string;
  Interne_ID: string;
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
  Paket_ID: string;
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
  ctx: { paketName: string; paketId: string; rolle: string; stückliste: string }
): FinanzamtWareRow {
  const parent = item.parentContainerId ? items.find((i) => i.id === item.parentContainerId) : undefined;
  const paketFromParent = parent && (parent.isBundle || parent.isPC) ? parent.name : '';
  const paketIdFromParent = parent && (parent.isBundle || parent.isPC) ? parent.id : '';

  let paketName = ctx.paketName || paketFromParent;
  let paketId = ctx.paketId || paketIdFromParent;
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
    Interne_ID: item.id,
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
    Paket_ID: paketId,
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
    let paketId = '';
    let stückliste = '';

    if (parent && (parent.isBundle || parent.isPC)) {
      paketName = parent.name;
      paketId = parent.id;
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

    rows.push(buildWareRow(item, list, { paketName, paketId, rolle, stückliste }));
  }

  return rows;
}

export type FinanzamtPaketRow = {
  Paket_ID: string;
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
      Paket_ID: parent.id,
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
    Wiederkehrend_ID: e.recurringExpenseId || '',
    Beleg_URL: e.attachmentUrl || '',
    Dateiname_Beleg: e.attachmentName || '',
  }));
}

function instructionSheetRows(companyName: string, exportedAt: string): string[][] {
  return [
    ['Finanzamt-Export — Kurzanleitung'],
    [''],
    ['Erstellt am (UTC):', exportedAt],
    ['Firma / Name (aus App-Einstellungen):', companyName || '—'],
    [''],
    ['Blätter in dieser Datei'],
    ['1) Anleitung', 'Diese Übersicht.'],
    ['2) Ware_Buchungen', 'Alle buchungsrelevanten Positionen: Bestand, verkaufte Einzelteile, Pakete.'],
    ['3) Pakete_Uebersicht', 'Eine Zeile pro Paket/PC mit Stückliste und Hinweis, wie der Verkauf in den Daten gebucht ist.'],
    ['4) Betriebsausgaben', 'Ihre erfassten Ausgaben inkl. Kategorie und optional Beleg-Link.'],
    [''],
    ['Wichtig: Pakete und PCs'],
    [
      'Wenn Sie ein Paket über den Verkaufsdialog verkaufen, verteilt die App den Verkaufspreis und die Gebühren anteilig auf die Komponenten (nach Verhältnis der Einkaufspreise). Im Export erscheinen dann die KOMPONENTENZEILEN mit Verkaufspreis und Gewinn; die leere Paket-Hülle wird weggelassen, damit Sie den Umsatz nicht doppelt zählen.',
    ],
    [
      'Wenn Sie ein Paket nachträglich (Retro-Bundle) als einen Verkauf erfassen, stehen Umsatz und Gewinn auf der PAKETZEILE; die Komponenten bleiben „Im Paket“ und erscheinen nicht als eigene Verkaufszeilen.',
    ],
    ['Die Spalte „Rolle_im_Paket“ und „Stückliste_Komponenten“ erklärt jede Zeile.'],
    [''],
    ['Spalten Ware_Buchungen (Auszug)'],
    ['Bezeichnung', 'Artikelbezeichnung wie in der App.'],
    ['Einkaufsdatum / Verkaufsdatum', 'Nachweis Zeitraum; leer, wenn noch nicht verkauft.'],
    ['Einkaufspreis_EUR / Verkaufspreis_EUR', 'Netto-Beträge wie erfasst (Steuerlogik bitte mit Steuerberater abstimmen).'],
    ['Gebühren_Verkauf_EUR', 'z. B. Marktplatzgebühren, auf die Komponente oder das Paket verteilt.'],
    ['Gewinn_EUR', 'Wie in der App berechnet (Verkauf − EK − Gebühr, falls erfasst).'],
    ['Paket_oder_PC / Paket_ID', 'Zuordnung zum übergeordneten Paket, falls zutreffend.'],
    [''],
    ['Google Sheets'],
    [
      'Diese Datei ist .xlsx. In Google Drive: „Neu“ → „Datei hochladen“, dann mit Google Tabellen öffnen. Kein Google-Konto in der App nötig.',
    ],
    [''],
    ['Hinweis'],
    [
      'Dieses Export ist eine strukturierte Übersicht Ihrer App-Daten. Für steuerliche Bewertung (Kleinunternehmer, Differenzbesteuerung usw.) ist Ihr Steuerberater zuständig.',
    ],
  ];
}

/**
 * Download a workbook suitable for upload to Google Sheets.
 */
export function exportFinanzamtWorkbook(
  items: InventoryItem[],
  expenses: Expense[],
  options?: { companyName?: string }
): void {
  const exportedAt = new Date().toISOString();
  const companyName = options?.companyName?.trim() || '';

  const wb = XLSX.utils.book_new();

  const instr = instructionSheetRows(companyName, exportedAt);
  const wsInstr = XLSX.utils.aoa_to_sheet(instr);
  wsInstr['!cols'] = [{ wch: 28 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, wsInstr, SHEET_ANLEITUNG);

  const wareRows = buildFinanzamtWareRows(items);
  const wsWare = XLSX.utils.json_to_sheet(wareRows);
  wsWare['!cols'] = Array(20).fill({ wch: 14 });
  XLSX.utils.book_append_sheet(wb, wsWare, SHEET_WARE);

  const paketRows = buildFinanzamtPaketSummaryRows(items);
  const wsPaket = XLSX.utils.json_to_sheet(paketRows);
  wsPaket['!cols'] = [{ wch: 14 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 80 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsPaket, SHEET_PAKETE);

  const ausRows = buildAusgabenRows(expenses);
  const wsAus =
    ausRows.length > 0
      ? XLSX.utils.json_to_sheet(ausRows)
      : XLSX.utils.json_to_sheet([{ Hinweis: 'Keine Ausgaben erfasst.' }]);
  wsAus['!cols'] = [{ wch: 12 }, { wch: 36 }, { wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 40 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, wsAus, SHEET_AUSGABEN);

  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Finanzamt-Export-${date}.xlsx`);
}
