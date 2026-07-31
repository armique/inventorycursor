import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { InventoryItem } from '../types';
import PCBuilderWizard from './PCBuilderWizard';
import LotBundleBuilder from './LotBundleBuilder';
import { isMixedBundleContainer } from '../utils/containerTaxonomy';
import { AddFlowStepHeader } from './addFlowShared';

interface Props {
  items: InventoryItem[];
  onSave: (items: InventoryItem[]) => void;
}

function withAddChrome(title: string, node: React.ReactNode, showChrome: boolean) {
  if (!showChrome) return <>{node}</>;
  return (
    <div>
      <AddFlowStepHeader title={title} />
      {node}
    </div>
  );
}

/**
 * /panel/builder
 * - mode=pc → PC Build (slots, no defective)
 * - mode=bundle → Bundle / Aufrustkit (slots, no defective)
 * - mode=mixed|lot → Mixed Bundle (flat bag, defective OK)
 */
const BuilderEntry: React.FC<Props> = ({ items, onSave }) => {
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('editId');
  const mode = (searchParams.get('mode') || '').toLowerCase();
  const editing = editId ? items.find((i) => i.id === editId) : undefined;
  const fromAddHub = !editing;

  if (editing) {
    if (editing.isPC || editing.category === 'PC') {
      return <PCBuilderWizard items={items} onSave={onSave} buildKind="pc" />;
    }
    if (isMixedBundleContainer(editing)) {
      return <LotBundleBuilder items={items} onSave={onSave} />;
    }
    if (editing.isBundle || editing.category === 'Bundle') {
      return <PCBuilderWizard items={items} onSave={onSave} buildKind="bundle" />;
    }
  }

  if (mode === 'mixed' || mode === 'lot') {
    return withAddChrome('Mixed Bundle', <LotBundleBuilder items={items} onSave={onSave} />, fromAddHub);
  }
  if (mode === 'bundle') {
    return withAddChrome(
      'Bundle',
      <PCBuilderWizard items={items} onSave={onSave} buildKind="bundle" />,
      fromAddHub
    );
  }
  return withAddChrome(
    'PC Build',
    <PCBuilderWizard items={items} onSave={onSave} buildKind="pc" />,
    fromAddHub
  );
};

export default BuilderEntry;
