
import React, { useState, useMemo } from 'react';
import { 
  Clipboard, 
  Wrench, 
  CheckCircle, 
  Globe, 
  ShoppingBag, 
  Truck, 
  MoreHorizontal,
  Package,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';
import { InventoryItem, WorkflowStage, ItemStatus, BusinessSettings } from '../types';
import SaleModal from './SaleModal';
import ReturnModal from './ReturnModal';

interface Props {
  items: InventoryItem[];
  onUpdate: (items: InventoryItem[]) => void;
  businessSettings: BusinessSettings;
}

const STAGES: { id: WorkflowStage; label: string; icon: React.ReactNode; color: string; bg: string }[] = [
  { id: 'Draft', label: 'Inbox / Drafts', icon: <Clipboard size={16}/>, color: 'text-slate-600', bg: 'bg-slate-100' },
  { id: 'Testing', label: 'Workbench', icon: <Wrench size={16}/>, color: 'text-amber-600', bg: 'bg-amber-50' },
  { id: 'Ready', label: 'Ready to List', icon: <CheckCircle size={16}/>, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { id: 'Listed', label: 'Active Listings', icon: <Globe size={16}/>, color: 'text-blue-600', bg: 'bg-blue-50' },
  { id: 'Sold', label: 'Sold', icon: <ShoppingBag size={16}/>, color: 'text-purple-600', bg: 'bg-purple-50' },
  { id: 'Shipped', label: 'Shipped', icon: <Truck size={16}/>, color: 'text-slate-600', bg: 'bg-slate-200' },
];

const KanbanBoard: React.FC<Props> = ({ items, onUpdate, businessSettings }) => {
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  
  // Modals
  const [itemToSell, setItemToSell] = useState<InventoryItem | null>(null);
  const [itemToReturn, setItemToReturn] = useState<InventoryItem | null>(null);

  // Normalize Stage Logic
  const getStage = (item: InventoryItem): WorkflowStage => {
    if (item.workflowStage) return item.workflowStage;
    if (item.isDraft) return 'Draft';
    if (item.status === ItemStatus.SOLD) return 'Sold';
    if (item.status === ItemStatus.TRADED) return 'Sold'; // Treat traded as sold in pipeline
    // Default to 'Ready' if in stock but no stage set
    return 'Ready';
  };

  const columns = useMemo(() => {
    const cols: Record<WorkflowStage, InventoryItem[]> = {
      Draft: [], Testing: [], Ready: [], Listed: [], Sold: [], Shipped: []
    };
    
    items.forEach(item => {
      // Skip items currently being built into a PC (components) unless specifically tracking components
      if (item.status === ItemStatus.IN_COMPOSITION) return;
      
      const stage = getStage(item);
      if (cols[stage]) cols[stage].push(item);
    });
    
    return cols;
  }, [items]);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedItem(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetStage: WorkflowStage) => {
    e.preventDefault();
    if (!draggedItem) return;

    const item = items.find(i => i.id === draggedItem);
    if (!item) return;

    const currentStage = getStage(item);
    if (currentStage === targetStage) return;

    // Logic Handling
    if (targetStage === 'Sold') {
       setItemToSell(item); // Open modal, update happens there
    } else if (currentStage === 'Sold') {
       // Moving FROM Sold to something else implies a return/cancellation
       setItemToReturn(item);
    } else {
       // Standard Move
       const updates: Partial<InventoryItem> = {
          workflowStage: targetStage,
          status: ItemStatus.IN_STOCK,
          isDraft: targetStage === 'Draft'
       };
       
       // Clean up if it was previously draft but moved forward
       if (currentStage === 'Draft' && targetStage !== 'Draft') {
          updates.isDraft = false;
       }

       onUpdate([{ ...item, ...updates }]);
    }
    
    setDraggedItem(null);
  };

  return (
    <div className="h-[calc(100vh-100px)] overflow-x-auto overflow-y-hidden pb-4">
      <div className="flex gap-6 h-full min-w-max px-4">
        {STAGES.map(stage => (
          <div 
            key={stage.id}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, stage.id)}
            className={`w-80 flex flex-col rounded-[2rem] border-2 border-slate-100 bg-white shadow-sm transition-colors ${draggedItem ? 'border-dashed border-slate-300' : ''}`}
          >
            {/* Header */}
            <div className={`p-4 border-b border-slate-100 flex justify-between items-center ${stage.bg} rounded-t-[2rem]`}>
               <div className={`flex items-center gap-2 font-black text-xs uppercase tracking-widest ${stage.color}`}>
                  {stage.icon} {stage.label}
               </div>
               <span className="bg-white px-2 py-1 rounded-lg text-[10px] font-bold shadow-sm text-slate-500">
                  {columns[stage.id].length}
               </span>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
               {columns[stage.id].map(item => (
                  <div 
                    key={item.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, item.id)}
                    className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm cursor-grab active:cursor-grabbing hover:border-blue-300 hover:shadow-md transition-all group relative"
                  >
                     <div className="flex gap-3">
                        <div className="w-12 h-12 bg-slate-50 rounded-xl shrink-0 overflow-hidden border border-slate-100">
                           {item.imageUrl ? (
                              <img src={item.imageUrl} className="w-full h-full object-cover" draggable={false} />
                           ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-300"><Package size={16}/></div>
                           )}
                        </div>
                        <div className="flex-1 min-w-0">
                           <p className="font-black text-xs text-slate-900 leading-tight line-clamp-2">{item.name}</p>
                           <div className="flex justify-between items-center mt-2">
                              <span className="text-[9px] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded uppercase">{item.category}</span>
                              <span className="font-black text-xs text-slate-900">€{item.buyPrice}</span>
                           </div>
                        </div>
                     </div>
                     {item.isDefective && (
                        <div className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white" title="Defective"></div>
                     )}
                  </div>
               ))}
               {columns[stage.id].length === 0 && (
                  <div className="h-24 flex items-center justify-center border-2 border-dashed border-slate-100 rounded-2xl opacity-50">
                     <p className="text-[10px] font-bold text-slate-400 uppercase">Empty</p>
                  </div>
               )}
            </div>
          </div>
        ))}
      </div>

      {/* Modals */}
      {itemToSell && (
         <SaleModal 
            item={itemToSell} 
            taxMode={businessSettings.taxMode}
            onSave={(updated) => { 
               onUpdate([{ ...updated, workflowStage: 'Sold' }]); 
               setItemToSell(null); 
            }} 
            onClose={() => setItemToSell(null)} 
         />
      )}

      {itemToReturn && (
         <ReturnModal
            items={[itemToReturn]}
            onConfirm={(updated) => {
               // When returning, defaulting stage to 'Testing' to verify item condition
               onUpdate(updated.map(i => ({ ...i, workflowStage: 'Testing' })));
               setItemToReturn(null);
            }}
            onClose={() => setItemToReturn(null)}
         />
      )}
    </div>
  );
};

export default KanbanBoard;
