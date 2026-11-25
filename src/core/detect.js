'use strict';
// Finds launchers on this computer and describes how to install into each.
//
// Target kinds:
//   instance - Prism-family launchers (Prism, PolyMC, PineconeMC, MultiMC): we
//              write a ready "CobbleAsia S2" instance that joins the server on Launch.
//   official - the official Minecraft Launcher: a Fabric version + a profile
//              with its own game folder, so vanilla and other mods stay untouched.
//   shared   - launchers that run straight out of .minecraft (TLauncher,
//              SKlauncher, others): Fabric version + mods in .minecraft/mods.
const fs = require('fs');
const path = require('path');
const { appData, minecraftDir } = require('./paths');

const exists = (p) => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * Prism-family launchers keep their instances folder in "<data>/instances"
 * unless the config file says otherwise (InstanceDir=..., relative to <data>).
 */
function instancesDirFor(dataDir) {
  let dir = path.join(dataDir, 'instances');
  let cfgs = [];
  try {
    cfgs = fs.readdirSync(dataDir).filter((f) => f.toLowerCase().endsWith('.cfg'));
  } catch {
    return dir;
  }
  for (const cfg of cfgs) {
    let text;
    try {
      text = fs.readFileSync(path.join(dataDir, cfg), 'utf8');
    } catch {
      continue;
    }
    const m = text.match(/^InstanceDir=(.*)$/m);
    if (m && m[1].trim()) {
      const v = m[1].trim();
      dir = path.isAbsolute(v) ? v : path.join(dataDir, v);
      break;
    }
  }
  return dir;
}

const PRISM_FAMILY = [
  { id: 'prism', name: 'Prism Launcher', folder: 'PrismLauncher' },
  { id: 'pinecone', name: 'PineconeMC', folder: 'ElyPrismLauncher' },
  { id: 'polymc', name: 'PolyMC', folder: 'PolyMC' },
];

function detect() {
  const targets = [];
  const ad = appData();

  for (const l of PRISM_FAMILY) {
    const data = path.join(ad, l.folder);
    if (!exists(data)) continue;
    targets.push({
      id: l.id,
      name: l.name,
      kind: 'instance',
      dir: instancesDirFor(data),
      autoJoin: true,
    });
  }

  const mc = minecraftDir();
  const hasProfiles =
    exists(path.join(mc, 'launcher_profiles.json')) ||
    exists(path.join(mc, 'launcher_profiles_microsoft_store.json'));
  if (hasProfiles) {
    targets.push({ id: 'official', name: 'Minecraft Launcher (official)', kind: 'official', dir: mc });
  }

  // TLauncher and SKlauncher have no published file layout; these markers are
  // the commonly reported ones. Either way they run out of .minecraft.
  const tlauncher =
    exists(path.join(mc, 'TlauncherProfiles.json')) ||
    exists(path.join(ad, '.tlauncher')) ||
    exists(path.join(ad, 'tlauncher'));
  const sklauncher = exists(path.join(ad, 'sklauncher')) || exists(path.join(mc, 'sklauncher'));
  if (tlauncher) targets.push({ id: 'tlauncher', name: 'TLauncher', kind: 'shared', dir: mc });
  if (sklauncher) targets.push({ id: 'sklauncher', name: 'SKlauncher', kind: 'shared', dir: mc });

  // A .minecraft folder we can't attribute to a known launcher.
  if (exists(mc) && !hasProfiles && !tlauncher && !sklauncher) {
    targets.push({ id: 'minecraft', name: 'Other launcher (uses .minecraft)', kind: 'shared', dir: mc });
  }
  return targets;
}

/**
 * A folder the player picked by hand. A Prism-family data folder or an
 * instances folder becomes an instance target; anything else is treated as a
 * .minecraft-style game folder.
 */
function targetForFolder(folder) {
  const base = path.basename(folder);
  const isData = fs
    .readdirSync(folder)
    .some((f) => /^(prismlauncher|multimc|polymc|elyprismlauncher)\.cfg$/i.test(f));
  if (isData) {
    return { id: 'custom', name: `Launcher in ${base}`, kind: 'instance', dir: instancesDirFor(folder), autoJoin: true };
  }
  if (base.toLowerCase() === 'instances') {
    return { id: 'custom', name: `Instances in ${path.basename(path.dirname(folder))}`, kind: 'instance', dir: folder, autoJoin: true };
  }
  return { id: 'custom', name: `Game folder ${base}`, kind: 'shared', dir: folder };
}

module.exports = { detect, targetForFolder, instancesDirFor };
