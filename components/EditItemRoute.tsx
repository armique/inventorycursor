import React, { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import EditItemModal from './EditItemModal';
import { InventoryItem } from '../types';

interface Props {
  items: InventoryItem[];
  categories: Record<string, string[]>;
  categoryFields: Record<string, string[]>;
  onSave: (items: InventoryItem[]) => void;
  onAddCategory: (category: string, subcategory?: string) => void;
}

/**
 * /panel/edit/:id — opens Listing Studio as the item edit card.
 */
const EditItemRoute: React.FC<Props> = ({
  items,
  categories,
  categoryFields,
  onSave,
  onAddCategory,
}) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const item = useMemo(() => items.find((i) => i.id === id) || null, [items, id]);

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/panel/inventory');
  };

  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-sm font-semibold text-slate-700">Item not found.</p>
        <Link
          to="/panel/inventory"
          className="text-xs font-black uppercase tracking-wide text-rose-600 hover:underline"
        >
          Back to inventory
        </Link>
      </div>
    );
  }

  return (
    <EditItemModal
      item={item}
      items={items}
      categories={categories}
      categoryFields={categoryFields}
      onSave={onSave}
      onClose={goBack}
      onAddCategory={onAddCategory}
    />
  );
};

export default EditItemRoute;
