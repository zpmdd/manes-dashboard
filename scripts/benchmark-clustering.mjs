import { cpus, platform, arch } from 'node:os';
import { dbscan, ALGORITHM_VERSION } from '../src/vehicleClustering.js';

const measurements = [];
for (const [scenario, count] of [['sparse', 10000], ['sparse', 100000], ['coincident', 100000], ['dense', 10000]]) {
  const points = Array.from({ length: count }, (_, i) => scenario === 'coincident' ? [116, 40] : scenario === 'dense' ? [116 + (i % 100) * .000001, 40 + Math.floor(i / 100) * .000001] : [73 + (i % 1000) * .06, 18 + Math.floor(i / 1000) * .2]);
  const started = performance.now();
  try {
    const result = dbscan(points);
    measurements.push({ scenario, count, elapsedMs: Math.round(performance.now() - started), clusterCount: result.clusterCount, distanceChecks: result.distanceChecks, status: 'completed' });
  } catch (error) { measurements.push({ scenario, count, elapsedMs: Math.round(performance.now() - started), status: 'capacity_limit', error: error.message }); }
}
console.log(JSON.stringify({ algorithmVersion: ALGORITHM_VERSION, node: process.version, platform: `${platform()} ${arch()}`, cpu: cpus()[0]?.model, kind: 'synthetic_algorithm_only', measurements }, null, 2));
