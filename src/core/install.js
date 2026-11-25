'use strict';
// Installs the pack into one target (see detect.js for the three kinds).
const fs = require('fs');
const path = require('path');
const nbt = require('./nbt');

const SERVER = 'play.cobbleasia.net';
const INSTANCE_NAME = 'CobbleAsia S2';
const PROFILE_KEY = 'cobbleasia';
const MANIFEST = '.cobbleasia-installed.json';
const MEMORY_MB = 6144;

const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeFile = (p, data) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
};

/**
 * Puts mods, configs and the server entry into a game folder.
 * shared=true means the folder is a .minecraft other things also use: on the
 * first install, mods already there are moved to a dated backup folder (never
 * deleted) so they can't clash. Later updates only swap our own mods, so any
 * extra client mods the player adds afterwards stay.
 */
function installGameFiles(gameDir, pack, modCache, { shared }) {
  const modsDir = path.join(gameDir, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });
  const manifestPath = path.join(modsDir, MANIFEST);
  const firstInstall = !fs.existsSync(manifestPath);
  const previous = firstInstall ? [] : readJson(manifestPath).files || [];

  const overrideMods = pack.overrides.filter((o) => /^mods\/[^/]+\.jar$/i.test(o.path));
  const wanted = new Set([...pack.mods.map((m) => m.filename), ...overrideMods.map((o) => path.posix.basename(o.path))]);

  // Drop our mods from the previous version that this version no longer has.
  for (const f of previous) {
    if (!wanted.has(f)) fs.rmSync(path.join(modsDir, f), { force: true });
  }

  let backupDir = null;
  let backedUp = 0;
  if (shared && firstInstall) {
    for (const f of fs.readdirSync(modsDir)) {
      if (!f.toLowerCase().endsWith('.jar') || wanted.has(f)) continue;
      backupDir = backupDir || path.join(gameDir, `mods-backup-${stamp()}`);
      fs.mkdirSync(backupDir, { recursive: true });
      fs.renameSync(path.join(modsDir, f), path.join(backupDir, f));
      backedUp++;
    }
  }

  for (const m of pack.mods) fs.copyFileSync(path.join(modCache, m.filename), path.join(modsDir, m.filename));
  for (const o of overrideMods) writeFile(path.join(modsDir, path.posix.basename(o.path)), o.data);

  for (const o of pack.overrides) {
    if (overrideMods.includes(o)) continue;
    const rel = o.path;
    if (rel === 'README.md') continue;
    const dest = path.join(gameDir, ...rel.split('/'));
    if (rel === 'servers.dat') {
      const existing = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
      writeFile(dest, nbt.mergeServers(existing, o.data));
    } else if (rel === 'options.txt') {
      if (!fs.existsSync(dest)) writeFile(dest, o.data); // never reset the player's settings
    } else {
      writeFile(dest, o.data);
    }
  }

  fs.writeFileSync(manifestPath, JSON.stringify({ pack: pack.version, files: [...wanted].sort() }, null, 2));
  return { backedUp, backupDir };
}

/** Writes Fabric's version JSON into <mc>/versions so the launcher can start Fabric. */
function installFabricVersion(mcDir, fabricProfile) {
  const id = fabricProfile.id;
  writeFile(path.join(mcDir, 'versions', id, `${id}.json`), JSON.stringify(fabricProfile, null, 2));
  return id;
}

function installOfficial(target, pack, modCache, fabricProfile, { icon } = {}) {
  const mc = target.dir;
  const versionId = installFabricVersion(mc, fabricProfile);
  const gameDir = path.join(mc, 'cobbleasia');
  const result = installGameFiles(gameDir, pack, modCache, { shared: false });

  const now = new Date().toISOString();
  let wrote = 0;
  for (const name of ['launcher_profiles.json', 'launcher_profiles_microsoft_store.json']) {
    const file = path.join(mc, name);
    if (!fs.existsSync(file)) continue;
    let data;
    try {
      data = readJson(file);
    } catch {
      throw new Error(`Couldn't read ${name}. Close the Minecraft Launcher and try again.`);
    }
    const backup = `${file}.cobbleasia-backup`;
    if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
    data.profiles = data.profiles || {};
    const old = data.profiles[PROFILE_KEY] || {};
    data.profiles[PROFILE_KEY] = {
      ...old,
      name: INSTANCE_NAME,
      type: 'custom',
      created: old.created || now,
      lastUsed: now,
      lastVersionId: versionId,
      gameDir,
      javaArgs: `-Xmx${MEMORY_MB / 1024}G -XX:+UseG1GC`,
      icon: icon || old.icon || 'Grass',
    };
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    wrote++;
  }
  if (!wrote) throw new Error('No launcher_profiles.json found. Open the Minecraft Launcher once, close it, then try again.');
  return { ...result, versionId, gameDir };
}

function installShared(target, pack, modCache, fabricProfile) {
  const versionId = installFabricVersion(target.dir, fabricProfile);
  const result = installGameFiles(target.dir, pack, modCache, { shared: true });
  return { ...result, versionId, gameDir: target.dir };
}

function setCfg(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) return text.replace(re, line);
  return text.replace(/\s*$/, '\n') + line + '\n';
}

function mmcPack(pack) {
  return {
    components: [
      { cachedName: 'LWJGL 3', cachedVersion: '3.3.3', cachedVolatile: true, dependencyOnly: true, uid: 'org.lwjgl3', version: '3.3.3' },
      { cachedName: 'Minecraft', cachedRequires: [{ suggests: '3.3.3', uid: 'org.lwjgl3' }], cachedVersion: pack.minecraft, important: true, uid: 'net.minecraft', version: pack.minecraft },
      { cachedName: 'Intermediary Mappings', cachedRequires: [{ equals: pack.minecraft, uid: 'net.minecraft' }], cachedVersion: pack.minecraft, cachedVolatile: true, dependencyOnly: true, uid: 'net.fabricmc.intermediary', version: pack.minecraft },
      { cachedName: 'Fabric Loader', cachedRequires: [{ uid: 'net.fabricmc.intermediary' }], cachedVersion: pack.loader, uid: 'net.fabricmc.fabric-loader', version: pack.loader },
    ],
    formatVersion: 1,
  };
}

function installInstance(target, pack, modCache) {
  const instDir = path.join(target.dir, INSTANCE_NAME);
  fs.mkdirSync(instDir, { recursive: true });
  // Prism accepts either name; keep whichever an existing instance already uses.
  const gameDir = fs.existsSync(path.join(instDir, '.minecraft')) ? path.join(instDir, '.minecraft') : path.join(instDir, 'minecraft');
  const result = installGameFiles(gameDir, pack, modCache, { shared: false });

  const cfgPath = path.join(instDir, 'instance.cfg');
  let cfg = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : `[General]\nname=${INSTANCE_NAME}\n`;
  const set = {
    InstanceType: 'OneSix',
    iconKey: 'default',
    JoinServerOnLaunch: 'true',
    JoinServerOnLaunchAddress: SERVER,
    OverrideMemory: 'true',
    MinMemAlloc: '1024',
    MaxMemAlloc: String(MEMORY_MB),
    notes: `Cobble Asia client pack ${pack.version}. Press Launch and the game joins ${SERVER}. Accept the server resource pack when asked.`,
  };
  for (const [k, v] of Object.entries(set)) cfg = setCfg(cfg, k, v);
  fs.writeFileSync(cfgPath, cfg);
  fs.writeFileSync(path.join(instDir, 'mmc-pack.json'), JSON.stringify(mmcPack(pack), null, 4));
  return { ...result, gameDir, instanceDir: instDir };
}

function installTarget(target, pack, modCache, fabricProfile, opts) {
  if (target.kind === 'instance') return installInstance(target, pack, modCache);
  if (target.kind === 'official') return installOfficial(target, pack, modCache, fabricProfile, opts);
  return installShared(target, pack, modCache, fabricProfile);
}

module.exports = { installTarget, installGameFiles, SERVER, INSTANCE_NAME };
