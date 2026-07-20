import React from 'react';
import { Link } from 'react-router-dom';
import {
  Boxes,
  FileSpreadsheet,
  History,
  Images,
  LayoutTemplate,
  Monitor,
  Package,
  PackageSearch,
  Plus,
  Printer,
  Receipt,
  Settings,
  Trash2,
  X,
} from 'lucide-react';

/** Full-screen dim + bottom sheet chrome for mobile IA. */
export const MobileSheetShell: React.FC<{
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ open, title, subtitle, onClose, children }) => {
  if (!open) return null;
  return (
    <div className="md:hidden fixed inset-0 z-[200] flex flex-col justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className="relative bg-white rounded-t-[1.75rem] border border-slate-200 shadow-2xl max-h-[min(88dvh,720px)] flex flex-col pb-safe animate-in slide-in-from-bottom duration-300"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex justify-center pt-2.5 pb-1">
          <span className="w-10 h-1 rounded-full bg-slate-200" />
        </div>
        <div className="px-4 pb-3 flex items-start justify-between gap-3 border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="text-base font-black text-slate-900 tracking-tight">{title}</h2>
            {subtitle && <p className="text-[11px] text-slate-500 font-medium mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 shrink-0"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0 px-3 py-3">{children}</div>
      </div>
    </div>
  );
};

const SheetLink: React.FC<{
  to: string;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onNavigate: () => void;
  accent?: string;
}> = ({ to, icon, label, hint, onNavigate, accent = 'bg-slate-100 text-slate-700' }) => (
  <Link
    to={to}
    onClick={onNavigate}
    className="flex items-center gap-3 w-full rounded-2xl border border-slate-100 bg-white px-3.5 py-3 active:scale-[0.99] transition"
  >
    <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${accent}`}>{icon}</span>
    <span className="min-w-0 flex-1 text-left">
      <span className="block text-sm font-bold text-slate-900">{label}</span>
      {hint && <span className="block text-[11px] text-slate-500 font-medium">{hint}</span>}
    </span>
  </Link>
);

export const MobileAddSheet: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => (
  <MobileSheetShell
    open={open}
    title="Add to inventory"
    subtitle="Same create flows as on desktop"
    onClose={onClose}
  >
    <div className="space-y-2">
      <SheetLink
        to="/panel/add"
        icon={<Plus size={18} />}
        label="Single item"
        hint="One product with photos & specs"
        onNavigate={onClose}
        accent="bg-emerald-50 text-emerald-700"
      />
      <SheetLink
        to="/panel/builder?type=pc"
        icon={<Monitor size={18} />}
        label="PC Build"
        hint="Compose a finished PC from parts"
        onNavigate={onClose}
        accent="bg-indigo-50 text-indigo-700"
      />
      <SheetLink
        to="/panel/builder?type=bundle"
        icon={<Boxes size={18} />}
        label="Bundle"
        hint="Group components into a bundle"
        onNavigate={onClose}
        accent="bg-violet-50 text-violet-700"
      />
      <SheetLink
        to="/panel/builder?type=mixed"
        icon={<Package size={18} />}
        label="Mixed Bundle"
        hint="Mixed category bundle"
        onNavigate={onClose}
        accent="bg-amber-50 text-amber-800"
      />
      <SheetLink
        to="/panel/add-bulk"
        icon={<PackageSearch size={18} />}
        label="Bulk Entry"
        hint="Paste many items at once"
        onNavigate={onClose}
        accent="bg-sky-50 text-sky-700"
      />
    </div>
  </MobileSheetShell>
);

export const MobileMoreSheet: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => (
  <MobileSheetShell
    open={open}
    title="More"
    subtitle="Tools & destinations from the desktop sidebar"
    onClose={onClose}
  >
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="px-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Selling</p>
        <SheetLink
          to="/panel/ebay-store-pull"
          icon={<PackageSearch size={18} />}
          label="eBay Tools"
          hint="Orders, sold sync, store pull"
          onNavigate={onClose}
          accent="bg-blue-50 text-blue-700"
        />
        <SheetLink
          to="/panel/card-gallery"
          icon={<Images size={18} />}
          label="Card gallery"
          hint="AI product cards"
          onNavigate={onClose}
          accent="bg-emerald-50 text-emerald-700"
        />
        <SheetLink
          to="/panel/store-management"
          icon={<LayoutTemplate size={18} />}
          label="Store"
          hint="Storefront catalog"
          onNavigate={onClose}
        />
        <SheetLink
          to="/panel/invoices"
          icon={<Receipt size={18} />}
          label="Invoices"
          onNavigate={onClose}
        />
      </div>
      <div className="space-y-2">
        <p className="px-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Ops</p>
        <SheetLink
          to="/panel/bulk-imports"
          icon={<History size={18} />}
          label="Bulk imports"
          onNavigate={onClose}
        />
        <SheetLink
          to="/panel/expenses"
          icon={<Receipt size={18} />}
          label="Expenses"
          onNavigate={onClose}
        />
        <SheetLink
          to="/panel/3d-print"
          icon={<Printer size={18} />}
          label="3D Print"
          onNavigate={onClose}
        />
        <SheetLink
          to="/panel/import"
          icon={<FileSpreadsheet size={18} />}
          label="Import CSV"
          onNavigate={onClose}
        />
        <SheetLink
          to="/panel/action-history"
          icon={<History size={18} />}
          label="Action history"
          onNavigate={onClose}
        />
        <SheetLink
          to="/panel/trash"
          icon={<Trash2 size={18} />}
          label="Trash"
          onNavigate={onClose}
          accent="bg-rose-50 text-rose-700"
        />
        <SheetLink
          to="/panel/settings"
          icon={<Settings size={18} />}
          label="Settings"
          onNavigate={onClose}
        />
      </div>
    </div>
  </MobileSheetShell>
);
