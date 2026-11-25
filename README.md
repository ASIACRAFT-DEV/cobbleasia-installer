# CobbleAsia Installer

A small desktop app for Windows and macOS that installs the Cobble Asia client
pack (play.cobbleasia.net) into the Minecraft launchers already on your computer.

## What it does

1. Finds your launchers.
2. Downloads the newest Cobble Asia pack from Modrinth and checks every file.
3. Installs it so you can join the server.

| Launcher | What gets installed |
|---|---|
| Prism Launcher, PineconeMC, PolyMC (or any Prism/MultiMC folder you pick) | A ready `CobbleAsia S2` instance with 6 GB of memory. Press **Launch** and it joins the server by itself. |
| Official Minecraft Launcher | Fabric plus a `CobbleAsia S2` installation with its own game folder, so your normal Minecraft and other mods aren't touched. |
| TLauncher, SKlauncher, or any other launcher that uses `.minecraft` | Fabric plus the mods in `.minecraft/mods`. On the first install, mods already there are moved to a dated `mods-backup-…` folder (never deleted). |

Cobble Asia is added to the top of your server list. Your other servers stay.
Run the installer again any time to update to the newest pack. Only Cobble Asia's
own mods are swapped, so extra client mods you added (shaders, minimaps) stay.

The installer doesn't handle accounts or start the game; your launcher does that.

## Download

Get the latest file from [Releases](../../releases):

- **Windows:** the `.exe`. If Windows says "Windows protected your PC", press **More info → Run anyway**.
- **Mac:** the `.dmg`. The first time, right-click the app → **Open**, or **System Settings → Privacy & Security → Open Anyway**.

## Development

```sh
npm install
npm start                      # run the app
HOME=$(mktemp -d) npm test     # end-to-end test against fake launcher folders (macOS/Linux)
npm run dist:mac               # build the .dmg (dist:win for the Windows .exe)
```

Pushing a tag like `v1.0.1` builds both platforms in GitHub Actions and publishes a release.

Source layout: `src/core/` holds the logic (`detect.js` finds launchers, `pack.js`
downloads the pack, `install.js` writes it, `nbt.js` merges `servers.dat`);
`src/ui/` is the window.
