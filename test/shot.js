'use strict';
// Drives the real app window: screenshot of the launcher list, press Install,
// wait for the result screen, screenshot it. Run with a temp HOME:
//   HOME=<temp> npx electron test/shot.js <outDir>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const outDir = process.argv[process.argv.length - 1];
require('../src/main.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.on('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', async () => {
    try {
      const js = (code) => win.webContents.executeJavaScript(code);
      win.webContents.setBackgroundThrottling(false);
      // A background window may not repaint; force a fresh frame before each capture.
      const shot = async (name) => {
        win.webContents.invalidate();
        await wait(400);
        fs.writeFileSync(path.join(outDir, name), (await win.capturePage()).toPNG());
      };
      await wait(2500);
      await shot('1-choose.png');
      await js("document.getElementById('install').click()");
      await wait(800);
      await shot('2-working.png');
      for (let i = 0; i < 600 && (await js("document.getElementById('done').hidden")); i++) await wait(500);
      await shot('3-done.png');
      console.log('RESULTS:', await js("document.getElementById('results').innerText"));
    } catch (e) {
      console.error('shot failed', e);
    }
    app.quit();
  });
});
