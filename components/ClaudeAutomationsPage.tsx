import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bot, Check, ClipboardCopy, ExternalLink } from 'lucide-react';
import {
  CLAUDE_AUTOMATION_PLAYBOOK,
  CLAUDE_AUTOMATION_SETUP,
  CLAUDE_AUTOMATIONS,
  CLAUDE_HUB_STARTER,
  exportClaudeAutomationsHubPayload,
  parseClaudeAutomationJobParam,
  type ClaudeAutomation,
  type ClaudeAutomationId,
} from '../utils/claudeAutomations';

declare global {
  interface Window {
    __CLAUDE_AUTOMATIONS_HUB__?: unknown;
  }
}

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
              Automation {auto.number}
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
            <ExternalLink size={11} /> {u.replace('/panel/', '').slice(0, 42)}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const agentMode = searchParams.get('agent') === '1';
  const jobFromUrl = parseClaudeAutomationJobParam(searchParams.get('job'));
  const [selected, setSelected] = useState<ClaudeAutomationId>(jobFromUrl || 'ebay_hunt');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const agentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (jobFromUrl) setSelected(jobFromUrl);
  }, [jobFromUrl]);

  const active = useMemo(
    () => CLAUDE_AUTOMATIONS.find((a) => a.id === selected) || CLAUDE_AUTOMATIONS[0],
    [selected],
  );

  const hubPayload = useMemo(() => exportClaudeAutomationsHubPayload(selected), [selected]);
  const hubJson = useMemo(() => JSON.stringify(hubPayload, null, 2), [hubPayload]);

  useEffect(() => {
    window.__CLAUDE_AUTOMATIONS_HUB__ = hubPayload;
  }, [hubPayload]);

  useEffect(() => {
    if (!agentMode) return;
    const t = window.setTimeout(() => {
      agentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => window.clearTimeout(t);
  }, [agentMode, selected]);

  const selectJob = (id: ClaudeAutomationId) => {
    setSelected(id);
    const next = new URLSearchParams(searchParams);
    next.set('job', id);
    if (agentMode) next.set('agent', '1');
    setSearchParams(next, { replace: true });
  };

  const onCopied = (kind: string) => {
    setCopiedKey(kind);
    window.setTimeout(() => setCopiedKey(null), 1600);
  };

  const agentUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/panel/automations?agent=1&job=${selected}`
      : `/panel/automations?agent=1&job=${selected}`;

  return (
    <div className="space-y-5 pb-10 max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 flex items-center gap-2">
            <Bot size={22} className="text-slate-700" /> Claude Automations
          </h1>
          <p className="text-[13px] text-slate-500 font-medium mt-0.5">
            Tell Claude: open this page and do what it says. One job = one Claude automation.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(CLAUDE_HUB_STARTER).then(() => onCopied('hub'));
          }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-[12px] font-semibold"
        >
          <ClipboardCopy size={13} />
          {copiedKey === 'hub' ? 'Copied' : 'Copy hub starter'}
        </button>
      </header>

      <section
        ref={agentRef}
        id="claude-automations-hub"
        data-claude-hub-ready="true"
        data-active-job={selected}
        className={`rounded-2xl border p-4 space-y-4 ${
          agentMode ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white'
        }`}
      >
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Agent hub (Claude reads this)</h2>
          <p className="text-[12px] text-slate-500 font-medium mt-0.5">
            URL:{' '}
            <span className="font-mono text-[11px] text-slate-400 break-all">{agentUrl}</span>
          </p>
        </div>

        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Playbook</p>
          <pre
            id="claude-automations-playbook"
            className="whitespace-pre-wrap text-[12px] leading-relaxed font-medium text-slate-700 rounded-xl border border-slate-200 bg-white p-3 max-h-64 overflow-y-auto"
          >
            {CLAUDE_AUTOMATION_PLAYBOOK}
          </pre>
        </div>

        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">
            Setup — create each automation separately
          </p>
          <pre
            id="claude-automations-setup"
            className="whitespace-pre-wrap text-[12px] leading-relaxed font-medium text-slate-700 rounded-xl border border-amber-200 bg-amber-50/80 p-3 max-h-72 overflow-y-auto"
          >
            {CLAUDE_AUTOMATION_SETUP}
          </pre>
        </div>

        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">
            Hub JSON · active job = {selected}
          </p>
          <pre
            id="claude-automations-hub-json"
            className="whitespace-pre text-[10px] leading-snug font-mono bg-slate-900 text-slate-100 rounded-xl p-3 max-h-40 overflow-auto"
          >
            {hubJson}
          </pre>
        </div>

        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">
            Active job brief · {active.name}
          </p>
          <pre
            id="claude-automation-active-brief"
            className="whitespace-pre-wrap text-[11px] leading-snug font-mono text-slate-700 bg-white border border-slate-200 rounded-xl p-3 max-h-56 overflow-y-auto"
          >
            {active.prompt}
          </pre>
          <p className="text-[12px] text-slate-600 font-medium mt-2">
            After reading: open the job URL and continue there (List Ready / Price Drop / Lot Hunt have their own JSON).
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {active.openUrls.map((u) => (
              <Link
                key={u}
                to={u}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-700"
              >
                <ExternalLink size={11} /> {u}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {CLAUDE_AUTOMATIONS.map((auto) => (
          <AutomationCard
            key={auto.id}
            auto={auto}
            active={auto.id === selected}
            onSelect={() => selectJob(auto.id)}
            onCopied={onCopied}
            copiedKey={copiedKey}
          />
        ))}
      </div>

      <p className="text-[11px] text-slate-400">
        Related:{' '}
        <Link className="underline" to="/panel/ebay-hunt?agent=1">
          Lot Hunt
        </Link>
        {' · '}
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
    </div>
  );
};

export default ClaudeAutomationsPage;
