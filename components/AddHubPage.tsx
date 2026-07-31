import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ADD_OPTIONS, AddOptionTile, AddFlowStepRail, type AddOption } from './addFlowShared';

/**
 * Step 1 of Add: pick what to create/import.
 * Destinations keep their existing forms/builders as step 2.
 */
const AddHubPage: React.FC = () => {
  const navigate = useNavigate();
  const createOptions = ADD_OPTIONS.filter((o) => o.group === 'create');
  const importOptions = ADD_OPTIONS.filter((o) => o.group === 'import');

  const renderGrid = (options: AddOption[]) => (
    <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-6 gap-1 sm:gap-2">
      {options.map((opt) => (
        <AddOptionTile
          key={opt.id}
          label={opt.label}
          hint={opt.hint}
          icon={opt.icon}
          onClick={() => navigate(opt.to)}
        />
      ))}
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto w-full px-1 sm:px-2 pb-24 md:pb-8">
      <div className="mb-8 space-y-3">
        <AddFlowStepRail step={1} />
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-black tracking-tight text-slate-900">
            Add to inventory
          </h1>
          <p className="text-sm font-semibold text-slate-500 mt-1 max-w-md">
            Choose what you want to add. You’ll fill in the details next.
          </p>
        </div>
      </div>

      <section className="mb-10">
        <h2 className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 mb-3 px-1">
          Create
        </h2>
        {renderGrid(createOptions)}
      </section>

      <section>
        <h2 className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 mb-3 px-1">
          Import
        </h2>
        {renderGrid(importOptions)}
      </section>

      <p className="mt-10 text-center text-[11px] font-semibold text-slate-400">
        Tip: press{' '}
        <kbd className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px]">n</kbd>{' '}
        anytime to open this screen.
      </p>
    </div>
  );
};

export default AddHubPage;

export { AddFlowStepHeader } from './addFlowShared';
