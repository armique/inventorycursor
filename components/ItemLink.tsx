import React from 'react';
import { Link } from 'react-router-dom';
import { InventoryItem } from '../types';

type ItemLike = Pick<InventoryItem, 'id' | 'isPC' | 'isBundle'>;

interface Props {
  itemId?: string | null;
  itemName?: string | null;
  /** Full item when available — used to route PCs/bundles to the builder. */
  item?: ItemLike | null;
  /** Inventory list for resolving PC/bundle flags when only itemId is known. */
  items?: InventoryItem[];
  className?: string;
  /** Shown when there is a name but no resolvable edit path. */
  plainClassName?: string;
  title?: string;
}

export function getItemEditPath(item: ItemLike): string {
  if (item.isPC || item.isBundle) {
    return `/panel/builder?editId=${item.id}`;
  }
  return `/panel/edit/${item.id}`;
}

export function resolveItemEditPath(
  itemId: string | undefined | null,
  items?: InventoryItem[],
  item?: ItemLike | null
): string | null {
  if (item?.id) return getItemEditPath(item);
  if (!itemId) return null;
  const found = items?.find((i) => i.id === itemId);
  if (found) return getItemEditPath(found);
  return `/panel/edit/${itemId}`;
}

const DEFAULT_LINK_CLASS =
  'font-bold text-slate-900 hover:text-indigo-600 hover:underline truncate transition-colors';

const ItemLink: React.FC<Props> = ({
  itemId,
  itemName,
  item,
  items,
  className,
  plainClassName,
  title,
}) => {
  const name = itemName?.trim();
  if (!name) return null;

  const path = resolveItemEditPath(itemId ?? item?.id, items, item);
  const resolvedTitle = title ?? `Open ${name}`;

  if (!path) {
    return (
      <span className={plainClassName || className || 'font-bold text-slate-900 truncate'} title={name}>
        {name}
      </span>
    );
  }

  return (
    <Link
      to={path}
      className={className || DEFAULT_LINK_CLASS}
      title={resolvedTitle}
      onClick={(e) => e.stopPropagation()}
    >
      {name}
    </Link>
  );
};

export default ItemLink;
