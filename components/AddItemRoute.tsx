import React, { Suspense, lazy } from 'react';
import { AddFlowStepHeader } from './addFlowShared';
import { InventoryItem } from '../types';

const ItemForm = lazy(() => import('./ItemForm'));

interface Props {
  onSave: (items: InventoryItem[]) => void;
  items: InventoryItem[];
  categories: Record<string, string[]>;
  onAddCategory: (cat: string, sub: string) => void;
  categoryFields: Record<string, string[]>;
}

/** Step 2 — single item form, reached from the Add hub. */
const AddItemRoute: React.FC<Props> = (props) => {
  return (
    <div>
      <AddFlowStepHeader title="Single item" />
      <Suspense fallback={<div className="py-16 text-center text-sm font-bold text-slate-400">Loading form…</div>}>
        <ItemForm
          onSave={props.onSave}
          items={props.items}
          categories={props.categories}
          onAddCategory={props.onAddCategory}
          categoryFields={props.categoryFields}
        />
      </Suspense>
    </div>
  );
};

export default AddItemRoute;
