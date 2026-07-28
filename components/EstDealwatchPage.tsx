import React from 'react';
import MarketWorkspace from './market/MarketWorkspace';

/** Panel route /panel/est — React Market Intelligence workspace (Phase 2). */
const EstDealwatchPage: React.FC = () => (
  <div className="flex-1 min-h-0 flex flex-col">
    <MarketWorkspace />
  </div>
);

export default EstDealwatchPage;
