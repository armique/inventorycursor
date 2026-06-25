import React, { useState } from 'react';
import { X } from 'lucide-react';

const STORAGE_KEY = 'armiktech_cookie_consent_v2';

export type CookieConsentLevel = 'none' | 'essential' | 'analytics';

export function getCookieConsentLevel(): CookieConsentLevel {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'analytics' || v === 'essential') return v;
    return 'none';
  } catch {
    return 'none';
  }
}

export function getCookieConsentAccepted(): boolean {
  return getCookieConsentLevel() !== 'none';
}

interface CookieConsentProps {
  onAccept: (level: CookieConsentLevel) => void;
  onPrivacyClick: () => void;
}

const CookieConsent: React.FC<CookieConsentProps> = ({ onAccept, onPrivacyClick }) => {
  const [showDetails, setShowDetails] = useState(false);

  const save = (level: CookieConsentLevel) => {
    try {
      localStorage.setItem(STORAGE_KEY, level);
    } catch {
      /* ignore */
    }
    onAccept(level);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[130] px-4 py-3 bg-slate-800/95 backdrop-blur-sm border-t border-slate-700 shadow-lg">
      <div className="mx-auto max-w-6xl flex flex-col gap-3">
        <p className="text-slate-200 text-sm">
          Wir nutzen technisch notwendige Speicher (z. B. Warenkorb/Wunschliste) und optional Analytics (Vercel), um die Website zu verbessern.
          <button type="button" onClick={onPrivacyClick} className="ml-1 underline hover:text-white">
            Datenschutz
          </button>
        </p>
        {showDetails && (
          <p className="text-xs text-slate-400">
            <strong>Essentiell:</strong> Session, Sprache, Cookie-Einstellung. <strong>Analytics:</strong> anonyme Nutzungsstatistik — nur wenn Sie zustimmen.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button type="button" onClick={() => save('essential')} className="px-4 py-2 rounded-xl bg-slate-700 text-white text-sm font-semibold hover:bg-slate-600">
            Nur notwendige
          </button>
          <button type="button" onClick={() => save('analytics')} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700">
            Analytics erlauben
          </button>
          <button type="button" onClick={() => setShowDetails((v) => !v)} className="text-xs text-slate-400 underline">
            {showDetails ? 'Weniger' : 'Details'}
          </button>
          <button type="button" onClick={() => save('essential')} className="p-2 rounded-lg text-slate-400 hover:text-white ml-auto" aria-label="Schließen">
            <X size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default CookieConsent;
