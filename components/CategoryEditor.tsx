import React, { useState } from 'react';
import {
  Layers,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Edit3,
  Check,
  X,
  Sliders,
  GripVertical,
} from 'lucide-react';
import { DEFAULT_CATEGORIES } from '../services/constants';

// Recommended spec fields for PC parts & Apple (for "Load recommended" button)
const RECOMMENDED_FIELDS: Record<string, string[]> = {
  'Components:Processors': ['Socket', 'Cores', 'Threads', 'Brand', 'Series', 'Base Clock', 'Boost Clock', 'TDP', 'L3 Cache', 'Condition', 'Warranty'],
  'Components:Motherboards': ['Socket', 'Form Factor', 'Chipset', 'Memory Type', 'Max RAM', 'WiFi', 'Condition', 'Warranty'],
  'Components:Graphics Cards': ['Chipset', 'VRAM', 'Memory Type', 'Power Connectors', 'Slot Size', 'Condition', 'Warranty'],
  'Components:RAM': ['Memory Type', 'Speed', 'Capacity', 'Modules', 'Latency', 'Condition', 'Warranty'],
  'Components:Storage (SSD/HDD)': ['Type', 'Interface', 'Capacity', 'Form Factor', 'Condition', 'Warranty'],
  'Components:Power Supplies': ['Wattage', 'Efficiency', 'Modularity', 'Condition', 'Warranty'],
  'Components:Cases': ['Form Factor', 'Color', 'Condition', 'Warranty'],
  'Components:Cooling': ['Type', 'Socket', 'TDP', 'Condition', 'Warranty'],
  'Laptops:Gaming Laptop': ['Screen Size', 'Resolution', 'Refresh Rate', 'CPU', 'GPU', 'RAM', 'Storage', 'Condition', 'Warranty'],
  'Laptops:MacBook': ['Screen Size', 'Chip', 'RAM', 'Storage', 'Year', 'Condition', 'Warranty'],
  'Laptops:Ultrabook': ['Screen Size', 'CPU', 'RAM', 'Storage', 'Condition', 'Warranty'],
  'Gadgets:Smartphones': ['Brand', 'Model', 'Storage', 'Screen Size', 'Condition', 'Warranty'],
  'Gadgets:Tablets': ['Brand', 'Model', 'Storage', 'Screen Size', 'Condition', 'Warranty'],
  'Peripherals:Monitors': ['Size', 'Resolution', 'Refresh Rate', 'Panel Type', 'Condition', 'Warranty'],
};

interface CategoryEditorProps {
  categories: Record<string, string[]>;
  categoryFields: Record<string, string[]>;
  onUpdateCategoryStructure: (newCats: Record<string, string[]>) => void;
  onUpdateCategoryFields: (newFields: Record<string, string[]>) => void;
}

const CategoryEditor: React.FC<CategoryEditorProps> = ({
  categories,
  categoryFields,
  onUpdateCategoryStructure,
  onUpdateCategoryFields,
}) => {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [selectedSubKey, setSelectedSubKey] = useState<string | null>(null); // "Category:SubCategory"
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingSub, setEditingSub] = useState<{ cat: string; sub: string } | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newSubName, setNewSubName] = useState<{ cat: string; value: string } | null>(null);
  const [newFieldName, setNewFieldName] = useState('');

  const catList = Object.keys(categories).length ? categories : DEFAULT_CATEGORIES;

  const addCategory = () => {
    const name = newCategoryName.trim();
    if (!name) return;
    if (catList[name]) return;
    onUpdateCategoryStructure({ ...catList, [name]: [] });
    setNewCategoryName('');
  };

  const removeCategory = (cat: string) => {
    if (!window.confirm(`Remove category "${cat}" and all its subcategories?`)) return;
    const next = { ...catList };
    delete next[cat];
    onUpdateCategoryStructure(next);
    const nextFields = { ...categoryFields };
    (catList[cat] || []).forEach(sub => {
      delete nextFields[`${cat}:${sub}`];
      delete nextFields[cat];
    });
    onUpdateCategoryFields(nextFields);
    if (expandedCategory === cat) setExpandedCategory(null);
    if (selectedSubKey?.startsWith(cat + ':')) setSelectedSubKey(null);
  };

  const renameCategory = (oldName: string, newName: string) => {
    const n = newName.trim();
    if (!n || n === oldName) {
      setEditingCategory(null);
      return;
    }
    const subs = catList[oldName] || [];
    const next = { ...catList };
    delete next[oldName];
    next[n] = subs;
    onUpdateCategoryStructure(next);
    const nextFields = { ...categoryFields };
    subs.forEach(sub => {
      const key = `${oldName}:${sub}`;
      if (nextFields[key]) {
        nextFields[`${n}:${sub}`] = nextFields[key];
        delete nextFields[key];
      }
    });
    if (categoryFields[oldName]) {
      nextFields[n] = categoryFields[oldName];
      delete nextFields[oldName];
    }
    onUpdateCategoryFields(nextFields);
    setEditingCategory(null);
    if (expandedCategory === oldName) setExpandedCategory(n);
  };

  const addSubcategory = (cat: string) => {
    const value = newSubName?.cat === cat ? newSubName.value.trim() : '';
    if (!value) return;
    const subs = catList[cat] || [];
    if (subs.includes(value)) return;
    onUpdateCategoryStructure({ ...catList, [cat]: [...subs, value] });
    setNewSubName(null);
  };

  const removeSubcategory = (cat: string, sub: string) => {
    if (!window.confirm(`Remove subcategory "${sub}"?`)) return;
    const subs = (catList[cat] || []).filter(s => s !== sub);
    onUpdateCategoryStructure({ ...catList, [cat]: subs });
    const key = `${cat}:${sub}`;
    const nextFields = { ...categoryFields };
    delete nextFields[key];
    onUpdateCategoryFields(nextFields);
    if (selectedSubKey === key) setSelectedSubKey(null);
  };

  const renameSubcategory = (cat: string, oldSub: string, newSub: string) => {
    const n = newSub.trim();
    if (!n || n === oldSub) {
      setEditingSub(null);
      return;
    }
    const subs = (catList[cat] || []).map(s => s === oldSub ? n : s);
    onUpdateCategoryStructure({ ...catList, [cat]: subs });
    const oldKey = `${cat}:${oldSub}`;
    const newKey = `${cat}:${n}`;
    if (categoryFields[oldKey]) {
      const nextFields = { ...categoryFields };
      nextFields[newKey] = categoryFields[oldKey];
      delete nextFields[oldKey];
      onUpdateCategoryFields(nextFields);
    }
    setEditingSub(null);
    if (selectedSubKey === oldKey) setSelectedSubKey(newKey);
  };

  const fieldsForKey = (key: string): string[] => {
    return categoryFields[key] || [];
  };

  const setFieldsForKey = (key: string, fields: string[]) => {
    const next = { ...categoryFields };
    if (fields.length) next[key] = fields;
    else delete next[key];
    onUpdateCategoryFields(next);
  };

  const addField = (key: string) => {
    const name = newFieldName.trim();
    if (!name) return;
    const current = fieldsForKey(key);
    if (current.includes(name)) return;
    setFieldsForKey(key, [...current, name]);
    setNewFieldName('');
  };

  const removeField = (key: string, fieldName: string) => {
    setFieldsForKey(key, fieldsForKey(key).filter(f => f !== fieldName));
  };

  const loadRecommended = () => {
    if (!window.confirm('Merge recommended spec fields for PCs, Apple & parts into your current setup? Existing keys are kept.')) return;
    const next = { ...categoryFields };
    Object.entries(RECOMMENDED_FIELDS).forEach(([key, fields]) => {
      const existing = next[key] || [];
      const merged = Array.from(new Set([...existing, ...fields]));
      next[key] = merged;
    });
    onUpdateCategoryFields(next);
  };

  const [catToSub, subToShow] = selectedSubKey ? selectedSubKey.split(':') : [null, null];

  return (
    <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm">
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Left: Categories & Subcategories */}
        <div className="lg:w-1/2 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <Layers size={24} className="text-blue-500" />
              Categories &amp; Subcategories
            </h3>
            <button
              type="button"
              onClick={loadRecommended}
              className="text-xs font-bold uppercase tracking-wider text-blue-600 hover:text-blue-800 bg-blue-50 px-3 py-2 rounded-xl border border-blue-100"
            >
              Load recommended (PCs &amp; parts)
            </button>
          </div>

          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
            {Object.entries(catList).map(([cat, subs]) => (
              <div key={cat} className="border border-slate-200 rounded-2xl overflow-hidden bg-slate-50/50">
                <div
                  className="flex items-center gap-2 p-4 cursor-pointer hover:bg-slate-100 transition-colors"
                  onClick={() => setExpandedCategory(expandedCategory === cat ? null : cat)}
                >
                  {expandedCategory === cat ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  {editingCategory === cat ? (
                    <input
                      autoFocus
                      className="flex-1 px-3 py-1.5 rounded-lg border border-blue-300 font-bold text-sm"
                      defaultValue={cat}
                      onBlur={e => renameCategory(cat, e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && renameCategory(cat, (e.target as HTMLInputElement).value)}
                    />
                  ) : (
                    <span className="flex-1 font-black text-slate-900">{cat}</span>
                  )}
                  {editingCategory !== cat && (
                    <>
                      <button type="button" onClick={e => { e.stopPropagation(); setEditingCategory(cat); }} className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg"><Edit3 size={14} /></button>
                      <button type="button" onClick={e => { e.stopPropagation(); removeCategory(cat); }} className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg"><Trash2 size={14} /></button>
                    </>
                  )}
                </div>
                {expandedCategory === cat && (
                  <div className="border-t border-slate-200 bg-white p-4 space-y-2">
                    {(subs || []).map(sub => {
                      const key = `${cat}:${sub}`;
                      const isSelected = selectedSubKey === key;
                      return (
                        <div key={key} className="flex items-center gap-2 group">
                          {editingSub?.cat === cat && editingSub?.sub === sub ? (
                            <input
                              autoFocus
                              className="flex-1 px-3 py-2 rounded-xl border border-blue-300 text-sm font-medium"
                              defaultValue={sub}
                              onBlur={e => renameSubcategory(cat, sub, e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && renameSubcategory(cat, sub, (e.target as HTMLInputElement).value)}
                            />
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => setSelectedSubKey(isSelected ? null : key)}
                                className={`flex-1 text-left px-4 py-2.5 rounded-xl border-2 transition-all ${isSelected ? 'bg-indigo-50 border-indigo-400 text-indigo-900 font-bold' : 'bg-slate-50 border-slate-100 hover:border-slate-200 font-medium text-slate-700'}`}
                              >
                                {sub}
                              </button>
                              <button type="button" onClick={e => { e.stopPropagation(); setEditingSub({ cat, sub }); }} className="p-2 text-slate-400 hover:text-blue-600 rounded-lg opacity-0 group-hover:opacity-100"><Edit3 size={14} /></button>
                              <button type="button" onClick={() => removeSubcategory(cat, sub)} className="p-2 text-slate-400 hover:text-red-600 rounded-lg opacity-0 group-hover:opacity-100"><Trash2 size={14} /></button>
                            </>
                          )}
                        </div>
                      );
                    })}
                    {newSubName?.cat === cat ? (
                      <div className="flex gap-2">
                        <input
                          autoFocus
                          className="flex-1 px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium"
                          placeholder="Subcategory name"
                          value={newSubName.value}
                          onChange={e => setNewSubName({ ...newSubName, value: e.target.value })}
                          onKeyDown={e => e.key === 'Enter' && addSubcategory(cat)}
                        />
                        <button type="button" onClick={() => addSubcategory(cat)} className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold text-sm">Add</button>
                        <button type="button" onClick={() => setNewSubName(null)} className="p-2 text-slate-400 hover:text-slate-600"><X size={18} /></button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setNewSubName({ cat, value: '' })}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-slate-200 text-slate-500 font-bold text-sm hover:border-blue-300 hover:text-blue-600 transition-all"
                      >
                        <Plus size={16} /> Add subcategory
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-sm"
              placeholder="New category name"
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCategory()}
            />
            <button type="button" onClick={addCategory} className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-black transition-all">
              Add Category
            </button>
          </div>
        </div>

        {/* Right: Spec fields for selected subcategory */}
        <div className="lg:w-1/2">
          <h3 className="text-xl font-black text-slate-900 flex items-center gap-2 mb-4">
            <Sliders size={24} className="text-indigo-500" />
            Item spec fields
          </h3>
          {selectedSubKey ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-500 font-bold">
                Fields for <span className="text-slate-900">{selectedSubKey}</span>. These appear on item cards and enable filtering &amp; PC Builder compatibility.
              </p>
              <ul className="space-y-2">
                {fieldsForKey(selectedSubKey).map(field => (
                  <li key={field} className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100 group">
                    <GripVertical size={16} className="text-slate-300" />
                    <span className="flex-1 font-bold text-slate-800">{field}</span>
                    <button type="button" onClick={() => removeField(selectedSubKey, field)} className="p-2 text-slate-400 hover:text-red-600 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <input
                  className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-xl font-medium text-sm"
                  placeholder="e.g. Socket, Brand, Capacity"
                  value={newFieldName}
                  onChange={e => setNewFieldName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addField(selectedSubKey))}
                />
                <button type="button" onClick={() => addField(selectedSubKey)} className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 transition-all">
                  Add field
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50">
              <Sliders size={48} className="text-slate-300 mb-4" />
              <p className="font-bold text-slate-500">Select a subcategory on the left</p>
              <p className="text-xs text-slate-400 mt-1">Define spec fields (Socket, Brand, etc.) for filtering and PC Builder compatibility.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CategoryEditor;
