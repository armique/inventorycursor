import React, { useMemo, useState } from 'react';
import { SlidersHorizontal, Sparkles, X } from 'lucide-react';
import ItemForm from './ItemForm';
import ListingStudioModal from './ListingStudioModal';
import ContainerMembershipBadge from './ContainerMembershipBadge';
import TradeLinkBadge from './TradeLinkBadge';
import { InventoryItem, ItemStatus } from '../types';
import { getContainerKind, isContainerMember } from '../utils/containerMembership';
import { resolveTradeReceivedItems, resolveTradeSourceItem } from '../utils/tradeLinks';

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
  onLocateTradeItem?: (target: InventoryItem) => void;
  onOpenTradeItem?: (target: InventoryItem) => void;
}

/**
 * Edit opens Listing Studio (#15 Specs Mirror) by default.
 * "Asset details" switches to the classic pricing / status form.
 */
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
  onLocateTradeItem,
  onOpenTradeItem,
}) => {
  const [mode, setMode] = useState<'studio' | 'asset'>('studio');
  const [draft, setDraft] = useState<InventoryItem>(item);

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const parentKind = getContainerKind(parentContainer);
  const showMembership = isContainerMember(draft) && parentKind && parentContainer;
  const tradeReceived = useMemo(
    () => resolveTradeReceivedItems(draft, itemsById),
    [draft, itemsById]
  );
  const tradeSource = useMemo(
    () => resolveTradeSourceItem(draft, itemsById),
    [draft, itemsById]
  );

  const liveItem = items.find((i) => i.id === draft.id) || draft;
  const studioItem = { ...liveItem, ...draft };

  if (mode === 'studio') {
    return (
      <ListingStudioModal
        item={studioItem}
        allItems={items}
        categoryFields={categoryFields}
        onClose={onClose}
        onUpdateItem={async (patch) => {
          const next = { ...liveItem, ...draft, ...patch };
          setDraft(next);
          onSave([next]);
        }}
        headerExtra={
          <button
            type="button"
            onClick={() => setMode('asset')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white text-[10px] font-black uppercase text-slate-600 hover:bg-slate-50"
          >
            <SlidersHorizontal size={12} />
            Asset details
          </button>
        }
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-3 md:p-4 animate-in fade-in">
      <div className="bg-slate-50 w-full max-w-6xl rounded-3xl shadow-2xl border border-white/20 overflow-hidden flex flex-col h-[min(88vh,820px)] relative">
        <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode('studio')}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-rose-600 text-white rounded-full shadow-lg text-[10px] font-black uppercase hover:bg-rose-700"
          >
            <Sparkles size={12} />
            Listing Studio
          </button>
          <button
            onClick={onClose}
            className="p-2 bg-white rounded-full shadow-lg text-slate-400 hover:text-slate-900 hover:scale-110 transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {(showMembership || tradeReceived.length > 0 || tradeSource) && (
          <div className="shrink-0 px-4 md:px-5 pt-4 space-y-2">
            {showMembership && onOpenParentContainer && parentContainer && parentKind && (
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
            )}
            {draft.status === ItemStatus.TRADED &&
              tradeReceived.length > 0 &&
              onOpenTradeItem &&
              onLocateTradeItem && (
                <TradeLinkBadge
                  variant="banner-outgoing"
                  receivedItems={tradeReceived}
                  onOpenItem={onOpenTradeItem}
                  onLocateItem={(target) => {
                    onClose();
                    onLocateTradeItem(target);
                  }}
                />
              )}
            {tradeSource && onOpenTradeItem && onLocateTradeItem && (
              <TradeLinkBadge
                variant="banner-incoming"
                sourceItem={tradeSource}
                onOpen={() => onOpenTradeItem(tradeSource)}
                onLocate={() => {
                  onClose();
                  onLocateTradeItem(tradeSource);
                }}
              />
            )}
          </div>
        )}

        <div className="flex-1 overflow-hidden p-4 md:p-5">
          <ItemForm
            initialData={liveItem}
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
