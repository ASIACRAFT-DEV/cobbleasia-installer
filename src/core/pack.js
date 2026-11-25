'use strict';
// Gets the newest Cobble Asia client pack from Modrinth and downloads its mods.
// The .mrpack lists every mod with its CDN URL and sha1; files are cached in
// the installer's cache folder so installing into several launchers downloads once.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { cacheDir } = require('./paths');

const PROJECT = 'cobbleasia';
const API = `https://api.modrinth.com/v2/project/${PROJECT}/version`;
// Modrinth asks API clients for a descriptive User-Agent.
const UA = 'ASIACRAFT-DEV/cobbleasia-installer (+https://github.com/ASIACRAFT-DEV)';

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

async function fetchBuffer(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr;
}

/** The newest version of the pack on Modrinth: { version, name, url, sha1, filename }. */
async function latestVersion() {
  const list = JSON.parse((await fetchBuffer(API)).toString('utf8'));
  for (const v of list) {
    const file = v.files.find((f) => f.primary && f.filename.endsWith('.mrpack')) || v.files.find((f) => f.filename.endsWith('.mrpack'));
    if (file) return { version: v.version_number, name: v.name, url: file.url, sha1: file.hashes.sha1, filename: file.filename };
  }
  throw new Error('No .mrpack found on Modrinth for the Cobble Asia pack');
}

/**
 * Downloads (or reuses) the .mrpack and returns the parsed pack:
 * { version, minecraft, loader, mods: [{ filename, sha1, urls }], overrides: [{ path, data }] }
 */
async function loadPack(info) {
  const dir = path.join(cacheDir(), 'packs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, info.filename);
  let buf = fs.existsSync(file) ? fs.readFileSync(file) : null;
  if (!buf || sha1(buf) !== info.sha1) {
    buf = await fetchBuffer(info.url);
    if (sha1(buf) !== info.sha1) throw new Error('The pack download was corrupted (checksum mismatch). Try again.');
    fs.writeFileSync(file, buf);
  }

  const zip = new AdmZip(buf);
  const index = JSON.parse(zip.readAsText('modrinth.index.json'));
  const deps = index.dependencies || {};
  if (!deps['fabric-loader']) throw new Error('This pack is not a Fabric pack; the installer only supports Fabric.');

  const mods = index.files
    .filter((f) => !(f.env && f.env.client === 'unsupported'))
    .map((f) => ({ path: f.path, filename: path.posix.basename(f.path), sha1: f.hashes.sha1, urls: f.downloads }));

  // "overrides/" applies to both sides, "client-overrides/" to the client only.
  const overrides = [];
  for (const prefix of ['overrides/', 'client-overrides/']) {
    for (const e of zip.getEntries()) {
      if (e.isDirectory || !e.entryName.startsWith(prefix)) continue;
      overrides.push({ path: e.entryName.slice(prefix.length), data: e.getData() });
    }
  }
  return { version: info.version, name: index.name, minecraft: deps.minecraft, loader: deps['fabric-loader'], mods, overrides };
}

/** Makes sure every mod is in the cache, verified. Returns the cache folder. */
async function ensureMods(pack, onProgress = () => {}) {
  const dir = path.join(cacheDir(), 'mods');
  fs.mkdirSync(dir, { recursive: true });
  let done = 0;
  const queue = [...pack.mods];
  const worker = async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      const file = path.join(dir, m.filename);
      const cached = fs.existsSync(file) && sha1(fs.readFileSync(file)) === m.sha1;
      if (!cached) {
        let ok = false;
        for (const url of m.urls) {
          try {
            const buf = await fetchBuffer(url);
            if (sha1(buf) !== m.sha1) throw new Error('checksum mismatch');
            fs.writeFileSync(file, buf);
            ok = true;
            break;
          } catch {
            /* try the next mirror */
          }
        }
        if (!ok) throw new Error(`Couldn't download ${m.filename}. Check your internet connection and try again.`);
      }
      done++;
      onProgress(done, pack.mods.length, m.filename);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return dir;
}

/** Fabric's launcher profile JSON (the same file the Fabric installer writes). */
async function fabricProfile(minecraft, loader) {
  const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(minecraft)}/${encodeURIComponent(loader)}/profile/json`;
  return JSON.parse((await fetchBuffer(url)).toString('utf8'));
}

module.exports = { latestVersion, loadPack, ensureMods, fabricProfile };
