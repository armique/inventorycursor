import React, { useEffect, useId, useRef, useState } from 'react';
import { Camera, Keyboard, Loader2, ScanBarcode, X } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  lookupBarcode,
  normalizeBarcodeInput,
  type BarcodeProduct,
} from '../services/barcodeLookup';

type Props = {
  onProduct: (product: BarcodeProduct) => void;
  onClose?: () => void;
  /** Compact embed (bulk form) vs full card */
  compact?: boolean;
};

/**
 * Camera barcode scan (EAN/UPC) + manual entry, then product lookup.
 * Works on iPhone Safari via html5-qrcode; falls back to typed digits anytime.
 */
const BarcodeScanPanel: React.FC<Props> = ({ onProduct, onClose, compact }) => {
  const reactId = useId().replace(/:/g, '');
  const scannerRegionId = `barcode-reader-${reactId}`;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const handlingRef = useRef(false);

  const [manual, setManual] = useState('');
  const [scanning, setScanning] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);

  const stopScanner = async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    setScanning(false);
    if (!s) return;
    try {
      if (s.isScanning) await s.stop();
    } catch {
      /* ignore */
    }
    try {
      s.clear();
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    return () => {
      void stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolveCode = async (code: string) => {
    const normalized = normalizeBarcodeInput(code);
    if (!normalized) {
      setError('Could not read a valid barcode. Try again or type the digits.');
      return;
    }
    if (handlingRef.current) return;
    handlingRef.current = true;
    setLookingUp(true);
    setError(null);
    setLastCode(normalized);
    try {
      await stopScanner();
      const product = await lookupBarcode(normalized);
      onProduct(product);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed');
    } finally {
      setLookingUp(false);
      handlingRef.current = false;
    }
  };

  const startScanner = async () => {
    setError(null);
    await stopScanner();
    try {
      const scanner = new Html5Qrcode(scannerRegionId);
      scannerRef.current = scanner;
      setScanning(true);
      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 8,
          qrbox: (viewW, viewH) => {
            const edge = Math.min(280, Math.floor(Math.min(viewW, viewH) * 0.78));
            return { width: edge, height: Math.floor(edge * 0.55) };
          },
          aspectRatio: 1.333,
        },
        (decoded) => {
          void resolveCode(decoded);
        },
        () => {
          /* ignore frame miss */
        }
      );
    } catch (e) {
      setScanning(false);
      scannerRef.current = null;
      const msg = e instanceof Error ? e.message : 'Camera unavailable';
      setError(
        /Permission|NotAllowed|denied/i.test(msg)
          ? 'Camera permission denied — type the barcode digits instead.'
          : 'Could not start camera — type the barcode digits instead.'
      );
    }
  };

  const submitManual = (e?: React.FormEvent) => {
    e?.preventDefault();
    void resolveCode(manual);
  };

  return (
    <div
      className={
        compact
          ? 'rounded-2xl border border-slate-200 bg-white p-3 space-y-3'
          : 'rounded-2xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm'
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-700 flex items-center gap-1.5">
            <ScanBarcode size={14} className="text-rose-600" />
            Scan barcode
          </h3>
          <p className="text-[10px] text-slate-400 font-medium mt-0.5">
            EAN/UPC on the box → product name. PC parts are not always in free databases.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={() => {
              void stopScanner();
              onClose();
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
            aria-label="Close scanner"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {!scanning ? (
          <button
            type="button"
            disabled={lookingUp}
            onClick={() => void startScanner()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase disabled:opacity-50"
          >
            <Camera size={13} />
            Open camera
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void stopScanner()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-[10px] font-black uppercase"
          >
            Stop camera
          </button>
        )}
      </div>

      <div
        id={scannerRegionId}
        className={`overflow-hidden rounded-xl bg-slate-900 ${
          scanning ? 'min-h-[200px]' : 'hidden'
        }`}
      />

      <form onSubmit={submitManual} className="space-y-1.5">
        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
          <Keyboard size={11} /> Or type / paste barcode
        </label>
        <div className="flex gap-1.5">
          <input
            inputMode="numeric"
            autoComplete="off"
            className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold outline-none focus:border-rose-400 focus:bg-white"
            placeholder="e.g. 4011200296908"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            disabled={lookingUp}
          />
          <button
            type="submit"
            disabled={lookingUp || !normalizeBarcodeInput(manual)}
            className="px-3 py-2.5 rounded-xl bg-rose-600 text-white text-[10px] font-black uppercase disabled:opacity-40"
          >
            {lookingUp ? <Loader2 size={14} className="animate-spin" /> : 'Lookup'}
          </button>
        </div>
      </form>

      {lastCode && lookingUp && (
        <p className="text-[10px] font-medium text-slate-500">Looking up {lastCode}…</p>
      )}
      {error && (
        <p className="text-[11px] font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-2.5 py-2">
          {error}
        </p>
      )}
    </div>
  );
};

export default BarcodeScanPanel;
