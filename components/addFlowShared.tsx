import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  PlusCircle,
  Monitor,
  Package,
  Boxes,
  Layers,
  Printer,
  CloudUpload,
  ChevronRight,
  ArrowLeft,
  Save,
} from 'lucide-react';

export type AddOption = {
  id: string;
  label: string;
  hint: string;
  to: string;
  icon: React.ReactNode;
  group: 'create' | 'import';
};

export const ADD_OPTIONS: AddOption[] = [
  {
    id: 'single',
    label: 'Single item',
    hint: 'One product',
    to: '/panel/add/item',
    icon: <PlusCircle size={22} strokeWidth={1.75} />,
    group: 'create',
  },
  {
    id: 'bulk',
    label: 'Bulk entry',
    hint: 'Many rows',
    to: '/panel/add-bulk',
    icon: <Layers size={22} strokeWidth={1.75} />,
    group: 'create',
  },
  {
    id: 'pc',
    label: 'PC Build',
    hint: 'Slot kit',
    to: '/panel/builder?mode=pc',
    icon: <Monitor size={22} strokeWidth={1.75} />,
    group: 'create',
  },
  {
    id: 'bundle',
    label: 'Bundle',
    hint: 'Aufrustkit',
    to: '/panel/builder?mode=bundle',
    icon: <Package size={22} strokeWidth={1.75} />,
    group: 'create',
  },
  {
    id: 'mixed',
    label: 'Mixed',
    hint: 'Any parts',
    to: '/panel/builder?mode=mixed',
    icon: <Boxes size={22} strokeWidth={1.75} />,
    group: 'create',
  },
  {
    id: 'print3d',
    label: '3D print',
    hint: 'Cost & stock',
    to: '/panel/3d-print',
    icon: <Printer size={22} strokeWidth={1.75} />,
    group: 'create',
  },
  {
    id: 'csv',
    label: 'Import CSV',
    hint: 'Spreadsheet',
    to: '/panel/import',
    icon: <CloudUpload size={22} strokeWidth={1.75} />,
    group: 'import',
  },
];

export const ADD_FLOW_LABEL =
  'text-[10px] font-black uppercase tracking-[0.18em] text-slate-400';

export const ADD_FLOW_INPUT =
  'w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-slate-400 focus:bg-white transition-all';

export const ADD_FLOW_PANEL =
  'bg-white rounded-2xl border border-slate-200 shadow-[0_1px_0_rgba(15,23,42,0.04)]';

type AddOptionTileProps = {
  label: string;
  hint?: string;
  icon: React.ReactNode;
  onClick: () => void;
  selected?: boolean;
  /** Soften unselected peers once a choice is made. */
  dimmed?: boolean;
  size?: 'md' | 'sm';
  /**
   * boxed = single rectangular card (icon + label inside).
   * default = icon chip with label underneath (Add hub / categories).
   */
  layout?: 'default' | 'boxed';
  className?: string;
};

/** Shared icon-above-label control for the Add hub and every add/compose picker. */
export function AddOptionTile({
  label,
  hint,
  icon,
  onClick,
  selected = false,
  dimmed = false,
  size = 'md',
  layout = 'default',
  className = '',
}: AddOptionTileProps) {
  const sm = size === 'sm';

  if (layout === 'boxed') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected || undefined}
        className={`group flex flex-col items-center justify-center text-center gap-2.5 rounded-2xl border transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 min-h-[5.75rem] sm:min-h-[6.5rem] px-3 py-3.5 ${
          selected
            ? 'bg-teal-50 border-teal-300 text-teal-900 shadow-[0_1px_0_rgba(13,148,136,0.12)] ring-1 ring-teal-200/80'
            : 'bg-white border-slate-200 text-slate-800 hover:border-slate-300 hover:bg-slate-50'
        } ${
          dimmed && !selected ? 'opacity-40 blur-[0.5px] hover:opacity-70 hover:blur-0' : ''
        } ${className}`}
      >
        <span
          className={`inline-flex items-center justify-center transition-transform duration-200 group-hover:-translate-y-0.5 ${
            selected ? 'text-teal-700' : 'text-slate-600 group-hover:text-slate-900'
          }`}
        >
          {icon}
        </span>
        <span className="min-w-0 w-full">
          <span
            className={`block font-bold leading-snug line-clamp-2 ${
              sm ? 'text-[12px]' : 'text-[13px] sm:text-sm'
            } ${selected ? 'text-teal-950' : 'text-slate-900'}`}
          >
            {label}
          </span>
          {hint ? (
            <span
              className={`block text-[10px] font-semibold mt-0.5 leading-tight line-clamp-1 ${
                selected ? 'text-teal-700/80' : 'text-slate-500'
              }`}
            >
              {hint}
            </span>
          ) : null}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected || undefined}
      className={`group flex flex-col items-center justify-start text-center transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 rounded-2xl ${
        sm ? 'gap-2 px-1.5 py-3' : 'gap-2.5 px-2 py-4'
      } ${
        selected
          ? 'bg-teal-50/90 ring-1 ring-teal-200/80'
          : 'hover:bg-slate-100/80'
      } ${
        dimmed && !selected ? 'opacity-40 blur-[0.5px] hover:opacity-70 hover:blur-0' : ''
      } ${className}`}
    >
      <span
        className={`rounded-2xl border inline-flex items-center justify-center transition-all duration-200 group-hover:-translate-y-0.5 ${
          sm ? 'w-11 h-11' : 'w-14 h-14'
        } ${
          selected
            ? 'bg-teal-100/80 border-teal-300 text-teal-800 shadow-[0_1px_0_rgba(13,148,136,0.12)]'
            : 'bg-white border-slate-200 text-slate-700 shadow-[0_1px_0_rgba(15,23,42,0.04)] group-hover:border-slate-300 group-hover:text-slate-900'
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 w-full">
        <span
          className={`block font-bold leading-tight ${sm ? 'text-[12px]' : 'text-[13px]'} ${
            selected ? 'text-teal-900' : 'text-slate-900'
          }`}
        >
          {label}
        </span>
        {hint ? (
          <span
            className={`block text-[10px] font-semibold mt-0.5 leading-tight ${
              selected ? 'text-teal-700/75' : 'text-slate-500'
            }`}
          >
            {hint}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export const ADD_HUB_PATH = '/panel/add';
const ADD_LAST_STEP2_KEY = 'deinventory.addFlow.lastStep2';

export function rememberAddStep2Path(path: string) {
  if (!path || path === ADD_HUB_PATH || path.startsWith(`${ADD_HUB_PATH}?`)) return;
  try {
    sessionStorage.setItem(ADD_LAST_STEP2_KEY, path);
  } catch {
    /* ignore */
  }
}

export function getRememberedAddStep2Path(): string | null {
  try {
    const path = sessionStorage.getItem(ADD_LAST_STEP2_KEY);
    if (!path || path === ADD_HUB_PATH) return null;
    return path;
  } catch {
    return null;
  }
}

function stepChipClass(active: boolean) {
  return `w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] tabular-nums ${
    active ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-600'
  }`;
}

/** Shared 1 · Choose → 2 · Details rail. Numbers navigate between hub and last details page. */
export function AddFlowStepRail({ step }: { step: 1 | 2 }) {
  const navigate = useNavigate();
  const location = useLocation();
  const step2Path = getRememberedAddStep2Path();
  const canGoToStep2 = Boolean(step2Path) && step === 1;

  React.useEffect(() => {
    if (step !== 2) return;
    rememberAddStep2Path(`${location.pathname}${location.search}`);
  }, [step, location.pathname, location.search]);

  const goStep1 = () => {
    if (location.pathname === ADD_HUB_PATH) return;
    navigate(ADD_HUB_PATH);
  };

  const goStep2 = () => {
    if (!step2Path || location.pathname + location.search === step2Path) return;
    navigate(step2Path);
  };

  return (
    <ol className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
      <li>
        <button
          type="button"
          onClick={goStep1}
          disabled={step === 1}
          aria-current={step === 1 ? 'step' : undefined}
          title="Step 1 · Choose type"
          className={`inline-flex items-center gap-1.5 rounded-full pr-1.5 -ml-0.5 pl-0.5 py-0.5 transition-colors ${
            step === 1
              ? 'text-slate-900 cursor-default'
              : 'hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <span className={stepChipClass(step === 1)}>1</span>
          Choose
        </button>
      </li>
      <ChevronRight size={12} className="text-slate-300 shrink-0" aria-hidden />
      <li>
        <button
          type="button"
          onClick={goStep2}
          disabled={step === 2 || !canGoToStep2}
          aria-current={step === 2 ? 'step' : undefined}
          title={
            step === 2
              ? 'Step 2 · Details'
              : canGoToStep2
                ? 'Step 2 · Back to details'
                : 'Pick a type first'
          }
          className={`inline-flex items-center gap-1.5 rounded-full pr-1.5 -ml-0.5 pl-0.5 py-0.5 transition-colors ${
            step === 2
              ? 'text-slate-900 cursor-default'
              : canGoToStep2
                ? 'hover:text-slate-900 hover:bg-slate-100'
                : 'opacity-50 cursor-not-allowed'
          }`}
        >
          <span className={stepChipClass(step === 2)}>2</span>
          Details
        </button>
      </li>
    </ol>
  );
}

/** Thin step chrome for Add destinations (step 2). */
export function AddFlowStepHeader({ title }: { title: string }) {
  return (
    <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-1">
      <AddFlowStepRail step={2} />
      <div className="flex items-center gap-3 min-w-0">
        <p className="text-sm font-bold text-slate-800 truncate">{title}</p>
        <Link
          to={ADD_HUB_PATH}
          className="shrink-0 text-[11px] font-black uppercase tracking-wider text-slate-500 hover:text-slate-900"
        >
          Change type
        </Link>
      </div>
    </div>
  );
}

export function AddFlowBackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="p-2.5 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-slate-900 transition-all shrink-0"
      aria-label="Back"
    >
      <ArrowLeft size={22} />
    </button>
  );
}

export function AddFlowPrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${className}`}
    >
      {children}
    </button>
  );
}

export function AddFlowSecondaryButton({
  children,
  onClick,
  disabled,
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-[11px] font-black uppercase tracking-widest hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${className}`}
    >
      {children}
    </button>
  );
}

/** Shared page header for New Asset + builders. */
export function AddFlowPageHeader({
  icon,
  title,
  subtitle,
  onBack,
  actions,
  below,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onBack: () => void;
  actions?: React.ReactNode;
  below?: React.ReactNode;
}) {
  return (
    <header className={`${ADD_FLOW_PANEL} px-4 py-3 mb-4 shrink-0`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <AddFlowBackButton onClick={onBack} />
          <span className="w-11 h-11 rounded-2xl bg-white border border-slate-200 text-slate-700 shadow-[0_1px_0_rgba(15,23,42,0.04)] inline-flex items-center justify-center shrink-0">
            {icon}
          </span>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-display font-black tracking-tight text-slate-900 truncate">
              {title}
            </h1>
            {subtitle ? (
              <p className="text-xs sm:text-sm font-semibold text-slate-500 truncate mt-0.5">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex items-center gap-2 flex-wrap justify-end">{actions}</div> : null}
      </div>
      {below}
    </header>
  );
}

/** Switch between PC / Bundle / Mixed without leaving the Add flow. */
export function AddFlowBuilderModeSwitch({ active }: { active: 'pc' | 'bundle' | 'mixed' }) {
  const navigate = useNavigate();
  const modes = [
    {
      id: 'pc' as const,
      label: 'PC Build',
      hint: 'Slot kit',
      icon: <Monitor size={18} strokeWidth={1.75} />,
      to: '/panel/builder?mode=pc',
    },
    {
      id: 'bundle' as const,
      label: 'Bundle',
      hint: 'Aufrustkit',
      icon: <Package size={18} strokeWidth={1.75} />,
      to: '/panel/builder?mode=bundle',
    },
    {
      id: 'mixed' as const,
      label: 'Mixed',
      hint: 'Any parts',
      icon: <Boxes size={18} strokeWidth={1.75} />,
      to: '/panel/builder?mode=mixed',
    },
  ];
  return (
    <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-3 gap-1 max-w-md">
      {modes.map((m) => (
        <AddOptionTile
          key={m.id}
          size="sm"
          label={m.label}
          hint={m.hint}
          icon={m.icon}
          selected={active === m.id}
          onClick={() => {
            if (active !== m.id) navigate(m.to);
          }}
          className="!py-2"
        />
      ))}
    </div>
  );
}

export function AddFlowTotalBadge({ label = 'Total', value }: { label?: string; value: string }) {
  return (
    <div className="text-right px-4 py-2 rounded-xl bg-slate-900 text-white min-w-[5.5rem]">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="text-lg font-black tabular-nums leading-tight">{value}</p>
    </div>
  );
}

export function AddFlowSaveButton({
  onClick,
  label = 'Save',
  disabled,
}: {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <AddFlowPrimaryButton onClick={onClick} disabled={disabled}>
      <Save size={16} /> {label}
    </AddFlowPrimaryButton>
  );
}
