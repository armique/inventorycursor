import React from 'react';

const pulse = 'animate-pulse bg-slate-200/80 rounded-xl';

export function PanelPageSkeleton() {
  return (
    <div className="flex-1 min-h-0 p-3 md:p-4 space-y-3" aria-busy="true" aria-label="Loading page">
      <div className={`h-8 w-48 ${pulse}`} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`h-24 ${pulse}`} />
        ))}
      </div>
      <div className={`h-64 ${pulse}`} />
    </div>
  );
}

export function InventoryPageSkeleton() {
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2 p-1.5 md:p-2" aria-busy="true" aria-label="Loading inventory">
      <div className={`h-11 ${pulse}`} />
      <div className="flex-1 min-h-0 space-y-1.5 overflow-hidden">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-1">
            <div className={`w-12 h-12 shrink-0 rounded-xl ${pulse}`} />
            <div className="flex-1 space-y-1.5">
              <div className={`h-4 w-2/3 ${pulse}`} />
              <div className={`h-3 w-1/3 ${pulse}`} />
            </div>
            <div className={`h-4 w-16 hidden sm:block ${pulse}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function StorefrontPageSkeleton() {
  return (
    <div className="min-h-[100dvh] bg-zinc-50" aria-busy="true" aria-label="Loading shop">
      <div className="h-14 border-b border-zinc-200 bg-white" />
      <div className="min-h-[70dvh] bg-zinc-200/70 animate-pulse" />
      <div className="mx-auto max-w-[1400px] px-4 py-8 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-2xl border border-zinc-200 overflow-hidden bg-white">
            <div className="aspect-[4/3] bg-zinc-100 animate-pulse" />
            <div className="p-5 space-y-3">
              <div className="h-3 w-1/3 bg-zinc-100 rounded animate-pulse" />
              <div className="h-5 w-full bg-zinc-100 rounded animate-pulse" />
              <div className="h-10 w-full bg-zinc-100 rounded animate-pulse mt-4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartWidgetSkeleton({ className = '' }: { className?: string }) {
  return <div className={`flex-1 min-h-[180px] ${pulse} ${className}`} aria-hidden />;
}

export function panelSuspenseFallback(pathname: string): React.ReactNode {
  if (pathname.startsWith('/panel/inventory')) {
    return <InventoryPageSkeleton />;
  }
  return <PanelPageSkeleton />;
}
