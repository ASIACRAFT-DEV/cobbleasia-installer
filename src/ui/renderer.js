'use strict';
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

let targets = [];

function show(section) {
  for (const id of ['choose', 'working', 'done']) $(id).hidden = id !== section;
}

function renderTargets() {
  const list = $('targets');
  list.replaceChildren();
  $('none').hidden = targets.length > 0;
  targets.forEach((t, i) => {
    const li = el('li');
    const label = el('label');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = t.checked !== false;
    box.addEventListener('change', () => {
      t.checked = box.checked;
      updateButton();
    });
    const info = el('div');
    const name = el('div', 'name', t.name);
    if (t.autoJoin) name.append(el('span', 'tag', 'joins the server on Launch'));
    info.append(name, el('div', 'path', t.dir));
    label.append(box, info);
    li.append(label);
    list.append(li);
    t.checked = box.checked;
    t.key = t.key || `${t.kind}:${t.dir}:${i}`;
  });
  updateButton();
}

function updateButton() {
  $('install').disabled = !targets.some((t) => t.checked);
}

/** Plain steps for the player, per kind of launcher. */
function steps(r, summary) {
  const t = r.target;
  if (t.kind === 'instance') {
    return [
      `Open ${t.name} (restart it if it was open).`,
      'Select "CobbleAsia S2" and press Launch. It joins the server by itself.',
    ];
  }
  if (t.kind === 'official') {
    return [
      'Open the Minecraft Launcher.',
      'Next to the Play button, pick the "CobbleAsia S2" installation.',
      'Press Play, then Multiplayer → Cobble Asia.',
    ];
  }
  const out = [
    `Open ${t.name}.`,
    `Choose the version ${summary.fabricId || 'Fabric ' + summary.loader}.`,
    'In its settings, give Minecraft at least 6 GB of memory (RAM).',
    'Press Play, then Multiplayer → Cobble Asia.',
  ];
  return out;
}

function renderResults(summary) {
  const list = $('results');
  list.replaceChildren();
  for (const r of summary.results) {
    const li = el('li');
    li.append(el('div', `icon ${r.ok ? 'ok' : 'bad'}`, r.ok ? '✔' : '✖'));
    const body = el('div');
    body.append(el('div', 'name', `${r.target.name}${r.ok ? `: pack ${summary.version} installed` : ': not installed'}`));
    if (!r.ok) {
      body.append(el('div', 'path', r.error));
    } else {
      const ol = el('ol');
      for (const s of steps(r, summary)) ol.append(el('li', null, s));
      body.append(ol);
      if (r.backedUp) {
        const note = el('div', 'path', `Your ${r.backedUp} other mod(s) were moved to ${r.backupDir} so they can't clash. Move back any you still want.`);
        const open = el('button', 'link', 'Open that folder');
        open.addEventListener('click', () => window.installer.openFolder(r.backupDir));
        body.append(note, open);
      }
    }
    li.append(body);
    list.append(li);
  }
}

async function init() {
  window.installer.onProgress(({ text, pct }) => {
    $('status').textContent = text;
    $('fill').style.width = `${pct}%`;
  });

  window.installer
    .packInfo()
    .then((p) => ($('pack').textContent = `pack ${p.version}`))
    .catch(() => ($('pack').textContent = "can't reach Modrinth, check your internet"));

  targets = await window.installer.detect();
  renderTargets();

  $('add').addEventListener('click', async () => {
    const t = await window.installer.pickFolder();
    if (!t) return;
    if (!targets.some((x) => x.kind === t.kind && x.dir === t.dir)) targets.push(t);
    renderTargets();
  });

  $('install').addEventListener('click', async () => {
    const chosen = targets.filter((t) => t.checked).map(({ id, name, kind, dir, autoJoin }) => ({ id, name, kind, dir, autoJoin }));
    show('working');
    try {
      const summary = await window.installer.install(chosen);
      renderResults(summary);
    } catch (e) {
      renderResults({ results: [{ target: { name: 'Install' }, ok: false, error: String(e.message || e).replace(/^Error invoking remote method 'install': (Error: )?/, '') }] });
    }
    show('done');
  });

  $('again').addEventListener('click', () => show('choose'));
}

init();
