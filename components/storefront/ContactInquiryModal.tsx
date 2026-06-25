import React from 'react';
import { Loader2, Send, X } from 'lucide-react';
import type { StorefrontTexts } from './storefrontTexts';
import type { StoreItem } from './storefrontUtils';

interface Props {
  item: StoreItem;
  texts: StorefrontTexts;
  darkMode: boolean;
  form: { name: string; email: string; phone: string; message: string };
  onFormChange: (patch: Partial<Props['form']>) => void;
  sending: boolean;
  sent: boolean;
  onSend: () => void;
  onClose: () => void;
}

const ContactInquiryModal: React.FC<Props> = ({
  item,
  texts,
  darkMode,
  form,
  onFormChange,
  sending,
  sent,
  onSend,
  onClose,
}) => (
  <div
    className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-zinc-900/60 backdrop-blur-sm animate-in fade-in"
    onClick={() => !sending && onClose()}
  >
    <div
      className={`w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl border p-6 sm:p-8 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200 ${
        darkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-zinc-200'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h3 className={`font-bold text-lg ${darkMode ? 'text-white' : 'text-zinc-900'}`}>{texts.aboutItem}</h3>
          <p className={`text-sm mt-1 font-medium line-clamp-2 ${darkMode ? 'text-zinc-400' : 'text-zinc-600'}`}>
            {item.name}
          </p>
        </div>
        <button
          type="button"
          onClick={() => !sending && onClose()}
          className={`p-2 rounded-xl shrink-0 ${darkMode ? 'hover:bg-zinc-800 text-zinc-500' : 'hover:bg-zinc-100 text-zinc-400'}`}
        >
          <X size={20} />
        </button>
      </div>

      {sent ? (
        <div className="text-center py-8">
          <div className="w-12 h-12 rounded-full bg-emerald-500/15 text-emerald-500 flex items-center justify-center mx-auto mb-3">
            <Send size={20} />
          </div>
          <p className="text-emerald-600 dark:text-emerald-400 font-semibold">{texts.sent}</p>
          <button type="button" onClick={onClose} className={`mt-4 text-sm underline ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
            {texts.close}
          </button>
        </div>
      ) : (
        <>
          {(['name', 'email', 'phone'] as const).map((field) => (
            <input
              key={field}
              type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'}
              value={form[field]}
              onChange={(e) => onFormChange({ [field]: e.target.value })}
              placeholder={field === 'name' ? texts.yourName : field === 'email' ? texts.yourEmail : texts.yourPhone}
              className={`w-full mb-3 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-brand-500/30 ${
                darkMode ? 'bg-zinc-900 border border-zinc-700 text-zinc-100' : 'border border-zinc-200 text-zinc-900'
              }`}
            />
          ))}
          <textarea
            value={form.message}
            onChange={(e) => onFormChange({ message: e.target.value })}
            placeholder={texts.yourMessage}
            rows={3}
            className={`w-full mb-5 rounded-xl px-4 py-3 text-sm outline-none resize-none focus:ring-2 focus:ring-brand-500/30 ${
              darkMode ? 'bg-zinc-900 border border-zinc-700 text-zinc-100' : 'border border-zinc-200 text-zinc-900'
            }`}
          />
          <button
            type="button"
            onClick={onSend}
            disabled={sending}
            className="w-full py-3.5 rounded-xl bg-brand-600 text-white text-sm font-bold flex items-center justify-center gap-2 hover:bg-brand-700 disabled:opacity-60 transition-colors"
          >
            {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={16} />}
            {texts.send}
          </button>
        </>
      )}
    </div>
  </div>
);

export default ContactInquiryModal;
