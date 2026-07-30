import React from 'react';

/**
 * Panel route /panel/dealwatch — embeds the full Dealwatch runtime UI
 * (dealwatch-runtime/index.html) served by the Vite dealwatch plugin at /dealwatch/.
 */
const EstDealwatchPage: React.FC = () => (
  <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
    <iframe
      title="Dealwatch"
      src="/dealwatch/index.html"
      className="flex-1 min-h-0 w-full border-0 bg-white"
      allow="clipboard-read; clipboard-write"
    />
  </div>
);

export default EstDealwatchPage;
