# Heavy Weapon Android port — progress notes (resume here)

Goal: personal Android port (APK) of the user's own Steam copy. HTML5 canvas game in a WebView APK.
Controls: floating joystick (left) = aim+move, FIRE + NUKE buttons (right). Screen adapts (logical H=480, W=640..1140).

## Layout
- orig/Heavy.Weapon.Deluxe/  original game (untrusted data)
- build/www/                 converted assets (img/, fonts/, sounds/, music/, data/) + index.html + js/game.js
- src/js/*.js                game sources, concatenated by tools/build_web.sh in order:
  core.js, input.js, 10_data, 20_collide, 30_board, 40_crafts, 50_projectiles, 60_bosses, 70_draw, 80_ui, main.js
- tools/build_web.sh  -> build/www/js/game.js ; tools/build_apk.sh -> out/HeavyWeapon.apk (signed, keystore.jks pass hwport123)
- re/ reverse-engineering outputs (dec/*.c decompiled funcs, *_all.c, research/imgtable.txt = app image table)
  disassembly helper: re-venv/bin/python -I <scratchpad>/drawcalls.py <start> <end>

## Status
- v1.0 (versionCode 3) delivered: everything playable end to end: title, menu, map/briefing, 19 missions, debrief,
  armory, survival, options, help, heroes, credits, pause, game over, hints.
- ALL 10 bosses now follow the decompiled code (Helicopter, Battleship, Rainer, Wrecker, Ape, Eye, Head, Worm,
  Robot, Final) incl. the original boss death sequence (21 explosions, 11-20 frame gaps, then white flash).
- Fidelity fixes in v1.0: boss hit order = main body first then parts (original craft list order); nukes also damage
  boss parts; ground scorch type/fade fixed (player: frame 1, -5/frame; enemy: frame 0, -3/frame);
  dedicated screen shake (B.shake, -2/frame) used by Robot/Ape/Wrecker landings instead of the white flash.
- Wide screens: boss target ranges widened by (half-320) or half/320 where the original clamps to the 640 screen.
- Tests (scratchpad, playwright, serve build/www on :8765): test1.js smoke, test3.js UI flows,
  test4.js <missions> <width> <chunks> <frames> (boss fights + projectile mix), test5.js (worm angry, robot eyes,
  final stages 2/3).
- v1.1 (versionCode 4): frame rendered 1:1 into a logical-size buffer then scaled once (fixes black seams between
  tiles/boss parts/status bar pieces at non-integer scales); render interpolation between 100 Hz steps
  (B.snapPrev/lerpBegin/lerpEnd, GameScene.preStep); original dialog look everywhere (Button = bracket + tinted
  button.png + Normal font; PopCap dialog header/lines layout: header baseline Y+inset+25, lines +36, 22 apart):
  Options (0x42a540/0x42b2f0: 3 sliders w/ readout, 4 checks, HELP/CREDITS/DONE), Pause (0x41f500), QUIT GAME
  confirm (0x41d320), GAME OVER with stats (0x41fe40/0x4201c0, also survival), PLAY TIP (0x423a30) with original
  hint texts + auto-fire hint after 6 single taps (0x417090); Detail slider = particle % / background on-off;
  gapless native music chain; menu theme silence trimmed (orig copy in research/music_orig).
- Original reference captures: second Wine instance on Xvfb :98 (env98.sh, prefix2, game2); screenshots in
  scratchpad d98_*.png, research/howto (how-to-play demo video), research/m1start; bot playthrough on :99 ->
  /home/claude/wine-hw/run_all/mNN (g_*.jpg every 3 s, debrief/armory/map.jpg), cinematics -> hw/cine/.
- v1.2 (versionCode 5): status bar score slot capped like the other slots on wide screens; tank treads drawn in
  640 px chunks (wide screens); craters fade like the original (1000-step life) so the road no longer turns into a
  black band; tank enters from the true screen edge; MAIN MENU like 0x426140 (glow flicker, tips, name panel, NEW
  USER, MISSION continue, LOCKED survival, quit taunts); briefing map 0x424bf0/0x425500 (corner brackets, country
  zoom, ENEMY INTEL cycling every enemy type of the mission, invade zoom + red fade); mission-start letters
  (0x41cae0); debrief overlay (0x426e60/0x426c80/0x427460, real bonuses); title 0x42eb60 (white fade from the intro
  flash, loading bar/slider/bullet, CLICK HERE TO PLAY, ATOMIC TANK! pop); armory 0x40f440/0x42ff80/0x4300c0
  (widgets at (i/3)*440+10,(i%3)*100+15, hover glow, additive bubble/levels/+- glow, dome part glow, armoryglow
  flicker, Computer-font monitor, POINTS REMAINING green at 465, NOT YET! dialog, points can be taken back to 0);
  heroes 0x4224e0/0x422780 (nukebg + rising fire puffs, smoked table, original defaults, WIN/nuke rank, blinking new
  entry, RESET confirm); cinematics as videos: intro (ends on the cannon flash), middle (after mission 9), final
  with credits (after mission 19, then heroes); wide-screen sides = blurred/darkened picture (HW.ambientFill).
- v1.3 (versionCode 6): HOW TO PLAY = live demo on a real Board in demo mode (Board({demo:true}): half 320, tank at
  y 400, no waves/scroll, invulnerable, script cursor + demoFire; HelpScene runs the 4-stage script of 0x420c30 /
  0x420e10 / 0x421160 / 0x420cd0 and draws per 0x421620 with touch FIRE/NUKE/stick icons instead of the mouse);
  shown once per session before the first battle (HW.withHelpFirst) unless "Do not show" is ticked
  (settings.noHelpAtStart); credits per 0x41ddd0 (waving flag polygon, quarter-pixel scroll from 510, alpha
  495-2|240-y|, titles yellow at 15 / names at 185, tap to leave); power-ups drift to the middle like 0x42c1b0
  (vx = -x*0.00625, vy = dropper's vy); "ATOMIC TANK!" voice (55) when leaving the title.
- Sound audit: every PlaySample id of the original is used by the port except 62 (v_waffle, typing WAFFLE on a
  keyboard); looping instances 24/41/43/76/78/84 and 75 tractorbeam all present.
- v1.4 (versionCode 7): the intro plays while the rest loads (main.js starts it after the title images; the title's
  bullet/slider show HW.loadProgress() until HW.loaded, then the plate closes); Android back closes open boxes
  (last button = NO/CANCEL/OK), asks the quit question on the main menu, leaves help/credits through their own
  return path, advances from the debrief.
- v1.5 (versionCode 8): mile sign fixed per 0x415b4f: milemarker top-left at (W + mileX, 350) (was 50 px too high),
  "n MILES" at (+10, 372), drawn before the ground strip so the posts go into the road; it rolls 1 px per step with
  the road and is reset after W + 65 steps.
- v1.6 (versionCode 9): nuke tint like 0x415530 (every background layer colorized with (255,255-nf,255-nf), the
  mushroom cloud untouched) - no more second multiply band from y 180 (the "black line"); battlefield zoom:
  B.zoomK() = settings.zoom or HW.zoomAuto() (aspect 4:3 1.0 ... 2:1 ~1.15, max 1.25), the world is drawn into a
  W/k x 480 buffer and scaled by k anchored at the road (HUD stays screen-space), B.half = W/(2k), aircraft band
  pushed down by B.skyShift() so nothing hides under the status bar, tall bosses' tops may go behind it like the HD
  edition; Options "Battlefield Zoom" slider 100-140% (snaps back to auto); demo boards keep k = 1. Touch flak
  aims at the first enemy on the gun line, otherwise bursts at the view top (B.viewTop()+40) or the screen side.
- v1.7 (versionCode 10): background anims are placed in the strips' own coordinates (x = offset + layer scroll,
  0 = left edge of the battlefield, no more +(half-320)), so on wide/zoomed screens the cooling-tower crack, waste
  spill, surrender flags, lighthouse, radio towers, hang tree, house light... sit on their buildings (they floated
  in the sky before); flying near-plane anims follow skyShift. Level end: the victory call (58) comes when the
  station is ~100 px away (about 1 s before the tank is parked), LevelEnd waits for gasX < 0.5 and opens the
  debriefing 300 steps later (its PlayMusic(4) victory song with it); HUD hidden from the call on. Performance:
  renders paced to 60/s (90/120 Hz screens), max 6 catch-up steps per frame, governor HW.perf (late frames > 25 ms
  in > 20% of a 3 s battle window -> perfLevel 1: canvas = logical buffer, compositor scales; 2: + particle cap 300;
  saved in settings.perfLevel), sound voices capped (24 total, 4 per sample, voices/blasts/loops exempt, nodes
  disconnected on end), particle pool + one-pass compaction, laser/megalaser targets prefiltered by ray/box,
  bullet/proj quick box rejection, touch controls pre-rendered into cached canvases, popup hue colours quantised
  (font tint cache stays small), shared D.FLIP option object.
- v1.8 (versionCode 11): debriefing opens the moment the tank is parked (gasX < 0.5) with music 4 and sample 58
  together (58 moved into DebriefScene like 0x426b50). Music: main menu = song 3 @59 (0x425e20, not restarted when
  already on), LoveTheme only on the title and played once (noLoop flag 2 in HWNative.playMusic / HTML audio).
  Sounds: DirectSound-style pan (+3 dB make-up on the equal-power panner, pan range +-0.5), no same-sample dedupe
  (stacking like the original, per-sample cap 4), soft limiter on the SFX bus, ICBM siren 69 centred (0x431d20)
  and ICBMs turn over just above the zoomed view's top edge. Danger triangle per 0x40ed50/0x40e920 (bands from the
  apex down, colour (255, sin(((tick+i)%100)*0.03141)*255, 0) alpha 128); top signs move down by skyShift.
  Tracks: older strips are cut back under the live one (one layer after respawns). Armory: tapping a weapon ball =
  its + button. Cruise kills are taken back (0x432c20) and the kill % is clamped to 100. Floating texts per 0x42c000/
  0x414a70/0x42bf90: Keypunch16, alpha 255-1/step, y0 + alpha/2 - 128, power-up messages HSL(hue,255,192) hue+=16,
  original push-apart; kill points use the same object. Zoomed view keeps fliers visible: heli/satellite hover band
  100..200 + skyShift, Helicopter/Rainer/Eye/Head/Final heights + skyShift. Strafer ball leaves from the nose.
  Progression: CONTINUE -> Armory (0x40e2f0 -> 0x401090 -> 0x40f190); saved campaign and best stage per player name
  (profile:<name>, settings.users[name].best; old single profile migrated) so Survival unlocks per player after 3
  stages; new game = 1 nuke, no shield, and every battle starts with at least the red shield (0x4191d0).
  Cinematics shown as a positioned <video> layer over the idle canvas (no per-frame copy; HW.render skips frames).
  Phones start in the lean render mode (perfLevel 1).
- v1.9 (versionCode 12): BOSS SPACE (60_bosses.js bossView): every boss works in the original's screen units with its
  own scale m (= 1/k: flying bosses anchored at y 480 stand where and as big as on the original screen; ground bosses
  anchored at the road y 460; the battleship fitWidth: as much across as the original's 640 px - two deck guns -
  limited so its deck top stays under the bar). A Proxy of the board converts tank/half/shots/bullets/explosions/
  particles/scores between the spaces; BP.draw/hitTest wrap drawB/hitTestB; crafts got wx()/wy() (homing, flak,
  thunder, nuke use them). Boss death per the originals (no death check in their updates): they keep moving/animating
  through the 21 explosions, only shots stop; wrecker's ball breaks loose and falls while the chain winds up (0x446a30,
  L -= 2), diesel idles with the original's fade-in/pitch drop. Wide screens: the parked wrecker rolls (<=0.45/step)
  toward the tank's side by up to half-320 so the long swing reaches the corners. Rainer meteor tail = meteorite
  particles (0x449630, white head). Level end per 0x41b690: HUD + touch controls gone from the final flash, boss song
  fades (0x41bf50 FadeOut 0.004 = 2.5 s; level song fades the same at the DANGER sign), debriefing at dist ==
  length + 500 (+ wide-screen extra), victory call waits for the native "music started" report (onMusicStart).
  Native music on its own HandlerThread, first piece of every track kept prepared (preloadMusic) -> no 0.5 s delay;
  fadeOutMusic. Cinematics: middle/final videos silent (audio was captured with the menu song under it): middle plays
  song 5 (0x41f070), final keeps the victory song; videos hidden until playing + blank poster + WebChromeClient
  getDefaultVideoPoster (no grey play icon). Sounds: priority voices (pick-ups, shield, crate parts, voices, menu...
  always play, ordinary ones steal the oldest), time-based voice bookkeeping, same-instant dedupe, one air-raid siren
  per salvo (panned), peak-only limiter. Danger intel text moves under a lowered top sign. Tracks: strips merge
  (old road kept, one layer). Helicopters pick random home spots across the width and stay inside the screen.
- (A boss-test build existed for v1.9/v2.0 and was dropped at the user's request.)
- v2.0 (versionCode 13): music played by a gapless streamer (MainActivity.MusicStream: MediaCodec decodes the OGG,
  AudioTrack plays it; the loop is decoded once while playing and repeats from memory - no seam; MediaPlayer chain only
  as fallback). SFX: soft clipper (tanh above 0.6) instead of the compressor, ordinary samples min 30 ms apart,
  MAX_SAME 3, voices taken over with an 8 ms fade (no clicks); IM-35 siren x1.3. Movie ends per 0x41efc0: colour wipe
  (sin, 0.05/update) in the movie's colour - middle green rgb(51,255,0), final rgb(153,51,51) - the next screen put
  up at pi/2 (HW.colorWipe, DOM layer). Status bar slides up (smoothstep, 0.015/update) after the final flash, HUD
  and touch controls fade with it. DANGER sign never under the bar (Danger.signY/topExtent). Debriefing 20 updates
  sooner (480). Nuke removes every enemy shot (0x41a160 field_41): meteors, eye beams, final lasers, rising ICBMs.
  Track pattern phase follows the road (groundX). MG-17 dive + shots, pickup RPG and T-63 lobs stretched by
  half/320 (land across the screen as across 640). Supply copter keeps its course and drops while the tank respawns.
  Launcher icon: the user's nuke emblem on black (research/icon/icon_source.png -> android/res/mipmap-*).
- NEXT: more side-by-side checks with the original.
