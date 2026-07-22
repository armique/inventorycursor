import React, { useMemo, useState } from 'react';
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
 * Edit opens Listing Studio as the single item card (inventory + listing).
 * Classic Asset details form is retired for edit — Add/new still uses ItemForm.
 */
const EditItemModal: React.FC<Props> = ({
  item,
  items,
  categories,
  categoryFields,
  onSave,
  onClose,
  parentContainer,
  onOpenParentContainer,
  onLocateParentContainer,
  onLocateTradeItem,
  onOpenTradeItem,
}) => {
  const [draft, setDraft] = useState<InventoryItem>(item);
  const draftRef = React.useRef(draft);
  draftRef.current = draft;

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

  const headerExtra = (
    <>
      {showMembership && onOpenParentContainer && parentContainer && parentKind && (
        <ContainerMembershipBadge
          variant="inline"
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
            variant="outgoing"
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
          variant="incoming"
          sourceItem={tradeSource}
          onOpen={() => onOpenTradeItem(tradeSource)}
          onLocate={() => {
            onClose();
            onLocateTradeItem(tradeSource);
          }}
        />
      )}
    </>
  );

  return (
    <ListingStudioModal
      item={studioItem}
      allItems={items}
      categories={categories}
      categoryFields={categoryFields}
      onClose={onClose}
      onUpdateItem={async (patch) => {
        const current = draftRef.current;
        const fromItems = items.find((i) => i.id === current.id);
        const next = { ...(fromItems || current), ...current, ...patch };
        draftRef.current = next;
        setDraft(next);
        onSave([next]);
      }}
      headerExtra={headerExtra}
    />
  );
};

export default EditItemModal;
