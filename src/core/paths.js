'use strict';
// Where launchers keep their data on each OS. Windows and macOS are the
// supported targets; Linux paths are included so the core can be tested there.
const os = require('os');
const path = require('path');

function home() {
  return os.homedir();
}

/** %APPDATA% on Windows, ~/Library/Application Support on macOS. */
function appData() {
  if (process.platform === 'win32') {
    return process.env.APPDATA || path.join(home(), 'AppData', 'Roaming');
  }
  if (process.platform === 'darwin') {
    return path.join(home(), 'Library', 'Application Support');
  }
  return process.env.XDG_DATA_HOME || path.join(home(), '.local', 'share');
}

/** The default .minecraft folder used by the official launcher, TLauncher and SKlauncher. */
function minecraftDir() {
  if (process.platform === 'win32') return path.join(appData(), '.minecraft');
  if (process.platform === 'darwin') return path.join(appData(), 'minecraft');
  return path.join(home(), '.minecraft');
}

/** The installer's own cache (downloaded pack + mods), shared by every install. */
function cacheDir() {
  return path.join(appData(), 'CobbleAsiaInstaller', 'cache');
}

module.exports = { home, appData, minecraftDir, cacheDir };
