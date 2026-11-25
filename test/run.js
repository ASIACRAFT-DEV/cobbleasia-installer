'use strict';
// End-to-end test of the core against fake launcher folders.
// Usage: HOME=<empty temp dir> node test/run.js   (macOS/Linux layout)
// Downloads the real pack from Modrinth on first run (cached afterwards).
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { appData, minecraftDir } = require('../src/core/paths');

// This test deletes launcher folders, so only ever run it against a temp dir:
// HOME=<temp> on macOS/Linux, APPDATA=<temp> on Windows.
if (!/scratch|tmp|temp/i.test(appData())) {
  console.error(`Refusing to run: ${appData()} doesn't look like a temp folder. Point HOME (or APPDATA on Windows) at an empty temp dir.`);
  process.exit(1);
}
const { detect, targetForFolder } = require('../src/core/detect');
const pack = require('../src/core/pack');
const { installTarget, SERVER, INSTANCE_NAME } = require('../src/core/install');
const nbt = require('../src/core/nbt');

const T = nbt.T;
function serversDat(entries) {
  const items = entries.map(([name, ip]) => ({ type: T.COMPOUND, value: [['name', { type: T.STRING, value: name }], ['ip', { type: T.STRING, value: ip }]] }));
  return nbt.write({ name: '', tag: { type: T.COMPOUND, value: [['servers', { type: T.LIST, value: { elemType: T.COMPOUND, items } }]] } });
}
const serverIps = (file) => {
  const root = nbt.read(fs.readFileSync(file));
  const list = root.tag.value.find(([k]) => k === 'servers')[1].value.items;
  return list.map((it) => it.value.find(([k]) => k === 'ip')[1].value);
};

(async () => {
  // --- fake launchers (wiped each run; the download cache is kept) ---
  const ad = appData();
  const mc = minecraftDir();
  for (const d of ['PrismLauncher', 'ElyPrismLauncher', 'PolyMC', 'sklauncher', 'tlauncher', '.tlauncher']) {
    fs.rmSync(path.join(ad, d), { recursive: true, force: true });
  }
  fs.rmSync(mc, { recursive: true, force: true });
  fs.mkdirSync(path.join(ad, 'PrismLauncher'), { recursive: true });
  fs.writeFileSync(path.join(ad, 'PrismLauncher', 'prismlauncher.cfg'), '[General]\nInstanceDir=instances\n');
  fs.mkdirSync(path.join(mc, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(mc, 'launcher_profiles.json'), JSON.stringify({ profiles: { abc: { name: 'Latest release', type: 'latest-release' } }, version: 3 }));
  fs.writeFileSync(path.join(mc, 'TlauncherProfiles.json'), '{}');
  fs.writeFileSync(path.join(mc, 'mods', 'some-other-mod.jar'), 'x');
  fs.writeFileSync(path.join(mc, 'servers.dat'), serversDat([['My Friend', 'friend.example.com']]));

  const targets = detect();
  console.log('detected:', targets.map((t) => `${t.name} [${t.kind}] ${t.dir}`));
  assert.deepStrictEqual(targets.map((t) => t.id).sort(), ['official', 'prism', 'tlauncher']);

  // --- pack ---
  const info = await pack.latestVersion();
  console.log('latest:', info.version, info.filename);
  const p = await pack.loadPack(info);
  console.log(`pack ${p.version}: mc ${p.minecraft}, fabric ${p.loader}, ${p.mods.length} mods, ${p.overrides.length} override files`);
  const sd = p.overrides.find((o) => o.path === 'servers.dat');
  assert.ok(sd, 'pack has servers.dat');
  assert.ok(nbt.write(nbt.read(sd.data)).equals(sd.data), 'servers.dat round-trips byte for byte');

  let last = 0;
  const cache = await pack.ensureMods(p, (d, n) => {
    if (d - last >= 10 || d === n) { console.log(`  mods ${d}/${n}`); last = d; }
  });
  const fabric = await pack.fabricProfile(p.minecraft, p.loader);

  // --- install everywhere, twice (second run = update path) ---
  const expectedJars = p.mods.length + p.overrides.filter((o) => /^mods\/.*\.jar$/.test(o.path)).length;
  for (const run of [1, 2]) {
    for (const t of targets) {
      const r = installTarget(t, p, cache, fabric, {});
      console.log(`run ${run} ${t.id}:`, JSON.stringify({ backedUp: r.backedUp, gameDir: r.gameDir }));
      const jars = fs.readdirSync(path.join(r.gameDir, 'mods')).filter((f) => f.endsWith('.jar'));
      assert.strictEqual(jars.length, expectedJars, `${t.id} jar count`);
      const ips = serverIps(path.join(r.gameDir, 'servers.dat'));
      assert.strictEqual(nbt.hostOf(ips[0]), SERVER, `${t.id}: Cobble Asia first in server list`);
      assert.strictEqual(ips.filter((ip) => nbt.hostOf(ip) === SERVER).length, 1, `${t.id}: no duplicate entry`);
      if (t.id === 'tlauncher') {
        assert.ok(ips.includes('friend.example.com'), 'player server kept');
        assert.strictEqual(r.backedUp, run === 1 ? 1 : 0, 'backup only on first install');
      }
    }
  }

  // --- spot checks ---
  const inst = path.join(ad, 'PrismLauncher', 'instances', INSTANCE_NAME);
  const cfg = fs.readFileSync(path.join(inst, 'instance.cfg'), 'utf8');
  assert.match(cfg, /^JoinServerOnLaunch=true$/m);
  assert.match(cfg, new RegExp(`^JoinServerOnLaunchAddress=${SERVER}$`, 'm'));
  assert.strictEqual((cfg.match(/^MaxMemAlloc=/gm) || []).length, 1, 'cfg keys not duplicated on update');
  const mmc = JSON.parse(fs.readFileSync(path.join(inst, 'mmc-pack.json'), 'utf8'));
  assert.strictEqual(mmc.components.find((c) => c.uid === 'net.fabricmc.fabric-loader').version, p.loader);

  const profiles = JSON.parse(fs.readFileSync(path.join(mc, 'launcher_profiles.json'), 'utf8'));
  assert.ok(profiles.profiles.abc, 'existing profile kept');
  assert.strictEqual(profiles.profiles.cobbleasia.lastVersionId, fabric.id);
  assert.ok(fs.existsSync(path.join(mc, 'versions', fabric.id, `${fabric.id}.json`)));
  assert.ok(fs.existsSync(path.join(mc, 'launcher_profiles.json.cobbleasia-backup')));

  // A hand-picked folder: instances folder and a plain game folder.
  assert.strictEqual(targetForFolder(path.join(ad, 'PrismLauncher')).kind, 'instance');
  assert.strictEqual(targetForFolder(mc).kind, 'shared');

  console.log('\nALL CHECKS PASSED');
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
