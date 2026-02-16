
import React, { useState, useEffect } from 'react';
import { InventoryItem, BusinessSettings, CustomerInfo } from '../types';
import { X, Printer, Edit2, Check, User, MapPin, Phone, Info, CreditCard, Receipt } from 'lucide-react';

interface Props {
  items: InventoryItem[];
  business: BusinessSettings;
  type: 'FINAL' | 'PAYMENT_REQUEST';
  onClose: () => void;
}

const InvoiceGenerator: React.FC<Props> = ({ items, business, type, onClose }) => {
  const invoiceDateStr = new Date().toISOString().split('T')[0];
  
  const [editableBusiness, setEditableBusiness] = useState<BusinessSettings>(business);
  const [customer, setCustomer] = useState<CustomerInfo>(() => {
    // If multiple items, try to find the first with customer info
    const firstWithCustomer = items.find(i => i.customer?.name);
    return firstWithCustomer?.customer || { name: 'Customer Name', address: 'Customer Address' };
  });
  
  const [invoiceMetadata, setInvoiceMetadata] = useState({
    number: `RE-${invoiceDateStr.replace(/-/g, '')}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`,
    date: invoiceDateStr,
    performanceDate: invoiceDateStr, // Leistungsdatum
    paymentDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] // 7 days
  });

  const [activeEditField, setActiveEditField] = useState<string | null>(null);

  // Math Logic for VAT Extraction
  // Stored price is always considered GROSS (Total)
  const totalGross = items.reduce((acc, i) => acc + (i.sellPrice || 0), 0);
  
  let netTotal = totalGross;
  let vatAmount = 0;
  
  if (editableBusiness.taxMode === 'RegularVAT') {
     // Extract 19% VAT from Gross
     netTotal = totalGross / 1.19;
     vatAmount = totalGross - netTotal;
  }

  const handlePrint = () => {
    window.print();
  };

  const renderEditable = (id: string, value: string, onUpdate: (v: string) => void, type: 'text' | 'textarea' = 'text') => {
    if (activeEditField === id) {
      return (
        <div className="flex items-center gap-2 group animate-in fade-in">
           {type === 'text' ? (
             <input autoFocus className="border-b-2 border-blue-500 outline-none p-1 font-bold text-slate-900 bg-blue-50/50" value={value} onChange={e => onUpdate(e.target.value)} onBlur={() => setActiveEditField(null)} />
           ) : (
             <textarea autoFocus rows={3} className="border-b-2 border-blue-500 outline-none p-1 font-bold text-slate-900 bg-blue-50/50 w-full" value={value} onChange={e => onUpdate(e.target.value)} onBlur={() => setActiveEditField(null)} />
           )}
           <button onClick={() => setActiveEditField(null)} className="p-1 bg-emerald-500 text-white rounded"><Check size={12}/></button>
        </div>
      );
    }
    return (
      <div onClick={() => setActiveEditField(id)} className="cursor-pointer hover:bg-slate-50 transition-colors border-b border-transparent hover:border-slate-200 group flex items-center gap-2">
         {value || <span className="text-red-400 italic print:hidden">Click to edit</span>}
         <Edit2 size={10} className="opacity-0 group-hover:opacity-40 print:hidden" />
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[500] bg-slate-900/90 backdrop-blur-xl flex items-center justify-center p-4">
      <style>
        {`
          @media print {
            body * {
              visibility: hidden;
            }
            #invoice-printable, #invoice-printable * {
              visibility: visible;
            }
            #invoice-printable {
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
            /* Hide scrollbars in print */
            ::-webkit-scrollbar { display: none; }
          }
        `}
      </style>
      <div id="invoice-printable" className="bg-white w-full max-w-[900px] h-[95vh] overflow-y-auto rounded-[3rem] shadow-2xl flex flex-col scrollbar-hide animate-in zoom-in-95 duration-500">
        
        <header className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 print:hidden shrink-0">
           <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg ${type === 'FINAL' ? 'bg-emerald-600 shadow-emerald-200' : 'bg-blue-600 shadow-blue-200'}`}>
                 {type === 'FINAL' ? <Receipt size={24} className="text-white"/> : <CreditCard size={24} className="text-white"/>}
              </div>
              <div>
                 <h2 className="text-xl font-black text-slate-900 tracking-tight">{type === 'FINAL' ? 'Professional Invoice' : 'Payment Request'}</h2>
                 <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest italic">WYSIWYG Interactive Editor</p>
              </div>
           </div>
           <div className="flex gap-2">
              <button onClick={handlePrint} className="flex items-center gap-3 px-8 py-3 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all shadow-xl">
                <Printer size={18}/> Generate PDF
              </button>
              <button onClick={onClose} className="p-3 bg-white text-slate-500 rounded-2xl hover:shadow-md transition-all border border-slate-100"><X size={24}/></button>
           </div>
        </header>

        <div className="p-16 print:p-12 space-y-12 flex-1 relative h-auto">
           
           {/* Seller Header */}
           <div className="flex justify-between items-start">
              <div className="space-y-1">
                 <div className="text-3xl font-black text-slate-900 uppercase tracking-tighter">
                   {renderEditable('biz-name', editableBusiness.companyName || editableBusiness.ownerName, v => setEditableBusiness({...editableBusiness, companyName: v}))}
                 </div>
                 <div className="text-xs text-slate-500 whitespace-pre-line leading-relaxed max-w-xs">
                   {renderEditable('biz-addr', editableBusiness.address, v => setEditableBusiness({...editableBusiness, address: v}), 'textarea')}
                 </div>
                 <div className="text-xs text-slate-500 flex items-center gap-2 pt-2">
                    <Phone size={10} className="text-blue-500" />
                    {renderEditable('biz-phone', editableBusiness.phone, v => setEditableBusiness({...editableBusiness, phone: v}))}
                 </div>
              </div>
              <div className="text-right">
                 <h2 className="text-4xl font-black text-slate-900 mb-4 tracking-tight">{type === 'FINAL' ? 'RECHNUNG' : 'VORAB-RECHNUNG'}</h2>
                 <div className="space-y-1 text-right">
                    <div className="flex items-center justify-end gap-2 text-xs font-bold text-slate-400">
                       <span>Rechnungs-Nr.:</span>
                       <div className="text-slate-900">{renderEditable('inv-num', invoiceMetadata.number, v => setInvoiceMetadata({...invoiceMetadata, number: v}))}</div>
                    </div>
                    <div className="flex items-center justify-end gap-2 text-xs font-bold text-slate-400">
                       <span>Datum:</span>
                       <div className="text-slate-900">{renderEditable('inv-date', invoiceMetadata.date, v => setInvoiceMetadata({...invoiceMetadata, date: v}))}</div>
                    </div>
                    <div className="flex items-center justify-end gap-2 text-xs font-bold text-slate-400">
                       <span>Leistungsdatum:</span>
                       <div className="text-slate-900">{renderEditable('inv-pdate', invoiceMetadata.performanceDate, v => setInvoiceMetadata({...invoiceMetadata, performanceDate: v}))}</div>
                    </div>
                 </div>
              </div>
           </div>

           {/* Buyer Address Section */}
           <div className="flex gap-16">
              <div className="w-1/2">
                 <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-4 flex items-center gap-2"><User size={12}/> Rechnungsempfänger:</p>
                 <div className="p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100 print:bg-transparent print:border-none print:p-0">
                    <div className="text-sm font-black text-slate-900 mb-1">
                      {renderEditable('cust-name', customer.name, v => setCustomer({...customer, name: v}))}
                    </div>
                    <div className="text-xs text-slate-500 whitespace-pre-line leading-relaxed">
                      {renderEditable('cust-addr', customer.address, v => setCustomer({...customer, address: v}), 'textarea')}
                    </div>
                    <div className="text-xs text-slate-500 mt-4 flex items-center gap-2">
                       <Phone size={10} className="text-slate-300" />
                       {renderEditable('cust-phone', customer.phone || 'Telefon hinzufügen', v => setCustomer({...customer, phone: v}))}
                    </div>
                 </div>
              </div>

              {type === 'PAYMENT_REQUEST' && (
                 <div className="w-1/2 flex items-center p-8 bg-blue-50 rounded-[2.5rem] border border-blue-100 print:border-slate-100">
                    <div className="space-y-2">
                       <div className="flex items-center gap-2 text-blue-600 mb-2">
                          <Info size={18}/>
                          <span className="text-[10px] font-black uppercase tracking-widest">Bitte beachten</span>
                       </div>
                       <p className="text-xs text-blue-800 font-bold leading-tight">Zahlbar innerhalb von 7 Tagen per Banküberweisung.</p>
                       <p className="text-[10px] text-blue-500 uppercase font-black">Fälligkeitsdatum: {invoiceMetadata.paymentDeadline}</p>
                    </div>
                 </div>
              )}
           </div>

           {/* Table of Positions */}
           <div className="border-t-2 border-slate-900 pt-8">
              <table className="w-full text-left">
                 <thead>
                    <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">
                       <th className="pb-4">Position / Artikelbeschreibung</th>
                       <th className="pb-4 text-center">Menge</th>
                       <th className="pb-4 text-right">Einzelpreis {editableBusiness.taxMode === 'RegularVAT' ? '(Netto)' : ''}</th>
                       <th className="pb-4 text-right">Gesamt {editableBusiness.taxMode === 'RegularVAT' ? '(Netto)' : ''}</th>
                    </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-50">
                    {items.map((item, index) => {
                      const itemGross = item.sellPrice || 0;
                      // Back-calculate Net from Gross for line item display
                      const itemNet = editableBusiness.taxMode === 'RegularVAT' ? itemGross / 1.19 : itemGross;
                      return (
                        <tr key={item.id} className="text-sm">
                          <td className="py-6 pr-4">
                             <p className="font-black text-slate-900">{item.name}</p>
                             <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">Ref-ID: {item.id.slice(-6).toUpperCase()}</p>
                          </td>
                          <td className="py-6 text-center font-bold">1</td>
                          <td className="py-6 text-right font-bold">€{itemNet.toFixed(2)}</td>
                          <td className="py-6 text-right font-black">€{itemNet.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                 </tbody>
              </table>
           </div>

           {/* Calculation Summary */}
           <div className="flex justify-end pt-8">
              <div className="w-80 space-y-4">
                 <div className="flex justify-between text-xs font-bold text-slate-400">
                    <span>Zwischensumme {editableBusiness.taxMode === 'RegularVAT' ? '(Netto)' : ''}:</span>
                    <span>€{netTotal.toFixed(2)}</span>
                 </div>
                 {editableBusiness.taxMode === 'RegularVAT' && (
                    <div className="flex justify-between text-xs font-bold text-slate-400">
                       <span>Umsatzsteuer (19%):</span>
                       <span>€{vatAmount.toFixed(2)}</span>
                    </div>
                 )}
                 <div className="flex justify-between items-center pt-5 border-t-2 border-slate-900">
                    <span className="text-sm font-black text-slate-900">RECHNUNGSBETRAG:</span>
                    <span className="text-3xl font-black text-slate-900">€{totalGross.toFixed(2)}</span>
                 </div>
              </div>
           </div>

           {/* Legal & Payment Details Footer */}
           <div className="pt-16 space-y-8 border-t border-slate-50">
              <div className="text-[10px] text-slate-400 leading-relaxed italic">
                {editableBusiness.taxMode === 'SmallBusiness' && (
                  <p>Gemäß § 19 UStG (Kleinunternehmerregelung) wird keine Umsatzsteuer berechnet.</p>
                )}
                {editableBusiness.taxMode === 'DifferentialVAT' && (
                  <p>Differenzbesteuerung gemäß § 25a UStG. Die Umsatzsteuer wird nicht gesondert ausgewiesen.</p>
                )}
                {type === 'PAYMENT_REQUEST' && (
                  <p className="mt-2 text-blue-600 font-bold not-italic">Bitte geben Sie bei der Überweisung die Rechnungsnummer "{invoiceMetadata.number}" als Verwendungszweck an.</p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-8 text-[10px] text-slate-400 font-bold not-italic">
                 <div className="space-y-1.5 p-6 bg-slate-50 rounded-2xl print:bg-transparent print:p-0">
                    <p className="text-slate-900 font-black uppercase tracking-widest mb-2">Steuerdetails:</p>
                    <div className="flex justify-between">
                       <span>Steuer-Nr:</span>
                       <span className="text-slate-700">{renderEditable('biz-taxid', editableBusiness.taxId, v => setEditableBusiness({...editableBusiness, taxId: v}))}</span>
                    </div>
                    {editableBusiness.vatId && (
                      <div className="flex justify-between">
                         <span>USt-IdNr:</span>
                         <span className="text-slate-700">{renderEditable('biz-vatid', editableBusiness.vatId, v => setEditableBusiness({...editableBusiness, vatId: v}))}</span>
                      </div>
                    )}
                 </div>

                 <div className="space-y-1.5 p-6 bg-blue-50/50 rounded-2xl border border-blue-100 print:bg-transparent print:p-0">
                    <p className="text-blue-600 font-black uppercase tracking-widest mb-2">Bankverbindung:</p>
                    <div className="flex justify-between">
                       <span>Bank:</span>
                       <span className="text-slate-700">{renderEditable('biz-bank', editableBusiness.bankName, v => setEditableBusiness({...editableBusiness, bankName: v}))}</span>
                    </div>
                    <div className="flex justify-between">
                       <span>IBAN:</span>
                       <span className="text-slate-700 font-mono">{renderEditable('biz-iban', editableBusiness.iban, v => setEditableBusiness({...editableBusiness, iban: v}))}</span>
                    </div>
                    <div className="flex justify-between">
                       <span>BIC:</span>
                       <span className="text-slate-700 font-mono">{renderEditable('biz-bic', editableBusiness.bic, v => setEditableBusiness({...editableBusiness, bic: v}))}</span>
                    </div>
                 </div>

                 <div className="space-y-1.5 p-6 text-right">
                    <p className="text-slate-900 font-black uppercase tracking-widest mb-2">Kontakt:</p>
                    <p className="text-slate-700">{editableBusiness.ownerName}</p>
                    <p className="text-slate-700">{editableBusiness.phone}</p>
                 </div>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default InvoiceGenerator;
