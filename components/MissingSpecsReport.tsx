import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, AlertCircle, ChevronRight } from 'lucide-react';
import { InventoryItem } from '../types';

interface Props {
  items: InventoryItem[];
  categoryFields: Record<string, string[]>;
}

interface MissingSpecItem {
  item: InventoryItem;
  missingFields: string[];
}

export const MissingSpecsReport: React.FC<Props> = ({ items, categoryFields }) => {
  const navigate = useNavigate();

  const missingSpecsList = useMemo((): MissingSpecItem[] => {
    const result: MissingSpecItem[] = [];
    items.forEach((item) => {
      const key = `${item.category}:${item.subCategory || ''}`;
      const fields = categoryFields[key] || categoryFields[item.category || ''] || [];
      const missing: string[] = [];
      fields.forEach((field) => {
        const val = item.specs?.[field];
        if (val === undefined || val === null || String(val).trim() === '') missing.push(field);
      });
      if (missing.length > 0) result.push({ item, missingFields: missing });
    });
    return result.sort((a, b) => b.missingFields.length - a.missingFields.length);
  }, [items, categoryFields]);

  return (
    <div className="space-y-6 animate-in fade-in pb-20">
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-2xl bg-amber-100 text-amber-600">
          <AlertCircle size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Missing key specs</h1>
          <p className="text-sm text-slate-500">Items that are missing one or more recommended specs for their category.</p>
        </div>
      </div>

      {missingSpecsList.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center">
          <FileText size={48} className="mx-auto text-slate-300 mb-3" />
          <p className="font-medium text-slate-600">No items missing key specs.</p>
          <p className="text-sm text-slate-400 mt-1">All items have their category fields filled.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-bold uppercase text-slate-500">
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Missing fields</th>
                <th className="px-4 py-3 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {missingSpecsList.map(({ item, missingFields }) => (
                <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-slate-900">{item.name}</td>
                  <td className="px-4 py-3 text-slate-600">{item.category}{item.subCategory ? ` · ${item.subCategory}` : ''}</td>
                  <td className="px-4 py-3">
                    <span className="text-amber-700 font-medium">{missingFields.join(', ')}</span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => navigate(`/panel/edit/${item.id}`)}
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Edit <ChevronRight size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default MissingSpecsReport;
