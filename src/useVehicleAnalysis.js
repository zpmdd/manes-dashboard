import { useEffect, useState } from 'react';

export function useVehicleAnalysis(source, options, enabled = false) {
  const [state, setState] = useState(null), rows = source?.rows;
  const signature = JSON.stringify(options ?? null);
  useEffect(() => {
    if (!enabled || !rows) return;
    const worker = new Worker(new URL('./vehicleClustering.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => setState({ rows, signature, ...data });
    worker.onerror = () => setState({ rows, signature, error: '聚类计算失败，请重新加载数据' });
    worker.postMessage({ rows, options: JSON.parse(signature) });
    return () => worker.terminate();
  }, [rows, signature, enabled]);
  if (!enabled) return { status: 'disabled' };
  if (!rows) return { status: source?.status || 'loading', error: source?.error };
  if (source.status === 'error' || source.status === 'loading') return { result: state?.rows === rows && state?.signature === signature ? state.result : undefined, status: source.status, error: source.error };
  if (state?.rows !== rows || state?.signature !== signature) return { status: 'loading' };
  return { ...state, status: state.error ? 'error' : 'ready' };
}
