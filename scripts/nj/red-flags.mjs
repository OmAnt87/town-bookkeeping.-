#!/usr/bin/env node
// Kept so the documented NJ commands still work; the red-flag pass now covers
// every state with real data. Same as: node scripts/red-flags.mjs --state NJ [--download]
//
//   node scripts/nj/red-flags.mjs --download
//   node scripts/nj/red-flags.mjs

process.argv.push('--state', 'NJ');
await import('../red-flags.mjs');
