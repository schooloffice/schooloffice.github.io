// Read-only audit probes. Run from repository root: node reports/audit-2026-09-07/probes.cjs
// Only synthetic data; no user storage, external network or production changes.
const fs = require('node:fs');
const vm = require('node:vm');
const zlib = require('node:zlib');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const run = (ctx, file) => vm.runInContext(read(file), ctx, { filename: file, timeout: 5000 });

async function main() {
  const result = { date: '2026-09-07', scope: 'synthetic probes of repository source; not a full browser test' };
  const domains = ['text', 'tables', 'slides', 'paint', 'vector', 'flowcharts'];
  const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
  result.code = domains.map(domain => {
    const files = walk(domain).filter(f => f.endsWith('.js'));
    const counts = files.map(file => ({ file, lines: read(file).trimEnd().split('\n').length }));
    return { domain, jsFiles: files.length, lines: counts.reduce((sum, c) => sum + c.lines, 0), largest: counts.sort((a, b) => b.lines - a.lines).slice(0, 2) };
  });

  const listeners = {};
  const stores = new Map();
  const origin = 'https://audit.invalid';
  const key = request => new URL(typeof request === 'string' ? request : request.url, origin + '/').href;
  const cache = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const data = stores.get(name);
    return {
      addAll: async urls => urls.forEach(url => data.set(key(url), { tag: 'precache-v1', clone() { return this; } })),
      match: async request => data.get(key(request)),
      put: async (request, response) => data.set(key(request), response),
      keys: async () => [...data.keys()], delete: async request => data.delete(key(request))
    };
  };
  const sw = vm.createContext({ URL, console, self: { location: { origin }, addEventListener: (name, fn) => listeners[name] = fn, skipWaiting: async () => {}, clients: { claim: async () => {} } }, caches: { open: async name => cache(name), keys: async () => [...stores.keys()], delete: async name => stores.delete(name) }, fetch: async () => { throw new Error('offline'); } });
  run(sw, 'sw.js');
  let install;
  listeners.install({ waitUntil: promise => install = promise });
  await install;
  result.offlineRoutes = [];
  for (const route of ['/', ...domains.map(d => `/${d}/`), '/text/index.html']) {
    sw.auditRequest = { url: origin + route };
    try { await vm.runInContext('networkFirstPage(auditRequest)', sw); result.offlineRoutes.push({ route, resolves: true }); }
    catch { result.offlineRoutes.push({ route, resolves: false }); }
  }
  const assets = vm.runInContext('CORE_ASSETS', sw);
  result.precache = { assets: assets.length, bytes: assets.reduce((sum, f) => sum + fs.statSync(path.join(root, f)).size, 0) };

  // A small, valid deflate payload whose directory understates the output size.
  const expanded = Buffer.alloc(1024 * 1024, 65);
  const compressed = zlib.deflateRawSync(expanded);
  const filename = Buffer.from('audit.xml');
  const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 8); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(1, 22); header.writeUInt16LE(filename.length, 26);
  const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(8, 10); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(1, 24); directory.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(directory.length + filename.length, 12); end.writeUInt32LE(header.length + filename.length + compressed.length, 16);
  const zipped = new Uint8Array(Buffer.concat([header, filename, compressed, directory, filename, end]));
  result.zip = [];
  for (const native of [true, false]) {
    const ctx = vm.createContext({ window: {}, Uint8Array, TextDecoder, TextEncoder, Blob, Response, DecompressionStream: native ? DecompressionStream : undefined });
    run(ctx, 'tables/js/xlsx-zip.js');
    const files = await ctx.window.TablesXlsxZip.zipRead(zipped);
    result.zip.push({ native, fileBytes: zipped.length, advertisedBytes: 1, actualBytes: files.get('audit.xml').length, rejected: false });
  }

  const formula = vm.createContext({ window: {}, console });
  for (const file of ['addressing', 'model', 'formula-parser', 'formula-references', 'formula-functions', 'formula-engine']) run(formula, `tables/js/${file}.js`);
  result.formulas = vm.runInContext(`['SUM(1,2)', '2^3', '"a"&"b"', '1E3'].map(expr => { try { return { expr, value: evaluateFormula(expr) }; } catch(e) { return { expr, error: e.message }; } })`, formula);
  result.repeatedReferences = vm.runInContext(`(() => {
    const original = evaluateFormula; let calls = 0;
    evaluateFormula = function(expr) { calls++; return original(expr); };
    cellData = { A1: '1' };
    for(let row=2; row<=16; row++) cellData['A'+row] = '=A'+(row-1)+'+A'+(row-1);
    const value = evaluateFormula('A16');
    return { rows: 16, value, evaluateCalls: calls };
  })()`, formula, { timeout: 5000 });
  const csv = vm.createContext({ window: {} });
  run(csv, 'tables/js/workbook.js');
  result.csv = vm.runInContext(`({ input: '1,5;2,5\\n3,5;4,5', parsed: parseCSV('1,5;2,5\\n3,5;4,5') })`, csv);
  const sort = vm.createContext({ window: {}, console, getBounds: () => ({rMin:1,rMax:2,cMin:0,cMax:1}), getCellId: (c,r) => String.fromCharCode(65+c)+r, rebuildGrid() {}, recalculateAll() {}, persistStateToStorage() {}, setSaveBadge() {}, saveToHistory() {} });
  vm.runInContext(`let cellData = {A1:'2',B1:'=A1*10',A2:'1',B2:'=A2*10'}; let cellStyles={}; const cellInp=[null,[{value:'2'}],[{value:'1'}]];`, sort);
  run(sort, 'tables/js/sorting.js');
  result.sort = vm.runInContext(`(() => { sortSelection(false); return cellData; })()`, sort);
  const badge = { style: {}, textContent: '' };
  const storage = vm.createContext({ window: {}, console: {warn(){}}, localStorage: {setItem(){throw new Error('Synthetic quota denial');}}, document: {getElementById: () => badge} });
  run(storage, 'tables/js/storage.js');
  run(storage, 'tables/js/state.js');
  vm.runInContext(`safeSetItem('audit','synthetic'); setSaveBadge();`, storage);
  result.storageFailure = { badge: badge.textContent };
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
