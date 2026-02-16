import React from 'react';
import { X } from 'lucide-react';
import { ABOUT_TITLE, ABOUT_CONTENT, CONTACT_TITLE, CONTACT_INTRO } from '../content/about-contact';

function renderContent(text: string) {
  return text.trim().split(/\n\n+/).map((para, i) => {
    const boldRegex = /\*\*(.+?)\*\*/g;
    const parts: (string | React.ReactNode)[] = [];
    let lastIndex = 0;
    let match;
    let key = 0;
    while ((match = boldRegex.exec(para)) !== null) {
      if (match.index > lastIndex) parts.push(para.slice(lastIndex, match.index));
      parts.push(<strong key={key++}>{match[1]}</strong>);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < para.length) parts.push(para.slice(lastIndex));
    return (
      <p key={i} className="mb-4 text-slate-700 text-sm leading-relaxed last:mb-0">
        {parts}
      </p>
    );
  });
}

interface AboutContactModalProps {
  type: 'about' | 'contact';
  onClose: () => void;
  onOpenPrivacy?: () => void;
}

const AboutContactModal: React.FC<AboutContactModalProps> = ({ type, onClose, onOpenPrivacy }) => {
  const isAbout = type === 'about';
  const title = isAbout ? ABOUT_TITLE : CONTACT_TITLE;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col border border-slate-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500" aria-label="Schließen">
            <X size={22} />
          </button>
        </div>
        <div className="px-4 sm:px-6 py-5 overflow-y-auto flex-1 min-h-0">
          {isAbout ? (
            renderContent(ABOUT_CONTENT)
          ) : (
            <>
              <p className="text-slate-700 text-sm leading-relaxed mb-4">{CONTACT_INTRO}</p>
              <p className="text-slate-600 text-sm">
                Nutzen Sie für konkrete Artikel die „Anfrage senden“-Funktion direkt beim Produkt. Für allgemeine Anfragen:{' '}
                <a href="mailto:kontakt@armiktech.com" className="text-slate-900 font-semibold underline hover:no-underline">
                  kontakt@armiktech.com
                </a>
              </p>
              {onOpenPrivacy && (
                <button type="button" onClick={onOpenPrivacy} className="mt-4 text-sm text-slate-500 underline hover:text-slate-900">
                  Datenschutzerklärung
                </button>
              )}
            </>
          )}
        </div>
        <div className="px-4 sm:px-6 py-4 border-t border-slate-200 shrink-0">
          <button type="button" onClick={onClose} className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800">
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
};

export default AboutContactModal;
