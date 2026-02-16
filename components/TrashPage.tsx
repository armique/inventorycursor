
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Search, Trash2, RotateCcw, AlertTriangle, X, Check, CheckCircle, Package, Clock,
  LayoutGrid, List as ListIcon, Calendar, GripVertical, ArrowUp, ArrowDown, ArrowUpDown, Square, CheckSquare, Minus
} from 'lucide-react';
import { InventoryItem } from '../types';
import ItemThumbnail from './ItemThumbnail';

interface Props {
  items: InventoryItem[];
  onRestore: (ids: string[]) => void;
  onPermanentDelete: (ids: string[]) => void;
}

type ColumnId = 'item' | 'category' | 'buyPrice' | 'buyDate' | 'actions';

const DEFAULT_WIDTHS: Record<string, number> = {
  item: 400,
  category: 150,
  buyPrice: 120,
  buyDate: 150,
  actions: 140
};

const TRASH_SORT_KEY = 'trash_sort_config';

const TrashPage: React.FC<Props> = ({ items, onRestore, onPermanentDelete }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => (localStorage.getItem('trash_view_mode') as any) || 'grid');
  
  // Persisted Sort Config
  const [sortConfig, setSortConfig] = useState<{ key: ColumnId; direction: 'asc' | 'desc' } | null>(() => {
    const saved = localStorage.getItem(TRASH_SORT_KEY);
    return saved ? JSON.parse(saved) : null;
  });
  
  // State for Purge Confirmation Modal
  const [purgeConfirmData, setPurgeConfirmData] = useState<{ items: InventoryItem[] } | null>(null);

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('trash_column_widths');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_WIDTHS, ...parsed };
      } catch (e) {
        return DEFAULT_WIDTHS;
      }
    }
    return DEFAULT_WIDTHS;
  });

  const resizingRef = useRef<{ col: string; startX: number; startWidth: number } | null>(null);

  useEffect(() => localStorage.setItem('trash_view_mode', viewMode), [viewMode]);
  useEffect(() => localStorage.setItem('trash_column_widths', JSON.stringify(columnWidths)), [columnWidths]);
  
  // Save Sort Config Effect
  useEffect(() => {
    if (sortConfig) {
      localStorage.setItem(TRASH_SORT_KEY, JSON.stringify(sortConfig));
    } else {
      localStorage.removeItem(TRASH_SORT_KEY);
    }
  }, [sortConfig]);

  const filteredItems = useMemo(() => {
    let result = items.filter(item => 
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.vendor?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (sortConfig) {
      result.sort((a, b) => {
        let aVal: any = (a as any)[sortConfig.key === 'item' ? 'name' : sortConfig.key];
        let bVal: any = (b as any)[sortConfig.key === 'item' ? 'name' : sortConfig.key];
        
        if (aVal === undefined) aVal = '';
        if (bVal === undefined) bVal = '';

        if (typeof aVal === 'string') {
          return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        } else {
          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
      });
    }
    return result;
  }, [items, searchTerm, sortConfig]);

  const handleSort = (key: ColumnId) => {
    if (key === 'actions' || resizingRef.current) return;
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const handleResizeStart = (e: React.MouseEvent, col: string) => {
    e.stopPropagation();
    e.preventDefault();
    resizingRef.current = {
      col,
      startX: e.clientX,
      startWidth: columnWidths[col] || 100
    };
    
    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!resizingRef.current) return;
      const deltaX = moveEvent.clientX - resizingRef.current.startX;
      const newWidth = Math.max(80, resizingRef.current.startWidth + deltaX);
      setColumnWidths(prev => ({ ...prev, [resizingRef.current!.col]: newWidth }));
    };
    
    const onMouseUp = () => {
      resizingRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const toggleSelect = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleSelectAll = () => {
    if (selectedIds.length === filteredItems.length && filteredItems.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredItems.map(item => item.id));
    }
  };

  const handleRestoreSingle = (item: InventoryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    onRestore([item.id]);
  };

  // --- UPDATED PURGE LOGIC ---

  const handlePurgeSingle = (item: InventoryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setPurgeConfirmData({ items: [item] });
  };

  const handlePurgeSelected = () => {
    if (selectedIds.length === 0) return;
    const toPurge = items.filter(i => selectedIds.includes(i.id));
    setPurgeConfirmData({ items: toPurge });
  };

  const handlePurgeAll = () => {
    if (items.length === 0) return;
    setPurgeConfirmData({ items: [...items] });
  };

  const confirmPurge = () => {
    if (!purgeConfirmData) return;
    const ids = purgeConfirmData.items.map(i => i.id);
    onPermanentDelete(ids);
    // Cleanup selected IDs that might have been deleted
    setSelectedIds(prev => prev.filter(id => !ids.includes(id)));
    setPurgeConfirmData(null);
  };

  const handleRestoreSelected = () => {
    if (selectedIds.length === 0) return;
    onRestore(selectedIds);
    setSelectedIds([]);
  };

  const renderColumnHeader = (id: ColumnId) => {
    const labels: Record<ColumnId, string> = {
      item: 'Deleted Asset',
      category: 'Category',
      buyPrice: 'Original Price',
      buyDate: 'Purchase Date',
      actions: 'Recovery'
    };
    const isActions = id === 'actions';
    const isRightAligned = id === 'buyPrice' || id === 'buyDate' || isActions;
    const isSorted = sortConfig?.key === id;
    const width = columnWidths[id] || DEFAULT_WIDTHS[id] || 120;

    return (
      <th 
        key={id}
        onClick={() => handleSort(id)}
        style={{ width: `${width}px`, minWidth: `${width}px` }}
        className={`p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest cursor-pointer hover:bg-slate-100/50 transition-colors group relative ${isRightAligned ? 'text-right' : ''}`}
      >
        <div className={`flex items-center gap-2 ${isRightAligned ? 'justify-end' : ''}`}>
          {!isActions && <GripVertical size={10} className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-300" />}
          <span className="truncate">{labels[id]}</span>
          {!isActions && (
            <span className="ml-1 opacity-40 group-hover:opacity-100 shrink-0">
              {isSorted ? (
                sortConfig.direction === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />
              ) : (
                <ArrowUpDown size={10} />
              )}
            </span>
          )}
        </div>
        <div 
          onMouseDown={(e) => handleResizeStart(e, id)}
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-red-400/30 active:bg-red-500 z-20 transition-colors"
        />
      </th>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-32">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter flex items-center gap-3">
            Recently Deleted
            <span className="bg-red-50 text-red-600 px-3 py-1 rounded-full text-xs font-black">
              {items.length}
            </span>
          </h1>
          <p className="text-sm text-slate-500 font-medium">Items stay here until permanently deleted or restored</p>
        </div>
        
        <div className="flex flex-wrap gap-2 w-full md:w-auto items-center">
           <div className="bg-white border border-slate-200 rounded-xl p-1 flex items-center mr-2 shadow-sm">
              <button onClick={() => setViewMode('grid')} className={`p-2 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}><LayoutGrid size={18} /></button>
              <button onClick={() => setViewMode('list')} className={`p-2 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}><ListIcon size={18} /></button>
           </div>
          
          <button 
            onClick={handlePurgeAll}
            disabled={items.length === 0}
            className="px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest bg-white text-red-600 border border-red-100 hover:bg-red-50 disabled:opacity-50 transition-all shadow-sm"
          >
            Empty Bin
          </button>
        </div>
      </header>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Filter trash..." 
            className="w-full pl-12 pr-4 py-4 rounded-2xl border border-slate-200 outline-none bg-white shadow-sm focus:ring-4 focus:ring-slate-100 transition-all font-medium" 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)} 
          />
        </div>
        {viewMode === 'grid' && (
          <button 
            onClick={handleSelectAll}
            className="px-6 py-4 bg-white border border-slate-200 rounded-2xl font-black text-[10px] uppercase tracking-widest text-slate-600 hover:bg-slate-50 transition-all flex items-center gap-2 shadow-sm"
          >
            {selectedIds.length === filteredItems.length && filteredItems.length > 0 ? (
              <><CheckSquare size={16} className="text-blue-600" /> Deselect All</>
            ) : selectedIds.length > 0 ? (
              <><Minus size={16} className="text-blue-600" /> Select All</>
            ) : (
              <><Square size={16} /> Select All</>
            )}
          </button>
        )}
      </div>

      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredItems.map(item => {
            const isSelected = selectedIds.includes(item.id);
            return (
              <div 
                key={item.id} 
                onClick={() => toggleSelect(item.id)}
                className={`bg-white p-4 rounded-[2.5rem] shadow-sm border transition-all relative group cursor-pointer ${isSelected ? 'ring-4 ring-blue-500 border-blue-500' : 'border-slate-100 hover:border-slate-200'}`}
              >
                <div className={`absolute top-6 right-6 z-[60] w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white/80 border-slate-300'}`}>
                  {isSelected && <Check size={14} />}
                </div>
                
                <div className="aspect-[4/3] rounded-[1.8rem] overflow-hidden bg-slate-50 mb-4 border border-slate-100 relative grayscale group-hover:grayscale-0 transition-all duration-500">
                  <ItemThumbnail item={item} className="w-full h-full object-cover" size={120} useCategoryImage />
                  
                  <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-[6px] opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center gap-3 z-[50]">
                    <button 
                      onClick={(e) => handleRestoreSingle(item, e)} 
                      className="w-12 h-12 bg-emerald-500 text-white rounded-2xl flex items-center justify-center shadow-2xl hover:bg-emerald-600 hover:scale-110 transition-all" 
                      title="Restore Asset"
                    >
                      <RotateCcw size={20}/>
                    </button>
                    <button 
                      onClick={(e) => handlePurgeSingle(item, e)} 
                      className="w-12 h-12 bg-red-500 text-white rounded-2xl flex items-center justify-center shadow-2xl hover:bg-red-600 hover:scale-110 transition-all" 
                      title="Wipe Permanently"
                    >
                      <Trash2 size={20}/>
                    </button>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <h3 className="font-black text-slate-900 text-sm line-clamp-2 leading-tight tracking-tight">{item.name}</h3>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-slate-400 font-bold uppercase truncate">{item.category}</p>
                    <p className="text-[10px] font-black text-slate-900">€{item.buyPrice}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-x-auto">
           <div className="min-w-max p-1">
              <table className="w-full text-left">
                 <thead>
                    <tr className="bg-slate-50/50 border-b border-slate-100 select-none">
                       <th className="p-5 w-[60px] min-w-[60px] text-center">
                          <button onClick={handleSelectAll} className="p-1 hover:bg-slate-100 rounded-md transition-colors flex items-center justify-center mx-auto">
                             {selectedIds.length === filteredItems.length && filteredItems.length > 0 ? (
                               <CheckSquare size={16} className="text-blue-600" />
                             ) : selectedIds.length > 0 ? (
                               <Minus size={16} className="text-blue-600" />
                             ) : (
                               <Square size={16} className="text-slate-400" />
                             )}
                          </button>
                       </th>
                       {renderColumnHeader('item')}
                       {renderColumnHeader('category')}
                       {renderColumnHeader('buyPrice')}
                       {renderColumnHeader('buyDate')}
                       {renderColumnHeader('actions')}
                    </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-50">
                    {filteredItems.map(item => {
                      const isSelected = selectedIds.includes(item.id);
                      const columns: ColumnId[] = ['item', 'category', 'buyPrice', 'buyDate', 'actions'];

                      return (
                        <tr key={item.id} className={`hover:bg-slate-50/50 transition-colors cursor-pointer group/row ${isSelected ? 'bg-blue-50/50' : ''}`}>
                           <td className="p-5 w-[60px] min-w-[60px] text-center" onClick={(e) => toggleSelect(item.id, e)}>
                             <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all mx-auto ${isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'}`}>
                                {isSelected && <Check size={12} />}
                             </div>
                           </td>
                           {columns.map(colId => {
                             const width = columnWidths[colId] || DEFAULT_WIDTHS[colId] || 120;
                             const style = { width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` };

                             if (colId === 'item') return (
                               <td key={colId} className="p-5" style={style} onClick={(e) => toggleSelect(item.id, e)}>
                                 <div className="flex items-center gap-4 relative group/item-cell overflow-hidden">
                                    <ItemThumbnail item={item} className="w-12 h-12 rounded-xl object-cover shadow-sm border border-slate-100 grayscale group-hover/row:grayscale-0 transition-all shrink-0" size={48} />
                                    <div className="flex-1 min-w-0 relative">
                                      <p className="text-sm font-black text-slate-900 tracking-tight truncate">{item.name}</p>
                                      <p className="text-[10px] text-slate-400 font-bold uppercase truncate">{item.vendor || 'Unknown Source'}</p>
                                      <div className="absolute top-0 right-0 h-full flex items-center gap-1 opacity-0 group-hover/item-cell:opacity-100 transition-opacity bg-gradient-to-l from-white via-white to-transparent pl-8 pointer-events-none group-hover/item-cell:pointer-events-auto">
                                        <button onClick={(e) => handleRestoreSingle(item, e)} className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-600 hover:text-white transition-all shadow-sm" title="Restore"><RotateCcw size={12}/></button>
                                        <button onClick={(e) => handlePurgeSingle(item, e)} className="p-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-600 hover:text-white transition-all shadow-sm" title="Wipe"><Trash2 size={12}/></button>
                                      </div>
                                    </div>
                                 </div>
                               </td>
                             );
                             if (colId === 'category') return <td key={colId} className="p-5 text-[10px] font-black text-slate-500 uppercase tracking-widest truncate" style={style}>{item.category}</td>;
                             if (colId === 'buyPrice') return <td key={colId} className="p-5 text-right font-black text-slate-900" style={style}>€{item.buyPrice}</td>;
                             if (colId === 'buyDate') return (
                               <td key={colId} className="p-5 text-right text-xs font-bold text-slate-500" style={style}>
                                 <span className="flex items-center justify-end gap-1">
                                    {item.buyDate || '-'}
                                    <Calendar size={10} className="text-slate-300"/>
                                 </span>
                               </td>
                             );
                             if (colId === 'actions') return (
                               <td key={colId} className="p-5 text-right" style={style}>
                                  <div className="flex justify-end gap-2 opacity-0 group-hover/row:opacity-100 transition-opacity">
                                    <button onClick={(e) => handleRestoreSingle(item, e)} className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all" title="Restore"><RotateCcw size={16}/></button>
                                    <button onClick={(e) => handlePurgeSingle(item, e)} className="p-2 text-red-600 hover:bg-red-50 rounded-xl transition-all" title="Delete Permanent"><Trash2 size={16}/></button>
                                  </div>
                               </td>
                             );
                             return null;
                           })}
                        </tr>
                      );
                    })}
                 </tbody>
              </table>
           </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="py-24 flex flex-col items-center justify-center text-center space-y-4 opacity-40">
          <div className="p-8 bg-slate-100 rounded-full">
            <Trash2 size={48} className="text-slate-400" />
          </div>
          <p className="font-black text-slate-400 uppercase tracking-widest text-sm">Trash is empty</p>
        </div>
      )}

      {selectedIds.length > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] bg-slate-900 px-8 py-5 rounded-[2.5rem] border border-slate-800 shadow-2xl flex items-center gap-8 animate-in slide-in-from-bottom-12 duration-300">
           <div className="flex flex-col">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Selected</p>
              <p className="text-xl font-black text-white">{selectedIds.length}</p>
           </div>
           <div className="h-10 w-px bg-slate-800"></div>
           <div className="flex gap-2">
              <button 
                onClick={handleRestoreSelected} 
                className="bg-white text-slate-900 px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg flex items-center gap-2 hover:bg-slate-100 transition-all"
              >
                <RotateCcw size={16}/> Restore Selection
              </button>
              <button 
                onClick={handlePurgeSelected} 
                className="bg-red-500 text-white px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg hover:bg-red-600 transition-all flex items-center gap-2"
              >
                <Trash2 size={16}/> Purge Permanently
              </button>
           </div>
           <button onClick={() => setSelectedIds([])} className="p-3 text-slate-500 hover:text-white transition-colors">
              <X size={20}/>
           </button>
        </div>
      )}

      {/* CONFIRMATION MODAL */}
      {purgeConfirmData && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in">
           <div className="bg-white w-full max-w-md rounded-[3rem] shadow-2xl p-8 space-y-6 text-center">
              <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-2">
                <AlertTriangle size={40} />
              </div>
              <div className="space-y-2">
                 <h3 className="text-2xl font-black text-slate-900 tracking-tight">Permanent Delete?</h3>
                 <p className="text-sm text-slate-500">
                    You are about to permanently delete <b>{purgeConfirmData.items.length} items</b>. 
                    <br/>
                    <span className="text-red-500 font-bold">This action cannot be undone.</span>
                 </p>
                 {purgeConfirmData.items.length === 1 && (
                    <div className="mt-2 p-3 bg-slate-50 rounded-xl text-xs font-bold text-slate-700 border border-slate-100">
                        {purgeConfirmData.items[0].name}
                    </div>
                 )}
              </div>
              
              <div className="flex gap-3 pt-4">
                 <button onClick={() => setPurgeConfirmData(null)} className="flex-1 py-4 bg-slate-100 rounded-2xl font-black text-xs uppercase hover:bg-slate-200 transition-all">Cancel</button>
                 <button onClick={confirmPurge} className="flex-1 py-4 bg-red-500 text-white rounded-2xl font-black text-xs uppercase shadow-xl hover:bg-red-600 transition-all">Yes, Delete</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default TrashPage;
