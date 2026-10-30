/* Heavy Weapon mobile port - the battlefield (re-implemented from the original game's logic) */
'use strict';
(function () {
  var D = HW.Draw;
  var rnd = HW.rnd, clamp = HW.clamp;
  var DEG = Math.PI / 180;

  /* ------------------------------------------------------------------ player profile / app state */
  HW.newProfile = function (name) {
    return {
      // a new game (0x40e250) clears everything and gives one nuke; the shield comes with the first battle
      name: name || 'TANKER', score: 0, mission: 0, lives: 3, nukes: 1, shield: 0, speed: 0, power: 0, rapid: 0, spread: 0,
      weapons: [0, 0, 0, 0, 0, 0], upgradePoints: 0, megaParts: 0, rank: 0, hints: 0, checkpoint: null,
      stats: { kills: 0, spawned: 0, shots: 0, misses: 0, friendlies: 0, projShot: 0 }
    };
  };
  HW.P = null; // active profile

  /* ------------------------------------------------------------------ sprite shortcut */
  function S(n) { return HW.img[n]; }
  HW.S = S;

  /* ------------------------------------------------------------------ Board */
  function Board(opts) {
    var P = HW.P;
    this.survival = !!opts.survival;
    this.demo = !!opts.demo;
    // every battle starts with at least the red shield (0x4191d0: if shield == 0 then shield = 1) - a new campaign
    // has none of its own, so mission 1 opens with the red shield and the one nuke a new game hands out
    if (!this.demo && P && !P.shield) P.shield = 1;
    this.mission = this.survival ? 0 : P.mission;
    this.country = this.survival ? 10 : HW.countryOf(this.mission);
    this.half = HW.W / (2 * this.zoomK());
    this.levelData = HW.data.levels[Math.min(this.country, 9)];
    var lenIdx = Math.min(this.mission, 8);
    this.length = HW.data.levels[lenIdx].length;
    if (this.survival) this.length = 1e9;
    this.dist = 0;           // field_17c
    this.tick = 0;
    this.speed = 0;          // scroll speed (field_188)
    this.skyX = 0; this.groundX = 0; this.bgX = 0; this.bg2X = 0;
    this.gasX = 1000;        // gas station position (field_190)
    this.gasName = 0;
    this.deathTimer = 300;   // field_80 (tank entering at level start)
    this.wasAlive = false;   // field_326
    this.deaths = 0;
    this.flash = 0;          // field_84 white flash
    this.nukeFlash = 0;      // field_88
    this.shake = 0;
    this.pupCooldown = 1000; // field_178
    this.crateCooldown = 0;  // field_1ac
    this.nukeCooldown = Math.floor(this.length / 6);   // field_1b0
    this.shieldCooldown = Math.floor(this.length / 8); // field_1b4
    if (this.survival) { this.nukeCooldown = 0; this.shieldCooldown = 0; }
    this.waveDelay = 100;    // field_1d0
    this.waves = [];         // active wave spawners
    this.mileX = 0;          // field_1c4
    this.noNukeBlink = 0;    // field_1dc
    this.boss = null;        // field_2e4
    this.bossEntering = true;// field_1e0
    this.bossDeath = null;   // field_300
    this.danger = null;      // field_30c
    this.levelDone = false;
    this.completeTimer = 0;
    this.noGround = false; this.noDozer = false; this.bossActive = false; // field_1b9 / 1ba / 1b8
    this.laneLeft = false; this.laneRight = false;
    this.pupCount = 0;       // field_1bc
    this.survStart = 0;      // field_180 (survival time offset)
    this.deathFlash = 0; this.deathX = 0; this.deathY = 443;
    // tank
    // the tank rolls in from just past the left edge of the screen (-380 on the original 640 screen)
    this.tx = -(this.half + 60); this.ty = 443;
    this.tankFrame = 0; this.gunFrame = 10;
    this.fireCd = 0; this.homingCd = 0; this.laserCd = 0; this.rocketCd = 0; this.flakCd = 0; this.thunderCd = 0;
    this.shieldInv = 0;      // field_148
    this.shieldZap = 0;      // field_160
    this.mega = 0;           // megalaser time (field_12c)
    this.megaParts = (!this.survival && this.mission > 0) ? (P.megaParts || 0) : 0;
    this.megaSound = null;
    this.beamLen = 800; this.beamAng = 0;
    this.orbAngle = 0; this.orbFlash = [0, 0, 0];
    this.cursorX = 320; this.cursorY = 100;
    // lists
    this.bullets = []; this.crafts = []; this.projs = []; this.explosions = []; this.particles = [];
    this.craters = []; this.tracks = []; this.casings = []; this.muzzles = []; this.scorches = [];
    this.powerups = []; this.crates = []; this.popups = []; this.texts = []; this.flaks = []; this.thunders = [];
    this.backObjs = []; this.anims = [null, null, null, null];
    this.mushrooms = [];
    // stats for debriefing
    this.st = { kills: 0, spawned: 0, friendlies: 0, projShot: 0, nukes: 0, shots: 0 };
    this.totalPoints = 0;
    // background images
    var bgn = HW.LEVEL_BG[this.country];
    this.imgSky = S('backgrounds/' + bgn + '_sky'); this.imgBg = S('backgrounds/' + bgn + '_bg');
    this.imgBg2 = S('backgrounds/' + bgn + '_bg2'); this.imgGround = S('backgrounds/' + bgn + '_ground');
    this.imgMap = S('backgrounds/' + bgn + '_map');
    this.animDefs = HW.data.anims[this.country] || [];
    if (this.survival) {
      this.survFile = HW.data.survival[rnd(10)];
      this.distStart = 0;
    }
    this.ending = null;
    // HOW TO PLAY demo board (0x421410): a 640 wide stage, no scrolling, the tank alive in the middle at y 400,
    // nothing spawns by itself (the demo script does it), the tank follows the script's cursor
    if (this.demo) {
      this.half = 320; this.tx = 0; this.ty = 400; this.deathTimer = 0; this.wasAlive = true;
      this.cursorX = 320; this.cursorY = 260; this.demoFire = false;
      this.st.spawned = 0;
    }
  }
  HW.Board = Board;
  var B = Board.prototype;

  /* battlefield magnification (HW.getZoom): the world is W/k wide; aircraft keep below the status bar, which now
     covers a little more of the sky (the band they fly in starts lower by skyShift) */
  B.zoomK = function () { return this.demo ? 1 : HW.getZoom(); };
  B.skyShift = function () { var k = this.zoomK(); return Math.max(0, 450 * (1 - 1 / k) - 12); };
  /* the topmost world line visible below the status bar */
  B.viewTop = function () { var k = this.zoomK(); return 480 - 450 / k; };

  /* level index used for difficulty: mission index, or survival rank (every 2 minutes) */
  B.levelIdx = function () { return this.survival ? Math.floor(this.dist / 12000) : this.mission; };
  B.edge = function () { return this.half; };

  /* ------------------------------------------------------------------ start */
  B.start = function () {
    HW.music(1);
    HW.snd(60);
    if (this.survival) this.bigText('SURVIVAL MODE', 240, 60);
    else {
      this.bigText('MISSION ' + (this.mission + 1), 220, 60);
      this.bigText(this.levelData.name, 280, 120, 'RubberStampLET20');
    }
  };

  /* ------------------------------------------------------------------ main update (100/s) */
  B.update = function () {
    var P = HW.P;
    if (this.demo) { this.updateDemo(); return; }
    this.half = HW.W / (2 * this.zoomK());
    this.tick++;
    if (this.paused) return;
    // death / respawn timer
    if (this.deathTimer > 0) {
      if (this.deathTimer === 300 && this.wasAlive) {
        if (P.lives > 0) { HW.snd(57); this.bigText('GET READY', 240, 15); }
        else { HW.snd(56); this.bigText('GAME OVER', 240, 40); }
      }
      if (this.deathTimer > 1) this.deathTimer--;
      if (this.deathTimer === 1 && !this.projs.some(function (p) { return p.isEnemy; })) {
        if (P.lives <= 0) { this.gameOver(); return; }
        P.lives--;
        this.deathTimer = 0;
      }
    } else {
      this.wasAlive = true;
      if (this.dist !== this.length || this.survival) this.dist++;
      if (this.survival) this.dist++;
      this.updateOrbs();
    }
    if (!this.survival) {
      if (this.dist === this.length - 600) {
        // wait for the sky to clear (enemy units and enemy fire only, so auto-fire cannot stall the boss)
        var busy = this.crafts.some(function (c) { return !c.friendly && !c.dead; }) ||
          this.bullets.some(function (b) { return b.enemy; }) || this.projs.some(function (p) { return p.isEnemy && !p.dead; });
        if (busy) this.dist--;
        else {
          this.danger = new HW.Danger(this);
          // 0x41b690: the level song fades out under the warning (FadeOut(1, 0.004 per update) = 2.5 s)
          HW.musicFade(2500);
        }
      }
      if (this.dist === this.length - 1 && !this.boss) this.spawnBoss();
      // the debriefing opens 500 updates after the boss's last explosion (0x41b690: dist == length + 500); on wide
      // screens the station starts further out, so the wait grows by the same distance
      if (this.levelDone && !this.ending && this.dist >= this.debriefAt) this.ending = new HW.LevelEnd(this);
      if (this.dist > 0 && this.dist < this.length && this.dist % 5000 === 0) this.mileX = -1;
    }
    if (this.nukeFlash > 0) { this.nukeFlash -= 0.75; if (this.nukeFlash < 0) this.nukeFlash = 0; }
    if (this.levelDone && (this.hudOut || 0) < 1) this.hudOut = Math.min(1, (this.hudOut || 0) + 0.015);
    if (this.pupCooldown > 0) this.pupCooldown--;
    if (this.crateCooldown > 0) this.crateCooldown--;
    if (this.nukeCooldown > 0) this.nukeCooldown--;
    if (this.shieldCooldown > 0) this.shieldCooldown--;
    if (this.waveDelay > 0 && this.waves.length === 0) { /* counted in updateWaves */ }
    if (this.noNukeBlink > 0) this.noNukeBlink--;
    if (this.deathFlash > 0 && this.deathFlash < 25) this.deathFlash++;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - 2);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - 2);
    if (this.shieldZap > 0) this.shieldZap = Math.max(0, this.shieldZap - 4);
    if (this.bossDeath) this.bossDeath.update();
    if (this.danger) this.danger.update();
    this.updateCrafts();
    this.updateBullets();
    this.updateProjs();
    this.updateExplosions();
    this.updateParticles();
    this.updatePowerups();
    this.updatePopups();
    this.updateTracks();
    this.updateMushrooms();
    // the beam is live while the cooldown is in its upper half (0x418a50 returns when laserCd < 50)
    if (this.laserCd >= 50 && P.weapons[2] > 0 && this.deathTimer === 0) this.updateLaser();
    if (this.mega > 0 && this.megaFiring) this.updateMegalaser();
    this.updateCrates();
    this.updateCasings();
    this.updateMuzzles();
    this.updateTexts();
    this.updateFlaks();
    this.updateThunders();
    this.spawnAnims();
    if (this.shieldInv > 0) this.shieldInv -= 0.3;
    if (this.deathTimer === 0) {
      this.updateTank();
      if (this.deathTimer === 0 && (this.dist < this.length - 800 || this.survival) && this.nukeFlash === 0) this.updateWaves();
    }
    // the sign rolls with the road from the right edge until it has left on the left (705 steps on the 640 screen)
    if (this.mileX < 0) { this.mileX--; if (this.mileX < -(this.half * 2 + 65)) this.mileX = 0; }
    if (this.ending) this.ending.update();
    // smooth part (UpdateF in the original)
    this.scroll(1);
    for (var i = 0; i < this.crafts.length; i++) this.crafts[i].move(1);
    if (this.megaSound && this.mega <= 0) { HW.Audio.stop(this.megaSound); this.megaSound = null; }
  };

  /* the demo board's step (0x4212a0 minus the script): the usual object updates, no waves, no scrolling */
  B.updateDemo = function () {
    this.tick++;
    if (this.nukeFlash > 0) { this.nukeFlash -= 0.75; if (this.nukeFlash < 0) this.nukeFlash = 0; }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - 2);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - 2);
    if (this.shieldZap > 0) this.shieldZap = Math.max(0, this.shieldZap - 4);
    this.updateCrafts();
    this.updateBullets();
    this.updateProjs();
    this.updateExplosions();
    this.updateParticles();
    this.updatePowerups();
    this.updatePopups();
    this.updateMushrooms();
    this.updateCasings();
    this.updateMuzzles();
    this.updateTexts();
    this.updateTank();
    for (var i = 0; i < this.crafts.length; i++) this.crafts[i].move(1);
  };

  /* ------------------------------------------------------------------ scrolling (0x4112f0) */
  B.scroll = function (f) {
    if (this.gasX < 10) this.speed = this.gasX * 0.1;
    else if (this.boss) this.speed *= 0.99;
    else { this.speed += 0.01; if (this.speed > 1) this.speed = 1; }
    var v = f * this.speed;
    this.skyX -= v * 0.1; if (this.skyX < -640) this.skyX += 640;
    this.bg2X -= v * 0.2; if (this.bg2X < -960) this.bg2X += 960;
    this.bgX -= v * 0.3; if (this.bgX < -960) this.bgX += 960;
    this.groundX -= v; if (this.groundX < -640) this.groundX += 640;
    if (this.gasX < 1000) this.gasX -= v;
    for (var i = this.craters.length - 1; i >= 0; i--) {
      var c = this.craters[i];
      // 0x4112f0: a crater lives 1000 steps (the last 512 fading out) unless it scrolls away first
      c.x -= f * this.speed;
      c.life -= f;
      if (c.life <= 0 || c.x < -this.half - 25) this.craters.splice(i, 1);
    }
    for (i = this.scorches.length - 1; i >= 0; i--) {
      var s = this.scorches[i];
      // the glow left by a bullet hitting the road fades (player 5, enemy 3 per step)
      s.x -= f * this.speed;
      s.a -= s.player ? 5 : 3;
      if (s.a <= 0 || s.x < -this.half - 30) this.scorches.splice(i, 1);
    }
    this.scrollAnims(f);
  };

  /* ------------------------------------------------------------------ render interpolation
     The simulation runs at the original 100 steps/s; phones refresh at 60/90/120 Hz, so a frame shows 1 or 2 steps
     (or none) and motion judders. Before every step the positions are remembered; a frame is drawn with every moving
     thing placed between its previous and current step position, then the real values are put back. */
  var LERP_LISTS = ['bullets', 'crafts', 'projs', 'explosions', 'particles', 'craters', 'scorches', 'casings', 'muzzles',
    'powerups', 'crates', 'popups', 'texts', 'mushrooms', 'flaks', 'thunders', 'anims'];
  var LERP_FIELDS = ['tx', 'ty', 'cursorX', 'cursorY', 'skyX', 'bg2X', 'bgX', 'groundX', 'gasX', 'mileX', 'deathX'];
  B.snapPrev = function () {
    for (var li = 0; li < LERP_LISTS.length; li++) {
      var L = this[LERP_LISTS[li]];
      if (!L) continue;
      for (var i = 0; i < L.length; i++) { var e = L[i]; if (e) { e._px = e.x; e._py = e.y; } }
    }
    for (i = 0; i < this.tracks.length; i++) { var t = this.tracks[i]; t._p1 = t.x1; t._p2 = t.x2; }
    var pv = this._pv || (this._pv = {});
    for (i = 0; i < LERP_FIELDS.length; i++) pv[LERP_FIELDS[i]] = this[LERP_FIELDS[i]];
    this._snapped = true;
  };
  function lerpNum(a, b, t, lim) { var d = b - a; return (d > lim || d < -lim) ? b : a + d * t; }
  B.lerpBegin = function (t) {
    if (!this._snapped || !(t > 0 && t < 1)) return false;
    var saved = this._lerpSaved || (this._lerpSaved = []);
    saved.length = 0;
    for (var li = 0; li < LERP_LISTS.length; li++) {
      var L = this[LERP_LISTS[li]];
      if (!L) continue;
      for (var i = 0; i < L.length; i++) {
        var e = L[i];
        if (!e || e.isBoss || e.noLerp || typeof e._px !== 'number' || typeof e.x !== 'number') continue;
        e._cx = e.x; e._cy = e.y;
        e.x = lerpNum(e._px, e.x, t, 64);
        if (typeof e._py === 'number' && typeof e.y === 'number') e.y = lerpNum(e._py, e.y, t, 64);
        saved.push(e);
      }
    }
    var ts = this._lerpTracks || (this._lerpTracks = []);
    ts.length = 0;
    for (i = 0; i < this.tracks.length; i++) {
      var k = this.tracks[i];
      if (typeof k._p1 !== 'number') continue;
      k._c1 = k.x1; k._c2 = k.x2;
      if (k.x1 <= k._p1) k.x1 = lerpNum(k._p1, k.x1, t, 64);   // (the +4 texture wrap at the left edge is not blended)
      k.x2 = lerpNum(k._p2, k.x2, t, 64);
      ts.push(k);
    }
    var pv = this._pv, cv = this._cv || (this._cv = {});
    for (i = 0; i < LERP_FIELDS.length; i++) {
      var f = LERP_FIELDS[i], v = this[f];
      cv[f] = v;
      if (typeof v === 'number' && typeof pv[f] === 'number') this[f] = lerpNum(pv[f], v, t, 64);
    }
    this._lerping = true;
    return true;
  };
  B.lerpEnd = function () {
    if (!this._lerping) return;
    var saved = this._lerpSaved, i;
    for (i = 0; i < saved.length; i++) { var e = saved[i]; e.x = e._cx; e.y = e._cy; }
    saved.length = 0;
    var ts = this._lerpTracks;
    for (i = 0; i < ts.length; i++) { ts[i].x1 = ts[i]._c1; ts[i].x2 = ts[i]._c2; }
    ts.length = 0;
    var cv = this._cv;
    for (i = 0; i < LERP_FIELDS.length; i++) this[LERP_FIELDS[i]] = cv[LERP_FIELDS[i]];
    this._lerping = false;
  };

  /* ------------------------------------------------------------------ background anims (0x419eb0 / 0x418f50) */
  B.spawnAnims = function () {
    if (!this.animDefs.length) return;
    if (!(this.dist < this.length - 2000 || this.survival)) return;
    for (var slot = 0; slot < 4; slot++) {
      if (this.anims[slot]) continue;
      if (rnd(200) !== 0) continue;
      var d = this.animDefs[rnd(this.animDefs.length)];
      if (d.rare === 'yes' && rnd(20) !== 0) continue;
      if (d.plane - 1 !== slot) continue;
      var a = { def: d, spr: S('anims/' + d.name), frame: 0, dir: 1, nuked: false, x: d.offset, y: d.y };
      if (slot === 1) a.x += this.bgX; else if (slot === 2) a.x += this.bg2X;
      // a.x is the top-left in the coordinates of the background strips (0 = left edge of the battlefield), so a
      // crack, spill or flag stays glued to its tower on any screen width; it starts beyond the right edge
      if (a.x < 640) a.x += 960;
      if (a.x < 640) a.x += 960;
      while (a.x < this.half * 2) a.x += 960;
      this.anims[slot] = a;
    }
  };
  B.scrollAnims = function (f) {
    for (var slot = 0; slot < 4; slot++) {
      var a = this.anims[slot];
      if (!a) continue;
      var d = a.def, frames = d.frames - (d.nuke === 'yes' ? 1 : 0);
      if (a.nuked) a.frame = d.frames - 1;
      else if (d.speed > 0 && frames > 1) {
        var sp = d.speed;
        for (var k = 0; k < d.delays.length; k++) if (d.delays[k].frame === Math.floor(a.frame)) sp = d.delays[k].speed;
        a.frame += a.dir * sp;
        if (a.frame >= frames) {
          if (d.type === 'pingpong') { a.dir = -1; a.frame = frames - 1; } else a.frame -= frames;
        } else if (a.frame < 0) { a.dir = 1; a.frame = 0; }
      } else if (frames <= 1) a.frame = 0;
      a.x += f * d.mx * this.speed;
      var m = [1, 0.3, 0.2, 0.1][slot];
      a.x -= f * this.speed * m;
      if (a.spr && a.x < -a.spr.cw) this.anims[slot] = null;
    }
  };
  B.drawAnim = function (ctx, slot) {
    var a = this.anims[slot];
    if (!a || !a.spr) return;
    var s = a.spr;
    // anim (x,y) is the TOP-LEFT corner (DRAWCEL centered=0) in the strips' own coordinates; x is floored like the
    // strips (tile()) so the two never drift a pixel apart. Things flying on the near plane (pterodactyl, peace
    // balloon, ghosts) come down with the aircraft band when the battlefield is zoomed.
    var x = Math.floor(a.x), y = a.y;
    if (slot === 0 && y < 250 && this.skyShift) y += this.skyShift();
    D.cel(ctx, s, x, Math.round(y), Math.floor(a.frame), 0);
  };

  /* ------------------------------------------------------------------ waves (0x41b340 / 0x41a5b0) */
  B.updateWaves = function () {
    var lv = this.levelIdx();
    // friendly supply helicopter
    if (rnd(150) === 0 && this.pupCooldown === 0 && !this.pupCount && !this.mega && !this.powerups.length) {
      this.pupCooldown = this.survival ? 600 : 1000;
      var t = this.choosePowerup();
      if (t > -1) this.crafts.push(new HW.PupCopter(this, t));
    }
    for (var i = this.waves.length - 1; i >= 0; i--) {
      var w = this.waves[i];
      for (var k = 0; k < w.ids.length; k++) {
        if (w.qty[k] <= 0) continue;
        var interval = Math.floor(w.len / w.qty[k]);
        if (interval > 0 && w.left > 0 && w.left % interval === 0) this.spawnCraft(w.ids[k]);
      }
      if (w.left > 0) { w.left--; this.waveDelay = 500; }
      else this.waves.splice(i, 1);
    }
    if (this.waveDelay > 0) this.waveDelay--;
    else {
      var levels = this.survival ? this.survFile : HW.data.waves;
      var li, wi;
      if (!this.survival && this.mission === 0 && this.dist < 2000) { li = 0; wi = 0; }
      else {
        li = Math.min(lv, levels.length - 1);
        wi = rnd(levels[li].length);
        li = lv;
      }
      this.startWave(li, wi);
    }
    if (this.crafts.length === this.pupCount && this.waveDelay > 100) this.waveDelay = 100;
  };
  B.startWave = function (li, wi) {
    var levels = this.survival ? this.survFile : HW.data.waves;
    var mul = 1;
    if (li >= levels.length) { mul = (li - levels.length + 1) / 7 + 1; li = levels.length - 1; }
    var wave = levels[li][wi % levels[li].length];
    var w = { len: wave.length, left: wave.length, ids: [], qty: [] };
    for (var k = 0; k < wave.craft.length; k++) {
      w.ids.push(HW.CRAFT[wave.craft[k][0]]);
      w.qty.push(Math.floor(wave.craft[k][1] * mul));
    }
    this.waves.push(w);
  };
  B.spawnCraft = function (id) {
    var C = HW.CraftTypes[id];
    if (!C && id !== 12) return;
    if ((id === 5 || id === 18) && (this.laneLeft || this.laneRight)) return;
    if (id === 19 && this.noDozer) return;
    if (id === 12) {
      // ICBMs come in groups of 2..5 spread across the screen
      var n = this.survival ? Math.floor(this.dist / 12000) : HW.P.mission;
      n = clamp(n, 2, 5);
      var span = (this.half * 2) - (this.half * 2) / n;
      for (var x = -span / 2; x <= span / 2 + 0.01; x += span / n) this.projs.push(new HW.BigMissile(this, x));
      return;
    }
    this.crafts.push(new C(this));
  };

  /* power-up choice (0x41aa90) */
  B.choosePowerup = function () {
    var P = HW.P, lv = this.levelIdx(), list = [];
    var cur = [P.nukes, P.shield, P.speed, P.power, P.rapid, P.spread];
    for (var k = 0; k < 6; k++) {
      var t = HW.PUPS[k];
      if ((lv * t.factor < cur[k] && t.factor > 0) || cur[k] === t.max) continue;
      if (k === 0 && (this.nukeCooldown || rnd(2))) continue;
      if (k === 1 && this.shieldCooldown) continue;
      list.push(k);
    }
    if (this.survival) {
      var sum = 0;
      for (k = 0; k < 6; k++) sum += P.weapons[k];
      if (sum < lv) for (k = 0; k < 6; k++) if (P.weapons[k] < 3) list.push(k + 6);
    }
    if (!list.length) return -1;
    return list[rnd(list.length)];
  };

  /* ------------------------------------------------------------------ tank (0x412dc0) */
  B.aimInput = function () {
    var I = HW.Input;
    if (this.demo) return null;
    if (I.mouseMode) {
      var k = this.zoomK();
      this.cursorX = I.mouseX / k - this.half + 320; this.cursorY = 480 - (480 - I.mouseY) / k;
      return null;
    }
    return I.stick();
  };
  B.updateTank = function () {
    var P = HW.P, I = HW.Input;
    // level over (boss dying or past the end): the game takes the wheel and drives to the middle, aiming up,
    // so the tank parks in front of the gas station (0x412dc0 forces the cursor to 320,320 and stops firing)
    var auto = (this.bossDeath || this.dist > this.length) && !this.survival;
    if (auto) { this.cursorX = 320; this.cursorY = 320; this.laserCd = 0; }
    var st = auto ? null : this.aimInput();
    var ang, v, dist;
    var limit = (P.speed + 6) * 0.25 + 1.75;
    if (st) {
      // joystick: aim = stick direction (up = 0), movement follows the original's control law
      var jx = st[0], jy = st[1], m = st[2];
      if (m === 0) { ang = this.aimAng || 0; dist = 0; }   // stick released: keep aiming, stop driving
      else {
        ang = Math.atan2(jx, Math.max(-jy, 0)) / DEG;
        dist = 40 + 40 * clamp((m - 0.1) / 0.45, 0, 1.6);
      }
      if (ang < -90) ang = -90; if (ang > 90) ang = 90;
      v = ((ang + 90) / 9 - 10) * 0.5;
      if (dist < 40) v = 0; else if (dist < 80) v = (dist - 40) * v * 0.025;
      // cursor stays where the gun points (used by flak / laser / megalaser)
      this.cursorX = 320 + this.tx + Math.sin(ang * DEG) * 260;
      this.cursorY = this.ty - 12 - Math.cos(ang * DEG) * 260;
    } else {
      var dx = (this.cursorX - 320) - this.tx, dy = this.ty - this.cursorY - 12;
      ang = Math.atan2(dx, dy) / DEG;
      if (ang < -90) ang = -90; if (ang > 90) ang = 90;
      v = ((ang + 90) / 9 - 10) * 0.5;
      if (this.cursorY < this.ty) dist = Math.sqrt(dx * dx + dy * dy); else dist = Math.abs(dx);
      if (dist < 40) v = 0; else if (dist < 80) v = (dist - 40) * v * 0.025;
    }
    this.gunFrame = (ang + 94) / 9;
    this.aimAng = ang;
    if (v < -limit) v = -limit; if (v > limit) v = limit;
    this.tankFrame += this.speed * 0.3 + v / 3;
    if (this.tankFrame > 9) this.tankFrame -= 9; if (this.tankFrame < 0) this.tankFrame += 9;
    var lim = this.half - 30;
    if (this.tx >= -lim || (st ? Math.abs(st[0]) > 0.2 : (this.cursorX >= 30 && dist >= 80))) {
      this.tx += v;
      var minx = -lim + (this.laneLeft ? 95 : 0);
      if (this.tx < minx && v < 0) this.tx = minx;
      var maxx = this.laneRight ? lim - 95 : lim;
      if (this.tx > maxx) this.tx = maxx;
    } else this.tx += 2;
    if (this.fireCd) this.fireCd--;
    if (this.homingCd) this.homingCd--;
    if (this.laserCd) this.laserCd--;
    if (this.rocketCd) this.rocketCd--;
    if (this.flakCd) this.flakCd--;
    if (this.thunderCd) this.thunderCd--;
    if (this.mega > 0) { this.mega--; if (this.mega < 500 && this.mega % 100 === 0) HW.snd(46); }
    var firing = this.demo ? this.demoFire : (!auto && (I.fire || HW.autoFire));
    // 0x417090: after six separate taps (not double-clicks) the auto-fire hint explains that FIRE can be held
    if (I.fire && !this.fireWas && !HW.autoFire && !this.survival && !this.demo) {
      if (this.tick - (this.fireTapT || -1000) > 50) this.fireTaps = (this.fireTaps || 0) + 1; else this.fireTaps = 0;
      this.fireTapT = this.tick;
      if (this.fireTaps > 5) { this.fireTaps = 0; HW.showHint('autofire'); }
    }
    this.fireWas = I.fire;
    this.megaFiring = firing && this.mega > 0;
    if (firing && this.mega <= 0) {
      if (!this.fireCd) this.fireMain();
      this.fireSecondary();
    }
    if (this.megaFiring && !this.megaSound) { this.megaSound = HW.Audio.play('megalaser', { loop: true, vol: 1 }); HW.snd(47); }
    if (!this.megaFiring && this.megaSound) { HW.Audio.stop(this.megaSound); this.megaSound = null; HW.snd(48); }
    // nukes
    if (I.nukePressed && !auto && !this.demo) this.detonateNuke();
  };

  B.fireMain = function () {
    var P = HW.P;
    var spread = P.spread, D1 = Math.pow(P.power + 1, 2 / Math.log(P.power + 6));
    var R = Math.pow(P.rapid + 1, 2 / Math.log(P.rapid + 6)) - 1;
    this.fireCd = Math.floor(15 - R + spread * 2);
    // sound: cross-fade between the tank fire samples by gun power
    var s = Math.min(1, (D1 - 1) / 6) * 4;
    var si = Math.min(4, Math.round(s));
    HW.snd(1 + si, this.tx);
    var a = (this.aimAng + 90) * DEG;
    var mx = this.tx - Math.cos(a) * 36, my = this.ty - 12 - Math.sin(a) * 36;
    this.addMuzzle(mx, my, 0, 0);
    for (var k = 0; k <= spread; k++) this.addBullet(D1, 0, Math.trunc(k * 10 - spread * 5));
    // shell casing
    this.casings.push({ x: this.tx - 5, y: this.ty - 10, vx: ((this.gunFrame - 10) * 0.5) - 1.5, vy: -1.5 });
    this.st.shots++;
  };
  /* player bullet (0x410d40) */
  B.addBullet = function (dmg, lateral, offDeg) {
    var g = this.gunFrame;
    var fr = Math.trunc(g + offDeg / 9);
    if (fr > 20) fr -= 20; if (fr < 0) fr += 20;
    var ang = (g * 9 - 4) * DEG;
    var x = this.tx - Math.cos(ang) * 36 - Math.cos(ang + Math.PI / 2) * lateral;
    var y = (this.ty - 12) - Math.sin(ang) * 36 - Math.sin(ang + Math.PI / 2) * lateral;
    var a2 = ang + offDeg * DEG;
    this.bullets.push({ x: x, y: y, vx: Math.cos(a2) * -5, vy: Math.sin(a2) * -5, g: 0, enemy: false,
      spr: S('bullets'), frame: fr, row: Math.min(4, Math.trunc(dmg)), dmg: dmg + 1 });
  };
  /* enemy energy bullet (0x411850) */
  B.enemyBullet = function (x, y, ang, spd) {
    if (this.deathTimer || this.bossDeath) return;
    spd = spd || 2.5;
    this.bullets.push({ x: x, y: y, vx: -Math.cos(ang) * spd, vy: Math.sin(ang) * spd, g: 0, enemy: true,
      spr: S('bombfrag'), frame: 0, row: 0 });
    HW.snd(54, x);
  };

  B.fireSecondary = function () {
    var P = HW.P, W = P.weapons;
    if (this.deathTimer) return;
    if (W[5] && !this.thunderCd) { this.thunderCd = 50; this.thunders.push(new HW.Thunder(this)); }
    if (W[1] && !this.homingCd) { this.homingCd = 85 - W[1] * 15; this.projs.push(new HW.HomingMissile(this)); }
    if (W[4] && !this.flakCd) { this.flakCd = 50; this.flaks.push(new HW.Flak(this)); }
    if (W[2] && !this.laserCd) { this.laserCd = 100; HW.snd(20, this.tx); }
    if (W[3] && !this.rocketCd) {
      this.rocketCd = 40;
      var n = W[3];
      for (var j = 0; j < n; j++) {
        var off = j * Math.floor(90 / n);
        if (n > 1) off += -22 - (n === 3 ? 8 : 0);
        this.projs.push(new HW.Rocket(this, off));
      }
      HW.snd(19, this.tx);
    }
  };

  /* tank destroyed (0x41a880) */
  B.killTank = function () {
    if (this.deathTimer || this.demo) return;
    var P = HW.P;
    this.deathTimer = 400;
    this.deaths++;
    this.deathFlash = 1; this.deathX = this.tx; this.deathY = this.ty;
    this.addExplosion(this.tx, this.ty - 5, 300, 200, 0, 0, 0);
    this.addParticles(S('tankflame'), this.tx, this.ty, 0, -2, 60, 3, 0.05, 3, 200, true, -1);
    HW.snd(10, this.tx);
    if (window.HWNative && HWNative.vibrate) HWNative.vibrate(300);
    this.addCrater(this.tx, 1);
    this.tx = -(this.half + 60); this.ty = 443;
    this.fireCd = this.homingCd = this.laserCd = this.rocketCd = this.flakCd = this.thunderCd = 0;
    this.mega = 0;
    this.waveDelay = 200;
    P.nukes = 0;
    P.shield = 1;
    this.megaParts = 0;
    this.crates.length = 0;
    this.waves.length = 0;
    if (P.lives <= 0) {
      HW.music(5);
    }
  };

  /* shield / tank hit test used by enemy projectiles (0x447890 + tank check) */
  B.shieldHit = function (spr, x, y, col, row, flip) {
    var P = HW.P;
    if (this.deathTimer) return false;
    if (P.shield || this.shieldInv > 0) {
      if (HW.collide(S('shield'), this.tx, this.ty + 2, 0, 0, false, spr, x, y, col, row, flip)) {
        if (this.shieldInv <= 0) {
          P.shield--;
          if (!P.shield) HW.snd(89, this.tx);
          this.shieldInv = 9;
          HW.snd(14, this.tx);
          if (window.HWNative && HWNative.vibrate) HWNative.vibrate(40);
        }
        return true;
      }
    }
    return false;
  };
  B.tankHit = function (spr, x, y, col, row, flip) {
    if (this.deathTimer) return false;
    return HW.collide(S('tank'), this.tx, this.ty, 0, 0, false, spr, x, y, col, row, flip);
  };

  /* ------------------------------------------------------------------ bullets (0x41add0) */
  var craftHit = null, projHit = null;   // the plain sprite hit tests (set once the classes exist)
  B.updateBullets = function () {
    if (!craftHit) { craftHit = HW.Craft.prototype.hitTest; projHit = HW.Proj.prototype.hitTest; }
    var P = HW.P, i, b;
    for (i = this.bullets.length - 1; i >= 0; i--) {
      b = this.bullets[i];
      if (b.vy < 3) b.vy += b.g;
      b.x += b.vx; b.y += b.vy;
      if (b.x < -this.half || b.x > this.half || b.y < 0 || b.y > 460) {
        if (b.y > 460) this.addScorch(b.x, 255, !b.enemy);
        this.bullets.splice(i, 1);
        if (!b.enemy) this.st.misses = (this.st.misses || 0) + 1;
      }
    }
    for (i = this.bullets.length - 1; i >= 0; i--) {
      b = this.bullets[i];
      if (!b.enemy) {
        var bhw = b.spr ? b.spr.cw / 2 + 2 : 50, bhh = b.spr ? b.spr.ch / 2 + 2 : 50;
        for (var k = 0; k < this.crafts.length; k++) {
          var c = this.crafts[k];
          if (!c.collidable || c.dead) continue;
          // quick box rejection for units using the plain sprite test (the pixel test would say no anyway)
          if (c.hitTest === craftHit && c.spr) {
            var ddx = c.x - b.x, ddy = c.y - b.y, ex = c.spr.cw / 2 + bhw, ey = c.spr.ch / 2 + bhh;
            if (ddx > ex || ddx < -ex || ddy > ey || ddy < -ey) continue;
          }
          if (c.hitTest(b.spr, b.x, b.y, b.frame, b.row, false)) {
            c.damage(b.dmg);
            if (c.armor < 0) c.kill(true);
            else {
              HW.snd(9, b.x);
              this.addParticles(S('spark'), b.x, b.y, b.vx * 0.25, b.vy * 0.25, 4, 2, 0.05, 3, 30, true, -1);
            }
            this.bullets.splice(i, 1);
            b = null;
            break;
          }
        }
        if (b && this.damageProjs(b.spr, b.x, b.y, b.frame, b.row, b.dmg)) this.bullets.splice(i, 1);
      } else {
        if (P.shield || this.shieldInv > 0) {
          if (!this.deathTimer && HW.collide(S('shield'), this.tx, this.ty + 2, 0, 0, false, b.spr, b.x, b.y, 0, 0, false)) {
            this.bullets.splice(i, 1);
            if (this.shieldInv <= 0) {
              P.shield--;
              if (!P.shield) HW.snd(89, this.tx);
              this.shieldInv = 9;
              HW.snd(14, this.tx);
            }
            continue;
          }
        }
        if (!this.deathTimer && HW.collide(S('tank'), this.tx, this.ty, 0, 0, false, b.spr, b.x, b.y, 0, 0, false)) {
          this.bullets.splice(i, 1);
          this.killTank();
        }
      }
    }
  };

  /* shoot down enemy projectiles (0x417390); returns true when something was hit */
  B.damageProjs = function (spr, x, y, frame, row, dmg, list) {
    if (!craftHit) { craftHit = HW.Craft.prototype.hitTest; projHit = HW.Proj.prototype.hitTest; }
    if (this.deathTimer && spr === S('tank')) return false;
    var L = list || this.projs;
    var hw = spr ? spr.cw / 2 + 2 : 50, hh = spr ? spr.ch / 2 + 2 : 50;
    for (var i = 0; i < L.length; i++) {
      var p = L[i];
      if (!p.isEnemy || !p.shootable || p.background || p.dead) continue;
      if (p.hitTest === projHit && p.spr) {
        var dx = p.x - x, dy = p.y - y, ex = p.spr.cw / 2 + hw, ey = p.spr.ch / 2 + hh;
        if (dx > ex || dx < -ex || dy > ey || dy < -ey) continue;
      }
      if (!p.hitTest(spr, x, y, frame, row, false)) continue;
      p.hp -= dmg;
      p.flash = 255;
      if (p.hp >= 0) {
        HW.snd(9, x);
        this.addParticles(S('spark'), x, y, p.vx * 0.5, p.vy * 0.5, 4, 2, 0.05, 3, 30, true, -1);
        return true;
      }
      this.addScore(p.points, p.x, p.y);
      this.addExplosion(p.x, p.y, (p.spr ? p.spr.cw : 30) + 40, (p.spr ? p.spr.ch : 30) + 40, p.vx, p.vy - 0.5, 0);
      p.dead = true;
      this.st.projShot++;
      return true;
    }
    return false;
  };

  /* ------------------------------------------------------------------ crafts */
  B.updateCrafts = function () {
    for (var i = 0; i < this.crafts.length; i++) {
      var c = this.crafts[i];
      if (c.dead) continue;
      if (this.deathTimer && c !== this.boss && !c.friendly) c.vx *= 1.01;
      if (c === this.boss && c.collidable) this.bossEntering = false;
      c.update();
    }
    for (i = this.crafts.length - 1; i >= 0; i--) if (this.crafts[i].dead) this.crafts.splice(i, 1);
  };
  B.updateProjs = function () {
    for (var i = 0; i < this.projs.length; i++) { var p = this.projs[i]; if (!p.dead) p.update(); }
    for (i = this.projs.length - 1; i >= 0; i--) if (this.projs[i].dead) this.projs.splice(i, 1);
  };

  /* ------------------------------------------------------------------ explosions & particles */
  B.addExplosion = function (x, y, w, h, vx, vy, speed) {
    this.explosions.push({ x: x, y: y, w: w, h: h, vx: vx || 0, vy: vy || 0, frame: 0, sp: 0.4 });
    var n = Math.min(100, Math.floor((w + h) / 6));
    if (HW.settings.detail > 0 && n) {
      this.addParticles(S('spark'), x, y, (vx || 0) * 0.5, (vy || 0) * 0.5, n, 3, 0.05, 3, 100, true, -1);
      if (n >= 2) this.addParticles(S('smoke'), x, y, (vx || 0) * 0.5, (vy || 0) * 0.5, Math.floor(n / 2), 0.5, -0.01, -0.5, 200, true, -1);
    }
    HW.snd(w + h > 140 ? 6 : 7, x);
  };
  B.updateExplosions = function () {
    for (var i = this.explosions.length - 1; i >= 0; i--) {
      var e = this.explosions[i];
      e.x += e.vx; e.y += e.vy; e.vx *= 0.99; e.vy *= 0.99;
      e.frame += e.sp;
      if (e.frame >= 20) this.explosions.splice(i, 1);
    }
  };
  /* particles (0x42b900): count, random spread speed, gravity toward max vy, life frames, fade, fixed frame */
  /* particles are recycled through a pool (hundreds live at once: missile trails, sparks, smoke), and the dead ones
     are squeezed out in one pass instead of one splice each - both keep the garbage collector quiet in big fights */
  var partPool = [];
  B.addParticles = function (spr, x, y, vx, vy, count, spread, grav, maxv, life, fade, fixed) {
    var det = HW.settings.detail;
    if (!spr || det <= 0) return;
    if (det < 1) count = Math.floor(count * det + Math.random());   // Detail slider = particle percentage
    var cap = HW.particleCap || 600;
    if (this.particles.length > cap) return;
    for (var i = 0; i < count; i++) {
      var s = spread > 0 ? rnd(Math.max(1, Math.floor(spread * 100))) * 0.01 : 0;
      var a = rnd(3600) * 0.0017453292520882224;
      var p = partPool.length ? partPool.pop() : {};
      p.spr = spr; p.x = x; p.y = y; p.vx = Math.cos(a) * s + vx; p.vy = Math.sin(a) * s + vy; p.g = grav; p.max = maxv;
      p.fade = fade; p.frame = 0; p.fs = 0; p.life = life; p.ttl = undefined; p._px = x; p._py = y;
      if (fixed >= 0) { p.frame = fixed; p.fs = 0; p.ttl = life; }
      else p.fs = spr.cols / life;
      this.particles.push(p);
    }
  };
  B.updateParticles = function () {
    var L = this.particles, n = 0;
    for (var i = 0; i < L.length; i++) {
      var p = L[i], dead = false;
      p.x += p.vx; p.y += p.vy;
      if (p.g > 0 ? p.vy < p.max : p.vy > p.max) p.vy += p.g;
      p.frame += p.fs;
      if (p.ttl !== undefined) { p.ttl--; if (p.ttl <= 0) dead = true; }
      else if (p.frame >= p.spr.cols) dead = true;
      if (dead) { p.spr = null; if (partPool.length < 1000) partPool.push(p); }
      else L[n++] = p;
    }
    L.length = n;
  };
  B.addScorch = function (x, a, player) {
    this.scorches.push({ x: x, a: a, player: !!player });
  };
  B.addCrater = function (x, n) {
    for (var i = -n; i <= n; i++) {
      this.craters.push({ x: x + i * 20, frame: rnd(5), life: 1000 });
      this.addParticles(S('smoke'), x + i * 20, 460, 0, -1, 1, 0.1, -0.01, -0.5, 100, true, -1);
      this.addParticles(S('rock'), x + i * 20, 460, 0, -1, 3, 1, 0.05, 3, 200, false, 0);
    }
  };
  B.updateCasings = function () {
    for (var i = this.casings.length - 1; i >= 0; i--) {
      var c = this.casings[i];
      c.x += c.vx; c.y += c.vy; c.vx *= 0.99; c.vy += 0.06; if (c.vy > 2) c.vy = 2;
      if (c.x < -this.half - 5 || c.y > 485) this.casings.splice(i, 1);
    }
  };
  B.addMuzzle = function (x, y, vx, vy) { this.muzzles.push({ x: x, y: y, vx: vx || 0, vy: vy || 0, life: 5 }); };
  B.addProj = function (p) { this.projs.push(p); return p; };
  B.updateMuzzles = function () {
    for (var i = this.muzzles.length - 1; i >= 0; i--) {
      var m = this.muzzles[i];
      m.x += m.vx; m.y += m.vy;
      if (--m.life < 1) this.muzzles.splice(i, 1);
    }
  };
  B.updateTracks = function () {
    var active = false;
    for (var i = this.tracks.length - 1; i >= 0; i--) {
      var t = this.tracks[i];
      t.x1 -= this.speed;
      if (t.active && !this.deathTimer) {
        if (this.tx - 20 < t.x1) t.x1 = this.tx - 20;
        t.x2 = Math.max(this.tx + 20, t.x2 - this.speed);
        active = true;
      } else {
        t.active = false;
        t.x2 -= this.speed;
        if (t.x2 < -this.half + 1) this.tracks.splice(i, 1);
      }
      if (t.x1 < -this.half - 3) t.x1 += 4;
    }
    if (!active && !this.deathTimer) this.tracks.push({ x1: this.tx, x2: this.tx, active: true });
    // after a respawn the new tank drives over its old marks: when the live strip reaches an older one the two become
    // one strip covering both (the old road stays where it was, and nothing is ever drawn twice - one layer of marks
    // however many times the tank comes back over the same ground)
    var A = null;
    for (i = 0; i < this.tracks.length; i++) if (this.tracks[i].active) { A = this.tracks[i]; break; }
    if (A) {
      for (i = this.tracks.length - 1; i >= 0; i--) {
        var o = this.tracks[i];
        if (o === A || o.x2 < A.x1 || o.x1 > A.x2) continue;
        if (o.x1 < A.x1) A.x1 = o.x1;
        if (o.x2 > A.x2) A.x2 = o.x2;
        this.tracks.splice(i, 1);
      }
    }
  };

  /* ------------------------------------------------------------------ scoring, popups, big text */
  B.addScore = function (pts, x, y) {
    if (!pts || this.survival) return;
    var P = HW.P;
    P.score += pts; if (P.score < 0) P.score = 0;
    // the points float up from the kill in the same text object as the power-up messages (0x417230 -> 0x42c000)
    this.popup(String(pts), x, y, false, pts > 0 ? '#fff' : '#f00');
  };
  /* floating texts (0x42c000 / 0x414a70 / 0x42bf90): the points of a kill and the power-up messages. Keypunch16,
     left edge at x - width/2 kept on the battlefield, alpha 255 falling 1 per step, drawn at y + alpha/2 - 128 so it
     rises 0.5 px per step; a power-up message cycles its colour through HSL(hue, 255, 192), hue += 16 per step.
     A text sitting just below another one that overlaps it is pushed up 2 px per step. */
  function hslColor(h) {
    var hh = (h / 256) * 6, c = 0.5, x = c * (1 - Math.abs(hh % 2 - 1)), m = 0.75 - c / 2, r = 0, g = 0, b = 0;
    if (hh < 1) { r = c; g = x; } else if (hh < 2) { r = x; g = c; } else if (hh < 3) { g = c; b = x; }
    else if (hh < 4) { g = x; b = c; } else if (hh < 5) { r = x; b = c; } else { r = c; b = x; }
    return 'rgb(' + Math.round((r + m) * 255) + ',' + Math.round((g + m) * 255) + ',' + Math.round((b + m) * 255) + ')';
  }
  B.popup = function (txt, x, y, cycle, color) {
    var f = HW.fonts.Keypunch16 || HW.fonts.Normal;
    var w = f ? f.width(txt) : 0;
    var px = Math.round(x - w / 2);
    if (px + w > this.half) px = Math.floor(this.half - w);
    if (px < -this.half) px = -Math.floor(this.half);
    this.popups.push({ s: txt, x: px, y0: y, w: w, life: 255, cycle: !!cycle, hue: 0, color: color || '#fff' });
  };
  B.updatePopups = function () {
    var L = this.popups, i, j;
    for (i = L.length - 1; i >= 0; i--) {
      var p = L[i];
      if (p.cycle) { p.hue = (p.hue + 16) & 255; p.color = hslColor(p.hue); }
      if (--p.life <= 0) L.splice(i, 1);
    }
    for (i = 0; i < L.length; i++) {
      var a = L[i], ya = a.life / 2 + a.y0;
      for (j = 0; j < L.length; j++) {
        if (i === j) continue;
        var b = L[j], yb = b.life / 2 + b.y0;
        if (b.x + b.w > a.x && b.x < a.x + a.w && yb > ya - 20 && yb <= ya) b.y0 -= 2;
      }
    }
  };
  /* big announcements (0x41c810 / 0x41c5f0 / 0x41cae0): every letter has a depth z (9, 11, 13 ... for each
     following letter) that falls 0.3 per step. A letter shows once z <= 8: it zooms in from far out (size and
     distance from the screen centre shrink with z, alpha = 255 - 32z), bounces as it lands (cos(o) * a: a fades
     0.02 per step, o turns 0.3 per step once z < 0), and vanishes quickly once z passes -70, so the words leave
     letter by letter, left to right. The text is removed when the last letter passes z = -80. */
  B.bigText = function (s, y, delay, font) {
    var t = { kind: 'big', s: s, y: y, delay: delay || 0, font: font || 'RubberStampLET42', z: [], a: [], o: [] };
    for (var i = 0; i < s.length; i++) { t.z.push(9 + 2 * i); t.a.push(1); t.o.push(0); }
    this.texts.push(t);
  };
  B.updateTexts = function () {
    for (var i = this.texts.length - 1; i >= 0; i--) {
      var t = this.texts[i];
      if (t.delay > 0) { t.delay--; continue; }
      for (var k = 0; k < t.z.length; k++) {
        t.z[k] -= 0.3;
        if (t.z[k] <= 8) {
          t.a[k] = Math.max(0, t.a[k] - 0.02);
          if (t.z[k] < 0) t.o[k] += 0.3;
        }
      }
      if (!t.z.length || t.z[t.z.length - 1] < -80) this.texts.splice(i, 1);
    }
  };

  /* ------------------------------------------------------------------ power-ups (0x42c2b0) */
  /* 0x42c1b0: a dropped power-up drifts toward the middle of the screen (vx = -x / 160) and starts falling with the
     dropper's vertical speed */
  B.addPowerup = function (type, x, y, vy) {
    this.powerups.push({ type: type, x: x, y: y, vx: -x * 0.00625, vy: vy || 0 });
  };
  B.updatePowerups = function () {
    var P = HW.P;
    for (var i = this.powerups.length - 1; i >= 0; i--) {
      var p = this.powerups[i];
      p.x += p.vx; p.vx *= 0.99;
      if (p.y < 455) { p.y += p.vy; p.vy += 0.07; if (p.vy > 3) p.vy = 3; }
      else {
        if (!this.deathTimer) { p.vx -= 0.003; if (p.vx < -1) p.vx = -1; }
        p.y = 455;
      }
      if (p.x < -this.half - 32) { this.powerups.splice(i, 1); continue; }
      if (this.deathTimer) continue;
      if (!HW.collide(S('powerups'), p.x, p.y, p.type, 0, false, S('tank'), this.tx, this.ty, 0, 0, false)) continue;
      this.powerups.splice(i, 1);
      var t = p.type;
      if (t < 6) {
        var keys = ['nukes', 'shield', 'speed', 'power', 'rapid', 'spread'];
        if (P[keys[t]] < HW.PUPS[t].max) {
          P[keys[t]]++;
          this.popup(HW.PUPS[t].name, this.tx, this.ty - 13, true);
          if (t === 0) HW.showHint('nuke');
        }
        if (t >= 3) HW.snd(0, this.tx);
        else if (t === 1) { HW.snd(88, this.tx); this.shieldZap = 255; }
        else if (t === 2) HW.snd(91, this.tx);
        else HW.snd(13, this.tx);
      } else {
        var w = t - 6;
        if (P.weapons[w] < 3) {
          P.weapons[w]++;
          this.popup(HW.WEAPON_NAMES[w], this.tx, this.ty - 13, true);
          HW.snd(90, this.tx);
        }
      }
    }
  };

  /* ------------------------------------------------------------------ megalaser crates (0x42da00 / 0x42db00) */
  B.dropCrate = function (x, y) {
    this.crates.push({ x: x, y: y, vx: -x / 120, vy: 0, part: this.megaParts, got: false });
  };
  B.updateCrates = function () {
    for (var i = this.crates.length - 1; i >= 0; i--) {
      var c = this.crates[i];
      c.x += c.vx; c.y += c.vy;
      if (c.got) {
        var tx = 160 + (this.half - 320), dx = tx - c.x, dy = 20 - c.y, d = Math.sqrt(dx * dx + dy * dy);
        c.vx = dx; c.vy = dy;
        if (d > 8) { c.vx = dx * 8 / d; c.vy = dy * 8 / d; }
        if (c.y < 21) {
          HW.snd(63 + Math.min(3, this.megaParts));
          this.megaParts++;
          if (this.megaParts >= 4) { this.megaParts = 0; this.mega = 3000; HW.snd(59); }
          else this.addScore(this.megaParts * 1000, c.x, c.y + 20);
          this.crates.splice(i, 1);
        }
      } else {
        c.vx *= 0.99; c.vy += 0.02; if (c.vy > 1.5) c.vy = 1.5;
        if (c.y > 460) {
          HW.snd(50, c.x);
          this.addExplosion(c.x, c.y, 50, 50, c.vx, 0, 0);
          this.addCrater(c.x, 0);
          this.crates.splice(i, 1);
        } else if (!this.deathTimer && HW.collide(S('crates'), c.x, c.y, c.part, 0, false, S('tank'), this.tx, this.ty, 0, 0, false)) {
          HW.snd(25, c.x);
          this.popup('MEGALASER ' + ((this.megaParts + 1) * 25) + '% COMPLETE', this.tx, this.ty, true);
          c.got = true;
          HW.showHint('mega');
        }
      }
    }
  };

  /* ------------------------------------------------------------------ nukes (0x41a160) */
  B.detonateNuke = function () {
    var P = HW.P;
    if (this.deathTimer || this.levelDone) return;
    if (!P.nukes) { this.noNukeBlink = 120; HW.snd(21); return; }
    if (this.danger || (this.boss && this.bossEntering)) { HW.snd(21); return; }
    for (var s = 0; s < 4; s++) { var a = this.anims[s]; if (a && a.def.nuke === 'yes') a.nuked = true; }
    P.nukes--;
    this.st.nukes++;
    this.flash = 254; this.nukeFlash = 255;
    for (var i = 0; i < this.crafts.length; i++) {
      var c = this.crafts[i];
      if (c.friendly || !c.collidable || c.dead) continue;
      var cm = c.m || 1;
      if (c.wy() - c.h * cm / 2 >= 460) continue;
      if (!this.boss) c.kill(true);
      else {
        if (c.collidableBody !== false) c.armor -= c.maxArmor / (HW.P.mission + 5);
        // boss parts are separate crafts in the original, so the blast hurts each of them too
        if (c.parts) for (var k = 0; k < c.parts.length; k++) {
          var pt = c.parts[k];
          if (pt.dead || (c.toWy ? c.toWy(pt.y) : pt.y) - (pt.spr ? pt.spr.ch : 40) * cm / 2 >= 460) continue;
          pt.armor -= pt.maxArmor / (HW.P.mission + 5);
          if (pt.armor < 0) c.destroyPart(pt);
        }
        if (c.armor < 0) c.kill(true);
      }
    }
    for (i = this.bullets.length - 1; i >= 0; i--) if (this.bullets[i].enemy) { this.addScore(10, this.bullets[i].x, this.bullets[i].y); this.bullets.splice(i, 1); }
    // 0x41a160 sweeps away every enemy shot (field_41), not only the ones that can be shot down: the war blimp's
    // meteors, the X-Bot's eye beams and the secret weapon's lasers go up in the blast too
    for (i = 0; i < this.projs.length; i++) {
      var p = this.projs[i];
      if (p.isEnemy && !p.dead) {
        if (p.points && p.y > 0) this.addScore(p.points, p.x, p.y);
        if (p.onNuked) p.onNuked();
        p.dead = true;
      }
    }
    this.waves.length = 0;
    this.waveDelay = 0;
    this.nukeCooldown = this.survival ? 1200 : Math.floor(this.length / 6);
    HW.snd(12);
    if (window.HWNative && HWNative.vibrate && !this.demo) HWNative.vibrate(250);
    this.mushrooms.push(new HW.Mushroom(this, this.tx));
  };
  B.updateMushrooms = function () {
    for (var i = this.mushrooms.length - 1; i >= 0; i--) if (!this.mushrooms[i].update()) this.mushrooms.splice(i, 1);
  };

  /* ------------------------------------------------------------------ orbs (0x418770) */
  B.updateOrbs = function () {
    var n = HW.P.weapons[0];
    this.orbAngle += 10 - 2 * n;
    if (this.orbAngle > 360) this.orbAngle -= 360;
    this.orbs = [];
    for (var i = 0; i < n; i++) {
      this.orbFlash[i] = Math.max(0, this.orbFlash[i] - 0.02);
      var off = (n === 2 ? 180 : 120) * i;
      var a = (off + this.orbAngle) * DEG;
      var ox = Math.cos(a) * 50 + this.tx, oy = Math.sin(a) * 40 + this.ty;
      this.orbs.push([ox, oy]);
      if (this.damageProjs(S('orb'), ox, oy, 0, 0, 1000)) { this.orbFlash[i] = 1; HW.snd(67, ox); }
      for (var k = this.bullets.length - 1; k >= 0; k--) {
        var b = this.bullets[k];
        if (!b.enemy) continue;
        if (HW.collide(S('orb'), ox, oy, 0, 0, false, b.spr, b.x, b.y, 0, 0, false)) {
          this.orbFlash[i] = 1;
          this.addScore(10, b.x, b.y);
          this.bullets.splice(k, 1);
          this.addExplosion(b.x, b.y, 50, 50, 0, 0, 0);
          HW.snd(67, ox);
        }
      }
    }
  };

  /* ------------------------------------------------------------------ laser (0x418a50) */
  B.beamAngle = function () {
    var cy = Math.min(this.cursorY, this.ty - 12);
    var dy = this.ty - cy - 12;
    return Math.atan2((this.cursorX - 320) - this.tx, dy) - 1.57;
  };
  /* The beams are traced in 5 px steps like the original (every step tested against every enemy). Only the units
     whose box the beam's line actually crosses can be hit, so they are picked once per trace (units with their own
     hit test - bosses, multi-part units - always stay in): same result, a fraction of the work. */
  function rayBox(ox, oy, ca, sa, cx, cy, hw, hh) {
    var t0 = 0, t1 = 1e9, a, b, t;
    if (ca > -1e-9 && ca < 1e-9) { if (ox < cx - hw || ox > cx + hw) return false; }
    else { a = (cx - hw - ox) / ca; b = (cx + hw - ox) / ca; if (a > b) { t = a; a = b; b = t; } if (a > t0) t0 = a; if (b < t1) t1 = b; }
    if (sa > -1e-9 && sa < 1e-9) { if (oy < cy - hh || oy > cy + hh) return false; }
    else { a = (cy - hh - oy) / sa; b = (cy + hh - oy) / sa; if (a > b) { t = a; a = b; b = t; } if (a > t0) t0 = a; if (b < t1) t1 = b; }
    return t0 <= t1;
  }
  var beamCrafts = [], beamProjs = [];
  B.beamTargets = function (ox, oy, ca, sa, bspr, enemyOnly) {
    var bw = (bspr ? bspr.cw : 20) / 2 + 3, bh = (bspr ? bspr.ch : 20) / 2 + 3, i, c, base = HW.Craft.prototype.hitTest;
    beamCrafts.length = 0; beamProjs.length = 0;
    for (i = 0; i < this.crafts.length; i++) {
      c = this.crafts[i];
      if (!c.collidable || c.friendly || c.dead) continue;
      if (c.hitTest !== base || !c.spr || rayBox(ox, oy, ca, sa, c.x, c.y, c.spr.cw / 2 + bw, c.spr.ch / 2 + bh)) beamCrafts.push(c);
    }
    var pbase = HW.Proj.prototype.hitTest;
    for (i = 0; i < this.projs.length; i++) {
      var p = this.projs[i];
      if (!p.isEnemy || !p.shootable || p.background || p.dead) continue;
      if (p.hitTest !== pbase || !p.spr || rayBox(ox, oy, ca, sa, p.x, p.y, p.spr.cw / 2 + bw, p.spr.ch / 2 + bh)) beamProjs.push(p);
    }
  };
  B.updateLaser = function () {
    var P = HW.P, lvl = P.weapons[2];
    this.beamAng = this.beamAngle();
    this.beamLen = 35;
    var ca = Math.cos(this.beamAng), sa = Math.sin(this.beamAng);
    var oy = this.ty - 12;
    var hit = false, bs = S('beam');
    this.beamTargets(this.tx, oy, ca, sa, bs);
    while (this.beamLen < 800) {
      var bx = ca * (this.beamLen + 5) + this.tx, by = sa * (this.beamLen + 5) + oy;
      if (bx < -this.half - 10 || bx > this.half + 10 || by < 0) break;
      for (var i = 0; i < beamCrafts.length; i++) {
        var c = beamCrafts[i];
        if (!c.collidable || c.friendly || c.dead) continue;
        if (c.hitTest(bs, bx, by, 0, 0, false)) {
          c.damage(lvl * 0.2, true);
          if (c.armor < 0) c.kill(true);
          hit = true; break;
        }
      }
      if (hit) break;
      if (beamProjs.length && this.damageProjs(bs, bx, by, 0, 0, lvl * 0.25, beamProjs)) { hit = true; break; }
      this.beamLen += 5;
    }
    this.beamHit = hit;
  };

  /* ------------------------------------------------------------------ megalaser (0x418c90) */
  B.updateMegalaser = function () {
    this.mega -= 2;
    this.beamAng = this.beamAngle();
    var ca = Math.cos(this.beamAng), sa = Math.sin(this.beamAng), oy = this.ty - 12, bs = S('beamfire');
    this.beamTargets(this.tx, oy, ca, sa, bs);
    for (this.megaLen = 35; this.megaLen < 800; this.megaLen += 5) {
      var bx = ca * this.megaLen + this.tx, by = sa * this.megaLen + oy;
      if (bx < -this.half || bx > this.half || by < 0) break;
      for (var i = 0; i < beamCrafts.length; i++) {
        var c = beamCrafts[i];
        if (c.friendly || !c.collidable || c.dead) continue;
        if (c.hitTest(bs, bx, by, 0, 0, false)) {
          if (c === this.boss) { c.damage(20, true); if (c.armor < 0) c.kill(true); }
          else c.kill(true);
        }
      }
      if (beamProjs.length) this.damageProjs(bs, bx, by, 0, 0, 10000, beamProjs);
      for (var k = this.bullets.length - 1; k >= 0; k--) {
        var b = this.bullets[k];
        if (b.enemy && Math.abs(b.x - bx) < 25 && Math.abs(b.y - by) < 25) { this.addScore(10, b.x, b.y); this.bullets.splice(k, 1); }
      }
    }
  };

  /* ------------------------------------------------------------------ flak & thunder lists */
  B.updateFlaks = function () { for (var i = this.flaks.length - 1; i >= 0; i--) if (!this.flaks[i].update()) this.flaks.splice(i, 1); };
  B.updateThunders = function () { for (var i = this.thunders.length - 1; i >= 0; i--) if (!this.thunders[i].update()) this.thunders.splice(i, 1); };

  /* ------------------------------------------------------------------ boss spawn (mission % 9) */
  B.spawnBoss = function () {
    var m = this.mission, idx = m % 9, ctor;
    if (m === 18) ctor = HW.Bosses.Final;
    else ctor = [HW.Bosses.Helicopter, HW.Bosses.Battleship, HW.Bosses.Rainer, HW.Bosses.Wrecker, HW.Bosses.Ape,
      HW.Bosses.Eye, HW.Bosses.Head, HW.Bosses.Worm, HW.Bosses.Robot][idx];
    if (!ctor) return;
    this.bossEntering = true;
    this.boss = new ctor(this, m >= 9 ? 1 : 0);
    this.crafts.push(this.boss);
  };
  B.bossDefeated = function (boss) {
    this.bossDeath = new HW.BossDeath(this, boss);
  };
  /* called when the boss death sequence ends (0x4138e0) */
  B.finishBoss = function () {
    for (var i = 0; i < this.crafts.length; i++) if (!this.crafts[i].dead && this.crafts[i] !== this.boss) this.crafts[i].kill(true);
    this.crafts.length = 0;
    this.boss = null;
    this.flash = 254; this.nukeFlash = 255;
    for (i = this.bullets.length - 1; i >= 0; i--) if (this.bullets[i].enemy) this.bullets.splice(i, 1);
    this.projs.length = 0;
    HW.snd(16);
    this.bossDeath = null;
    this.gasX = 480 + (this.half - 320);
    // (0.2 s sooner than the original's 500 updates: the victory call and song come a moment earlier)
    this.debriefAt = this.length + 480 + Math.max(0, Math.round(this.half - 320));
    this.dist++;
    // 0x41bf50: the boss song dies away over 2.5 s (FadeOut(2, 0.004 per update)) from the final flash
    HW.musicFade(2500);
    this.gasName = rnd(4);
    this.levelDone = true;
    this.laneLeft = this.laneRight = false;
  };

  /* stop looping sounds when leaving the battlefield */
  B.cleanup = function () {
    for (var i = 0; i < this.crafts.length; i++) {
      var c = this.crafts[i];
      if (c.sound) { HW.Audio.stop(c.sound); c.sound = null; }
      if (c.isBoss && c.onRemove) c.onRemove();   // the wrecker's engine and chain, the blimp's beam
    }
    if (this.megaSound) { HW.Audio.stop(this.megaSound); this.megaSound = null; }
  };

  B.gameOver = function () {
    if (this.over) return;
    this.over = true;
    HW.onGameOver(this);
  };
})();
