import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Check, ClipboardCopy, ExternalLink } from 'lucide-react';
import {
  CLAUDE_AUTOMATION_PLAYBOOK,
  CLAUDE_AUTOMATIONS,
  type ClaudeAutomation,
  type ClaudeAutomationId,
} from '../utils/claudeAutomations';

const AutomationCard: React.FC<{
  auto: ClaudeAutomation;
  active: boolean;
  onSelect: () => void;
  onCopied: (kind: string) => void;
  copiedKey: string | null;
}> = ({ auto, active, onSelect, onCopied, copiedKey }) => {
  const copy = async (text: string, kind: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onCopied(kind);
    } catch {
      /* ignore */
    }
  };

  const num = auto.id === 'inbound' ? '1' : auto.id === 'list_drafts' ? '2' : '3';

  return (
    <div
      className={`rounded-2xl border p-4 space-y-3 transition-colors ${
        active ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white'
      }`}
    >
      <button type="button" onClick={onSelect} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Automation {num}
            </p>
            <h2 className="text-[16px] font-semibold tracking-tight text-slate-900 mt-0.5">{auto.name}</h2>
            <p className="text-[12px] text-slate-500 font-medium mt-1">{auto.cadence}</p>
          </div>
          {active && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-900 text-white">
              Selected
            </span>
          )}
        </div>
      </button>

      <ul className="space-y-1">
        {auto.does.map((d) => (
          <li key={d} className="text-[12px] text-slate-700 flex gap-1.5">
            <Check size={13} className="text-emerald-600 shrink-0 mt-0.5" />
            <span>{d}</span>
          </li>
        ))}
      </ul>

      <div className="rounded-xl bg-amber-50 px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800 mb-1">Never</p>
        <ul className="space-y-0.5">
          {auto.never.map((n) => (
            <li key={n} className="text-[11px] text-amber-900/90 font-medium">
              {n}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {auto.openUrls.map((u) => (
          <Link
            key={u}
            to={u}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 hover:border-slate-400"
          >
            <ExternalLink size={11} /> {u.replace('/panel/', '')}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() => copy(auto.starter, `${auto.id}:starter`)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-[12px] font-semibold"
        >
          <ClipboardCopy size={13} />
          {copiedKey === `${auto.id}:starter` ? 'Copied starter' : 'Copy starter'}
        </button>
        <button
          type="button"
          onClick={() => copy(auto.prompt, `${auto.id}:prompt`)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-[12px] font-semibold text-slate-700"
        >
          <ClipboardCopy size={13} />
          {copiedKey === `${auto.id}:prompt` ? 'Copied prompt' : 'Copy full prompt'}
        </button>
      </div>
    </div>
  );
};

const ClaudeAutomationsPage: React.FC = () => {
  const [selected, setSelected] = useState<ClaudeAutomationId>('inbound');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const active = useMemo(
    () => CLAUDE_AUTOMATIONS.find((a) => a.id === selected) || CLAUDE_AUTOMATIONS[0],
    [selected],
  );

  const onCopied = (kind: string) => {
    setCopiedKey(kind);
    window.setTimeout(() => setCopiedKey(null), 1600);
  };

  return (
    <div className="space-y-5 pb-10 max-w-6xl">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 flex items-center gap-2">
          <Bot size={22} className="text-slate-700" /> Claude Automations
        </h1>
        <p className="text-[13px] text-slate-500 font-medium mt-0.5">
          Three separate chats — never mix. Copy starter into Claude Computer Use.
        </p>
      </header>

      <pre className="whitespace-pre-wrap text-[12px] leading-relaxed font-medium text-slate-700 rounded-2xl border border-slate-200 bg-white p-4">
        {CLAUDE_AUTOMATION_PLAYBOOK}
      </pre>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {CLAUDE_AUTOMATIONS.map((auto) => (
          <AutomationCard
            key={auto.id}
            auto={auto}
            active={auto.id === selected}
            onSelect={() => setSelected(auto.id)}
            onCopied={onCopied}
            copiedKey={copiedKey}
          />
        ))}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight">{active.name} — full prompt</h2>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(active.prompt).then(() => onCopied(`${active.id}:panel`));
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-[12px] font-semibold"
          >
            <ClipboardCopy size={13} />
            {copiedKey === `${active.id}:panel` ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre
          id={`claude-automation-prompt-${active.id}`}
          className="whitespace-pre-wrap text-[11px] leading-snug font-mono text-slate-700 bg-slate-50 border border-slate-100 rounded-xl p-3 max-h-[28rem] overflow-y-auto"
        >
          {active.prompt}
        </pre>
        <p className="text-[11px] text-slate-400">
          Related:{' '}
          <Link className="underline" to="/panel/list-ready?agent=1">
            List Ready
          </Link>
          {' · '}
          <Link className="underline" to="/panel/price-drop?agent=1">
            Price Drop
          </Link>
          {' · '}
          <Link className="underline" to="/panel/inventory">
            Inventory
          </Link>
        </p>
      </section>
    </div>
  );
};

export default ClaudeAutomationsPage;
