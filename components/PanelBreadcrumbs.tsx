import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

const LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  inventory: 'Inventory',
  add: 'Add item',
  'add-bulk': 'Bulk add',
  builder: 'Builder',
  'ebay-store-pull': 'eBay Store Pull',
  'card-gallery': 'Card gallery',
  invoices: 'Invoices',
  'action-history': 'Action history',
  expenses: 'Expenses',
  import: 'Import',
  trash: 'Trash',
  'store-management': 'Store',
  'storefront-configurator': 'Storefront configurator',
  settings: 'Settings',
};

const PanelBreadcrumbs: React.FC = () => {
  const { pathname } = useLocation();
  if (!pathname.startsWith('/panel')) return null;

  const segments = pathname.replace(/^\/panel\/?/, '').split('/').filter(Boolean);
  const isDensePage = /^\/panel\/(inventory|trash)(\/|$)/.test(pathname);
  const crumbs = [{ path: '/panel/dashboard', label: 'Panel' }, ...segments.map((seg, i) => ({
    path: `/panel/${segments.slice(0, i + 1).join('/')}`,
    label: LABELS[seg] || seg,
  }))];

  return (
    <nav aria-label="Breadcrumb" className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 flex-wrap ${isDensePage ? 'mb-0' : 'mb-3'}`}>
      <Link to="/panel/dashboard" className="hover:text-slate-700 flex items-center gap-1">
        <Home size={12} />
      </Link>
      {crumbs.slice(1).map((c) => (
        <React.Fragment key={c.path}>
          <ChevronRight size={12} className="text-slate-300" />
          <Link to={c.path} className="hover:text-slate-700 truncate max-w-[140px]">
            {c.label}
          </Link>
        </React.Fragment>
      ))}
    </nav>
  );
};

export default PanelBreadcrumbs;
