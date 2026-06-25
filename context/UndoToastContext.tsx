import React, { createContext, useContext } from 'react';
import { useUndoToast } from '../hooks/useUndoToast';
import UndoToastBar from '../components/UndoToastBar';

type UndoToastContextValue = {
  showUndo: (message: string, onUndo: () => void) => void;
};

const UndoToastContext = createContext<UndoToastContextValue | null>(null);

export function UndoToastProvider({ children }: { children: React.ReactNode }) {
  const { undoMessage, showUndo, runUndo, dismissUndo } = useUndoToast();

  return (
    <UndoToastContext.Provider value={{ showUndo }}>
      {children}
      <UndoToastBar message={undoMessage} onUndo={runUndo} onDismiss={dismissUndo} />
    </UndoToastContext.Provider>
  );
}

export function useUndoToastContext(): UndoToastContextValue {
  const ctx = useContext(UndoToastContext);
  if (!ctx) {
    return { showUndo: () => {} };
  }
  return ctx;
}
