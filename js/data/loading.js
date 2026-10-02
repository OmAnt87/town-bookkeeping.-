import { validateDataset } from '../engine/ledger.js';
import { reportingFor } from '../engine/reporting.js';

export function createDetailLoader(fetcher = (...args) => fetch(...args)) {
  const cache = new Map();
  return async function load(town) {
    if (!town.detailFile || town.ledger) return town;
    const key = town.detailFile;
    if (!cache.has(key)) {
      const pending = (async () => {
        const response = await fetcher(`data/real/${key}`);
        if (!response.ok) throw new Error(`Could not load ${key} (${response.status})`);
        const data = await response.json();
        const errors = validateDataset(data);
        if (errors.length) throw new Error(`${key}: ${errors.join(' ')}`);
        return data;
      })();
      cache.set(key, pending);
      pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
    }
    const data = await cache.get(key);
    const full = data.towns.find((t) => t.id === town.id);
    if (!full) { cache.delete(key); throw new Error(`${town.name} is missing from ${key}`); }
    return { ...town, ...full, ledger: full.ledger || [], reporting: reportingFor(full), demo: false };
  };
}
export async function completeDataset(dataset, load) {
  const towns = [];
  // Sequential iteration bounds network/memory pressure; the loader caches counties.
  for (const town of dataset.towns) {
    try { towns.push(await load(town)); }
    catch (error) { throw new Error(`Complete export stopped at ${town.name}: ${error.message}`); }
  }
  return { ...dataset, towns };
}
export function summaryDataset(dataset) {
  return { ...dataset, towns: dataset.towns.map(({ ledger, history, topDonors, notes, sources, ...town }) => town) };
}
export function requestIsCurrent(state, dataset, revision) {
  return state.dataset === dataset && state.routeRevision === revision;
}
