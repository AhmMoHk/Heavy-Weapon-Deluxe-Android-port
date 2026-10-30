# Heavy Weapon - Android port, source code (v2.0)

Personal port of Heavy Weapon Deluxe (the PC game) to Android phones and tablets.
The game is an HTML5 canvas re-implementation running in a full-screen WebView; music is played natively.

## Layout

| Path | What it is |
|---|---|
| `src/js/` | The game. Concatenated in this order by `tools/build_web.sh` into `build/www/js/game.js`: `core.js` (loop, rendering, audio, fonts, storage), `input.js` (touch joystick / FIRE / NUKE), `10_data.js` (tables from the original), `20_collide.js` (pixel collision), `30_board.js` (the battlefield), `40_crafts.js` (enemy units), `50_projectiles.js` (shots, bombs, missiles, DANGER sign), `60_bosses.js` (the 10 bosses, boss space), `70_draw.js` (battlefield drawing, status bar), `80_ui.js` (title, menus, map, armory, debriefing, dialogs, movies, flow), `main.js` (loading) |
| `build/www/index.html` | The web page the WebView opens |
| `android/` | The Android app: `AndroidManifest.xml`, `src/org/hwport/heavyweapon/MainActivity.java` (WebView host, asset server, gapless music streamer, JS bridge `HWNative`), `res/` (icon, app name) |
| `tools/` | `build_web.sh`, `build_apk.sh` (javac -> dx -> aapt -> zipalign -> apksigner) and the converters that made the game files from the original (`convert_images.py`, `convert_fonts.py`, `convert_data.py`, `gen_sprites.py`, `mo3_*.py` for the music) |
| `keystore.jks` | The signing key of your APK (password `hwport123`) - keep it to build updates that install over the current app |
| `PROGRESS.md` | Notes on every version and on the original code each part follows |

## The game files (images, sounds, music, movies, fonts, data)

They come from your copy of the game and are not in this source archive. They are inside the APK:
an APK is a ZIP file - open `HeavyWeapon-v2.0.apk` with any ZIP tool and copy the folder `assets/www/`
to `build/www/` (keep `build/www/index.html` and `build/www/js/` from here).

## Building

Needs a Linux shell with Node.js (only for checks), Java (javac), the Android SDK build tools
(`dalvik-exchange`/`dx`, `aapt`, `zipalign`, `apksigner`) and `platforms/android-23/android.jar`
(paths at the top of `tools/build_apk.sh`).

```
bash tools/build_web.sh     # src/js/*.js -> build/www/js/game.js
bash tools/build_apk.sh     # -> out/HeavyWeapon.apk (signed with keystore.jks)
```

For a quick look in a desktop browser: `cd build/www && python3 -m http.server 8765`, then open
`http://127.0.0.1:8765/` (music plays through HTML audio there instead of the native player).
