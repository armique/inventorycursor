import React from 'react';
import type { InventoryItem } from '../types';
import DealwatchWorkspace from './dealwatch/DealwatchWorkspace';

/**
 * Panel route /panel/dealwatch — React workspace (search constructor + tracked searches).
 */
const EstDealwatchPage: React.FC<{ items?: InventoryItem[] }> = () => (
  <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
    <DealwatchWorkspace embedded />
  </div>
);

export default EstDealwatchPage;
