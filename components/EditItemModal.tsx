
import React from 'react';
import { X } from 'lucide-react';
import ItemForm from './ItemForm';
import ContainerMembershipBadge from './ContainerMembershipBadge';
import { InventoryItem } from '../types';
import { getContainerKind, isContainerMember } from '../utils/containerMembership';

interface Props {
  item: InventoryItem;
  items: InventoryItem[];
  categories: Record<string, string[]>;
  categoryFields: Record<string, string[]>;
  onSave: (items: InventoryItem[]) => void;
  onClose: () => void;
  onAddCategory: (category: string, subcategory?: string) => void;
  parentContainer?: InventoryItem;
  onOpenParentContainer?: (parent: InventoryItem) => void;
  onLocateParentContainer?: (parent: InventoryItem) => void;
}

const EditItemModal: React.FC<Props> = ({ 
  item, 
  items, 
  categories, 
  categoryFields, 
  onSave, 
  onClose,
  onAddCategory,
  parentContainer,
  onOpenParentContainer,
  onLocateParentContainer,
}) => {
  const parentKind = getContainerKind(parentContainer);
  const showMembership = isContainerMember(item) && parentKind && parentContainer;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-3 md:p-4 animate-in fade-in">
      <div className="bg-slate-50 w-full max-w-6xl rounded-3xl shadow-2xl border border-white/20 overflow-hidden flex flex-col h-[min(88vh,820px)] relative">

        {/* Close Button Overlay */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-50 p-2 bg-white rounded-full shadow-lg text-slate-400 hover:text-slate-900 hover:scale-110 transition-all"
        >
          <X size={18}/>
        </button>

        {showMembership && onOpenParentContainer && (
          <div className="shrink-0 px-4 md:px-5 pt-4">
            <ContainerMembershipBadge
              variant="banner"
              kind={parentKind}
              parentName={parentContainer.name}
              onOpen={() => onOpenParentContainer(parentContainer)}
              onLocate={
                onLocateParentContainer
                  ? () => {
                      onClose();
                      onLocateParentContainer(parentContainer);
                    }
                  : undefined
              }
            />
          </div>
        )}

        <div className="flex-1 overflow-hidden p-4 md:p-5">
           <ItemForm 
              initialData={item}
              items={items}
              onSave={onSave}
              categories={categories}
              categoryFields={categoryFields}
              onAddCategory={onAddCategory}
              onClose={onClose}
              isModal={true}
           />
        </div>
      </div>
    </div>
  );
};

export default EditItemModal;
