
import React, { useState, useEffect } from 'react';
import { X, Copy, RefreshCcw, Facebook, ShoppingBag, Globe, Share2, Wand2, Check, Sparkles } from 'lucide-react';
import { InventoryItem } from '../types';
import { generateCrossPostingContent, CrossPostContent } from '../services/geminiService';

interface Props {
  item: InventoryItem;
  onClose: () => void;
}

const CrossPostingModal: React.FC<Props> = ({ item, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState<CrossPostContent | null>(null);
  const [activeTab, setActiveTab] = useState<'ebay' | 'kleinanzeigen' | 'facebook'>('kleinanzeigen');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    generateContent();
  }, []);

  const generateContent = async () => {
    setLoading(true);
    try {
      const result = await generateCrossPostingContent(item);
      setContent(result);
    } catch (e) {
      console.error("Failed to generate cross-posting content", e);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const updateContent = (platform: keyof CrossPostContent, field: 'title' | 'description', value: string) => {
    if (!content) return;
    setContent({
      ...content,
      [platform]: {
        ...content[platform],
        [field]: value
      }
    });
  };

  const renderPlatformContent = (platform: 'ebay' | 'kleinanzeigen' | 'facebook') => {
    if (!content) return null;
    const data = content[platform];
    const isEbay = platform === 'ebay';
    const isFB = platform === 'facebook';

    if (!data) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-2">
                <Sparkles size={32} className="opacity-50"/>
                <p className="text-xs font-bold uppercase tracking-widest">No content generated for {platform}</p>
                <p className="text-[10px]">Try regenerating to get suggestions.</p>
            </div>
        );
    }

    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
        <div className="space-y-2">
          <div className="flex justify-between items-center">
             <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Optimized Title</label>
             <button 
                onClick={() => handleCopy(data.title, `${platform}-title`)}
                className={`text-[10px] font-bold uppercase flex items-center gap-1 transition-colors ${copiedField === `${platform}-title` ? 'text-emerald-500' : 'text-blue-500 hover:text-blue-600'}`}
             >
                {copiedField === `${platform}-title` ? <Check size={12}/> : <Copy size={12}/>}
                {copiedField === `${platform}-title` ? 'Copied' : 'Copy'}
             </button>
          </div>
          <input 
            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-100 transition-all"
            value={data.title || ''}
            onChange={e => updateContent(platform, 'title', e.target.value)}
          />
          <div className="flex justify-end">
             <span className={`text-[9px] font-bold ${data.title?.length > (isEbay ? 80 : 60) ? 'text-red-500' : 'text-slate-400'}`}>
                {data.title?.length || 0} / {isEbay ? 80 : isFB ? 100 : 60} chars
             </span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-center">
             <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Description</label>
             <button 
                onClick={() => handleCopy(data.description, `${platform}-desc`)}
                className={`text-[10px] font-bold uppercase flex items-center gap-1 transition-colors ${copiedField === `${platform}-desc` ? 'text-emerald-500' : 'text-blue-500 hover:text-blue-600'}`}
             >
                {copiedField === `${platform}-desc` ? <Check size={12}/> : <Copy size={12}/>}
                {copiedField === `${platform}-desc` ? 'Copied' : 'Copy'}
             </button>
          </div>
          <textarea 
            className="w-full px-5 py-4 bg-white border border-slate-200 rounded-2xl font-medium text-xs outline-none focus:ring-2 focus:ring-blue-100 transition-all min-h-[300px] leading-relaxed resize-none"
            value={data.description || ''}
            onChange={e => updateContent(platform, 'description', e.target.value)}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-4xl rounded-[3rem] shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh]">
        <header className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-2xl flex items-center justify-center shadow-lg">
              <Share2 size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">Cross-Posting Assistant</h2>
              <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest mt-1">Multi-Platform Listing Generator</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-white rounded-2xl transition-all text-slate-400">
            <X size={24} />
          </button>
        </header>

        <div className="flex flex-1 overflow-hidden">
           {/* Sidebar Tabs */}
           <div className="w-64 bg-slate-50 border-r border-slate-100 p-6 space-y-3 hidden md:block">
              <TabButton 
                 active={activeTab === 'kleinanzeigen'} 
                 onClick={() => setActiveTab('kleinanzeigen')} 
                 label="Kleinanzeigen" 
                 icon={<ShoppingBag size={18}/>}
                 color="bg-emerald-500"
              />
              <TabButton 
                 active={activeTab === 'ebay'} 
                 onClick={() => setActiveTab('ebay')} 
                 label="eBay.de" 
                 icon={<Globe size={18}/>}
                 color="bg-blue-600"
              />
              <TabButton 
                 active={activeTab === 'facebook'} 
                 onClick={() => setActiveTab('facebook')} 
                 label="Marketplace" 
                 icon={<Facebook size={18}/>}
                 color="bg-blue-500"
              />
           </div>

           {/* Content Area */}
           <div className="flex-1 p-8 overflow-y-auto bg-slate-50/30">
              {loading ? (
                 <div className="h-full flex flex-col items-center justify-center space-y-4 opacity-50">
                    <Wand2 size={48} className="animate-spin text-indigo-500"/>
                    <p className="font-black text-slate-400 uppercase tracking-widest text-xs">Generating optimized listings...</p>
                 </div>
              ) : (
                 <>
                    {/* Mobile Tabs */}
                    <div className="flex gap-2 mb-6 md:hidden overflow-x-auto pb-2">
                       <button onClick={() => setActiveTab('kleinanzeigen')} className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap ${activeTab === 'kleinanzeigen' ? 'bg-emerald-500 text-white' : 'bg-white border text-slate-500'}`}>Kleinanzeigen</button>
                       <button onClick={() => setActiveTab('ebay')} className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap ${activeTab === 'ebay' ? 'bg-blue-600 text-white' : 'bg-white border text-slate-500'}`}>eBay</button>
                       <button onClick={() => setActiveTab('facebook')} className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap ${activeTab === 'facebook' ? 'bg-blue-500 text-white' : 'bg-white border text-slate-500'}`}>Facebook</button>
                    </div>

                    {renderPlatformContent(activeTab)}
                 </>
              )}
           </div>
        </div>

        <footer className="p-6 border-t border-slate-100 flex justify-between bg-white shrink-0">
           <div className="text-[10px] font-bold text-slate-400 flex items-center gap-2">
              <Sparkles size={14} className="text-indigo-500"/> AI Generated • Review before posting
           </div>
           <button 
              onClick={generateContent} 
              disabled={loading}
              className="flex items-center gap-2 px-6 py-3 bg-slate-100 text-slate-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all disabled:opacity-50"
           >
              <RefreshCcw size={14}/> Regenerate
           </button>
        </footer>
      </div>
    </div>
  );
};

const TabButton = ({ active, onClick, label, icon, color }: any) => (
   <button 
      onClick={onClick}
      className={`w-full p-4 rounded-2xl flex items-center gap-3 transition-all ${active ? 'bg-white shadow-lg shadow-slate-100 ring-2 ring-indigo-50' : 'hover:bg-slate-100 text-slate-400'}`}
   >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-md transition-transform ${active ? 'scale-110' : ''} ${color}`}>
         {icon}
      </div>
      <span className={`text-xs font-bold ${active ? 'text-slate-900' : 'text-slate-500'}`}>{label}</span>
   </button>
);

export default CrossPostingModal;
