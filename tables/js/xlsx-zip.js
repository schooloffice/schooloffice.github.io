'use strict';

// ---- Мінімальний ZIP-шар для XLSX ----
// XLSX — це ZIP-архів з XML-частинами всередині. Власний шар обрано свідомо:
// на ЗАПИС стиснення взагалі не потрібне (метод "stored" приймають Excel,
// LibreOffice і Google Sheets), а на ЧИТАННЯ достатньо raw-inflate.
//
// Inflate працює у два способи:
//   1) DecompressionStream('deflate-raw') — нативний, швидкий (браузери з 2023 р.);
//   2) власний puff-style інфлятор — запасний шлях для старих шкільних пристроїв.
//
// Межі розміру перевіряє викликач (xlsx-import.js), тут лише структура архіву.

const ZIP_MAX_ENTRIES = 512;
const ZIP_MAX_ENTRY_BYTES = 64 * 1024 * 1024;

// ---- CRC32 ----
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---- Growable byte buffer ----
function makeByteSink(initial) {
  let buf = new Uint8Array(Math.max(64, initial || 1024));
  let len = 0;

  function ensure(extra) {
    if (len + extra <= buf.length) return;
    let next = buf.length * 2;
    while (next < len + extra) next *= 2;
    const grown = new Uint8Array(next);
    grown.set(buf.subarray(0, len));
    buf = grown;
  }

  return {
    get length() { return len; },
    byte(v) { ensure(1); buf[len++] = v & 0xFF; },
    u16(v) { ensure(2); buf[len++] = v & 0xFF; buf[len++] = (v >>> 8) & 0xFF; },
    u32(v) { ensure(4); buf[len++] = v & 0xFF; buf[len++] = (v >>> 8) & 0xFF; buf[len++] = (v >>> 16) & 0xFF; buf[len++] = (v >>> 24) & 0xFF; },
    raw(bytes) { ensure(bytes.length); buf.set(bytes, len); len += bytes.length; },
    // Пряме читання/запис для інфлятора (copy з уже розпакованого хвоста).
    at(i) { return buf[i]; },
    push(v) { ensure(1); buf[len++] = v & 0xFF; },
    result() { return buf.slice(0, len); }
  };
}

// ---- Запис ZIP (метод "stored", без стиснення) ----
// files: [{ name: 'xl/workbook.xml', data: Uint8Array }]
function zipWrite(files) {
  const out = makeByteSink(64 * 1024);
  const central = [];
  const encoder = new TextEncoder();

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = file.data;
    const crc = crc32(data);
    const offset = out.length;

    out.u32(0x04034B50);      // local file header signature
    out.u16(20);              // version needed
    out.u16(0x0800);          // flags: UTF-8 names
    out.u16(0);               // method: stored
    out.u16(0);               // mod time
    out.u16(0x21);            // mod date (1980-01-01)
    out.u32(crc);
    out.u32(data.length);     // compressed size
    out.u32(data.length);     // uncompressed size
    out.u16(nameBytes.length);
    out.u16(0);               // extra length
    out.raw(nameBytes);
    out.raw(data);

    central.push({ nameBytes, crc, size: data.length, offset });
  }

  const centralStart = out.length;
  for (const entry of central) {
    out.u32(0x02014B50);      // central directory signature
    out.u16(20);              // version made by
    out.u16(20);              // version needed
    out.u16(0x0800);          // flags: UTF-8 names
    out.u16(0);               // method: stored
    out.u16(0);
    out.u16(0x21);
    out.u32(entry.crc);
    out.u32(entry.size);
    out.u32(entry.size);
    out.u16(entry.nameBytes.length);
    out.u16(0);               // extra
    out.u16(0);               // comment
    out.u16(0);               // disk number
    out.u16(0);               // internal attrs
    out.u32(0);               // external attrs
    out.u32(entry.offset);
    out.raw(entry.nameBytes);
  }
  const centralSize = out.length - centralStart;

  out.u32(0x06054B50);        // end of central directory
  out.u16(0);
  out.u16(0);
  out.u16(central.length);
  out.u16(central.length);
  out.u32(centralSize);
  out.u32(centralStart);
  out.u16(0);                 // comment length

  return out.result();
}

// ---- Читання ZIP ----
function readU16(bytes, at) { return bytes[at] | (bytes[at + 1] << 8); }
function readU32(bytes, at) {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

function findEndOfCentralDirectory(bytes) {
  // EOCD має змінний коментар у хвості, тому шукаємо сигнатуру з кінця.
  const minAt = Math.max(0, bytes.length - 0xFFFF - 22);
  for (let at = bytes.length - 22; at >= minAt; at--) {
    if (readU32(bytes, at) === 0x06054B50) return at;
  }
  throw new Error('Це не ZIP-архів: не знайдено кінець каталогу');
}

async function zipRead(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('Очікувався Uint8Array');
  if (bytes.length < 22) throw new Error('Це не ZIP-архів: файл надто малий');

  const eocd = findEndOfCentralDirectory(bytes);
  const count = readU16(bytes, eocd + 10);
  const centralStart = readU32(bytes, eocd + 16);

  if (count > ZIP_MAX_ENTRIES) throw new Error(`Забагато записів у файлі (максимум ${ZIP_MAX_ENTRIES})`);
  if (centralStart >= bytes.length) throw new Error('Пошкоджений каталог архіву');

  const decoder = new TextDecoder('utf-8');
  const entries = new Map();
  let at = centralStart;

  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || readU32(bytes, at) !== 0x02014B50) {
      throw new Error('Пошкоджений каталог архіву');
    }
    const method = readU16(bytes, at + 10);
    const compressedSize = readU32(bytes, at + 20);
    const uncompressedSize = readU32(bytes, at + 24);
    const nameLen = readU16(bytes, at + 28);
    const extraLen = readU16(bytes, at + 30);
    const commentLen = readU16(bytes, at + 32);
    const localOffset = readU32(bytes, at + 42);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));

    if (uncompressedSize > ZIP_MAX_ENTRY_BYTES) throw new Error(`Частина ${name} завелика`);

    entries.set(name, { method, compressedSize, uncompressedSize, localOffset });
    at += 46 + nameLen + extraLen + commentLen;
  }

  const files = new Map();
  for (const [name, entry] of entries) {
    files.set(name, await readEntry(bytes, entry, name));
  }
  return files;
}

async function readEntry(bytes, entry, name) {
  const at = entry.localOffset;
  if (at + 30 > bytes.length || readU32(bytes, at) !== 0x04034B50) {
    throw new Error(`Пошкоджений запис ${name}`);
  }
  const nameLen = readU16(bytes, at + 26);
  const extraLen = readU16(bytes, at + 28);
  const dataStart = at + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.length) throw new Error(`Пошкоджений запис ${name}`);

  const raw = bytes.subarray(dataStart, dataEnd);
  if (entry.method === 0) return raw.slice();
  if (entry.method !== 8) throw new Error(`Непідтримуване стиснення в ${name}`);
  return inflateRaw(raw, entry.uncompressedSize);
}

// ---- Inflate ----
async function inflateRaw(data, expectedSize) {
  if (typeof DecompressionStream === 'function') {
    try {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) {
      // Старий движок або відсутній 'deflate-raw' — падаємо на власний інфлятор.
    }
  }
  return inflateRawFallback(data, expectedSize);
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// Канонічна таблиця Хаффмана у формі (counts, symbols) — алгоритм "puff".
function buildHuffman(lengths, count) {
  const counts = new Uint16Array(16);
  for (let i = 0; i < count; i++) counts[lengths[i]]++;
  counts[0] = 0;

  const offsets = new Uint16Array(16);
  for (let len = 1; len < 16; len++) offsets[len] = offsets[len - 1] + counts[len - 1];

  const symbols = new Uint16Array(count);
  for (let i = 0; i < count; i++) if (lengths[i]) symbols[offsets[lengths[i]]++] = i;

  return { counts, symbols };
}

let FIXED_LITERAL = null;
let FIXED_DISTANCE = null;

function fixedTables() {
  if (!FIXED_LITERAL) {
    const lit = new Uint8Array(288);
    for (let i = 0; i < 144; i++) lit[i] = 8;
    for (let i = 144; i < 256; i++) lit[i] = 9;
    for (let i = 256; i < 280; i++) lit[i] = 7;
    for (let i = 280; i < 288; i++) lit[i] = 8;
    FIXED_LITERAL = buildHuffman(lit, 288);

    const dist = new Uint8Array(30).fill(5);
    FIXED_DISTANCE = buildHuffman(dist, 30);
  }
  return { literal: FIXED_LITERAL, distance: FIXED_DISTANCE };
}

function inflateRawFallback(data, expectedSize) {
  const out = makeByteSink(expectedSize > 0 ? expectedSize : data.length * 4);
  let pos = 0;
  let bitBuf = 0;
  let bitCount = 0;

  function bits(need) {
    while (bitCount < need) {
      if (pos >= data.length) throw new Error('Несподіваний кінець стиснутих даних');
      bitBuf |= data[pos++] << bitCount;
      bitCount += 8;
    }
    const value = bitBuf & ((1 << need) - 1);
    bitBuf >>>= need;
    bitCount -= need;
    return value;
  }

  function decode(huff) {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = huff.counts[len];
      if (code - first < count) return huff.symbols[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('Пошкоджений код Хаффмана');
  }

  function block(literal, distance) {
    for (;;) {
      const sym = decode(literal);
      if (sym < 256) { out.push(sym); continue; }
      if (sym === 256) return;

      const lenIdx = sym - 257;
      if (lenIdx >= LENGTH_BASE.length) throw new Error('Пошкоджена довжина збігу');
      const length = LENGTH_BASE[lenIdx] + bits(LENGTH_EXTRA[lenIdx]);

      const distIdx = decode(distance);
      if (distIdx >= DIST_BASE.length) throw new Error('Пошкоджена відстань збігу');
      const dist = DIST_BASE[distIdx] + bits(DIST_EXTRA[distIdx]);
      if (dist > out.length) throw new Error('Відстань більша за розпаковані дані');

      let from = out.length - dist;
      for (let i = 0; i < length; i++) out.push(out.at(from + i));
    }
  }

  function dynamicTables() {
    const hlit = bits(5) + 257;
    const hdist = bits(5) + 1;
    const hclen = bits(4) + 4;

    const clLengths = new Uint8Array(19);
    for (let i = 0; i < hclen; i++) clLengths[CODE_LENGTH_ORDER[i]] = bits(3);
    const clTable = buildHuffman(clLengths, 19);

    const lengths = new Uint8Array(hlit + hdist);
    let i = 0;
    while (i < hlit + hdist) {
      const sym = decode(clTable);
      if (sym < 16) { lengths[i++] = sym; continue; }

      let repeat;
      let value = 0;
      if (sym === 16) {
        if (i === 0) throw new Error('Пошкоджена таблиця довжин');
        value = lengths[i - 1];
        repeat = 3 + bits(2);
      } else if (sym === 17) {
        repeat = 3 + bits(3);
      } else {
        repeat = 11 + bits(7);
      }
      if (i + repeat > hlit + hdist) throw new Error('Пошкоджена таблиця довжин');
      while (repeat--) lengths[i++] = value;
    }

    return {
      literal: buildHuffman(lengths.subarray(0, hlit), hlit),
      distance: buildHuffman(lengths.subarray(hlit), hdist)
    };
  }

  for (;;) {
    const final = bits(1);
    const type = bits(2);

    if (type === 0) {
      // Stored: вирівнюємо до байта і копіюємо як є.
      bitBuf = 0;
      bitCount = 0;
      if (pos + 4 > data.length) throw new Error('Несподіваний кінець stored-блоку');
      const len = data[pos] | (data[pos + 1] << 8);
      const nlen = data[pos + 2] | (data[pos + 3] << 8);
      pos += 4;
      if ((len ^ 0xFFFF) !== nlen) throw new Error('Пошкоджений stored-блок');
      if (pos + len > data.length) throw new Error('Несподіваний кінець stored-блоку');
      out.raw(data.subarray(pos, pos + len));
      pos += len;
    } else if (type === 1) {
      const tables = fixedTables();
      block(tables.literal, tables.distance);
    } else if (type === 2) {
      const tables = dynamicTables();
      block(tables.literal, tables.distance);
    } else {
      throw new Error('Невідомий тип блоку DEFLATE');
    }

    if (final) break;
  }

  return out.result();
}

window.TablesXlsxZip = {
  zipWrite,
  zipRead,
  crc32,
  inflateRawFallback
};
