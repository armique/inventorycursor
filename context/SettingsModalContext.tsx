import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type SettingsTabId =
  | 'BUSINESS'
  | 'EBAY'
  | 'CLOUD'
  | 'DEPLOY'
  | 'AI'
  | 'FINANZAMT'
  | 'CATEGORIES'
  | 'SYSTEM';

type SettingsModalContextValue = {
  open: boolean;
  tab?: SettingsTabId;
  openSettings: (tab?: string) => void;
  closeSettings: () => void;
};

const SettingsModalContext = createContext<SettingsModalContextValue | null>(null);

function normalizeTab(tab?: string): SettingsTabId | undefined {
  if (!tab) return undefined;
  const t = tab.toUpperCase();
  if (t === 'EBAY' || t === 'EBAY API' || t === 'LISTINGS') return 'EBAY';
  if (
    t === 'BUSINESS' ||
    t === 'CLOUD' ||
    t === 'DEPLOY' ||
    t === 'AI' ||
    t === 'FINANZAMT' ||
    t === 'CATEGORIES' ||
    t === 'SYSTEM'
  ) {
    return t;
  }
  return undefined;
}

export function SettingsModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTabId | undefined>(undefined);

  const openSettings = useCallback((nextTab?: string) => {
    setTab(normalizeTab(nextTab));
    setOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setOpen(false);
  }, []);

  const value = useMemo(
    () => ({ open, tab, openSettings, closeSettings }),
    [open, tab, openSettings, closeSettings]
  );

  return (
    <SettingsModalContext.Provider value={value}>{children}</SettingsModalContext.Provider>
  );
}

export function useSettingsModal(): SettingsModalContextValue {
  const ctx = useContext(SettingsModalContext);
  if (!ctx) {
    return {
      open: false,
      openSettings: () => {},
      closeSettings: () => {},
    };
  }
  return ctx;
}
