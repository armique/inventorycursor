import React, { useSyncExternalStore } from 'react';
import GlobalSearch from './GlobalSearch';
import { getPanelSearchSnapshot, subscribePanelSearchData } from '../services/panelSearchStore';

type Props = {
  onClose?: () => void;
};

/** GlobalSearch wired to the panel search store — updates without re-rendering PanelLayout. */
const ConnectedGlobalSearch: React.FC<Props> = (props) => {
  const { items, expenses, businessSettings } = useSyncExternalStore(
    subscribePanelSearchData,
    getPanelSearchSnapshot,
    getPanelSearchSnapshot
  );
  return (
    <GlobalSearch
      items={items}
      expenses={expenses}
      businessSettings={businessSettings}
      {...props}
    />
  );
};

export default React.memo(ConnectedGlobalSearch);
