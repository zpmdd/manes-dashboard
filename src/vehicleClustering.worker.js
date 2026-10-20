import { analyzeVehicles } from './vehicleClustering.js';
import { analyzeRestrictionTrajectory } from './restrictions.js';

self.onmessage = ({ data }) => {
  try { self.postMessage({ result: analyzeVehicles(data.rows, data.options), restrictionAnalysis: data.restriction ? analyzeRestrictionTrajectory(data.restriction, data.rows) : undefined }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
