
import React from 'react';
import { InventoryItem, BusinessSettings } from '../types';
import { X, Printer, Download } from 'lucide-react';

interface Props {
  item: InventoryItem;
  business: BusinessSettings;
  onClose: () => void;
}

const InvoiceView: React.FC<Props> = ({ item, business, onClose }) => {
  const invoiceDate = item.sellDate || new Date().toISOString().split('T')[0];
  const rechnungsNummer = item.invoiceNumber || `RE-${invoiceDate.replace(/-/g, '')}-${item.id.slice(-4).toUpperCase()}`;

  const totalGross = item.sellPrice || 0;
  
  let subTotal = totalGross;
  let vatAmount = 0;

  if (business.taxMode === 'RegularVAT') {
     subTotal = totalGross / 1.19;
     vatAmount = totalGross - subTotal;
  }

  const handlePrint = () => {
    window.print();
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
            @page { margin: 0; size: auto; }
            ::-webkit-scrollbar { display: none; }
          }
        `}
      </style>
      <div id="invoice-view-printable" className="bg-white w-full max-w-[800px] h-[95vh] overflow-y-auto rounded-[2rem] shadow-2xl flex flex-col scrollbar-hide">
        <header className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 print:hidden">
           <h2 className="text-xl font-black uppercase tracking-widest text-slate-900">Invoice Preview</h2>
           <div className="flex gap-2">
              <button onClick={handlePrint} className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all">
                <Printer size={16}/> Print PDF
              </button>
              <button onClick={onClose} className="p-2.5 bg-slate-100 text-slate-500 rounded-xl hover:bg-slate-200 transition-all"><X size={20}/></button>
           </div>
        </header>

        <div className="p-16 print:p-12 space-y-12 flex-1">
           {/* Invoice Header */}
           <div className="flex justify-between items-start">
              <div className="space-y-2">
                 <h1 className="text-3xl font-black tracking-tighter text-slate-900 uppercase">{business.companyName || business.ownerName}</h1>
                 <p className="text-xs text-slate-500 whitespace-pre-line leading-relaxed">{business.address}</p>
              </div>
              <div className="text-right">
                 <h2 className="text-2xl font-black text-slate-900 mb-2">RECHNUNG</h2>
                 <p className="text-xs font-bold text-slate-400">Nr: {rechnungsNummer}</p>
                 <p className="text-xs font-bold text-slate-400">Datum: {invoiceDate}</p>
              </div>
           </div>

           {/* Customer Details */}
           <div className="w-1/2">
              <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-4">Empfänger:</p>
              <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 print:bg-transparent print:border-none print:p-0">
                 <p className="text-sm font-black text-slate-900">{item.customer?.name || 'Kunde'}</p>
                 <p className="text-xs text-slate-500 whitespace-pre-line mt-1">{item.customer?.address || 'Keine Adresse hinterlegt'}</p>
              </div>
           </div>

           {/* Table */}
           <div className="border-t-2 border-slate-900 pt-8">
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
                       <td className="py-6 pr-4">
                          <p className="font-black text-slate-900">{item.name}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">{item.category} | {item.subCategory}</p>
                       </td>
                       <td className="py-6 text-center font-bold">1</td>
                       <td className="py-6 text-right font-bold">€{(business.taxMode === 'RegularVAT' ? totalGross / 1.19 : totalGross).toFixed(2)}</td>
                       <td className="py-6 text-right font-black">€{(business.taxMode === 'RegularVAT' ? totalGross / 1.19 : totalGross).toFixed(2)}</td>
                    </tr>
                 </tbody>
              </table>
           </div>

           {/* Totals */}
           <div className="flex justify-end pt-8">
              <div className="w-64 space-y-4">
                 <div className="flex justify-between text-xs font-bold text-slate-400">
                    <span>Zwischensumme {business.taxMode === 'RegularVAT' ? '(Netto)' : ''}:</span>
                    <span>€{subTotal.toFixed(2)}</span>
                 </div>
                 {business.taxMode === 'RegularVAT' && (
                    <div className="flex justify-between text-xs font-bold text-slate-400">
                       <span>Umsatzsteuer (19%):</span>
                       <span>€{vatAmount.toFixed(2)}</span>
                    </div>
                 )}
                 <div className="flex justify-between items-center pt-4 border-t-2 border-slate-900">
                    <span className="text-sm font-black text-slate-900">GESAMTBETRAG:</span>
                    <span className="text-xl font-black text-slate-900">€{totalGross.toFixed(2)}</span>
                 </div>
              </div>
           </div>

           {/* Legal Footer */}
           <div className="pt-16 space-y-4 text-[10px] text-slate-400 leading-relaxed italic border-t border-slate-50">
              {business.taxMode === 'SmallBusiness' && (
                <p>Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</p>
              )}
              {business.taxMode === 'DifferentialVAT' && (
                <p>Differenzbesteuerung gemäß § 25a UStG. Die Umsatzsteuer wird nicht gesondert ausgewiesen.</p>
              )}
              <div className="grid grid-cols-3 gap-8 pt-8 not-italic font-bold">
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
