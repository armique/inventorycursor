
import React, { useState } from 'react';
import { InventoryItem, BusinessSettings } from '../types';
import { formatEUR } from '../utils/formatMoney';
import { getInvoiceItemAmounts } from '../utils/invoiceAmounts';
import { X, Printer, Download, Loader2 } from 'lucide-react';
import { saveInvoiceElementToPc } from '../utils/downloadInvoice';

interface Props {
  item: InventoryItem;
  business: BusinessSettings;
  onClose: () => void;
}

const InvoiceView: React.FC<Props> = ({ item, business, onClose }) => {
  const invoiceDate = item.sellDate || new Date().toISOString().split('T')[0];
  const rechnungsNummer = item.invoiceNumber || `RE-${invoiceDate.replace(/-/g, '')}-${item.id.slice(-4).toUpperCase()}`;

  const { itemGross, shippingGross, totalGross } = getInvoiceItemAmounts(item);
  
  let subTotal = itemGross;
  let vatAmount = 0;

  if (business.taxMode === 'RegularVAT') {
     subTotal = totalGross / 1.19;
     vatAmount = totalGross - subTotal;
  }

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handlePrint = () => {
    window.print();
  };

  const handleSavePdf = async () => {
    const root = document.getElementById('invoice-view-printable');
    if (!root || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveInvoiceElementToPc(root, rechnungsNummer);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'PDF speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4">
      <style>
        {`
          @media print {
            body * {
              visibility: hidden;
            }
            #invoice-view-printable, #invoice-view-printable * {
              visibility: visible;
            }
            #invoice-view-printable {
              position: absolute;
              left: 0;
              top: 0;
              width: 100%;
              height: auto !important;
              margin: 0;
              padding: 0;
              background: white;
              overflow: visible !important;
            }
            @page { margin: 10mm; size: A4; }
            ::-webkit-scrollbar { display: none; }
          }
        `}
      </style>
      <div id="invoice-view-printable" className="bg-white w-full max-w-[800px] h-[95vh] overflow-y-auto rounded-[2rem] shadow-2xl flex flex-col scrollbar-hide">
        <header data-invoice-toolbar className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 print:hidden">
           <div>
             <h2 className="text-xl font-black uppercase tracking-widest text-slate-900">Invoice Preview</h2>
             {saveError ? (
               <p className="text-[11px] font-semibold text-rose-600 mt-1">{saveError}</p>
             ) : null}
           </div>
           <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleSavePdf()}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-700 transition-all disabled:opacity-60"
                title="Rechnung als PDF auf diesem PC speichern"
              >
                {saving ? <Loader2 size={16} className="animate-spin"/> : <Download size={16}/>}
                {saving ? 'Speichern…' : 'PDF speichern'}
              </button>
              <button type="button" onClick={handlePrint} className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">
                <Printer size={16}/> Print PDF
              </button>
              <button type="button" onClick={onClose} className="p-2.5 bg-slate-100 text-slate-500 rounded-xl hover:bg-slate-200 transition-all"><X size={20}/></button>
           </div>
        </header>

        <div data-invoice-sheet className="p-8 print:p-0 space-y-6 flex-1">
           {/* Invoice Header */}
           <div className="flex justify-between items-start">
              <div className="space-y-2">
                 <h1 className="text-2xl font-black tracking-tighter text-slate-900 uppercase">{business.companyName || business.ownerName}</h1>
                 <p className="text-xs text-slate-500 whitespace-pre-line leading-relaxed">{business.address}</p>
              </div>
              <div className="text-right">
                 <h2 className="text-xl font-black text-slate-900 mb-1">RECHNUNG</h2>
                 <p className="text-xs font-bold text-slate-400">Nr: {rechnungsNummer}</p>
                 <p className="text-xs font-bold text-slate-400">Datum: {invoiceDate}</p>
              </div>
           </div>

           {/* Customer Details */}
           <div className="w-1/2">
              <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-2">Empfänger:</p>
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 print:bg-transparent print:border-none print:p-0">
                 <p className="text-sm font-black text-slate-900">{item.customer?.name || 'Kunde'}</p>
                 <p className="text-xs text-slate-500 whitespace-pre-line mt-1">{item.customer?.address || 'Keine Adresse hinterlegt'}</p>
                 {(item.ebayUsername || item.ebayOrderId) && (
                   <p className="text-[10px] text-slate-500 mt-3">
                     {[item.ebayUsername && `eBay: ${item.ebayUsername}`, item.ebayOrderId && `Bestellnr.: ${item.ebayOrderId}`]
                       .filter(Boolean)
                       .join(' • ')}
                   </p>
                 )}
              </div>
           </div>

           {/* Table */}
           <div className="border-t-2 border-slate-900 pt-4">
              <table className="w-full text-left">
                 <thead>
                    <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">
                       <th className="pb-4">Position / Beschreibung</th>
                       <th className="pb-4 text-center">Menge</th>
                       <th className="pb-4 text-right">Einzelpreis {business.taxMode === 'RegularVAT' ? '(Netto)' : ''}</th>
                       <th className="pb-4 text-right">Gesamt {business.taxMode === 'RegularVAT' ? '(Netto)' : ''}</th>
                    </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-50">
                    <tr className="text-sm">
                       <td className="py-3 pr-4">
                          <p className="font-black text-slate-900">{item.name}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">{item.category} | {item.subCategory}</p>
                       </td>
                       <td className="py-3 text-center font-bold">1</td>
                       <td className="py-3 text-right font-bold">€{formatEUR(business.taxMode === 'RegularVAT' ? itemGross / 1.19 : itemGross)}</td>
                       <td className="py-3 text-right font-black">€{formatEUR(business.taxMode === 'RegularVAT' ? itemGross / 1.19 : itemGross)}</td>
                    </tr>
                    {shippingGross > 0 && (
                    <tr className="text-sm">
                       <td className="py-3 pr-4">
                          <p className="font-black text-slate-900">Versand</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">Lieferkosten</p>
                       </td>
                       <td className="py-3 text-center font-bold">1</td>
                       <td className="py-3 text-right font-bold">€{formatEUR(business.taxMode === 'RegularVAT' ? shippingGross / 1.19 : shippingGross)}</td>
                       <td className="py-3 text-right font-black">€{formatEUR(business.taxMode === 'RegularVAT' ? shippingGross / 1.19 : shippingGross)}</td>
                    </tr>
                    )}
                 </tbody>
              </table>
           </div>

           {/* Totals */}
           <div className="flex justify-end pt-4">
              <div className="w-64 space-y-2">
                 <div className="flex justify-between text-xs font-bold text-slate-400">
                    <span>Zwischensumme {business.taxMode === 'RegularVAT' ? '(Netto)' : ''}:</span>
                    <span>€{formatEUR(business.taxMode === 'RegularVAT' ? subTotal : itemGross)}</span>
                 </div>
                 {shippingGross > 0 && business.taxMode !== 'RegularVAT' && (
                    <div className="flex justify-between text-xs font-bold text-slate-400">
                       <span>Versand:</span>
                       <span>€{formatEUR(shippingGross)}</span>
                    </div>
                 )}
                 {business.taxMode === 'RegularVAT' && (
                    <div className="flex justify-between text-xs font-bold text-slate-400">
                       <span>Umsatzsteuer (19%):</span>
                       <span>€{formatEUR(vatAmount)}</span>
                    </div>
                 )}
                 <div className="flex justify-between items-center pt-4 border-t-2 border-slate-900">
                    <span className="text-sm font-black text-slate-900">GESAMTBETRAG:</span>
                    <span className="text-xl font-black text-slate-900">€{formatEUR(totalGross)}</span>
                 </div>
              </div>
           </div>

           {/* Legal Footer */}
           <div className="pt-6 space-y-3 text-[10px] text-slate-400 leading-relaxed italic border-t border-slate-50">
              {business.taxMode === 'DifferentialVAT' && (
                <p>Differenzbesteuerung gemäß § 25a UStG. Die Umsatzsteuer wird nicht gesondert ausgewiesen.</p>
              )}
              <div className="grid grid-cols-3 gap-6 pt-4 not-italic font-bold">
                 <div className="space-y-1">
                    <p className="text-slate-900 font-black">Steuer-Infos:</p>
                    <p>St-Nr: {business.taxId}</p>
                    {business.vatId && <p>USt-IdNr: {business.vatId}</p>}
                 </div>
                 <div className="space-y-1">
                    <p className="text-slate-900 font-black">Bankverbindung:</p>
                    <p>{business.bankName}</p>
                    <p>IBAN: {business.iban}</p>
                    <p>BIC: {business.bic}</p>
                 </div>
                 <div className="text-right">
                    <p className="text-slate-900 font-black">Kontakt:</p>
                    <p>{business.ownerName}</p>
                 </div>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default InvoiceView;
