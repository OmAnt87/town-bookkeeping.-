// Compact form of data/real/summary.json. Many towns share the same reporting
// notes, camera-map source and state name, so the file stores each of those
// once in a table and the towns point at it. packSummary is used by
// scripts/build-summary.mjs; unpackSummary turns the file back into the plain
// { towns } shape the app has always used, and passes the older plain file
// through unchanged.

export const SUMMARY_FORMAT = 2;

function table() {
  const list = [];
  const index = new Map();
  return {
    list,
    add(value) {
      const key = JSON.stringify(value);
      if (!index.has(key)) index.set(key, list.push(value) - 1);
      return index.get(key);
    },
  };
}

export function packSummary({ towns, ...rest }) {
  const reporting = table();
  const sources = table();
  const states = {};
  const packed = towns.map(({ stateName, reporting: r, surveillanceMap: cams, ...t }) => {
    if (stateName && t.state) states[t.state] = stateName;
    const out = { ...t };
    if (r !== undefined) out.reporting = reporting.add(r);
    if (cams) out.surveillanceMap = cams.source ? { ...cams, source: sources.add(cams.source) } : cams;
    return out;
  });
  return { ...rest, format: SUMMARY_FORMAT, states, reporting: reporting.list, cameraSources: sources.list, towns: packed };
}

export function unpackSummary(data) {
  if (data?.format !== SUMMARY_FORMAT) return data;
  const { format, states = {}, reporting = [], cameraSources = [], towns = [], ...rest } = data;
  return {
    ...rest,
    towns: towns.map((t) => {
      const out = { ...t };
      if (states[t.state]) out.stateName = states[t.state];
      if (Number.isInteger(t.reporting)) out.reporting = reporting[t.reporting];
      if (t.surveillanceMap && Number.isInteger(t.surveillanceMap.source)) out.surveillanceMap = { ...t.surveillanceMap, source: cameraSources[t.surveillanceMap.source] };
      return out;
    }),
  };
}
