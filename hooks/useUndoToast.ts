import { useCallback, useRef, useState } from 'react';

type UndoFn = () => void;

/** 5-second undo toast for destructive actions (#131). */
export function useUndoToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const undoRef = useRef<UndoFn | null>(null);

  const showUndo = useCallback((msg: string, onUndo: UndoFn) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    undoRef.current = onUndo;
    setMessage(msg);
    timerRef.current = window.setTimeout(() => {
      setMessage(null);
      undoRef.current = null;
    }, 5000);
  }, []);

  const dismiss = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setMessage(null);
    undoRef.current = null;
  }, []);

  const runUndo = useCallback(() => {
    undoRef.current?.();
    dismiss();
  }, [dismiss]);

  return { undoMessage: message, showUndo, runUndo, dismissUndo: dismiss };
}
