import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { InventoryItem } from '../types';
import PCBuilderWizard from './PCBuilderWizard';
import LotBundleBuilder from './LotBundleBuilder';

interface Props {
  items: InventoryItem[];
  onSave: (items: InventoryItem[]) => void;
}

/**
 * Routes /panel/builder to PC Build or Lot Bundle screens.
 * - ?mode=lot|bundle → Lot Bundle
 * - editId of a bundle → Lot Bundle
 * - otherwise → PC Builder
 */
const BuilderEntry: React.FC<Props> = ({ items, onSave }) => {
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('editId');
  const mode = (searchParams.get('mode') || '').toLowerCase();
  const editing = editId ? items.find((i) => i.id === editId) : undefined;

  const useLot =
    Boolean(editing?.isBundle) || mode === 'lot' || mode === 'bundle';

  if (useLot) {
    return <LotBundleBuilder items={items} onSave={onSave} />;
  }
  return <PCBuilderWizard items={items} onSave={onSave} />;
};

export default BuilderEntry;
