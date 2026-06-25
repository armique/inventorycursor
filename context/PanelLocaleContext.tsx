import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type PanelLocale = 'en' | 'de';

const STORAGE_KEY = 'panel_locale_v1';

type Dict = Record<string, { en: string; de: string }>;

const STRINGS: Dict = {
  dashboard: { en: 'Dashboard', de: 'Übersicht' },
  inventory: { en: 'Inventory', de: 'Bestand' },
  addItem: { en: 'Add item', de: 'Artikel hinzufügen' },
  importData: { en: 'Import data', de: 'Daten importieren' },
  settings: { en: 'Settings', de: 'Einstellungen' },
  save: { en: 'Save', de: 'Speichern' },
  cancel: { en: 'Cancel', de: 'Abbrechen' },
  search: { en: 'Search', de: 'Suchen' },
  sold: { en: 'Sold', de: 'Verkauft' },
  profit: { en: 'Profit', de: 'Gewinn' },
  healthCheck: { en: 'Health check', de: 'Systemstatus' },
};

interface Ctx {
  locale: PanelLocale;
  setLocale: (l: PanelLocale) => void;
  t: (key: keyof typeof STRINGS) => string;
}

const PanelLocaleContext = createContext<Ctx | null>(null);

export const PanelLocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<PanelLocale>(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      return s === 'de' ? 'de' : 'en';
    } catch {
      return 'en';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
  }, [locale]);

  const value = useMemo<Ctx>(
    () => ({
      locale,
      setLocale: setLocaleState,
      t: (key) => STRINGS[key]?.[locale] ?? key,
    }),
    [locale]
  );

  return <PanelLocaleContext.Provider value={value}>{children}</PanelLocaleContext.Provider>;
};

export function usePanelLocale(): Ctx {
  const ctx = useContext(PanelLocaleContext);
  if (!ctx) throw new Error('usePanelLocale outside provider');
  return ctx;
}
