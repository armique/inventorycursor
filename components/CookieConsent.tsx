import React from 'react';
import { X } from 'lucide-react';

const STORAGE_KEY = 'armiktech_cookie_consent';

export function getCookieConsentAccepted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

interface CookieConsentProps {
  onAccept: () => void;
  onPrivacyClick: () => void;
}

const CookieConsent: React.FC<CookieConsentProps> = ({ onAccept, onPrivacyClick }) => {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-[130] px-4 py-3 bg-slate-800/95 backdrop-blur-sm border-t border-slate-700 shadow-lg">
      <div className="mx-auto max-w-6xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-slate-200 text-sm">
          Wir nutzen Cookies und Analytics, um die Nutzung der Website zu verbessern.
          <button type="button" onClick={onPrivacyClick} className="ml-1 underline hover:text-white">
            Datenschutz
          </button>
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onAccept}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 transition-colors"
          >
            Verstanden
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="p-2 rounded-lg text-slate-400 hover:text-white transition-colors"
            aria-label="Schließen"
          >
            <X size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default CookieConsent;
