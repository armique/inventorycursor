
import React, { useState, useEffect } from 'react';
import { 
  Download, 
  Upload, 
  RotateCcw, 
  ShieldCheck, 
  Database, 
  History, 
  Trash2,
  FileJson,
  CheckCircle2,
  AlertTriangle,
  Copy,
  ClipboardPaste,
  Zap
} from 'lucide-react';
import { InventoryItem, BackupEntry } from '../types';

interface Props {
  currentItems: InventoryItem[];
  onRestore: (items: InventoryItem[]) => void;
}

const BackupManager: React.FC<Props> = ({ currentItems, onRestore }) => {
  const [archives, setArchives] = useState<BackupEntry[]>([]);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [recoveryString, setRecoveryString] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('inventory_archives');
    if (saved) {
      setArchives(JSON.parse(saved));
    }
  }, []);

  const saveArchives = (newArchives: BackupEntry[]) => {
    setArchives(newArchives);
    localStorage.setItem('inventory_archives', JSON.stringify(newArchives));
  };

  const handleManualBackup = () => {
    const newBackup: BackupEntry = {
      id: `manual-${Date.now()}`,
      date: new Date().toLocaleString(),
      itemCount: currentItems.length,
      data: JSON.stringify(currentItems)
    };
    saveArchives([newBackup, ...archives]);
    setStatus({ type: 'success', message: 'Резервная копия успешно создана' });
  };

  const handleRestore = (data: string) => {
    if (window.confirm('Вы уверены, что хотите восстановить данные? Текущий список товаров будет заменен.')) {
      try {
        const items = JSON.parse(data);
        onRestore(items);
        setStatus({ type: 'success', message: 'Данные успешно восстановлены' });
      } catch (e) {
        setStatus({ type: 'error', message: 'Ошибка при восстановлении данных' });
      }
    }
  };

  // Modern Base64 Unicode Helper
  const encodeUnicode = (str: string) => {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const decodeUnicode = (base64: string) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  };

  const handleQuickRestore = () => {
    if (!recoveryString.trim()) return;
    try {
      const decoded = decodeUnicode(recoveryString.trim());
      const items = JSON.parse(decoded);
      if (Array.isArray(items)) {
        onRestore(items);
        setStatus({ type: 'success', message: 'Инвентарь мгновенно восстановлен!' });
        setRecoveryString('');
      }
    } catch (e) {
      console.error(e);
      setStatus({ type: 'error', message: 'Неверный формат строки восстановления' });
    }
  };

  const copyFullBackupToClipboard = () => {
    try {
      const dataStr = JSON.stringify(currentItems);
      const encoded = encodeUnicode(dataStr);
      navigator.clipboard.writeText(encoded);
      setStatus({ type: 'success', message: 'Строка восстановления скопирована в буфер!' });
    } catch (e) {
      setStatus({ type: 'error', message: 'Не удалось сгенерировать строку' });
    }
  };

  const handleDeleteArchive = (id: string) => {
    saveArchives(archives.filter(a => a.id !== id));
  };

  const downloadBackupFile = () => {
    const dataStr = JSON.stringify({
      version: "1.1",
      timestamp: new Date().toISOString(),
      items: currentItems
    }, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `deinventory_backup_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        const items = parsed.items || parsed;
        if (Array.isArray(items)) {
          onRestore(items);
          setStatus({ type: 'success', message: 'Данные успешно загружены из файла' });
        } else {
          throw new Error("Invalid format");
        }
      } catch (e) {
        setStatus({ type: 'error', message: 'Неверный формат файла резервной копии' });
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Безопасность данных</h1>
          <p className="text-slate-500">Защита от сброса при обновлениях приложения</p>
        </div>
        <div className="flex gap-2">
           <button 
            onClick={downloadBackupFile} 
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold bg-white text-slate-700 border hover:bg-slate-50 transition-all text-sm"
          >
            <Download size={16} /> JSON Файл
          </button>
           <button 
            onClick={handleManualBackup} 
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold bg-blue-600 text-white shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all text-sm"
          >
            <ShieldCheck size={16} /> Создать архив
          </button>
        </div>
      </header>

      {status && (
        <div className={`p-4 rounded-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2 ${status.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-100' : 'bg-red-50 text-red-800 border border-red-100'}`}>
          {status.type === 'success' ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
          <p className="font-bold text-sm">{status.message}</p>
          <button onClick={() => setStatus(null)} className="ml-auto text-xs font-black uppercase opacity-50">Закрыть</button>
        </div>
      )}

      {/* EMERGENCY RECOVERY SECTION - HIGHLIGHTED */}
      <div className="bg-gradient-to-br from-indigo-600 to-blue-700 p-8 rounded-[2rem] text-white shadow-xl shadow-blue-100 space-y-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10">
          <Zap size={160} />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <span className="bg-white/20 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">Важно</span>
            <h2 className="text-2xl font-black">Перенос данных между версиями</h2>
          </div>
          <p className="text-blue-100 text-sm max-w-xl">
            Используйте этот блок каждый раз, когда просите меня изменить код приложения. Скопируйте строку перед правкой и вставьте её после.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
          <div className="bg-white/10 backdrop-blur-md p-6 rounded-2xl border border-white/20 space-y-4">
            <h3 className="font-bold flex items-center gap-2">
              <Copy size={18} /> Шаг 1: Копирование
            </h3>
            <p className="text-xs text-blue-100 leading-relaxed">Нажмите кнопку ниже, чтобы получить зашифрованную строку всего вашего инвентаря со всеми фото.</p>
            <button 
              onClick={copyFullBackupToClipboard}
              className="w-full py-3 bg-white text-blue-700 rounded-xl font-black text-sm hover:bg-blue-50 transition-all flex items-center justify-center gap-2 shadow-lg"
            >
              <Copy size={16} /> Скопировать строку инвентаря
            </button>
          </div>

          <div className="bg-white/10 backdrop-blur-md p-6 rounded-2xl border border-white/20 space-y-4">
            <h3 className="font-bold flex items-center gap-2">
              <ClipboardPaste size={18} /> Шаг 2: Восстановление
            </h3>
            <div className="flex gap-2">
              <input 
                type="text"
                placeholder="Вставьте строку сюда..."
                className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-xs outline-none focus:bg-white/20 placeholder:text-blue-200"
                value={recoveryString}
                onChange={(e) => setRecoveryString(e.target.value)}
              />
              <button 
                onClick={handleQuickRestore}
                className="px-4 py-2 bg-emerald-500 text-white rounded-xl font-black text-xs hover:bg-emerald-600 transition-all shadow-lg"
              >
                Восстановить
              </button>
            </div>
            <p className="text-[10px] text-blue-200 italic">При восстановлении все текущие данные будут заменены данными из строки.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-4">
          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-50 flex justify-between items-center">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <History size={18} className="text-blue-500" />
                История локальных архивов
              </h3>
              <span className="text-[10px] font-black bg-slate-100 px-2 py-1 rounded-md text-slate-400 uppercase tracking-tighter">Хранится в браузере</span>
            </div>
            
            <div className="divide-y divide-slate-50 max-h-[500px] overflow-y-auto">
              {archives.length > 0 ? archives.map((archive) => (
                <div key={archive.id} className="p-4 hover:bg-slate-50/50 transition-colors flex items-center justify-between group">
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-xl ${archive.id.startsWith('auto') ? 'bg-indigo-50 text-indigo-500' : 'bg-amber-50 text-amber-500'}`}>
                      <Database size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800">{archive.date}</p>
                      <p className="text-xs text-slate-400">{archive.itemCount} товаров • {archive.id.startsWith('auto') ? 'Авто-архив' : 'Ручная копия'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => handleRestore(archive.data)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-100 transition-colors"
                    >
                      <RotateCcw size={14} /> Восстановить
                    </button>
                    <button 
                      onClick={() => handleDeleteArchive(archive.id)}
                      className="p-1.5 text-slate-300 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              )) : (
                <div className="p-12 text-center text-slate-400">
                  <Database size={40} className="mx-auto mb-3 opacity-20" />
                  <p className="font-medium">Локальных архивов пока нет</p>
                  <p className="text-xs">Система создаст первую копию автоматически завтра</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
            <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Upload size={18} className="text-slate-400" />
              Импорт из файла
            </h4>
            <div className="relative border-2 border-dashed border-slate-100 rounded-2xl p-6 text-center hover:bg-slate-50 transition-colors group cursor-pointer">
              <FileJson size={32} className="mx-auto text-slate-300 mb-2 group-hover:text-blue-400" />
              <p className="text-xs font-medium text-slate-500">Выберите .json файл для восстановления</p>
              <input 
                type="file" 
                accept=".json"
                onChange={handleFileUpload}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </div>
          </div>

          <div className="p-6 bg-slate-900 rounded-3xl text-white">
             <div className="flex items-center gap-3 mb-4">
                <ShieldCheck className="text-blue-400" />
                <h4 className="font-bold">Cloud Sync Hint</h4>
             </div>
             <p className="text-[11px] text-slate-400 leading-relaxed">
                Так как это веб-приложение без серверной базы данных, оно полностью зависит от памяти вашего браузера. Регулярно нажимайте "Скопировать строку инвентаря" и сохраняйте её в надежном месте.
             </p>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default BackupManager;
