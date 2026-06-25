/**
 * ELSTER / tax prep checklist (#64) — informational, not filing software.
 */
export type ElsterCheckItem = {
  id: string;
  label: string;
  done: boolean;
  hint: string;
};

export function buildElsterChecklist(data: {
  hasFinanzamtExport: boolean;
  hasInvoices: boolean;
  hasExpenseReceipts: boolean;
  taxMode: string;
  differentialItems: number;
}): ElsterCheckItem[] {
  return [
    {
      id: 'euer',
      label: 'EÜR / Jahresüberschuss aus App exportiert',
      done: data.hasFinanzamtExport,
      hint: 'Settings → Finanzamt → Excel export für Zeitraum',
    },
    {
      id: 'invoices',
      label: 'Rechnungen archiviert',
      done: data.hasInvoices,
      hint: 'Invoice Manager — PDF/Print pro Käufer',
    },
    {
      id: 'receipts',
      label: 'Belege zu Ausgaben',
      done: data.hasExpenseReceipts,
      hint: 'Expenses — Foto-Beleg hochladen',
    },
    {
      id: 'ust',
      label: 'USt-Modus geprüft',
      done: data.taxMode !== 'SmallBusiness',
      hint: data.taxMode === 'SmallBusiness' ? 'Kleinunternehmer §19 — keine USt in Rechnung' : 'Regelbesteuerung — UStVA beachten',
    },
    {
      id: 'diff',
      label: '§25a Differenzbesteuerung markiert',
      done: data.differentialItems === 0 || data.taxMode === 'DifferentialVAT',
      hint: `${data.differentialItems} Artikel mit Gebrauchtware-Hinweis prüfen`,
    },
    {
      id: 'elster',
      label: 'ELSTER-Zugang / Steuerberater',
      done: false,
      hint: 'Diese App ersetzt kein ELSTER — Daten an Steuerberater übergeben',
    },
  ];
}
