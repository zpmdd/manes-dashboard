import { useCallback, useEffect, useRef, useState } from 'react';
import { linkedVehicles, vehicleDistrict } from './vehicles';
import { NATIONAL } from './geo';

export function useVehicleLayer({ allVehicles, index, mapVisible, layers, setLayers, command, code, activeCode, dialog, setDialog, navigate, sendCommand, setToast, fetchJson, navigationRequest }) {
  const [vehicleId, setVehicleId] = useState(null);
  const vehicle = allVehicles.find(item => item.VEHICLENO === vehicleId) || allVehicles[0];
  const setVehicle = useCallback(item => setVehicleId(item?.VEHICLENO ?? null), []);
  const [vehicleHighlight, setVehicleHighlight] = useState('vehicle:all'), [vehicleDetailed, setVehicleDetailed] = useState(false), [vehicleHover, setVehicleHover] = useState(null);
  const hoverTimer = useRef(), vehicleRequest = navigationRequest;
  const hoverVehicle = useCallback(value => { clearTimeout(hoverTimer.current); if (value) setVehicleHover(value); else hoverTimer.current = setTimeout(() => setVehicleHover(null), 120); }, []);
  useEffect(() => { setVehicleHover(null); return () => clearTimeout(hoverTimer.current); }, [command, vehicleHighlight, vehicleDetailed, code, layers.vehicles]);
  useEffect(() => () => vehicleRequest.current?.abort(), [mapVisible]);
  useEffect(() => {
    if (!vehicleHover && vehicleHighlight === 'vehicle:all') return;
    const dismiss = event => { if (event.key === 'Escape' && !dialog) { setVehicleHover(null); setVehicleHighlight('vehicle:all'); vehicleRequest.current?.abort(); } };
    window.addEventListener('keydown', dismiss); return () => window.removeEventListener('keydown', dismiss);
  }, [vehicleHover, vehicleHighlight, dialog]);
  useEffect(() => { vehicleRequest.current?.abort(); setVehicleHover(null); if (!linkedVehicles(vehicleHighlight, allVehicles)?.length) setVehicleHighlight('vehicle:all'); }, [allVehicles]);
  const clearVehicleSelection = useCallback(() => { vehicleRequest.current?.abort(); setVehicleHighlight('vehicle:all'); setVehicleHover(null); }, []);
  const focusVehicles = useCallback(async (item, highlight) => {
    vehicleRequest.current?.abort();
    const abort = new AbortController(); vehicleRequest.current = abort;
    const vehicles = Array.isArray(item) ? item : item ? [item] : allVehicles;
    if (!vehicles.length) return;
    const single = vehicles.length === 1 ? vehicles[0] : null;
    setLayers(s => ({ ...s, vehicles: true })); setDialog(null); setVehicleHover(null);
    setVehicleHighlight(highlight || (single ? `vehicle:${single.VEHICLENO}` : 'vehicle:all'));
    if (single) setVehicle(single);
    try {
      const district = await vehicleDistrict(vehicles, index, region => fetchJson(`/data/regions/${region}.json`, abort.signal));
      if (abort.signal.aborted) return;
      if (district) navigate(district, single);
      else if (single) setToast('当前离线边界未匹配到车辆所在区县');
      else sendCommand('vehicles', vehicles);
    } catch (error) { if (!abort.signal.aborted) setToast(`车辆定位失败：${error.message}`); }
  }, [index, navigate, sendCommand, allVehicles]);
  const pickVehicle = useCallback(item => { void focusVehicles(item); }, [focusVehicles]);
  const showVehicleDetails = useCallback(item => { setVehicle(item); setDialog('vehicle'); setVehicleHover(null); }, []);
  const navigateWidget = useCallback(next => {
    const vehicles = linkedVehicles(next, allVehicles);
    if (vehicles) {
      vehicleRequest.current?.abort(); setVehicleHighlight(next); setVehicle(vehicles[0]); setDialog(null); setLayers(s => ({ ...s, vehicles: true }));
      if (!['vehicle:all', 'vehicle:moving', 'vehicle:stopped'].includes(next) || vehicleDetailed || activeCode !== NATIONAL) void focusVehicles(vehicles, next);
      return true;
    }
    return false;
  }, [index, navigate, focusVehicles, vehicleDetailed, activeCode, allVehicles]);
  return { vehicle, setVehicle, vehicleHighlight, vehicleDetailed, setVehicleDetailed, vehicleHover, hoverVehicle, hoverTimer, focusVehicles, pickVehicle, clearVehicleSelection, showVehicleDetails, navigateWidget };
}
