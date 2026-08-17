import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import { StorefrontPageSkeleton } from './components/RouteSkeletons';

const StorefrontPage = lazy(() => import('./components/StorefrontPage'));
const LegalPage = lazy(() => import('./components/LegalPage'));

function ForcePanelReload({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return <StorefrontPageSkeleton />;
}

export default function StorefrontApp() {
  return (
    <Router>
      <Analytics />
      <Suspense fallback={<StorefrontPageSkeleton />}>
        <Routes>
          <Route path="/" element={<StorefrontPage />} />
          <Route path="/item/:id" element={<StorefrontPage />} />
          <Route path="/impressum" element={<LegalPage />} />
          <Route path="/datenschutz" element={<LegalPage />} />
          <Route path="/agb" element={<LegalPage />} />
          <Route path="/panel/*" element={<ForcePanelReload to="/panel/dashboard" />} />
          <Route path="/upload/*" element={<ForcePanelReload to={window.location.pathname + window.location.search} />} />
          <Route path="/auth/*" element={<ForcePanelReload to={window.location.pathname + window.location.search} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Router>
  );
}
