import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSettingsModal } from '../context/SettingsModalContext';

/** Visiting /panel/settings opens the settings modal and leaves the URL on inventory. */
const OpenSettingsFromRoute: React.FC = () => {
  const { openSettings } = useSettingsModal();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const tab = params.get('tab') ?? undefined;
  useEffect(() => {
    openSettings(tab);
    navigate('/panel/inventory', { replace: true });
    // open once when landing on /panel/settings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-8 text-sm font-bold text-slate-500">Opening settings…</div>
  );
};

export default OpenSettingsFromRoute;
