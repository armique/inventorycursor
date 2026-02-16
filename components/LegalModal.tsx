import React from 'react';
import { X } from 'lucide-react';
import {
  AGB_TITLE,
  AGB_CONTENT,
  DATENSCHUTZ_TITLE,
  DATENSCHUTZ_CONTENT,
  IMPRESSUM_TITLE,
  IMPRESSUM_CONTENT,
} from '../content/legal-de';

const LEGAL_PAGES: Record<string, { title: string; content: string }> = {
  agb: { title: AGB_TITLE, content: AGB_CONTENT },
  datenschutz: { title: DATENSCHUTZ_TITLE, content: DATENSCHUTZ_CONTENT },
  impressum: { title: IMPRESSUM_TITLE, content: IMPRESSUM_CONTENT },
};

function renderLegalContent(text: string) {
  const paragraphs = text.trim().split(/\n\n+/);
  return paragraphs.map((para, i) => {
    const parts: (string | React.ReactNode)[] = [];
    let rest = para.trim();
    let key = 0;
    while (rest.length > 0) {
      const boldStart = rest.indexOf('**');
      if (boldStart === -1) {
        parts.push(rest);
        break;
      }
      if (boldStart > 0) parts.push(rest.slice(0, boldStart));
      rest = rest.slice(boldStart + 2);
      const boldEnd = rest.indexOf('**');
      if (boldEnd === -1) {
        parts.push(rest);
        break;
      }
      parts.push(<strong key={key++}>{rest.slice(0, boldEnd)}</strong>);
      rest = rest.slice(boldEnd + 2);
    }
    return (
      <p key={i} className="mb-4 text-slate-700 text-sm leading-relaxed last:mb-0">
        {parts}
      </p>
    );
  });
}

export type LegalModalType = 'agb' | 'datenschutz' | 'impressum';

interface LegalModalProps {
  type: LegalModalType;
  onClose: () => void;
  closeLabel?: string;
}

const LegalModal: React.FC<LegalModalProps> = ({ type, onClose, closeLabel = 'Schließen' }) => {
  const legal = LEGAL_PAGES[type] ?? LEGAL_PAGES.impressum;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-lg font-bold text-slate-900">{legal.title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors"
            aria-label={closeLabel}
          >
            <X size={22} />
          </button>
        </div>
        <div className="px-4 sm:px-6 py-5 overflow-y-auto flex-1 min-h-0">
          {renderLegalContent(legal.content)}
        </div>
        <div className="px-4 sm:px-6 py-4 border-t border-slate-200 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors"
          >
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LegalModal;
