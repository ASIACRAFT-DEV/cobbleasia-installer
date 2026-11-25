'use strict';
// Minimal reader/writer for uncompressed big-endian NBT, enough to merge
// servers.dat (a root compound holding a "servers" list of compounds).
// Every tag type round-trips, so unknown fields in the player's file survive.

const T = { END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6, BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12 };

// Values are kept as { type, value } so writing reproduces the original types.
// Compound value: array of [name, tag] pairs (keeps key order). List value: { elemType, items: [tag] }.

function read(buf) {
  let o = 0;
  const u8 = () => buf.readUInt8(o++);
  const i16 = () => { const v = buf.readInt16BE(o); o += 2; return v; };
  const u16 = () => { const v = buf.readUInt16BE(o); o += 2; return v; };
  const i32 = () => { const v = buf.readInt32BE(o); o += 4; return v; };
  const i64 = () => { const v = buf.readBigInt64BE(o); o += 8; return v; };
  const str = () => { const n = u16(); const s = buf.toString('utf8', o, o + n); o += n; return s; };

  function payload(type) {
    switch (type) {
      case T.BYTE: { const v = buf.readInt8(o); o += 1; return v; }
      case T.SHORT: return i16();
      case T.INT: return i32();
      case T.LONG: return i64();
      case T.FLOAT: { const v = buf.readFloatBE(o); o += 4; return v; }
      case T.DOUBLE: { const v = buf.readDoubleBE(o); o += 8; return v; }
      case T.BYTE_ARRAY: { const n = i32(); const v = buf.subarray(o, o + n); o += n; return Buffer.from(v); }
      case T.STRING: return str();
      case T.LIST: {
        const elemType = u8(); const n = i32(); const items = [];
        for (let i = 0; i < n; i++) items.push({ type: elemType, value: payload(elemType) });
        return { elemType, items };
      }
      case T.COMPOUND: {
        const entries = [];
        for (;;) {
          const t = u8();
          if (t === T.END) break;
          const name = str();
          entries.push([name, { type: t, value: payload(t) }]);
        }
        return entries;
      }
      case T.INT_ARRAY: { const n = i32(); const a = []; for (let i = 0; i < n; i++) a.push(i32()); return a; }
      case T.LONG_ARRAY: { const n = i32(); const a = []; for (let i = 0; i < n; i++) a.push(i64()); return a; }
      default: throw new Error(`Unknown NBT tag type ${type} at byte ${o}`);
    }
  }

  const rootType = u8();
  if (rootType !== T.COMPOUND) throw new Error('servers.dat: root is not a compound');
  const rootName = str();
  return { name: rootName, tag: { type: T.COMPOUND, value: payload(T.COMPOUND) } };
}

function write(root) {
  const parts = [];
  const u8 = (v) => { const b = Buffer.alloc(1); b.writeUInt8(v); parts.push(b); };
  const i8 = (v) => { const b = Buffer.alloc(1); b.writeInt8(v); parts.push(b); };
  const i16 = (v) => { const b = Buffer.alloc(2); b.writeInt16BE(v); parts.push(b); };
  const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32BE(v); parts.push(b); };
  const i64 = (v) => { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); parts.push(b); };
  const str = (s) => { const d = Buffer.from(s, 'utf8'); const b = Buffer.alloc(2); b.writeUInt16BE(d.length); parts.push(b, d); };

  function payload(tag) {
    const v = tag.value;
    switch (tag.type) {
      case T.BYTE: return i8(v);
      case T.SHORT: return i16(v);
      case T.INT: return i32(v);
      case T.LONG: return i64(v);
      case T.FLOAT: { const b = Buffer.alloc(4); b.writeFloatBE(v); return parts.push(b); }
      case T.DOUBLE: { const b = Buffer.alloc(8); b.writeDoubleBE(v); return parts.push(b); }
      case T.BYTE_ARRAY: i32(v.length); return parts.push(Buffer.from(v));
      case T.STRING: return str(v);
      case T.LIST: {
        // An empty list may carry END as its element type; keep whatever it had.
        u8(v.items.length ? v.items[0].type : v.elemType); i32(v.items.length);
        for (const it of v.items) payload(it);
        return;
      }
      case T.COMPOUND:
        for (const [name, t] of v) { u8(t.type); str(name); payload(t); }
        return u8(T.END);
      case T.INT_ARRAY: i32(v.length); for (const x of v) i32(x); return;
      case T.LONG_ARRAY: i32(v.length); for (const x of v) i64(x); return;
      default: throw new Error(`Unknown NBT tag type ${tag.type}`);
    }
  }

  u8(T.COMPOUND); str(root.name); payload(root.tag);
  return Buffer.concat(parts);
}

const get = (compound, key) => {
  const e = compound.find(([k]) => k === key);
  return e ? e[1] : undefined;
};

/** Server host without port, lowercased, for comparing entries. */
const hostOf = (ip) => String(ip || '').trim().toLowerCase().replace(/:\d+$/, '');

function serversList(root) {
  let list = get(root.tag.value, 'servers');
  if (!list) {
    list = { type: T.LIST, value: { elemType: T.COMPOUND, items: [] } };
    root.tag.value.push(['servers', list]);
  }
  return list.value.items;
}

/**
 * Adds the pack's server entries to the top of the player's server list,
 * skipping any host the player already has. Returns the new file bytes.
 */
function mergeServers(existingBuf, packBuf) {
  const pack = read(packBuf);
  if (!existingBuf || existingBuf.length === 0) return write(pack);
  const mine = read(existingBuf);
  const items = serversList(mine);
  const have = new Set(items.map((it) => hostOf(get(it.value, 'ip')?.value)));
  const toAdd = serversList(pack).filter((it) => !have.has(hostOf(get(it.value, 'ip')?.value)));
  items.unshift(...toAdd);
  return write(mine);
}

module.exports = { read, write, mergeServers, hostOf, T };
