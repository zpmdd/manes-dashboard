import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDataSourceController } from './dataSources.js';

export function useDataSources(sources = [], code, { enabled = true } = {}) {
  const [results, setResults] = useState({});
  const active = useRef(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const signature = useMemo(() => JSON.stringify(sources), [sources]);
  useEffect(() => {
    const controller = createDataSourceController({ onChange: setResults });
    active.current = controller;
    const onVisibility = () => controller.setActive(enabledRef.current && !document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { controller.dispose(); document.removeEventListener('visibilitychange', onVisibility); if (active.current === controller) active.current = null; };
  }, []);
  useEffect(() => {
    active.current?.reconcile(JSON.parse(signature), code, enabled && !document.hidden);
  }, [signature, code, enabled]);
  const refresh = useCallback(id => {
    if (enabledRef.current && !document.hidden) return active.current?.refresh(id);
  }, []);
  return { results, refresh };
}
