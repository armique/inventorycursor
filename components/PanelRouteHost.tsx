import React, { useLayoutEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';

type Props = {
  routeKey: string;
  onPainted: (routeKey: string) => void;
};

/** Notifies the shell once this route has committed its first paint. */
const PanelRouteHost: React.FC<Props> = ({ routeKey, onPainted }) => {
  const onPaintedRef = useRef(onPainted);
  onPaintedRef.current = onPainted;
  const lastNotifiedRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (lastNotifiedRef.current === routeKey) return;
    lastNotifiedRef.current = routeKey;
    onPaintedRef.current(routeKey);
  }, [routeKey]);

  return <Outlet />;
};

export default PanelRouteHost;
