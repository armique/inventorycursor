import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  AGB_TITLE,
  AGB_CONTENT,
  DATENSCHUTZ_TITLE,
  DATENSCHUTZ_CONTENT,
  IMPRESSUM_TITLE,
  IMPRESSUM_CONTENT,
} from '../content/legal-de';

/** Render markdown-like content: **bold** and paragraphs */
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

const LEGAL_PAGES: Record<string, { title: string; content: string }> = {
  agb: { title: AGB_TITLE, content: AGB_CONTENT },
  datenschutz: { title: DATENSCHUTZ_TITLE, content: DATENSCHUTZ_CONTENT },
  impressum: { title: IMPRESSUM_TITLE, content: IMPRESSUM_CONTENT },
};

const LegalPage: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const slug = pathname.replace(/^\//, '').toLowerCase(); // e.g. "agb", "datenschutz", "impressum"
  const legal = LEGAL_PAGES[slug] ?? LEGAL_PAGES.impressum;

  return (
    <div
      className="min-h-screen flex flex-col bg-gradient-to-b from-slate-50 via-white to-slate-50/80 text-slate-900 antialiased"
      style={{ fontFamily: "'Outfit', system-ui, sans-serif" }}
    >
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-xl border-b border-slate-200/80 shadow-sm">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-xl font-bold tracking-tight text-slate-900 hover:text-slate-600 transition-colors"
          >
            ArmikTech
          </button>
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-3xl w-full px-4 sm:px-6 py-10 sm:py-14">
        <h1 className="text-2xl font-bold text-slate-900 mb-8">{legal.title}</h1>
        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm">
          {renderLegalContent(legal.content)}
        </div>
        <p className="mt-6 text-slate-500 text-xs">
          Bitte ersetzen Sie in Impressum und Datenschutz die Platzhalter (z. B. [Firmenname], [Adresse], [Ihre E-Mail]) durch Ihre eigenen Angaben.
        </p>
      </main>

      <footer className="mt-auto border-t border-slate-200/80 bg-slate-900 text-slate-300">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 flex flex-col items-center gap-1 text-center">
          <p className="text-slate-400 text-sm">© {new Date().getFullYear()} · ArmikTech</p>
          <div className="flex gap-4 mt-2">
            <button type="button" onClick={() => navigate('/')} className="text-slate-500 text-sm hover:text-white transition-colors">
              Zurück zu ArmikTech
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LegalPage;
