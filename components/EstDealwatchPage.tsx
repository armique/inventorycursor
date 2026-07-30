import React from 'react';
import DealwatchWorkspace from './dealwatch/DealwatchWorkspace';

/** Panel route /panel/dealwatch — React Dealwatch workspace. */
const EstDealwatchPage: React.FC = () => (
  <div className="flex-1 min-h-0 flex flex-col">
    <DealwatchWorkspace />
  </div>
);

export default EstDealwatchPage;
