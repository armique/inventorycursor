import React, { useState } from 'react';
import { Rocket, Key, Package, X, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const STORAGE_KEY = 'onboarding_complete_v1';

export function isOnboardingComplete(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function markOnboardingComplete(): void {
  localStorage.setItem(STORAGE_KEY, 'true');
}

interface Props {
  onComplete: () => void;
}

const OnboardingWizard: React.FC<Props> = ({ onComplete }) => {
  const [step, setStep] = useState(0);

  const finish = () => {
    markOnboardingComplete();
    onComplete();
  };

  const steps = [
    {
      title: 'Welcome to DeInventory Pro',
      body: 'Track PC parts from buy to sell across Kleinanzeigen, eBay, and your storefront.',
      icon: <Rocket className="text-blue-500" size={32} />,
    },
    {
      title: 'Business & tax settings',
      body: 'Set company name, tax mode (Kleinunternehmer / §25a / regular VAT), and bank details under Settings → Business.',
      icon: <Package className="text-emerald-500" size={32} />,
    },
    {
      title: 'Optional AI keys',
      body: 'Add VITE_GEMINI_API_KEY or GROQ_API_KEY in .env for specs fill and Deal Hunter. Check Health under the panel menu.',
      icon: <Key className="text-amber-500" size={32} />,
    },
  ];

  const current = steps[step];

  return (
    <div className="fixed inset-0 z-[400] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-[2rem] shadow-2xl border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-start">
          <div className="p-3 rounded-2xl bg-slate-50">{current.icon}</div>
          <button type="button" onClick={finish} className="p-2 text-slate-400 hover:text-slate-700" aria-label="Skip">
            <X size={20} />
          </button>
        </div>
        <div className="p-8 space-y-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Step {step + 1} of {steps.length}
          </p>
          <h2 className="text-xl font-black text-slate-900">{current.title}</h2>
          <p className="text-sm text-slate-600 leading-relaxed">{current.body}</p>
          {step === steps.length - 1 && (
            <Link
              to="/panel/add"
              className="inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:underline"
              onClick={finish}
            >
              Add your first item <ChevronRight size={16} />
            </Link>
          )}
        </div>
        <div className="p-6 bg-slate-50 flex justify-between">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => setStep((s) => s - 1)}
            className="px-4 py-2 text-xs font-bold text-slate-500 disabled:opacity-30"
          >
            Back
          </button>
          {step < steps.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              className="px-6 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-black uppercase"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={finish}
              className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-black uppercase"
            >
              Get started
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default OnboardingWizard;
