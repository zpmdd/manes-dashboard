import { analyzeVehicles } from './vehicleClustering.js';

self.onmessage = ({ data }) => {
  try { self.postMessage({ result: analyzeVehicles(data.rows, data.options) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
