/* Heavy Weapon mobile port - menus, briefing map, armory, debriefing, dialogs */
'use strict';
(function () {
  var D = HW.Draw, clamp = HW.clamp, rnd = HW.rnd;
  function S(n) { return HW.img[n]; }
  function F(n) { return HW.fonts[n] || HW.fonts.Normal; }

  /* ------------------------------------------------------------------ settings & persistence */
  var defaults = { sfx: 0.8, music: 0.7, detail: 1, shake: true, autoFire: false, leftHanded: false, controlAlpha: 0.55, hints: true, seenHints: {} };
  HW.settings = Object.assign({}, defaults, HW.store.get('settings', {}));
  HW.saveSettings = function () { HW.store.set('settings', HW.settings); };
  // drawing level picked by the performance governor on an earlier run (core.js, HW.perf)
  // (phones start in the lean mode: the compositor scales the logical frame, which costs the GPU a full-resolution
  // pass less every frame; the governor only ever goes further down from there)
  HW.perfLevel = typeof HW.settings.perfLevel === 'number' ? clamp(HW.settings.perfLevel | 0, 1, 2) : 1;
  HW.particleCap = HW.perfLevel >= 2 ? 300 : 600;
  HW.applySettings = function () {
    var s = HW.settings;
    HW.Audio.setSfxVolume(s.sfx); HW.Audio.setMusicVolume(s.music);
    HW.Input.controlAlpha = s.controlAlpha; HW.Input.leftHanded = s.leftHanded;
    HW.autoFire = s.autoFire;
    HW.Input.layout();
  };
  /* Every player name keeps its own saved campaign and its own best stage (users.dat holds one record per user in
     the original: field +28 the mission to continue, +30 the furthest stage, which unlocks Survival at 3). The data
     of the single-player versions (one 'profile', one global bestMission) moves to the current name once. */
  function pkey(n) { return 'profile:' + (n || ''); }
  HW.userRec = function (n) {
    var s = HW.settings, u = s.users || (s.users = {});
    n = n === undefined ? (s.playerName || '') : n;
    return u[n] || (u[n] = { best: 0 });
  };
  (function migrate() {
    var s = HW.settings;
    if (s.usersMigrated) return;
    var n = s.playerName || '', old = HW.store.get('profile', null);
    if (old && !HW.store.get(pkey(n), null)) HW.store.set(pkey(n), old);
    var r = HW.userRec(n); r.best = Math.max(r.best || 0, s.bestMission || 0);
    s.usersMigrated = true;
    HW.store.set('settings', s);
  })();
  HW.saveProfile = function () {
    if (!HW.P || HW.P.survivalProfile) return;
    var copy = JSON.parse(JSON.stringify(HW.P));
    HW.store.set(pkey(HW.settings.playerName), copy);
  };
  HW.loadProfile = function () { return HW.store.get(pkey(HW.settings.playerName), null); };
  HW.clearProfile = function () { HW.store.set(pkey(HW.settings.playerName), null); };
  function snapshot(P) { var c = JSON.parse(JSON.stringify(P)); delete c.checkpoint; return c; }
  HW.scores = HW.store.get('scores', { mission: [], survival: [] });
  function addScore(list, entry, key) {
    list.push(entry);
    list.sort(function (a, b) { return b[key] - a[key]; });
    if (list.length > 10) list.length = 10;
    HW.store.set('scores', HW.scores);
    return list.indexOf(entry);
  }

  /* ------------------------------------------------------------------ widgets */
  function Button(x, y, w, h, label, cb, o) {
    this.x = x; this.y = y; this.w = w; this.h = h; this.label = label; this.cb = cb; o = o || {};
    this.down = false; this.disabled = !!o.disabled; this.round = !!o.round; this.invisible = !!o.invisible;
    this.font = o.font || 'Outlined'; this.color = o.color || '#ffffff';
  }
  Button.prototype.hit = function (x, y) {
    if (this.round) { var dx = x - (this.x + this.w / 2), dy = y - (this.y + this.h / 2), r = this.w / 2 + 6; return dx * dx + dy * dy <= r * r; }
    return x >= this.x - 6 && x <= this.x + this.w + 6 && y >= this.y - 6 && y <= this.y + this.h + 6;
  };
  /* the original dialog button (0x41cec0 / 0x41d010): metal bracket, colorized green bar, Normal font label at y+21;
     drawn 30 px tall, centred in the (taller, touch friendly) hit box */
  Button.prototype.draw = function (ctx) {
    if (this.invisible) return;
    var bb = S('buttonbracket'), b = S('button');
    var x = Math.round(this.x), w = Math.round(this.w), y = Math.round(this.y + (this.h - 30) / 2), dy = this.down ? 1 : 0;
    ctx.save();
    if (this.disabled) ctx.globalAlpha *= 0.45;
    if (bb && b) {
      HW.drawBox3(ctx, bb, x, y, w);
      HW.drawBox3(ctx, D.mulTint(b, this.tint || 'rgb(64,192,64)'), x, y + dy, w);
    }
    var f = F('Normal');
    if (f) f.draw(ctx, this.label, x + w / 2, y + 21 + dy, '#fff', 1);
    if (this.down && S('buttonglow')) { ctx.globalCompositeOperation = 'lighter'; HW.drawBox3(ctx, S('buttonglow'), x, y + dy, w); }
    ctx.restore();
  };
  HW.Button = Button;

  /* base scene with a 640x480 centered layout and buttons */
  function Scene() {}
  Scene.prototype.initScene = function () { this.buttons = []; this.t = 0; };
  Scene.prototype.lx = function (x) { return x - HW.OX; };
  Scene.prototype.onPress = function (x, y) {
    x = this.lx(x);
    for (var i = 0; i < this.buttons.length; i++) { var b = this.buttons[i]; if (!b.disabled && b.hit(x, y)) { b.down = true; HW.snd(17); } }
    if (this.press) this.press(x, y);
  };
  Scene.prototype.onDrag = function (x, y) {
    x = this.lx(x);
    for (var i = 0; i < this.buttons.length; i++) { var b = this.buttons[i]; if (b.down && !b.hit(x, y)) b.down = false; }
    if (this.drag) this.drag(x, y);
  };
  Scene.prototype.onRelease = function (x, y) {
    x = this.lx(x);
    var fired = null;
    for (var i = 0; i < this.buttons.length; i++) { var b = this.buttons[i]; if (b.down && b.hit(x, y)) fired = b; b.down = false; }
    if (fired) { HW.snd(18); fired.cb(); }
    if (this.release) this.release(x, y);
  };
  Scene.prototype.update = function () { this.t++; if (this.tick) this.tick(); };
  Scene.prototype.drawButtons = function (ctx) { for (var i = 0; i < this.buttons.length; i++) this.buttons[i].draw(ctx); };
  /* fill the area outside the classic 640 frame: the screen's own picture, scaled to the full width, blurred and
     darkened (built once per screen size), so wide phones get soft "ambient" sides instead of black bars */
  var ambient = {}, ambientKeys = [];
  function ambientFill(bgName, bg) {
    var W = HW.W, key = bgName + '|' + W, c = ambient[key];
    if (c) return c;
    c = document.createElement('canvas'); c.width = W; c.height = 480;
    var x = c.getContext('2d'), sc = W / 640, h = Math.round(480 * sc);
    x.fillStyle = '#000'; x.fillRect(0, 0, W, 480);
    var hasFilter = typeof x.filter === 'string';
    if (hasFilter) x.filter = 'blur(9px) brightness(0.42) saturate(1.1)';
    x.drawImage(bg.image, 0, 0, bg.w, bg.h, 0, Math.round((480 - h) / 2), W, h);
    if (hasFilter) x.filter = 'none';
    else { x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillRect(0, 0, W, 480); }
    // a soft shadow where the picture meets the sides
    var ox = HW.OX, g = x.createLinearGradient(ox - 24, 0, ox, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.7)');
    x.fillStyle = g; x.fillRect(ox - 24, 0, 24, 480);
    g = x.createLinearGradient(ox + 640, 0, ox + 664, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.7)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(ox + 640, 0, 24, 480);
    ambient[key] = c; ambientKeys.push(key);
    if (ambientKeys.length > 8) delete ambient[ambientKeys.shift()];
    return c;
  }
  HW.ambientFill = ambientFill;
  Scene.prototype.frame = function (ctx, bgName) {
    var W = HW.W, ox = HW.OX, bg = bgName && S(bgName);
    if (bg && ox > 0) ctx.drawImage(ambientFill(bgName, bg), 0, 0);
    else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, 480); }
    if (bg) ctx.drawImage(bg.image, ox, 0);
  };
  function defScene(proto) {
    var K = function (a, b, c) { this.initScene(); if (this.setup) this.setup(a, b, c); };
    K.prototype = Object.create(Scene.prototype);
    for (var k in proto) K.prototype[k] = proto[k];
    return K;
  }
  HW.defScene = defScene;

  function panel(ctx, x, y, w, h, alpha) {
    ctx.save();
    ctx.fillStyle = 'rgba(8,20,10,' + (alpha === undefined ? 0.85 : alpha) + ')';
    ctx.strokeStyle = '#7da07d'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(x + 0.5, y + 0.5, w, h); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  HW.panel = panel;

  /* ------------------------------------------------------------------ title screen (0x42ee70 / 0x42e7a0 / 0x42eb60)
     The intro movie ends on the cannon's white flash; the title fades in from white (2 per step) while the loading
     bar rises into place (y = 422 + fade/2) inside its pulsing cyan glow. The bar shows the bullet fully loaded, then
     the metal plate slides back over it (10 px per step, "gunpowerup") and "CLICK HERE TO PLAY" appears on the plate
     (RubberStampLET20, orange, white while touched). Once the fade is over the ATOMIC TANK! logo pops in at (530,260):
     alpha min(255, sin(f/2)*512) plus an additive glow cel at sin(f)*255, f += 0.02 up to 3.141. */
  HW.TitleScene = defScene({
    setup: function () {
      this.out = 255; this.slider = 0; this.f = 0; this.link = false; this.down = false;
      HW.music(0);
    },
    skip: function () { this.out = 0; this.f = 3.141; if (!this.link && HW.loaded) { this.slider = 304; this.link = true; } },
    tick: function () {
      if (this.out > 0) this.out = Math.max(0, this.out - 2);
      else { this.f += 0.02; if (this.f > 3.141) this.f = 3.141; }
      // when the loading is complete the plate closes over the bullet (0x42e840): right away if it finished during
      // the movie (after a short look at the full bullet), else the moment it does
      if (HW.loaded && !this.slider && this.t >= 70) { this.slider = 4; HW.snd(0); }
      if (this.slider && !this.link) { this.slider += 10; if (this.slider > 304) { this.slider = 304; this.link = true; } }
    },
    draw: function (ctx) {
      var ox = HW.OX, y = 422 + (this.out >> 1), s;
      this.frame(ctx, 'title');
      ctx.save();
      if ((s = S('loadingglow'))) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (Math.cos((this.t % 1570) * 0.04) * 64 + 191) / 255;
        ctx.drawImage(s.image, ox + 320 - (s.w >> 1), y - (s.h >> 1));
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      }
      ctx.beginPath(); ctx.rect(ox + 168, 0, 304, 480); ctx.clip();
      var frac = HW.loaded ? 1 : clamp(HW.loadProgress ? HW.loadProgress() : 1, 0, 1);
      if (this.slider < 304) {
        if ((s = S('loadinginside'))) ctx.drawImage(s.image, ox + 320 - (s.w >> 1), y - (s.h >> 1));
        if ((s = S('loadingbullet'))) ctx.drawImage(s.image, ox + Math.trunc(624 - frac * 304) - (s.w >> 1), y + 1 - (s.h >> 1));
      }
      if ((s = S('loadingslider'))) ctx.drawImage(s.image, ox + (this.slider > 0 ? this.slider + 16 : Math.trunc(320 - frac * 304)) - (s.w >> 1), y - (s.h >> 1));
      ctx.restore();
      if ((s = S('loadingframe'))) ctx.drawImage(s.image, ox + 320 - (s.w >> 1), y - (s.h >> 1));
      if (this.link && F('RubberStampLET20')) {
        var f = F('RubberStampLET20'), txt = 'CLICK HERE TO PLAY', w = f.width(txt);
        f.draw(ctx, txt, ox + 320 - Math.floor(w / 2), 405 + ((29 + f.ascent) >> 1) - 1, this.down ? '#fff' : 'rgb(255,192,0)', 0);
      }
      if (this.out > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (this.out / 255) + ')'; ctx.fillRect(0, 0, HW.W, 480); }
      if (this.f > 0 && (s = S('atomictank'))) {
        var cw = s.w >> 1, x0 = ox + 530 - (cw >> 1), y0 = 260 - (s.h >> 1);
        ctx.save();
        ctx.globalAlpha = Math.min(255, Math.sin(this.f * 0.5) * 512) / 255;
        ctx.drawImage(s.image, 0, 0, cw, s.h, x0, y0, cw, s.h);
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.max(0, Math.sin(this.f));
        ctx.drawImage(s.image, cw, 0, cw, s.h, x0, y0, cw, s.h);
        ctx.restore();
      }
    },
    press: function () { HW.Audio.unlock(); HW.Audio.resumePending(); this.down = this.link; },
    release: function () {
      if (!this.link) { this.skip(); return; }
      this.down = false;
      HW.snd(18);
      HW.snd(55);   // "ATOMIC TANK!" as the title screen goes away (0x42e6b0)
      HW.setScene(new HW.MenuScene());
    }
  });

  /* ------------------------------------------------------------------ briefing map (0x425500 / 0x424660 / 0x424bf0)
     The map appears with green corner brackets at the screen corners; after half a second they close in on the
     target country (10% of the way per step), the map darkens while the country lights up green, the country slides
     to the centre of the left panel, then the briefing fades in: MISSION n, the country, intel text and ENEMY INTEL
     cycling through every enemy type of the mission (3 s each, tap the panel for the next one). Touching the country
     or "Click here to invade!" turns it red; the invasion zooms the red country to fill the screen, the mission
     starts and the red fades away over the game. */
  var COUNTRY_POS = [[13, 23], [10, 207], [119, 144], [114, 232], [255, 115], [247, 36], [436, 74], [306, 189], [394, 247], [253, 347]];
  /* craft id (1-based, as in the waves) -> intel picture: [image, extra parts...] (0x423fc0) */
  var INTEL_PICS = {
    1: ['propfighter'], 2: ['smalljet'], 3: ['bomber'], 4: ['jetfighter'], 5: ['truck'], 6: ['bigbomber'], 7: ['smallcopter'],
    8: ['medcopter', ['medrotor', 480, 318]], 9: ['bigcopter', 'rotors'], 10: ['deltabomber'], 11: ['deltajet'], 12: ['bigmissile'],
    13: ['superbomber'], 14: ['fatbomber'], 15: ['blimp', ['blimpprop', 508, 361], ['blimpprop', 392, 360]], 16: ['satellite'],
    17: ['strafer'], 18: ['enemytank', ['enemygun', 480, 323]], 19: ['dozer'], 20: ['deflector'], 21: ['cruise']
  };
  HW.MapScene = defScene({
    setup: function () {
      var P = HW.P, self = this;
      HW.music(3);
      HW.Input.showControls = false;
      this.c = HW.countryOf(P.mission);
      this.lv = HW.data.levels[this.c];
      this.img = S('mission' + (this.c + 1));
      var cp = COUNTRY_POS[this.c] || [0, 0];
      this.cx = cp[0]; this.cy = cp[1];
      this.iw = this.img ? this.img.w : 100; this.ih = this.img ? this.img.h : 100;
      this.delay = 50; this.zooming = true; this.sliding = true;
      this.dark = 0; this.text = 0; this.red = 0; this.inv = 0; this.fade = -1;
      this.x1 = 0; this.y1 = 0; this.x2 = 640; this.y2 = 480;
      this.over = false; this.linkDown = false;
      // every enemy type that appears in this mission's waves, in craft order (0x425500)
      var waves = HW.data.waves[Math.min(P.mission, HW.data.waves.length - 1)] || [], seen = {};
      waves.forEach(function (w) { w.craft.forEach(function (c) { var id = HW.CRAFT[c[0]]; if (id) seen[id] = 1; }); });
      this.intel = Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
      this.ii = 0; this.cycle = 0; this.auto = true;
      P.checkpoint = snapshot(P);
      HW.saveProfile();
      void self;
    },
    linkRect: function () { var w = F('Normal').width('Click here to invade!'); return [160 - Math.floor(w / 2), 440, w, 25]; },
    onCountry: function (x, y) {
      if (this.text < 255 || this.inv) return false;
      return x >= this.x1 + 4 && x <= this.x1 + this.iw - 4 && y >= this.y1 + 4 && y <= this.y1 + this.ih - 4;
    },
    onLink: function (x, y) {
      if (this.text < 255 || this.inv) return false;
      var r = this.linkRect();
      return x >= r[0] - 8 && x <= r[0] + r[2] + 8 && y >= r[1] - 6 && y <= r[1] + r[3] + 8;
    },
    onPress: function (x, y) {
      x = this.lx(x);
      if (this.onCountry(x, y) || this.onLink(x, y)) { this.over = true; this.linkDown = this.onLink(x, y); }
    },
    onDrag: function (x, y) { x = this.lx(x); this.over = this.over && (this.onCountry(x, y) || this.onLink(x, y)); },
    onRelease: function (x, y) {
      x = this.lx(x);
      var go = this.over && (this.onCountry(x, y) || this.onLink(x, y));
      this.over = false; this.linkDown = false;
      if (go) { this.invade(); return; }
      // the ENEMY INTEL panel: next enemy, and stop the automatic cycling (0x424580)
      if (this.text >= 255 && !this.inv && x >= 320 && y >= 250 && this.intel.length) {
        this.ii = (this.ii + 1) % this.intel.length; this.cycle = 0; this.auto = false; HW.snd(17);
      }
    },
    invade: function () {
      // 0x424510: the country (centred at 160,270) starts to zoom, the links go away
      this.x1 = 160; this.y1 = 270; this.inv = 1;
      HW.snd(85);
    },
    tick: function () {
      if (this.fade >= 0) return;
      if (this.delay > 0) { this.delay--; return; }
      var tw = this.iw, th = this.ih;
      if (this.zooming) {
        var d0 = (this.cx - this.x1) * 0.1, d2 = (this.cy - this.y1) * 0.1;
        this.x1 += d0; this.y1 += d2;
        this.x2 += (this.cx + tw - this.x2) * 0.1; this.y2 += (this.cy + th - this.y2) * 0.1;
        if (d0 < 0.1 && d2 < 0.1) this.zooming = false;
      } else if (!this.inv) {
        this.dark += 4;
        if (this.dark > 255) {
          this.dark = 255;
          if (this.sliding) {
            var dx = (160 - Math.floor(tw / 2) - this.x1) * 0.1, dy = (270 - Math.floor(th / 2) - this.y1) * 0.1;
            this.x1 += dx; this.y1 += dy; this.x2 += dx; this.y2 += dy;
            if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) this.sliding = false;
          } else if (this.text < 255) this.text = Math.min(255, this.text + 4);
        }
      } else {
        this.inv += 0.2;
        var big = this.c === 4, txx = big ? 510 : 320, tyy = big ? 410 : 240;
        var ddx = (txx - this.x1) * 0.05, ddy = (tyy - this.y1) * 0.05;
        this.x1 += ddx; this.y1 += ddy;
        if (ddx < 0.1 && ddy < 0.1 && this.inv > 14) {
          // the mission starts underneath a red screen that fades away (field_b0); the first battle of a session
          // is preceded by HOW TO PLAY (0x424a44)
          HW.withHelpFirst(function (afterHelp) {
            HW.startMission();
            if (!afterHelp && HW.scene instanceof HW.GameScene) HW.scene.redFade = 255;
          });
          return;
        }
      }
      // touching the country or the link tints it red (field_a0)
      if (this.over) this.red = Math.min(255, this.red + 12); else this.red = Math.max(0, this.red - 12);
      if (this.auto && this.intel.length && ++this.cycle % 300 === 0) this.ii = (this.ii + 1) % this.intel.length;
    },
    draw: function (ctx) {
      var P = HW.P, map = S('map');
      if (map && HW.OX > 0) ctx.drawImage(HW.ambientFill('map', map), 0, 0);
      else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, HW.W, 480); }
      ctx.save(); ctx.translate(HW.OX, 0);
      if (map) ctx.drawImage(map.image, 0, 0);
      if (this.dark > 0) { ctx.fillStyle = 'rgba(0,0,0,' + (this.dark * 0.75 / 255) + ')'; ctx.fillRect(-HW.OX, 0, HW.W, 480); }
      // corner brackets
      var mr = S('maprect'), ba = (255 - this.text) / 255;
      if (mr && ba > 0) {
        var g = D.mulTint(mr, 'rgb(0,255,0)');
        ctx.save(); ctx.globalAlpha = ba;
        D.celC(ctx, g, Math.round(this.x1 + 10), Math.round(this.y1 + 10), 0, 0);
        D.celC(ctx, g, Math.round(this.x2 - 10), Math.round(this.y1 + 10), 1, 0);
        D.celC(ctx, g, Math.round(this.x2 - 10), Math.round(this.y2 - 10), 2, 0);
        D.celC(ctx, g, Math.round(this.x1 + 10), Math.round(this.y2 - 10), 3, 0);
        ctx.restore();
      }
      if (this.text > 0) this.drawBriefing(ctx, this.text / 255);
      // the country: green, red while touched; zooming red during the invasion
      if (this.dark > 0 && this.img) {
        ctx.save();
        if (this.inv) {
          var k = this.inv, w = this.iw * k, h = this.ih * k;
          ctx.drawImage(D.mulTint(this.img, 'rgb(255,0,0)').image, Math.round(this.x1 - w / 2), Math.round(this.y1 - h / 2), Math.round(w), Math.round(h));
        } else {
          ctx.globalAlpha = this.dark / 255;
          var r = Math.round(this.red);
          D.img(ctx, D.mulTint(this.img, 'rgb(' + r + ',' + (255 - r) + ',0)'), Math.round(this.x1), Math.round(this.y1));
        }
        ctx.restore();
      }
      ctx.restore();
    },
    drawBriefing: function (ctx, a) {
      var P = HW.P, lv = this.lv;
      ctx.save(); ctx.globalAlpha = a;
      F('RubberStampLET42').draw(ctx, 'MISSION ' + (P.mission + 1), 320, 50, '#fff', 1);
      var r20 = F('RubberStampLET20');
      r20.draw(ctx, lv ? lv.name : '', 160, 100, '#fff', 1);
      r20.draw(ctx, 'ENEMY INTEL', 480, 285, '#fff', 1);
      ctx.fillStyle = 'rgb(128,128,128)';
      ctx.fillRect(320, 65, 1, 415); ctx.fillRect(0, 65, 640, 1); ctx.fillRect(320, 250, 320, 1);
      var cf = F('Computer'), green = 'rgb(0,255,0)';
      var round = P.mission === 18 ? 0 : Math.min(1, Math.floor(P.mission / 9));
      var intel = lv && lv.intel ? (lv.intel[round] || lv.intel[0]) : '';
      var lines = cf.wrap(intel, 280);
      var ls = cf.lineSpacing;   // 17 for the Computer font
      for (var i = 0; i < lines.length; i++) cf.draw(ctx, lines[i], 340, 80 + cf.ascent + i * ls, green, 0);
      // the enemy picture and its data
      var id = this.intel[this.ii];
      var pic = INTEL_PICS[id], cd = HW.data.craft[id - 1];
      if (pic) {
        var main = S(pic[0]);
        if (main) D.celC(ctx, main, 480, 340, 0, 0);
        for (var k = 1; k < pic.length; k++) {
          var part = pic[k];
          if (part === 'rotors' && main) D.cel(ctx, S('rotors'), 480 - Math.floor(main.cw / 2), 340 - Math.floor(main.ch / 2), 0, 0);
          else if (Array.isArray(part)) D.celC(ctx, S(part[0]), part[1], part[2], 0, 0);
        }
      }
      if (cd) {
        var y = 410;
        cf.draw(ctx, cd.desc, 340, y, green, 0); y += ls;
        if (cd.arms) { cf.draw(ctx, 'Weapon: ' + cd.arms, 340, y, green, 0); y += ls; }
        cf.draw(ctx, 'Armor: ' + Math.floor(cd.armor), 340, y, green, 0); y += ls;
        cf.draw(ctx, 'Score: ' + cd.points, 340, y, green, 0);
      }
      // "Click here to invade!" (underlined hyperlink)
      var n = F('Normal'), lr = this.linkRect(), col = this.linkDown ? 'rgb(255,255,0)' : '#fff';
      n.draw(ctx, 'Click here to invade!', lr[0], 460, col, 0);
      ctx.fillStyle = col; ctx.fillRect(lr[0], 463, lr[2], 1);
      ctx.restore();
    }
  });

  /* ------------------------------------------------------------------ gameplay scene */
  HW.GameScene = defScene({
    setup: function (board) {
      this.board = board;
      this.paused = false;
      HW.Input.reset();
      HW.Input.showControls = true; HW.Input.fade = 1;
      board.start();
    },
    update: function () {
      var I = HW.Input;
      this.t++;
      if (this.dialog) { this.dialog.update && this.dialog.update(); return; }
      if (I.pausePressed && !this.board.over) { this.pause(); return; }
      I.nukeCount = HW.P.nukes;
      I.nukeEnabled = !this.board.survival || true;
      // autopilot to the gas station: the touch controls fade out while the status bar slides away
      if (this.board.levelDone && I.showControls) {
        I.fade = 1 - (this.board.hudOut || 0);
        if (I.fade <= 0) { I.showControls = false; I.reset(); I.fade = 1; }
      }
      this.board.update();
    },
    pause: function () {
      var self = this;
      if (this.dialog) return;
      HW.Input.showControls = false; HW.Input.reset();
      HW.Audio.pauseAll();
      this.dialog = new PauseDialog(this, function () { self.dialog = null; HW.Input.showControls = true; HW.Audio.resumeAll(); });
    },
    preStep: function () { if (!this.dialog) this.board.snapPrev(); if (this.redFade > 0) this.redFade = Math.max(0, this.redFade - 2); },
    draw: function (ctx) {
      var B = this.board, lerp = !this.dialog && B.lerpBegin(HW.alpha);
      try { B.draw(ctx); } finally { if (lerp) B.lerpEnd(); }
      if (this.redFade > 0) { ctx.fillStyle = 'rgba(255,0,0,' + (this.redFade / 255) + ')'; ctx.fillRect(0, 0, HW.W, 480); }
      if (this.dialog) this.dialog.draw(ctx);
    },
    onPress: function (x, y) { if (this.dialog) this.dialog.onPress(x, y); },
    onDrag: function (x, y) { if (this.dialog) this.dialog.onDrag(x, y); },
    onRelease: function (x, y) { if (this.dialog) this.dialog.onRelease(x, y); },
    leave: function () { HW.Input.showControls = false; if (this.board) this.board.cleanup && this.board.cleanup(); }
  });

  /* modal dialog base (drawn over a scene) */
  function Dialog() {}
  Dialog.prototype = Object.create(Scene.prototype);
  Dialog.prototype.box = function (ctx, x, y, w, h, noDim) {
    if (!noDim) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(-HW.OX, 0, HW.W, 480); }
    var dg = S('dialog');
    if (dg) {
      var c = 30;
      ctx.drawImage(dg.image, 0, 0, c, c, x, y, c, c);
      ctx.drawImage(dg.image, c, 0, 30, c, x + c, y, w - 2 * c, c);
      ctx.drawImage(dg.image, 60, 0, c, c, x + w - c, y, c, c);
      ctx.drawImage(dg.image, 0, c, c, 30, x, y + c, c, h - 2 * c);
      ctx.drawImage(dg.image, c, c, 30, 30, x + c, y + c, w - 2 * c, h - 2 * c);
      ctx.drawImage(dg.image, 60, c, c, 30, x + w - c, y + c, c, h - 2 * c);
      ctx.drawImage(dg.image, 0, 60, c, c, x, y + h - c, c, c);
      ctx.drawImage(dg.image, c, 60, 30, c, x + c, y + h - c, w - 2 * c, c);
      ctx.drawImage(dg.image, 60, 60, c, c, x + w - c, y + h - c, c, c);
    } else panel(ctx, x, y, w, h);
  };
  /* ---- the original dialog look (PopCap Dialog::Draw): 9-slice box, header in RubberStampLET20 tinted yellow at
     contentTop + ascent, word-wrapped lines centred 36 px below the header baseline, 22 px apart */
  function dlgHeader(ctx, X, Y, W, inset, text) {
    var f = F('RubberStampLET20'), b = Y + inset + f.ascent;
    if (text) f.draw(ctx, text, X + Math.floor((W - f.width(text)) / 2), b, 'rgb(255,255,0)', 0);
    return b;
  }
  function dlgLines(ctx, X, W, inset, baseline, text, color, align) {
    var f = F('Normal'), x0 = X + inset + 2, w = W - 2 * inset - 4, lines = f.wrap(text, w);
    for (var i = 0; i < lines.length; i++) {
      var lx = align === -1 ? x0 : (align === 1 ? x0 + w - f.width(lines[i]) : x0 + Math.floor((w - f.width(lines[i])) / 2));
      f.draw(ctx, lines[i], lx, baseline + i * 22, color, 0);
    }
    return lines.length;
  }
  HW.dlgHeader = dlgHeader; HW.dlgLines = dlgLines;
  function tintBtn(b, tint) { b.tint = tint; return b; }

  /* pause dialog (0x41f500 / 0x41f350): 300x210 centred, no header, three olive buttons */
  function PauseDialog(scene, onClose) {
    var self = this, X = 170, Y = 135, G = 'rgb(128,192,64)';
    this.initScene(); this.scene = scene; this.onClose = onClose;
    this.buttons.push(tintBtn(new Button(X + 50, Y + 50, 200, 30, 'OPTIONS', function () {
      scene.dialog = new OptionsDialog(function () { scene.dialog = self; });
    }), G));
    this.buttons.push(tintBtn(new Button(X + 50, Y + 90, 200, 30, 'MAIN MENU', function () {
      var surv = scene.board && scene.board.survival;
      scene.dialog = new ConfirmDialog('QUIT GAME', surv ? 'Retreat to main menu?' :
        'If you quit now, your progress in this mission will be lost!\n\nRetreat to main menu?', function (yes) {
        if (yes) { HW.Audio.resumeAll(); HW.abandonGame(scene.board); } else scene.dialog = self;
      }, 320, surv ? 180 : 240);
    }), G));
    this.buttons.push(tintBtn(new Button(X + 50, Y + 130, 200, 30, 'RESUME GAME', function () { self.onClose(); }), G));
  }
  PauseDialog.prototype = Object.create(Dialog.prototype);
  PauseDialog.prototype.draw = function (ctx) {
    ctx.save(); ctx.translate(HW.OX, 0);
    this.box(ctx, 170, 135, 300, 210, true);
    this.drawButtons(ctx);
    ctx.restore();
  };

  /* YES / NO message box (0x41d320 / 0x41d1a0) */
  function ConfirmDialog(title, text, cb, w, h) {
    w = w || 320; h = h || 240;
    this.initScene(); this.title = title; this.text = text; this.w = w; this.h = h;
    this.X = 320 - Math.floor(w / 2); this.Y = 240 - Math.floor(h / 2);
    this.buttons.push(tintBtn(new Button(this.X + w / 2 - 125, this.Y + h - 55, 120, 30, 'YES', function () { cb(true); }), 'rgb(64,192,64)'));
    this.buttons.push(tintBtn(new Button(this.X + w / 2 + 5, this.Y + h - 55, 120, 30, 'NO', function () { cb(false); }), 'rgb(192,64,64)'));
  }
  ConfirmDialog.prototype = Object.create(Dialog.prototype);
  ConfirmDialog.prototype.draw = function (ctx) {
    ctx.save(); ctx.translate(HW.OX, 0);
    this.box(ctx, this.X, this.Y, this.w, this.h, true);
    var hb = dlgHeader(ctx, this.X, this.Y, this.w, 25, this.title);
    dlgLines(ctx, this.X, this.w, 25, hb + 36, this.text, 'rgb(192,192,192)', 0);
    this.drawButtons(ctx);
    ctx.restore();
  };
  HW.ConfirmDialog = ConfirmDialog;

  /* game over (0x41fe40 / 0x41fb80, stats drawn by 0x4201c0): mission 360x220, survival 360x240 */
  function GameOverDialog(board, info) {
    var self = this;
    this.initScene(); this.board = board; this.info = info;
    this.surv = !!board.survival;
    this.w = 360; this.h = this.surv ? 240 : 220;
    this.X = 320 - this.w / 2; this.Y = 240 - this.h / 2;
    this.buttons.push(tintBtn(new Button(this.X + this.w / 2 - 140, this.Y + this.h - 55, 150, 30, 'TRY AGAIN', function () {
      if (self.surv) HW.restartSurvival(); else HW.retryMission();
    }), 'rgb(128,192,64)'));
    this.buttons.push(tintBtn(new Button(this.X + this.w / 2 + 30, this.Y + this.h - 55, 110, 30, 'QUIT', function () {
      if (self.surv) HW.endSurvival(); else { HW.saveProfile(); HW.setScene(new HW.MenuScene()); }
    }), 'rgb(128,0,0)'));
  }
  GameOverDialog.prototype = Object.create(Dialog.prototype);
  GameOverDialog.prototype.update = function () { this.t++; };
  GameOverDialog.prototype.draw = function (ctx) {
    var X = this.X, Y = this.Y, w = this.w, h = this.h, n = F('Normal'), inf = this.info;
    ctx.save(); ctx.translate(HW.OX, 0);
    this.box(ctx, X, Y, w, h, true);
    dlgHeader(ctx, X, Y, w, 20, 'GAME OVER');
    ctx.fillStyle = 'rgb(128,128,128)'; ctx.fillRect(X + 29, Y + 54, 302, h - 118);
    ctx.fillStyle = '#000'; ctx.fillRect(X + 30, Y + 55, 300, h - 120);
    var green = 'rgb(64,192,0)', labels, values;
    if (inf.rank < 10) { if (this.t % 60 < 30) n.draw(ctx, this.surv ? 'TOP 10 TIME' : 'NEW HIGH SCORE', X + 40, Y + 77, 'rgb(255,64,0)', 0); }
    else n.draw(ctx, this.surv ? 'SURVIVAL TIME' : 'TOTAL SCORE', X + 40, Y + 77, green, 0);
    if (this.surv) {
      labels = ['YOUR BEST TIME', 'ENEMIES DESTROYED', 'KILL PERCENTAGE', 'FRIENDLIES DESTROYED'];
      values = [HW.fmtClock(inf.time), HW.fmtClock(inf.best), HW.commas(inf.kills), inf.pct + '%', String(inf.friendlies)];
    } else {
      labels = ['ENEMIES DESTROYED', 'KILL PERCENTAGE', 'FRIENDLIES DESTROYED'];
      values = [HW.commas(inf.score), HW.commas(inf.kills), inf.pct + '%', String(inf.friendlies)];
    }
    for (var i = 0; i < labels.length; i++) n.draw(ctx, labels[i], X + 40, Y + 82 + 17 + i * 22, green, 0);
    for (i = 0; i < values.length; i++) n.draw(ctx, values[i], X + 320 - n.width(values[i]), Y + 60 + 17 + i * 22, 'rgb(255,192,0)', 0);
    this.drawButtons(ctx);
    ctx.restore();
  };
  /* mm:ss (or h:mm:ss after an hour) from survival distance units (200 per second) */
  HW.fmtClock = function (v) {
    v = Math.max(0, Math.floor(v));
    var s = Math.floor(v / 200) % 60, m = Math.floor(v / 12000) % 60, hr = Math.floor(v / 720000);
    function two(k) { return (k < 10 ? '0' : '') + k; }
    return hr > 0 ? hr + ':' + two(m) + ':' + two(s) : two(m) + ':' + two(s);
  };
  HW.commas = function (v) { return String(Math.floor(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };

  /* ------------------------------------------------------------------ options (0x42a540 layout, 0x42b2f0 draw) */
  /* PopCap Slider: 3-slice track, thumb drawn at val * (width - thumb width) so it never leaves the track */
  function Slider(x, y, w, label, get, set, readout) {
    this.x = x; this.y = y; this.w = w; this.h = 34; this.label = label; this.get = get; this.set = set; this.readout = readout;
    this.drag = false; this.rel = 11;
  }
  Slider.prototype.draw = function (ctx) {
    var tr = S('slidertrack'), th = S('sliderthumb'), x = this.x, w = this.w, ty = this.y + 12;
    if (tr) {
      var c = Math.floor(tr.w / 3), im = tr.image, h = tr.h;
      ctx.drawImage(im, 0, 0, c, h, x, ty, c, h);
      ctx.drawImage(im, c, 0, c, h, x + c, ty, w - 2 * c, h);
      ctx.drawImage(im, 2 * c, 0, c, h, x + w - c, ty, c, h);
    } else { ctx.fillStyle = '#000'; ctx.fillRect(x + 6, ty, w - 12, 5); }
    var tw = th ? th.w : 22;
    if (th) ctx.drawImage(th.image, Math.round(x + this.get() * (w - tw)), this.y + 2);
  };
  Slider.prototype.hit = function (x, y) { return x > this.x - 14 && x < this.x + this.w + 14 && y > this.y - 6 && y < this.y + this.h + 6; };
  Slider.prototype.press = function (x) {
    var tw = 22, tx = this.x + this.get() * (this.w - tw);
    // grabbing the thumb keeps the finger offset; touching the bar moves the thumb under the finger
    if (x >= tx - 8 && x < tx + tw + 8) this.rel = clamp(x - tx, 0, tw);
    else { this.rel = tw / 2; this.setFrom(x); }
    this.drag = true;
  };
  Slider.prototype.setFrom = function (x) { this.set(clamp((x - this.rel - this.x) / (this.w - 22), 0, 1)); };
  function Check(x, y, label, get, set) { this.x = x; this.y = y; this.label = label; this.get = get; this.set = set; }
  Check.prototype.draw = function (ctx) {
    D.img(ctx, S(this.get() ? 'checked' : 'unchecked'), this.x, this.y);
    F('Normal').draw(ctx, this.label, this.x + 40, this.y + 20, 'rgb(192,192,192)', 0);
  };
  Check.prototype.hit = function (x, y) { return x > this.x - 8 && x < this.x + 46 + F('Normal').width(this.label) && y > this.y - 1 && y < this.y + 30; };

  /* the dialog sits at (140,35) 360x410 in the original; it is 30 px taller here for the extra Zoom slider (the
     battlefield magnification, automatic from the screen shape until moved). Labels are grey (192,192,192). */
  var OPT_X = 140, OPT_Y = 20, OPT_W = 360, OPT_H = 440;
  function pct(v) { return Math.round(v * 100); }
  function OptionsBase(onDone, fromMenu) {
    var s = HW.settings, self = this, X = OPT_X, Y = OPT_Y;
    this.initScene(); this.onDone = onDone;
    this.sliders = [
      new Slider(X + 120, Y + 55, 200, 'Sound FX', function () { return s.sfx; }, function (v) { s.sfx = v; HW.Audio.setSfxVolume(v); },
        function (v) { return 'Sound Effects Volume: ' + pct(v) + '%'; }),
      new Slider(X + 120, Y + 85, 200, 'Music', function () { return s.music; }, function (v) { s.music = v; HW.Audio.setMusicVolume(v); },
        function (v) { return 'Music Volume: ' + pct(v) + '%'; }),
      new Slider(X + 120, Y + 115, 200, 'Detail', function () { return s.detail; }, function (v) { s.detail = v; },
        function (v) { return 'Particles: ' + pct(v) + '% / Background: ' + (v > 0 ? 'ON' : 'OFF'); }),
      new Slider(X + 120, Y + 145, 200, 'Zoom', function () { return clamp((HW.getZoom() - 1) / 0.4, 0, 1); }, function (v) {
        var z = Math.round((1 + 0.4 * v) * 100) / 100;
        s.zoom = Math.abs(z - HW.zoomAuto()) < 0.02 ? null : z;
      }, function () {
        return 'Battlefield Zoom: ' + Math.round(HW.getZoom() * 100) + '%' + (typeof s.zoom === 'number' ? '' : ' (auto)');
      })
    ];
    this.checks = [
      new Check(X + 40, Y + 185, 'Auto Fire', function () { return s.autoFire; }, function (v) { s.autoFire = v; HW.autoFire = v; }),
      new Check(X + 40, Y + 215, 'Left-Handed Controls', function () { return s.leftHanded; }, function (v) { s.leftHanded = v; HW.Input.leftHanded = v; HW.Input.layout(); }),
      new Check(X + 40, Y + 245, 'Screen Shake', function () { return s.shake; }, function (v) { s.shake = v; }),
      new Check(X + 40, Y + 275, 'Enable Hints', function () { return s.hints; }, function (v) { s.hints = v; if (v) s.seenHints = {}; })
    ];
    this.buttons.push(new Button(X + 40, Y + 320, 130, 30, 'HELP', function () {
      HW.saveSettings(); HW.helpReturn = self.onDone; HW.setScene(new HW.HelpScene());
    }));
    this.buttons.push(new Button(X + 190, Y + 320, 130, 30, 'CREDITS', function () {
      HW.saveSettings(); HW.creditsReturn = self.onDone; HW.setScene(new HW.CreditsScene());
    }));
    this.buttons.push(new Button(X + 40, Y + 355, 280, 30, 'DONE', function () { HW.saveSettings(); self.onDone(); }));
    if (!fromMenu) { this.buttons[0].disabled = true; this.buttons[1].disabled = true; }
  }
  OptionsBase.prototype = Object.create(Dialog.prototype);
  OptionsBase.prototype.press = function (x, y) {
    for (var i = 0; i < this.sliders.length; i++) if (this.sliders[i].hit(x, y)) { this.sliders[i].press(x); return; }
    for (i = 0; i < this.checks.length; i++) if (this.checks[i].hit(x, y)) { this.checks[i].set(!this.checks[i].get()); HW.snd(17); return; }
  };
  OptionsBase.prototype.drag = function (x) { for (var i = 0; i < this.sliders.length; i++) if (this.sliders[i].drag) this.sliders[i].setFrom(x); };
  OptionsBase.prototype.release = function () {
    for (var i = 0; i < this.sliders.length; i++) {
      // the original plays a sample sound when the Sound FX slider is let go
      if (this.sliders[i].drag && i === 0) HW.snd(0);
      this.sliders[i].drag = false;
    }
  };
  OptionsBase.prototype.drawBody = function (ctx) {
    var X = OPT_X, Y = OPT_Y, n = F('Normal'), grey = 'rgb(192,192,192)';
    this.box(ctx, X, Y, OPT_W, OPT_H, true);
    F('RubberStampLET20').draw(ctx, 'OPTIONS', X + OPT_W / 2, Y + 40, '#fff', 1);
    for (var i = 0; i < this.sliders.length; i++) {
      var sl = this.sliders[i];
      n.draw(ctx, sl.label, X + 40, Y + 75 + 30 * i, grey, 0);
      sl.draw(ctx);
      if (sl.drag) n.draw(ctx, sl.readout(sl.get()), X + 40, Y + OPT_H - 30, grey, 0);
    }
    for (i = 0; i < this.checks.length; i++) this.checks[i].draw(ctx);
    this.drawButtons(ctx);
  };
  function OptionsDialog(onDone) { OptionsBase.call(this, onDone, false); }
  OptionsDialog.prototype = Object.create(OptionsBase.prototype);
  OptionsDialog.prototype.draw = function (ctx) {
    ctx.save(); ctx.translate(HW.OX, 0);
    this.drawBody(ctx);
    ctx.restore();
  };
  HW.OptionsScene = defScene({
    setup: function (onDone) { this.dlg = new OptionsBase(onDone, true); this.menu = new HW.MenuScene(true); },
    draw: function (ctx) {
      this.menu.draw(ctx);
      ctx.save(); ctx.translate(HW.OX, 0);
      this.dlg.drawBody(ctx);
      ctx.restore();
    },
    onPress: function (x, y) { this.dlg.onPress(x, y); },
    onDrag: function (x, y) { this.dlg.onDrag(x, y); },
    onRelease: function (x, y) { this.dlg.onRelease(x, y); }
  });

  /* ------------------------------------------------------------------ main menu (0x425e20 / 0x425c40 / 0x426140) */
  var MENU_TIPS = {
    MISSION: 'Set out on a multi-staged campaign to obliterate the forces of tyranny!',
    SURVIVAL: 'Put your skills to the ultimate test! How long can you survive the onslaught?',
    HEROES: 'Check the high scores to see if you are a Hero of Freedom!',
    OPTIONS: 'Modify sound, video, and game settings here.',
    HELP: 'Get briefed on how to play here!',
    QUIT: 'Surrender and return to your phone.'
  };
  var QUIT_TAUNTS = [
    'Will you abandon our allies at their time of greatest need?',
    'Fine!  Leave!  Enjoy your freedom for the few remaining hours that you still have it!',
    "What's the matter?  No AC?  No leather?  No 6-speaker stereo?  This is a WAR MACHINE, boy!",
    'Are you going to let Red Star win this time?',
    'The free world is depending on you!  Are you going to let us down?',
    "On the run already?  You just can't find good help any more!",
    "If you think a court-martial is easier to face than the enemy, I'll personally see to it that you're sadly mistaken!  Are you SURE?",
    "Too much carnage?  Can't take the heat?  Are you a momma's boy???",
    "There's only one thing worse than a traitor, and that's a quitter!  Quit anyway?",
    'Quit NOW?  Just whose side are you on, anyway???'
  ];
  /* stages completed in mission mode (unlocks survival after 3) */
  HW.stagesDone = function () {
    var p = HW.loadProfile(), m = p ? p.mission || 0 : 0;
    return Math.max(m, HW.userRec().best || 0);
  };
  HW.playerName = function () { return HW.settings.playerName || ''; };

  /* OK message box (0x429b00 / 0x429980) */
  function MessageDialog(title, text, w, h, onOk) {
    this.initScene(); this.title = title; this.text = text; this.w = w; this.h = h;
    this.X = 320 - Math.floor(w / 2); this.Y = 240 - Math.floor(h / 2);
    this.buttons.push(tintBtn(new Button(this.X + w / 2 - 50, this.Y + h - 60, 100, 30, 'OK', onOk), 'rgb(64,192,64)'));
  }
  MessageDialog.prototype = Object.create(Dialog.prototype);
  MessageDialog.prototype.draw = function (ctx) {
    ctx.save(); ctx.translate(HW.OX, 0);
    this.box(ctx, this.X, this.Y, this.w, this.h, true);
    var hb = dlgHeader(ctx, this.X, this.Y, this.w, 25, this.title);
    dlgLines(ctx, this.X, this.w, 25, hb + 36, this.text, 'rgb(192,192,192)', 0);
    this.drawButtons(ctx);
    ctx.restore();
  };
  HW.MessageDialog = MessageDialog;

  /* continue or start a new campaign (0x41d800 / 0x41d700): 520x230 */
  function MissionModeDialog(saved, close) {
    var w = 520, h = 230, X = 60, Y = 125, G = 'rgb(64,192,64)';
    this.initScene(); this.X = X; this.Y = Y; this.w = w; this.h = h;
    var lv = HW.data.levels[HW.countryOf(saved.mission)];
    this.text = 'Would you like to continue\nMission: ' + (saved.mission + 1) + ' - ' + (lv ? lv.name : '') + '\n\nOr begin a new campaign?';
    this.buttons.push(tintBtn(new Button(X + w / 2 - 220, Y + h - 55, 140, 30, 'CONTINUE', function () {
      // CONTINUE always goes through the armory first (0x40e2f0 -> 0x401090 -> 0x40f190), so the upgrade points have
      // to be spent before the next mission can start
      HW.P = saved; HW.setScene(new HW.ArmoryScene());
    }), G));
    this.buttons.push(tintBtn(new Button(X + w / 2 - 70, Y + h - 55, 140, 30, 'NEW GAME', function () { HW.newCampaign(); }), G));
    this.buttons.push(tintBtn(new Button(X + w / 2 + 80, Y + h - 55, 140, 30, 'CANCEL', close), 'rgb(192,64,64)'));
  }
  MissionModeDialog.prototype = Object.create(Dialog.prototype);
  MissionModeDialog.prototype.draw = function (ctx) {
    ctx.save(); ctx.translate(HW.OX, 0);
    this.box(ctx, this.X, this.Y, this.w, this.h, true);
    var hb = dlgHeader(ctx, this.X, this.Y, this.w, 25, 'MISSION MODE');
    dlgLines(ctx, this.X, this.w, 25, hb + 36, this.text, 'rgb(192,192,192)', 0);
    this.drawButtons(ctx);
    ctx.restore();
  };
  HW.newCampaign = function () {
    HW.P = HW.newProfile(HW.playerName() || 'TANKER'); HW.saveProfile();
    HW.setScene(new HW.MapScene());
  };

  /* NEW USER / RENAME USER (0x428e60): 330x190, black edit box 250x30, OK. A transparent HTML input on top of the
     edit box brings up the phone keyboard; the text itself is drawn with the game font */
  function NameDialog(rename, done) {
    var self = this, X = 155, Y = 145;
    this.initScene(); this.rename = rename; this.done = done; this.X = X; this.Y = Y; this.w = 330; this.h = 190;
    this.text = rename ? HW.playerName() : '';
    this.err = null;
    this.buttons.push(tintBtn(new Button(X + this.w / 2 - 60, Y + this.h - 55, 120, 30, 'OK', function () { self.ok(); }), 'rgb(64,192,64)'));
    var inp = document.getElementById('hwName');
    if (!inp) {
      inp = document.createElement('input');
      inp.id = 'hwName'; inp.type = 'text'; inp.maxLength = 15; inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.setAttribute('autocapitalize', 'words');
      inp.style.cssText = 'position:absolute;z-index:5;border:0;outline:0;background:transparent;color:transparent;' +
        'caret-color:transparent;padding:0;margin:0;font-size:16px;';
      document.body.appendChild(inp);
    }
    this.inp = inp;
    inp.value = this.text;
    inp.oninput = function () { self.text = inp.value.replace(/[^A-Za-z0-9 _.\-!]/g, '').slice(0, 15); };
    inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); self.ok(); } };
    inp.style.display = 'block';
    this.place();
    try { inp.focus(); } catch (e) { }
  }
  NameDialog.prototype = Object.create(Dialog.prototype);
  NameDialog.prototype.place = function () {
    var s = HW.cssScale, i = this.inp;
    i.style.left = (HW.cssLeft + (HW.OX + 195) * s) + 'px'; i.style.top = (HW.cssTop + 240 * s) + 'px';
    i.style.width = (250 * s) + 'px'; i.style.height = (30 * s) + 'px';
  };
  NameDialog.prototype.ok = function () {
    var n = this.text.trim();
    if (!n) { this.err = 'You must enter a name in order to continue.'; return; }
    this.inp.blur(); this.inp.style.display = 'none';
    var old = HW.settings.playerName || '';
    if (this.rename && old !== n) {
      // RENAME USER: the record and the saved campaign go with the new name
      var p = HW.loadProfile(), r = HW.userRec(old);
      HW.settings.users[n] = r; delete HW.settings.users[old];
      HW.clearProfile();
      HW.settings.playerName = n;
      if (p) { p.name = n; HW.store.set('profile:' + n, p); }
      if (HW.P && !HW.P.survivalProfile) HW.P.name = n;
    } else if (old !== n) {
      // NEW USER: another player with his own (possibly empty) record
      HW.settings.playerName = n;
      HW.userRec(n);
      if (HW.P && !HW.P.survivalProfile) HW.P = HW.loadProfile();
    }
    HW.saveSettings();
    this.done(n);
  };
  NameDialog.prototype.update = function () { this.t++; this.place(); };
  NameDialog.prototype.draw = function (ctx) {
    var X = this.X, Y = this.Y;
    ctx.save(); ctx.translate(HW.OX, 0);
    this.box(ctx, X, Y, this.w, this.h, true);
    var hb = dlgHeader(ctx, X, Y, this.w, 25, this.rename ? 'RENAME USER' : 'NEW USER');
    dlgLines(ctx, X, this.w, 25, hb + 36, this.err || 'Please enter your name.', this.err ? 'rgb(255,128,64)' : 'rgb(192,192,192)', 0);
    ctx.fillStyle = 'rgb(128,128,128)'; ctx.fillRect(195, 240, 250, 30);
    ctx.fillStyle = '#000'; ctx.fillRect(196, 241, 248, 28);
    var n = F('Normal'), tw = n.width(this.text);
    ctx.save(); ctx.beginPath(); ctx.rect(196, 241, 248, 28); ctx.clip();
    n.draw(ctx, this.text, 200, 261, '#fff', 0);
    if ((this.t >> 5) % 2 === 0) { ctx.fillStyle = '#fff'; ctx.fillRect(201 + tw, 245, 1, 20); }
    ctx.restore();
    this.drawButtons(ctx);
    ctx.restore();
  };
  NameDialog.prototype.hide = function () { this.inp.blur(); this.inp.style.display = 'none'; };

  /* menu buttons (0x4258a0): an additive glow image whose brightness eases 0..130 while the button is "hovered"
     (touched); entering plays the map-over click panned by position (0x4259e0) */
  function MenuBtn(name, x, y, w, h, big, cb) {
    this.name = name; this.x = x; this.y = y; this.w = w; this.h = h; this.big = big; this.cb = cb;
    this.glow = 0; this.dg = 0; this.over = false;
  }
  MenuBtn.prototype.hit = function (x, y) {
    if (this.big) { var dx = x - (this.x + this.w / 2), dy = y - (this.y + this.h / 2), r = this.w / 2 + 4; return dx * dx + dy * dy <= r * r; }
    return x >= this.x - 4 && x <= this.x + this.w + 4 && y >= this.y - 4 && y <= this.y + this.h + 4;
  };
  MenuBtn.prototype.setOver = function (o) {
    if (o === this.over) return;
    this.over = o; this.dg = o ? 10 : -10;
    HW.snd(49, this.x + this.w / 2 - 320);
  };
  MenuBtn.prototype.update = function () {
    this.glow += this.dg;
    if (this.glow > 130) { this.glow = 130; this.dg = 0; }
    if (this.glow < 0) { this.glow = 0; this.dg = 0; }
  };

  HW.MenuScene = defScene({
    setup: function (asBackdrop) {
      var self = this;
      this.backdrop = !!asBackdrop;
      // the main menu fades in song 3 from order 59 unless it is already on (0x425e20); the love theme with the
      // "Heavy Weapon" call is only the title's, played once per run
      if (!asBackdrop) HW.music(3);
      HW.Input.showControls = false;
      this.atAlpha = asBackdrop ? 255 : 0;           // "ATOMIC TANK!" logo (field_5c)
      this.flick = 0; this.flickV = 192; this.flickSnd = null;   // glow flicker (0x423e50)
      this.dialog = null;
      this.mb = [
        new MenuBtn('MISSION', 45, 195, 110, 110, true, function () { self.startMission(); }),
        new MenuBtn('SURVIVAL', 175, 325, 110, 110, true, function () { self.startSurvival(); }),
        new MenuBtn('HEROES', 475, 195, 120, 40, false, function () { HW.setScene(new HW.HeroesScene()); }),
        new MenuBtn('OPTIONS', 445, 265, 120, 40, false, function () { HW.setScene(new HW.OptionsScene(function () { HW.setScene(new HW.MenuScene()); })); }),
        new MenuBtn('HELP', 445, 335, 120, 40, false, function () { HW.helpReturn = function () { HW.setScene(new HW.MenuScene()); }; HW.setScene(new HW.HelpScene()); }),
        new MenuBtn('QUIT', 475, 405, 120, 40, false, function () { self.quit(); })
      ];
      this.link = { text: "If this isn't you, click here" };
      if (!asBackdrop && !HW.playerName()) this.askName(false);
    },
    askName: function (rename) {
      var self = this;
      this.dialog = new NameDialog(rename, function () { self.dialog = null; });
    },
    startMission: function () {
      var saved = HW.loadProfile(), self = this;
      if (saved && saved.mission > 0) this.dialog = new MissionModeDialog(saved, function () { self.dialog = null; });
      else HW.newCampaign();
    },
    startSurvival: function () {
      var self = this;
      if (HW.stagesDone() < 3) {
        this.dialog = new MessageDialog('LOCKED', 'You must complete 3 stages in Mission Mode in order to unlock Survival Mode!', 280, 210,
          function () { self.dialog = null; });
        return;
      }
      HW.withHelpFirst(function () { HW.startSurvival(); });
    },
    quit: function () {
      var self = this;
      this.dialog = new ConfirmDialog('QUIT GAME', QUIT_TAUNTS[rnd(QUIT_TAUNTS.length)], function (yes) {
        self.dialog = null;
        if (yes) HW.quitApp();
      }, 320, 230);
    },
    leave: function () {
      if (this.flickSnd) { HW.Audio.stop(this.flickSnd); this.flickSnd = null; }
      if (this.dialog && this.dialog.hide) this.dialog.hide();
    },
    tick: function () {
      var i, any = false;
      if (this.dialog) { if (this.dialog.update) this.dialog.update(); }
      for (i = 0; i < this.mb.length; i++) { this.mb[i].update(); if (this.mb[i].over) any = true; }
      // the logo fades out while a button tip is shown (0x425ba0)
      if (any) this.atAlpha = Math.max(0, this.atAlpha - 12); else this.atAlpha = Math.min(255, this.atAlpha + 12);
      // the neon glow shorts out now and then, buzzing (0x423e50)
      if (this.backdrop) return;
      if (rnd(200) === 0 && !this.flick) {
        this.flick = rnd(65) + 10;
        this.flickSnd = HW.Audio.play('shorting', { loop: true });
      }
      if (this.flick) {
        this.flick--;
        this.flickV = 128 + rnd(32);
        if (!this.flick && this.flickSnd) { HW.Audio.stop(this.flickSnd); this.flickSnd = null; }
      }
    },
    onPress: function (x, y) {
      x = this.lx(x);
      if (this.dialog) { this.dialog.onPress(x + HW.OX, y); return; }
      for (var i = 0; i < this.mb.length; i++) if (this.mb[i].hit(x, y)) { this.mb[i].setOver(true); HW.snd(17); this.pressed = this.mb[i]; return; }
      if (this.linkHit(x, y)) this.linkDown = true;
    },
    onDrag: function (x, y) {
      x = this.lx(x);
      if (this.dialog) { this.dialog.onDrag(x + HW.OX, y); return; }
      if (this.pressed && !this.pressed.hit(x, y)) { this.pressed.setOver(false); this.pressed = null; }
    },
    onRelease: function (x, y) {
      x = this.lx(x);
      if (this.dialog) { this.dialog.onRelease(x + HW.OX, y); return; }
      var p = this.pressed;
      this.pressed = null;
      if (p) { p.setOver(false); if (p.hit(x, y)) { HW.snd(18); p.cb(); } }
      if (this.linkDown && this.linkHit(x, y)) { HW.snd(18); this.askName(true); }
      this.linkDown = false;
    },
    linkHit: function (x, y) {
      var f = F('Computer'), w = f.width(this.link.text);
      return x >= 490 - w / 2 - 6 && x <= 490 + w / 2 + 6 && y >= 72 && y <= 108;
    },
    draw: function (ctx) {
      this.frame(ctx, 'mainmenu');
      ctx.save(); ctx.translate(HW.OX, 0);
      // user panel
      var n = F('Normal'), name = HW.playerName();
      if (!name) n.draw(ctx, 'NEW USER', 490, 55, '#fff', 1);
      else { n.draw(ctx, 'Welcome Back,', 490, 55, '#fff', 1); n.draw(ctx, name, 490, 75, '#fff', 1); }
      var cf = F('Computer'), lw = cf.width(this.link.text);
      cf.draw(ctx, this.link.text, 490 - Math.floor(lw / 2), 95, this.linkDown ? 'rgb(192,64,32)' : '#fff', 0);
      // neon glow over the circuit board
      var mg = S('mainglow');
      if (mg) {
        var v = this.flick ? this.flickV : 192;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(D.mulTint(mg, 'rgb(' + v + ',' + v + ',' + v + ')').image, 0, 0);
        ctx.restore();
      }
      if (this.atAlpha > 0 && S('atmenu')) { ctx.save(); ctx.globalAlpha = this.atAlpha / 255; D.img(ctx, S('atmenu'), 237, 152); ctx.restore(); }
      // button glows and tips
      for (var i = 0; i < this.mb.length; i++) {
        var b = this.mb[i];
        if (b.glow <= 0) continue;
        var gi = S(b.big ? 'mainbigbtn' : 'mainsmallbtn');
        if (gi) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(D.mulTint(gi, 'rgb(' + b.glow + ',' + b.glow + ',' + b.glow + ')').image, b.x, b.y);
          ctx.restore();
        }
        var tip = (b.name === 'SURVIVAL' && HW.stagesDone() < 3) ? 'You must complete 3 stages in Mission Mode\nin order to unlock\nSurvival Mode!' : MENU_TIPS[b.name];
        this.drawTip(ctx, tip, b.glow);
      }
      ctx.restore();
      if (this.dialog) this.dialog.draw(ctx);
    },
    drawTip: function (ctx, text, a) {
      var ol = F('Outline'), od = F('Outlined');
      function block(f, y0, color, alpha) {
        var lines = f.wrap(text, 210);
        for (var k = 0; k < lines.length; k++) f.draw(ctx, lines[k], 210 + Math.floor((210 - f.width(lines[k])) / 2), y0 + f.ascent + k * 22, color, 0, alpha);
      }
      block(ol, 175, '#000', a / 255);
      block(od, 170, 'rgb(255,224,64)', Math.min(1, a / 130));
    }
  });

  /* ------------------------------------------------------------------ HOW TO PLAY (0x421410 / 0x4212a0 / 0x421620)
     A live demo on a real game board inside the picture frame, scripted in four stages that loop:
     0  the tank follows a swinging cursor and fires in bursts (cursor x = 320 + 100 sin(p), p += 0.03; firing while
        t % 150 < 75; ends once t > 500 and the cursor is back in the middle);
     1  a prop plane crosses at y 140 and lets a bomb go at x = -120, the tank shoots once at t 550 and 780, a small
        helicopter fires at the tank when it is right overhead, the tank dodges (t 800..880: x = 320 + 200 sin);
     2  the white supply helicopter drops a nuke power-up over the tank;
     3  ten planes fly in and the nuke goes off at t 200.
     The original's mouse picture becomes the on-screen FIRE / NUKE buttons and a little aiming stick, and the
     instructions talk about touch controls. Shown once per session before the first battle unless switched off. */
  var HELP_TEXT = [
    'Hold FIRE to shoot.\nThe tank drives and aims with the left stick.',
    'Dodge or destroy enemy fire!',
    "Collect power-ups.\nDon't destroy the friendly white chopper!",
    'Press NUKE to unleash a nuclear bomb!'
  ];
  HW.helpShown = false;
  /* 0x424a44 / 0x42678c: the first battle of a session is preceded by HOW TO PLAY (unless switched off) */
  HW.withHelpFirst = function (start) {
    if (HW.settings.noHelpAtStart || HW.helpShown) { start(false); return; }
    HW.helpShown = true;
    HW.helpReturn = function () { start(true); };
    HW.setScene(new HW.HelpScene());
  };
  HW.HelpScene = defScene({
    setup: function () {
      var self = this;
      var back = HW.helpReturn || function () { HW.setScene(new HW.MenuScene()); };
      HW.helpReturn = null;
      HW.helpShown = true;
      HW.Input.showControls = false;
      this.back = back;
      this.saveP = HW.P;
      this.P = HW.newProfile('DEMO'); this.P.shield = 0; this.P.nukes = 0;
      this.withDemo(function () { self.board = new HW.Board({ demo: true }); });
      this.stage = 0; this.st = 0; this.phase = 0; this.click = false; this.nukeIcon = 0;
      this.plane = null; this.copter = null; this.pup = null;
      this.buttons.push(tintBtn(new Button(500, 440, 120, 44, 'OK', function () { self.finish(); }), 'rgb(32,128,64)'));
      this.checkDown = false;
    },
    withDemo: function (fn) {
      var keep = HW.P;
      HW.P = this.P;
      try { fn(); } finally { HW.P = keep; }
    },
    finish: function () {
      HW.saveSettings();
      this.leave();
      var cb = this.back; this.back = null;
      if (cb) cb();
    },
    leave: function () {
      var B = this.board;
      if (B) { B.crafts.forEach(function (c) { if (c.onRemove && !c.dead) { c.dead = true; c.onRemove(); } }); }
      if (B && B.megaSound) { HW.Audio.stop(B.megaSound); B.megaSound = null; }
    },
    tick: function () {
      var self = this;
      this.withDemo(function () { self.script(); self.board.update(); });
      this.st++;
    },
    script: function () {
      var B = this.board, t = this.st, P = this.P, c;
      switch (this.stage) {
        case 0:
          B.cursorX = Math.trunc(Math.sin(this.phase) * 100 + 320);
          this.phase += 0.03;
          this.click = (t % 150) < 75;
          if (Math.abs(B.cursorX - 320) < 4 && t > 500) { this.st = 399; this.phase = 0; B.cursorX = 320; this.click = false; this.stage = 1; }
          break;
        case 1:
          if (t === 400) {
            c = this.plane = new HW.CraftTypes[1](B);
            c.y = 140; c.dir = 0; c.vx = 2; c.x = -300 - Math.floor(c.w / 2); c.cd = 1e9;
            B.crafts.push(c);
          }
          if (t === 600) {
            c = this.copter = new HW.CraftTypes[7](B);
            c.y = 140; c.dir = 0; c.vx = 2; c.x = -300 - Math.floor(c.w / 2); c.cd = 1e9;
            B.crafts.push(c);
          }
          if ((c = this.plane)) {
            if (Math.abs(Math.trunc(c.x + 120)) < 2 && !B.projs.length && !c.dead)
              B.addProj(new HW.DumbBomb(B, Math.trunc(c.x), Math.trunc(c.y + Math.floor(c.h / 2)), c.vx, c.vy, c.dir));
            if (c.dead || c.x > 300 + c.w / 2) { if (!c.dead) c.remove(); this.plane = null; }
          }
          if ((c = this.copter)) {
            if (Math.abs(Math.trunc(c.x)) < 1.1 && !B.bullets.length && !c.dead) {
              B.enemyBullet(Math.trunc(c.x), Math.trunc(c.y + Math.floor(c.h / 2)), Math.atan2(B.tx - c.x, B.ty - c.y) + 1.5705, 0);
              c.muzzle = 5;
            }
            if (c.dead || c.x > 300 + c.w / 2) { if (!c.dead) c.remove(); this.copter = null; }
          }
          this.click = (t === 550 || t === 780);
          if (t >= 800 && t < 880) B.cursorX = Math.trunc(Math.sin((t - 800) * 0.039767) * 200 + 320);
          if (t > 1000) { this.st = 0; this.stage = 2; B.cursorX = 320; this.plane = this.copter = null; }
          break;
        case 2:
          if (t === 1) {
            c = this.pup = new HW.PupCopter(B, 0);
            c.y = 140; c.dir = 0; c.vx = 2; c.x = -520; c.dropX = 1e9;
            B.crafts.push(c);
          }
          if ((c = this.pup)) {
            if (c.x >= 0 && !c.dropped && !c.dead) { B.addPowerup(0, c.x, c.y, c.vy); c.dropped = true; }
            if (c.dead || c.x > 520) { if (!c.dead) c.remove(); this.pup = null; this.st = 0; this.stage = 3; }
          }
          if (B.popups.some(function (q) { return q.cycle; })) this.nukeIcon = 1;   // the NUKE ACQUIRED message
          break;
        case 3:
          if (t < 100 && t % 10 === 0) B.crafts.push(new HW.CraftTypes[1](B));
          if (t === 200) {
            if (!P.nukes) P.nukes = 1;
            B.nukeCooldown = 0;
            B.detonateNuke();
            if (this.nukeIcon) this.nukeIcon--;
          }
          if (t > 700) { this.st = 0; this.stage = 0; }
          break;
      }
      B.demoFire = this.click;
    },
    checkHit: function (x, y) { return x >= 14 && x <= 300 && y >= 440 && y <= 480; },
    press: function (x, y) { this.checkDown = this.checkHit(x, y); if (this.checkDown) HW.snd(17); },
    release: function (x, y) {
      if (this.checkDown && this.checkHit(x, y)) { HW.settings.noHelpAtStart = !HW.settings.noHelpAtStart; HW.snd(18); HW.saveSettings(); }
      this.checkDown = false;
    },
    draw: function (ctx) {
      var self = this, B = this.board, ox = HW.OX, s;
      this.frame(ctx, 'help');
      ctx.save(); ctx.translate(ox, 0);
      var r20 = F('RubberStampLET20');
      r20.draw(ctx, 'HOW TO PLAY', 320 - Math.floor(r20.width('HOW TO PLAY') / 2), 25, '#fff', 0);
      // the demo board inside the picture frame
      var lp = B.lerpBegin ? false : false;
      void lp;
      this.withDemo(function () {
        ctx.save(); ctx.beginPath(); ctx.rect(20, 40, 600, 360); ctx.clip(); ctx.translate(320, 0);
        B.drawDemoBack(ctx);
        ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.rect(20, 40, 600, 400); ctx.clip(); ctx.translate(320, 0);
        B.drawDemo(ctx);
        if (self.nukeIcon && (s = S('nukeicon'))) D.celC(ctx, s, -280, 70, 0, 0);
        ctx.restore();
      });
      // the cursor the tank follows
      ctx.save(); ctx.beginPath(); ctx.rect(20, 40, 600, 400); ctx.clip();
      if ((s = S('target' + (Math.floor(this.t / 4) % 8 + 1)))) ctx.drawImage(s.image, Math.round(B.cursorX) - 28, Math.round(B.cursorY) - 28);
      ctx.restore();
      // instructions (Outlined, centred in 120,50,400,100)
      var od = F('Outlined'), lines = od.wrap(HELP_TEXT[this.stage], 400), ls = 23;
      for (var i = 0; i < lines.length; i++) od.draw(ctx, lines[i], 320 - Math.floor(od.width(lines[i]) / 2), 50 + od.ascent + i * ls, '#fff', 0);
      this.drawControls(ctx);
      // "do not show" check box and OK
      var cb = S(HW.settings.noHelpAtStart ? 'checked' : 'unchecked');
      if (cb) ctx.drawImage(cb.image, 20, 448);
      od.draw(ctx, 'Do not show this screen at startup', 55, 467, '#fff', 0);
      this.drawButtons(ctx);
      ctx.restore();
    },
    /* where the original shows its mouse (540,350): the touch buttons light up as the demo fires / nukes,
       and a small stick bottom-left points from the tank at the cursor */
    drawControls: function (ctx) {
      var B = this.board, od = F('Outlined');
      var fireOn = this.click, nukeOn = this.stage === 3 && this.st > 180 && this.st < 240;
      function btn(x, y, r, on, c0, c1) {
        var g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
        g.addColorStop(0, on ? 'rgba(255,240,170,1)' : c0); g.addColorStop(1, on ? 'rgba(220,70,20,1)' : c1);
        ctx.beginPath(); ctx.arc(x, y, r * (on ? 0.94 : 1), 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,240,220,0.95)'; ctx.stroke();
      }
      ctx.save();
      // FIRE
      var fx = 556, fy = 362, fr = 30;
      btn(fx, fy, fr, fireOn, 'rgba(255,190,90,0.95)', 'rgba(150,40,10,0.9)');
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(fx, fy, 11, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx - 19, fy); ctx.lineTo(fx - 6, fy); ctx.moveTo(fx + 6, fy); ctx.lineTo(fx + 19, fy);
      ctx.moveTo(fx, fy - 19); ctx.lineTo(fx, fy - 6); ctx.moveTo(fx, fy + 6); ctx.lineTo(fx, fy + 19); ctx.stroke();
      // NUKE
      var nx = 500, ny = 380, nr = 20, ni = S('nukeicon');
      btn(nx, ny, nr, nukeOn, 'rgba(255,120,120,0.95)', 'rgba(110,0,0,0.9)');
      if (ni) ctx.drawImage(ni.image, nx - 12, ny - 12, 24, 24);
      if (fireOn) od.draw(ctx, '*tap*', fx - Math.floor(od.width('*tap*') / 2), fy - fr - 6, '#fff', 0);
      if (nukeOn) od.draw(ctx, '*tap*', nx - Math.floor(od.width('*tap*') / 2), ny - nr - 6, '#fff', 0);
      // the aiming stick
      var jx = 92, jy = 362, jr = 30;
      ctx.beginPath(); ctx.arc(jx, jy, jr + 4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(10,20,10,0.45)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(220,255,220,0.9)'; ctx.stroke();
      var dx = (B.cursorX - 320) - B.tx, dy = (B.cursorY) - (B.ty - 12), m = Math.sqrt(dx * dx + dy * dy) || 1;
      var k = Math.min(1, Math.max(0.35, Math.abs(dx) / 160));
      var kx = jx + dx / m * jr * 0.75 * (Math.abs(dx) < 40 ? 0.5 : 1), ky = jy + dy / m * jr * 0.75 * k;
      var g = ctx.createRadialGradient(kx - 4, ky - 5, 3, kx, ky, 16);
      g.addColorStop(0, 'rgba(240,255,240,1)'); g.addColorStop(1, 'rgba(90,140,90,1)');
      ctx.beginPath(); ctx.arc(kx, ky, 15, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.stroke();
      ctx.restore();
    }
  });

  /* ------------------------------------------------------------------ credits (0x41ec80 / 0x41dce0 / 0x41ddd0)
     data/credits.xml scrolled up a quarter pixel per step from y 510 over the salute picture, fading out toward the
     top and bottom (alpha 495 - 2|240 - y|); headers in the rubber-stamp font centred at 235, job titles in yellow at
     x 15 sharing the line with the first name at x 185. The black flag on the pole waves (a 16-point polygon,
     7 points along each edge, y += (sin(0.8k + p) + 1) * 2k, p -= 0.1 per step). A tap goes back. */
  HW.CreditsScene = defScene({
    setup: function () {
      this.back = HW.creditsReturn || function () { HW.setScene(new HW.MenuScene()); };
      HW.creditsReturn = null;
      this.scroll = 510; this.phase = 0; this.downIn = false;
    },
    tick: function () {
      this.phase -= 0.1; if (this.phase < 0) this.phase += 6.283185307179586;
      this.scroll -= 0.25;
    },
    press: function () { this.downIn = true; },
    release: function () {
      if (!this.downIn) return;
      this.downIn = false;
      HW.snd(18);
      var cb = this.back; this.back = null;
      if (cb) cb();
    },
    draw: function (ctx) {
      var k, c = HW.data.credits || [];
      this.frame(ctx, 'credits');
      ctx.save(); ctx.translate(HW.OX, 0);
      // the waving flag
      var top = [[88, 44]], bot = [[88, 148]];
      for (k = 1; k <= 7; k++) {
        var x = 110 + (k - 1) * 22, w = (Math.sin(k * 0.8 + this.phase) + 1) * 2 * k;
        top.push([x, Math.trunc(w + 44)]); bot.unshift([x, Math.trunc(w + 148)]);
      }
      var pts = top.concat(bot);
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
      ctx.closePath(); ctx.fill();
      // the scrolling credits
      var r20 = F('RubberStampLET20'), nf = F('Normal'), y = 0;
      for (var i = 0; i < c.length; i++) {
        var e = c[i], sy = y + this.scroll, a = Math.min(255, 495 - Math.abs(Math.trunc(240 - sy)) * 2) / 255;
        var vis = sy > 0 && sy < 480 && a > 0;
        if (e[0] === 'h') {
          if (vis) r20.draw(ctx, e[1], 235 - Math.floor(r20.width(e[1]) / 2), Math.round(sy), '#fff', 0, a);
          y += r20.lineSpacing * 2;
        } else if (e[0] === 't') {
          if (vis) nf.draw(ctx, e[1], 15, Math.round(sy), 'rgb(255,255,0)', 0, a);
        } else if (e[0] === 'l') {
          if (vis) nf.draw(ctx, e[1], 185, Math.round(sy), '#fff', 0, a);
          y += nf.lineSpacing;
        } else y += nf.lineSpacing;
      }
      if (y + this.scroll < 0) this.scroll = 510;
      ctx.restore();
    }
  });

  /* ------------------------------------------------------------------ heroes (0x4224e0 / 0x4222b0 / 0x422780)
     The nuclear blast picture with flames rising off the bottom edge (17 additive "fire" puffs every 10 steps,
     climbing 1-4 px per step while they cool from white through orange to nothing), a smoked table in the rubber
     stamp font, and the original default heroes. A fresh entry blinks. RESET puts the defaults back. */
  var HERO_DEFAULTS = {
    mission: [['Josh', 60000, 3], ['Don', 50000, 2], ['Ben', 40000, 2], ['Ace', 30000, 2], ['Tysen', 20000, 1],
      ['Chad', 15000, 1], ['Kathy', 10000, 1], ['Brian', 5000, 0], ['John', 2500, 0], ['Jason', 1000, 0]],
    survival: [['Hans', 30000], ['Shawn', 27000], ['Chad', 24000], ['Katrina', 21000], ['Walter', 18000], ['Jon', 15000],
      ['Isaac', 12000], ['Dave', 9000], ['Nick', 6000], ['Jeff', 3000]]
  };
  function defaultHeroes(mode) {
    return HERO_DEFAULTS[mode].map(function (d) {
      return mode === 'mission' ? { name: d[0], score: d[1], level: d[2], rank: d[2] } : { name: d[0], time: d[1] / 200 };
    });
  }
  // the tables start out with the original defaults (older saves without them are topped up)
  ['mission', 'survival'].forEach(function (m) {
    var l = HW.scores[m] || (HW.scores[m] = []);
    if (!HW.scores.seeded) {
      defaultHeroes(m).forEach(function (e) { l.push(e); });
      l.sort(function (a, b) { return m === 'mission' ? b.score - a.score : b.time - a.time; });
      if (l.length > 10) l.length = 10;
    }
  });
  if (!HW.scores.seeded) { HW.scores.seeded = true; HW.store.set('scores', HW.scores); }
  HW.HeroesScene = defScene({
    setup: function (mode, highlight) {
      var self = this, G = 'rgb(64,128,255)';
      this.mode = mode || 'mission';
      this.hiMode = this.mode; this.hi = highlight === undefined ? -1 : highlight;
      this.fires = [];
      this.dialog = null;
      this.buttons.push(tintBtn(new Button(50, 433, 140, 44, 'MISSION', function () { self.mode = 'mission'; }), G));
      this.buttons.push(tintBtn(new Button(200, 433, 150, 44, 'SURVIVAL', function () { self.mode = 'survival'; }), G));
      this.buttons.push(tintBtn(new Button(360, 433, 110, 44, 'RESET', function () { self.reset(); }), 'rgb(0,128,0)'));
      this.buttons.push(tintBtn(new Button(480, 433, 110, 44, 'MAIN', function () { HW.setScene(new HW.MenuScene()); }), 'rgb(128,64,32)'));
    },
    reset: function () {
      var self = this, m = this.mode;
      this.dialog = new ConfirmDialog('RESET SCORES?', 'Are you sure you want reset ' + (m === 'survival' ? 'SURVIVAL' : 'MISSION') +
        ' Mode high scores to their defaults?\n\nThis will reset all scores that have been recorded.', function (yes) {
        self.dialog = null;
        if (!yes) return;
        HW.scores[m] = defaultHeroes(m);
        HW.store.set('scores', HW.scores);
        if (self.hiMode === m) self.hi = 10;
      }, 360, 250);
    },
    tick: function () {
      if (this.dialog && this.dialog.update) this.dialog.update();
      if (this.t % 10 === 0) for (var x = 0; x <= 640; x += 40) this.fires.push({ x: x, y: 520, v: 1, vy: 1 + rnd(3000) * 0.001 });
      for (var i = this.fires.length - 1; i >= 0; i--) {
        var p = this.fires[i];
        p.y -= p.vy; p.v -= 0.015;
        if (p.v <= 0) this.fires.splice(i, 1);
      }
    },
    onPress: function (x, y) { if (this.dialog) this.dialog.onPress(x, y); else Scene.prototype.onPress.call(this, x, y); },
    onDrag: function (x, y) { if (this.dialog) this.dialog.onDrag(x, y); else Scene.prototype.onDrag.call(this, x, y); },
    onRelease: function (x, y) { if (this.dialog) this.dialog.onRelease(x, y); else Scene.prototype.onRelease.call(this, x, y); },
    draw: function (ctx) {
      var i, s, surv = this.mode === 'survival', list = HW.scores[this.mode] || [];
      this.frame(ctx, 'nukebg');
      ctx.save(); ctx.translate(HW.OX, 0);
      // flames (colour min(255, v*1024), min(255, v*512), min(255, v*256), additive)
      if ((s = S('fire'))) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (i = 0; i < this.fires.length; i++) {
          var p = this.fires[i], q = Math.round(p.v * 32) / 32;
          var col = 'rgb(' + Math.min(255, Math.round(q * 1024)) + ',' + Math.min(255, Math.round(q * 512)) + ',' + Math.min(255, Math.round(q * 256)) + ')';
          ctx.drawImage(D.mulTint(s, col).image, Math.round(p.x) - 50, Math.round(p.y) - 50);
        }
        ctx.restore();
      }
      // the table
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(50, 50, 540, 380); ctx.fillRect(50, 50, 540, 20);
      ctx.fillStyle = '#000';
      ctx.fillRect(50, 50, 541, 1); ctx.fillRect(50, 430, 541, 1); ctx.fillRect(50, 50, 1, 381); ctx.fillRect(590, 50, 1, 381);
      ctx.fillRect(50, 70, 541, 1);
      if (surv) ctx.fillRect(440, 50, 1, 381);
      else { ctx.fillRect(310, 50, 1, 381); ctx.fillRect(460, 50, 1, 381); ctx.fillRect(530, 50, 1, 381); }
      var od = F('Outlined'), r20 = F('RubberStampLET20');
      var cl = function (f, t, cx, y) { f.draw(ctx, t, cx - Math.floor(f.width(t) / 2), y, '#fff', 0); };
      if (surv) { cl(od, 'PLAYER NAME', 240, 67); cl(od, 'TIME', 515, 67); cl(r20, 'TOP 10 HEROES (SURVIVAL)', 320, 35); }
      else { cl(od, 'PLAYER NAME', 180, 67); cl(od, 'SCORE', 390, 67); cl(od, 'LVL', 498, 67); cl(od, 'RANK', 560, 67); cl(r20, 'TOP 10 HEROES (MISSION)', 310, 35); }
      var tx = surv ? 0 : -10, ins = S('smallinsignia');
      for (i = 0; i < 10 && i < list.length; i++) {
        var e = list[i], y = 100 + 35 * i, a;
        a = (i === this.hi && this.mode === this.hiMode) ? Math.round((Math.cos((this.t % 40) * 0.15708) + 1) * 127) / 255 : 1;
        if (a <= 0) continue;
        r20.draw(ctx, String(e.name || '').toUpperCase(), 70 + tx, y, '#fff', 0, a);
        if (surv) {
          var tm = HW.fmtClock ? HW.fmtClock(Math.round((e.time || 0) * 200)) : HW.fmtTime(e.time);
          r20.draw(ctx, tm, 580 - r20.width(tm), y, '#fff', 0, a);
        } else {
          var sc = String(e.score || 0), lv = (e.level || 0) < 19 ? String((e.level || 0) + 1) : 'WIN';
          r20.draw(ctx, sc, 460 + tx - r20.width(sc), y, '#fff', 0, a);
          r20.draw(ctx, lv, 320 + 185 + tx - Math.floor(r20.width(lv) / 2), y, '#fff', 0, a);
          if ((e.rank || 0) > 0 && ins) {
            ctx.save(); ctx.globalAlpha = a; D.cel(ctx, ins, 558 + tx, y - 24, Math.min(19, e.rank) - 1, 0); ctx.restore();
          }
        }
      }
      this.drawButtons(ctx);
      ctx.restore();
      if (this.dialog) this.dialog.draw(ctx);
    }
  });
  HW.fmtTime = function (secs) {
    secs = Math.floor(secs);
    var h = Math.floor(secs / 3600), m = Math.floor(secs / 60) % 60, s = secs % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  };

  /* ------------------------------------------------------------------ debriefing (0x426e60 / 0x427460) */
  /* The debriefing is laid over the finished mission (the tank parked at the gas station keeps idling underneath):
     0x426e60 works out the bonuses, 0x426c80 reveals a line every 50 steps (100: total score, 150: enemies, 200: kill
     percentage, 250: friendly fire bonus, 300: survival bonus, 350: reinforcements, 400: destruction bonus) and counts
     the bonuses up into the total score with a beep, 0x427460 draws it in the rubber-stamp font with the rank panel. */
  var RANK_NAMES = ['PRIVATE FIRST CLASS', 'CORPORAL', 'SERGEANT', 'SERGEANT FIRST CLASS', 'MASTER SERGEANT', 'FIRST SERGEANT',
    'WARRANT OFFICER', 'CHIEF WARRANT OFFICER', 'SECOND LIEUTENANT', 'FIRST LIEUTENANT', 'CAPTAIN', 'MAJOR', 'LIEUTENANT COLONEL',
    'COLONEL', 'MAJOR GENERAL', 'LIEUTENANT GENERAL', 'GENERAL', 'GENERAL OF THE ARMY', 'ULTIMATE TANKER'];
  HW.RANK_NAMES = RANK_NAMES;
  HW.DebriefScene = defScene({
    setup: function (board) {
      var self = this, P = HW.P, m = P.mission, st = board.st;
      // 0x426e60 / 0x426b50: the victory song and the victory call come together with the debriefing (the call waits
      // for the native player to report that the song has really started, so the two are never apart)
      HW.music(4, function () { HW.snd(58); });
      HW.Input.showControls = false; HW.Input.reset();
      this.board = board;
      this.dark = 0; this.time = 0;
      this.pct = clamp(Math.trunc(st.kills * 100 / Math.max(1, st.spawned)), 0, 100);
      this.kills = st.kills;
      this.destr = this.pct >= 100 ? (m + 1) * 10000 : this.pct >= 95 ? (m + 1) * 5000 : this.pct >= 90 ? (m + 1) * 1000 : 0;
      this.destrShown = 0;
      this.ff = !st.friendlies ? (m + 1) * 5000 : 0; this.ffShown = 0;
      this.surv = P.lives === 2 ? (m + 1) * 5000 : 0; this.survShown = 0;
      this.reinf = Math.max(0, 2 - P.lives); this.reinfShown = 0;
      this.total = P.score;                       // counts up to the new score
      P.score += this.ff + this.surv + this.destr;
      this.rank = Math.min(18, m);
      P.rank = Math.max(P.rank || 0, m + 1);
      P.megaParts = board.megaParts;
      HW.advanceProfile();
      // the ADVANCE button (advancebtn: normal / over / down strips) at 495,420
      this.adv = { x: 495, y: 420, w: 135, h: 45, down: false };
      void self;
    },
    tick: function () {
      var b = this.board;
      if (b) { b.snapPrev(); b.update(); }
      if (this.dark < 128) this.dark += 4;
      if (this.time < 10000) this.time++;
      if (this.total > HW.P.score) this.total = HW.P.score;
      var t = this.time;
      if (t % 50 === 0 && t > 50 && t < (8 + (this.destr > 0 ? 1 : 0)) * 50) HW.snd(22);
      var step;
      if (t > 250 && this.ffShown < this.ff) {
        step = Math.trunc(this.ff / 150); this.ffShown = Math.min(this.ff, this.ffShown + step); this.total += step; HW.snd(52);
      }
      if (t > 300 && this.survShown < this.surv) {
        step = Math.trunc(this.surv / 150); this.survShown = Math.min(this.surv, this.survShown + step); this.total += step; HW.snd(52);
      }
      if ((t === 400 || t === 450) && this.reinfShown < this.reinf) { this.reinfShown++; HW.snd(53); }
      if (t > 400 && this.destrShown < this.destr && this.destr > 0) {
        step = Math.trunc(this.destr / 150); this.destrShown = Math.min(this.destr, this.destrShown + step); this.total += step; HW.snd(52);
      }
    },
    onPress: function (x, y) { x = this.lx(x); if (this.hitAdv(x, y)) { this.adv.down = true; HW.snd(17); } },
    onDrag: function (x, y) { x = this.lx(x); if (this.adv.down && !this.hitAdv(x, y)) this.adv.down = false; },
    onRelease: function (x, y) {
      x = this.lx(x);
      var go = this.adv.down && this.hitAdv(x, y);
      this.adv.down = false;
      if (go) { HW.snd(18); HW.advanceMission(); }
    },
    hitAdv: function (x, y) { var a = this.adv; return x >= a.x - 8 && x <= a.x + a.w + 8 && y >= a.y - 8 && y <= a.y + a.h + 8; },
    leave: function () { if (this.board && this.board.cleanup) this.board.cleanup(); },
    draw: function (ctx) {
      var B = this.board, ox = HW.OX;
      if (B) { var lp = B.lerpBegin(HW.alpha); try { B.draw(ctx); } finally { if (lp) B.lerpEnd(); } }
      else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, HW.W, 480); }
      // darken the game (the area left of the panel, all the way to the left edge on wide screens)
      ctx.fillStyle = 'rgba(0,0,0,' + (this.dark / 255) + ')'; ctx.fillRect(0, 0, ox + 480, 480);
      ctx.save(); ctx.translate(ox, 0);
      // the rank panel (it also covers the right margin of wide screens)
      ctx.fillStyle = 'rgba(128,128,128,' + Math.min(1, this.dark * 2 / 255) + ')'; ctx.fillRect(480, 0, 160 + ox, 480);
      ctx.fillStyle = '#000'; ctx.fillRect(479, 0, 3, 480);
      ctx.fillStyle = '#fff'; ctx.fillRect(480, 0, 1, 480);
      F('RubberStampLET42').draw(ctx, 'DEBRIEFING', 240, 100, '#fff', 1);
      var ins = S('largeinsignia');
      if (ins) D.celC(ctx, ins, 560, 200, this.rank, 0);
      var od = F('Outlined');
      od.draw(ctx, 'YOUR RANK', 560, 100, '#fff', 1);
      var rl = od.wrap(RANK_NAMES[this.rank] || '', 120);
      for (var i = 0; i < rl.length; i++) od.draw(ctx, rl[i], 560, 300 + od.ascent + i * od.lineSpacing, '#fff', 1);
      var r20 = F('RubberStampLET20'), t = this.time;
      var row = function (label, value, y) {
        r20.draw(ctx, label, 20, y, '#fff', 0);
        if (value !== null) r20.draw(ctx, value, 460 - r20.width(value), y, '#fff', 0);
      };
      if (t > 100) row('TOTAL SCORE:', String(this.total), 150);
      if (t > 150) row('ENEMIES DESTROYED:', String(this.kills), 195);
      if (t > 200) row('KILL PERCENTAGE:', this.pct + '%', 225);
      if (t > 250) row('FRIENDLY FIRE BONUS:', this.ff > 0 ? String(this.ffShown) : 'NONE', 255);
      if (t > 300) row('SURVIVAL BONUS:', this.surv > 0 ? String(this.survShown) : 'NONE', 285);
      if (t > 350) {
        if (this.reinf > 0) {
          row('REINFORCEMENTS:', null, 315);
          for (var k = 0; k < this.reinfShown; k++) D.img(ctx, S('reinforcement'), 430 - 35 * k, 295);
        } else row('REINFORCEMENTS:', 'NONE', 315);
      }
      if (this.destr > 0 && t > 400) {
        row(this.pct >= 100 ? 'TOTAL DESTRUCTION:' : this.pct >= 95 ? 'MASSIVE DESTRUCTION:' : 'MAJOR DESTRUCTION:', String(this.destrShown), 345);
      }
      // ADVANCE
      var ab = S('advancebtn'), a = this.adv;
      if (ab) ctx.drawImage(ab.image, a.down ? 270 : 0, 0, 135, 45, a.x, a.y, 135, 45);
      ctx.restore();
    }
  });

  /* ------------------------------------------------------------------ armory (0x40f190 / 0x40ee90 / 0x40f440)
     Weapon widgets (0x42ff80) sit at ((i/3)*440+10, (i%3)*100+15): icon, hover glow (+-12 per step), an additive
     glass bubble and the level digit; their +/- buttons (0x4300c0) light up additively while touched. Only the
     mission+2 first weapons are installed. Upgrading (or taking points back, down to level 0) lights that part of the
     tank in the dome for a moment (255, -2 per step). The monitor shows the touched weapon in the Computer font; the
     armory neon (armoryglow) shorts out now and then like the main menu's. GO! refuses while points remain. */
  var WDESC = [
    ['DEFENSE ORBS', 'These orbiting defensive spheres block all enemy ordinance, excluding laser weapons.\n\n', 'Next level :\n Additional Orb'],
    ['HOMING MISSILE', 'Zero in on evil with this deadly, aircraft-seeking weapon.\n\n', 'Next level :\n Faster firing rate'],
    ['LASER', 'Slice and dice your foes with flaming hot beams of destruction!\n\n', 'Next level :\n Increased power'],
    ['ROCKETS', 'Unsophisticated, indiscriminate, ugly, and these un-guided menaces always take it personally.\n\n', 'Next level :\n Extra rocket'],
    ['FLAK CANNON', 'Pulverizes any aircraft and arsenal that dare to venture near your crosshairs.\n\n', 'Next level :\n Increased radius & duration'],
    ['THUNDERSTRIKE', 'Powerful bolts of lightning leap from your tank, seeking enemy craft to devour.\n\n', 'Next level :\n Longer life & more power']
  ];
  var ARMORY_MSG = 'Select one of the available weapon systems to upgrade now!\n\nYour progress has been saved.';
  /* Widget::WriteCenteredLine: centred in the 640 frame, black shadow at (1,2) */
  function centeredLine(ctx, f, text, y, color) {
    var x = Math.floor((640 - f.width(text)) / 2);
    f.draw(ctx, text, x + 1, y + 2, '#000', 0);
    f.draw(ctx, text, x, y, color, 0);
  }
  /* Graphics::WriteWordWrapped (left justified): first baseline at top + ascent - ascentPadding */
  function wordWrapped(ctx, f, text, x, y, w, color) {
    var main = f.layers[f.layers.length - 1], b = y + f.ascent - (main.ascentPadding || 0), lines = f.wrap(text, w);
    for (var i = 0; i < lines.length; i++) f.draw(ctx, lines[i], x, b + i * f.lineSpacing, color, 0);
  }
  HW.ArmoryScene = defScene({
    setup: function () {
      var self = this, P = HW.P;
      HW.music(3);
      HW.Input.showControls = false;
      this.avail = Math.min(6, P.mission + 2);
      this.sel = -1;
      this.wglow = [0, 0, 0, 0, 0, 0];               // widget hover glow (0x42fc30)
      this.bglow = [];                                 // +/- button glow and its ramp (0x4301c0)
      for (var i = 0; i < 6; i++) this.bglow.push([[0, 0], [0, 0]]);
      this.dome = [0, 0, 0, 0, 0, 0];                  // tank part glow in the dome (0x40ee90)
      this.touch = null;                               // {i, id: -1 icon / 0 plus / 1 minus}
      this.flick = 0; this.flickV = 192; this.flickSnd = null;
      this.dialog = null;
      this.buttons.push(tintBtn(new Button(510, 423, 110, 44, 'GO!', function () { self.go(); }), 'rgb(32,128,64)'));
      this.buttons.push(tintBtn(new Button(20, 423, 110, 44, 'MAIN', function () { HW.saveProfile(); HW.setScene(new HW.MenuScene()); }), 'rgb(128,64,32)'));
      HW.saveProfile();
    },
    widget: function (i) { var side = (i / 3) | 0, row = i % 3; return { side: side, x: side * 440 + 10, y: row * 100 + 15 }; },
    iconAt: function (i) { var w = this.widget(i); return [w.x + 95 - w.side * 10, w.y + 45]; },
    btnRect: function (i, id) { var w = this.widget(i); return [w.x - w.side * 123 + 132, w.y + 14 + id * 31, 39, 31]; },
    hitTest: function (x, y) {
      for (var i = 0; i < this.avail; i++) {
        for (var id = 0; id < 2; id++) {
          var r = this.btnRect(i, id);
          if (x >= r[0] - 8 && x <= r[0] + r[2] + 8 && y >= r[1] - (id ? 0 : 8) && y <= r[1] + r[3] + (id ? 8 : 0)) return { i: i, id: id };
        }
        var c = this.iconAt(i);
        if (Math.hypot(x - c[0], y - c[1]) <= 44) return { i: i, id: -1 };
      }
      return null;
    },
    go: function () {
      var self = this;
      if (HW.P.upgradePoints > 0) {
        this.dialog = new MessageDialog('NOT YET!', "You're going to need all the help you can get! You must use all of your upgrade points before you may continue.",
          300, 230, function () { self.dialog = null; });
        return;
      }
      HW.saveProfile();
      HW.setScene(new HW.MapScene());
    },
    hover: function (t) {
      // entering a weapon (icon or its buttons) selects it for the monitor and beeps (0x42fc90 / 0x42fd40)
      if (t && (!this.touch || this.touch.i !== t.i)) {
        this.sel = t.i;
        HW.snd(49, (this.widget(t.i).side * 2 - 1) * (HW.W / 4));
      }
      // the weapon's ball works as its + button on a touch screen, so it lights the + glow too
      if (this.touch) this.bglow[this.touch.i][Math.max(0, this.touch.id)][1] = -12;
      if (t) { this.bglow[t.i][Math.max(0, t.id)][1] = 12; }
      this.touch = t;
    },
    onPress: function (x, y) {
      if (this.dialog) { this.dialog.onPress(x, y); return; }
      Scene.prototype.onPress.call(this, x, y);
      var t = this.hitTest(this.lx(x), y);
      this.hover(t);
      if (t) HW.snd(17, (this.widget(t.i).side * 2 - 1) * (HW.W / 4));
    },
    onDrag: function (x, y) {
      if (this.dialog) { this.dialog.onDrag(x, y); return; }
      Scene.prototype.onDrag.call(this, x, y);
      var t = this.hitTest(this.lx(x), y), o = this.touch;
      if (!t !== !o || (t && o && (t.i !== o.i || t.id !== o.id))) this.hover(t);
    },
    onRelease: function (x, y) {
      if (this.dialog) { this.dialog.onRelease(x, y); return; }
      Scene.prototype.onRelease.call(this, x, y);
      var t = this.hitTest(this.lx(x), y), o = this.touch;
      // + / - buttons, and a tap on the weapon's ball itself adds a level (+1) like its + button
      if (o && t && o.i === t.i && o.id === t.id) this.change(t.i, t.id < 0 ? 0 : t.id);
      this.hover(null);
    },
    /* 0x42feb0: + raises the level while points remain (max 3), - takes a point back (down to 0) */
    change: function (i, id) {
      var P = HW.P, pan = (this.widget(i).side * 2 - 1) * (HW.W / 4);
      HW.snd(18, pan);
      if (id === 0) {
        if (P.weapons[i] >= 3 || P.upgradePoints <= 0) { HW.snd(21, pan); return; }
        P.weapons[i]++; P.upgradePoints--;
      } else {
        if (P.weapons[i] <= 0) { HW.snd(21, pan); return; }
        P.weapons[i]--; P.upgradePoints++;
      }
      this.dome[i] = 255;
    },
    tick: function () {
      var i;
      if (this.dialog && this.dialog.update) this.dialog.update();
      for (i = 0; i < 6; i++) {
        if (this.dome[i] > 0) this.dome[i] -= 2;
        var over = this.touch && this.touch.i === i;
        this.wglow[i] = over ? Math.min(255, this.wglow[i] + 12) : Math.max(0, this.wglow[i] - 12);
        for (var id = 0; id < 2; id++) {
          var g = this.bglow[i][id];
          g[0] += g[1];
          if (g[0] > 255) { g[0] = 255; g[1] = 0; }
          if (g[0] < 0) { g[0] = 0; g[1] = 0; }
        }
      }
      // the neon shorts out now and then, buzzing (0x423e50)
      if (rnd(200) === 0 && !this.flick) {
        this.flick = rnd(65) + 10;
        this.flickSnd = HW.Audio.play('shorting', { loop: true });
      }
      if (this.flick) {
        this.flick--;
        this.flickV = 128 + rnd(32);
        if (!this.flick && this.flickSnd) { HW.Audio.stop(this.flickSnd); this.flickSnd = null; }
      }
    },
    leave: function () { if (this.flickSnd) { HW.Audio.stop(this.flickSnd); this.flickSnd = null; } },
    draw: function (ctx) {
      var P = HW.P, i, s;
      this.frame(ctx, 'armory');
      ctx.save(); ctx.translate(HW.OX, 0);
      // the monitor
      var cp = F('Computer');
      if (this.sel >= 0) {
        var d = WDESC[this.sel], lv = P.weapons[this.sel];
        centeredLine(ctx, cp, d[0], 105, 'rgb(255,224,64)');
        wordWrapped(ctx, cp, d[1], 245, 110, 150, 'rgb(255,192,32)');
        if (lv >= 3) centeredLine(ctx, cp, 'M A X E D', 250, 'rgb(255,224,64)');
        else if (lv > 0) wordWrapped(ctx, cp, d[2], 245, 210, 150, 'rgb(255,192,32)');
      } else wordWrapped(ctx, cp, ARMORY_MSG, 245, 95, 150, 'rgb(255,192,32)');
      centeredLine(ctx, F('Normal'), 'POINTS REMAINING: ' + P.upgradePoints, 465, 'rgb(0,255,0)');
      // the armory neon
      if ((s = S('armoryglow'))) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (this.flick ? this.flickV : 192) / 255;
        ctx.drawImage(s.image, 0, 0); ctx.restore();
      }
      // the tank in the dome, its gun straight up; the part just changed glows
      this.drawTankPreview(ctx, 320, 400);
      for (i = 0; i < 6; i++) {
        if (this.dome[i] <= 0) continue;
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = this.dome[i] / 255;
        for (var k = 0; k < 4; k++) this.drawPart(ctx, i, 320, 400);
        ctx.restore();
      }
      // weapon widgets and their +/- buttons
      var up = S('upgrades'), ug = S('upgradeglow'), bub = S('upgradebubble'), lvl = S('upgradelvl'), ub = S('upgradebtns');
      for (i = 0; i < this.avail; i++) {
        var w = this.widget(i), c = this.iconAt(i);
        D.celC(ctx, up, c[0], c[1], i, 0);
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        if (this.wglow[i] > 0 && ug) { ctx.globalAlpha = this.wglow[i] / 255; D.celC(ctx, ug, c[0], c[1], 0, 0); ctx.globalAlpha = 1; }
        if (bub) D.celC(ctx, bub, c[0], c[1], 0, 0);
        if (lvl) D.celC(ctx, lvl, w.x + w.side * 120 + 30, w.y + 44, clamp(P.weapons[i], 0, 3), 0);
        for (var id = 0; id < 2; id++) {
          var g = this.bglow[i][id][0];
          if (g > 0 && ub) { var r = this.btnRect(i, id); ctx.globalAlpha = g / 255; D.cel(ctx, ub, r[0], r[1], w.side, id); }
        }
        ctx.restore();
      }
      this.drawButtons(ctx);
      ctx.restore();
      if (this.dialog) this.dialog.draw(ctx);
    },
    /* 0x401b80 with the gun at cel 10 (straight up) and the treads rolling ((count % 50) / 5) */
    drawTankPreview: function (ctx, x, y) {
      var P = HW.P, g = 10, W = P.weapons;
      D.celC(ctx, S('tankshadow'), x, y + 22, 0, 0);
      D.celC(ctx, S('tank'), x, y, Math.floor((this.t % 50) / 5), 0);
      D.cel(ctx, S('gun'), x - 40, y - 52, g, Math.min(4, P.spread));
      if (W[2] > 0) D.cel(ctx, S('lasers'), x - 40, y - 42, g, W[2] - 1);
      if (W[4] > 0) D.cel(ctx, S('flakguns'), x - 40, y - 52, g, W[4] - 1);
      if (W[1] > 0) D.celC(ctx, S('homing'), x, y - 2, W[1] - 1, 0);
      if (W[5] > 0) D.celC(ctx, S('staticstrike'), x, y + 4, 0, W[5] - 1);
      this.drawPart(ctx, 3, x, y);
      this.drawPart(ctx, 0, x, y);
    },
    /* 0x4011b0: one weapon's part on the tank */
    drawPart: function (ctx, i, x, y) {
      var W = HW.P.weapons, g = 10, n = W[i];
      if (n <= 0) return;
      switch (i) {
        case 0: {
          var a = (this.t % 360) * (4 - n) * 3;
          for (var k = 0; k < n; k++) {
            var aa = (a + k * (n === 2 ? 180 : 120)) * Math.PI / 180;
            D.celC(ctx, S('orb'), Math.round(x + Math.cos(aa) * 50), Math.round(y + Math.sin(aa) * 40), 0, 0);
          }
          break;
        }
        case 1: D.celC(ctx, S('homing'), x, y - 2, n - 1, 0); break;
        case 2: D.cel(ctx, S('lasers'), x - 40, y - 42, g, n - 1); break;
        case 3: {
          var an = g * 9 * Math.PI / 180, a2 = an + 1.5708, px = x - Math.cos(an) * 12, py = y - 12 - Math.sin(an) * 12;
          for (var j = 0; j < n; j++) {
            var off = Math.floor(90 / n) * j;
            if (n > 1) off += -22 - (n === 3 ? 8 : 0);
            D.celC(ctx, S('rocketpod'), Math.round(px - Math.cos(a2) * off), Math.round(py - Math.sin(a2) * off), g, 0);
          }
          break;
        }
        case 4: D.cel(ctx, S('flakguns'), x - 40, y - 52, g, n - 1); break;
        case 5: D.celC(ctx, S('staticstrike'), x, y + 4, 0, n - 1); break;
      }
    }
  });

  /* ------------------------------------------------------------------ campaign tour complete */
  /* ------------------------------------------------------------------ cinematics
     The original plays Flash movies (images/intro.swf before the title, middle.swf after mission 9, final.swf after
     mission 19); they were captured from the original and play here as videos in the classic 640x480 frame. A tap
     skips. The movies have no sound of their own - the music under them is the game's:
       intro  - captured with its music (song 5) in the video itself;
       middle - 0x41f070: FadeOutAll, then song 5 (AtomicTank from order 79) - the video is silent, the music is played;
       final  - 0x41f070 leaves the music alone: the victory song of the last debriefing goes on under it (silent video). */
  var BLANK_POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  /* The end of a movie (0x41efc0): the screen fills with the movie's background colour (alpha sin(t), t += 0.05 per
     update), the next screen is put up underneath at t = pi/2 and the colour fades off it again by t = pi - middle.swf
     ends in its green, so the green spreads over the whole screen and then clears off the armory. Drawn as a layer
     above everything (the video included). */
  HW.colorWipe = function (color, onMid) {
    var d = document.createElement('div'), t0 = performance.now(), mid = false;
    d.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:6;opacity:0;background:' + color;
    document.body.appendChild(d);
    (function step() {
      var ph = (performance.now() - t0) / 10 * 0.05;
      if (!mid && ph >= Math.PI / 2) { mid = true; if (onMid) onMid(); }
      if (ph >= Math.PI) { if (d.parentNode) d.parentNode.removeChild(d); return; }
      d.style.opacity = String(Math.max(0, Math.sin(ph)));
      requestAnimationFrame(step);
    })();
  };
  HW.CinemaScene = defScene({
    setup: function (name, onDone, opts) {
      var self = this;
      opts = opts || {};
      this.name = name; this.onDone = onDone; this.done = false; this.ready = false; this.endColor = opts.endColor || null;
      if (opts.music !== undefined) HW.music(opts.music);
      else if (!opts.keepMusic) HW.Audio.stopMusic();
      HW.Input.showControls = false;
      // the film is shown by the browser's own video layer on top of the (idle) game canvas: the phone decodes and
      // presents it in hardware, with its sound, instead of the game copying every frame into its canvas (which made
      // the long ending stutter on phones). It stays invisible until its first frame is up, so the WebView's grey
      // "play" placeholder never shows.
      var v = this.v = document.createElement('video');
      v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
      v.poster = BLANK_POSTER; v.controls = false; v.disablePictureInPicture = true;
      v.preload = 'auto'; v.muted = !!opts.silent;
      v.style.cssText = 'position:absolute;left:0;top:0;width:2px;height:2px;pointer-events:none;z-index:2;background:#000;object-fit:fill;visibility:hidden;';
      document.body.appendChild(v);
      this.place();
      v.volume = HW.clamp(HW.settings.music, 0, 1);
      v.onended = function () { self.finish(); };
      v.onerror = function () { self.finish(); };
      v.onplaying = function () { self.ready = true; v.style.visibility = 'visible'; };
      fetch('cine/' + name + '.mp4').then(function (r) { if (!r.ok) throw new Error('missing'); return r.arrayBuffer(); })
        .then(function (buf) {
          if (self.done) return;
          self.url = URL.createObjectURL(new Blob([buf], { type: 'video/mp4' }));
          v.src = self.url;
          var p = v.play();
          if (p && p.catch) p.catch(function () {
            // autoplay with sound refused (desktop browsers): try muted, else skip
            v.muted = true;
            v.play().catch(function () { self.finish(); });
          });
        }).catch(function () { self.finish(); });
    },
    finish: function (quiet) {
      if (this.done) return;
      this.done = true;
      var v = this.v;
      try { v.pause(); } catch (e) { }
      if (!this.endColor || quiet) { try { v.removeAttribute('src'); v.load(); } catch (e) { } if (v.parentNode) v.parentNode.removeChild(v); }
      if (this.url) URL.revokeObjectURL(this.url);
      var cb = this.onDone;
      this.onDone = null;
      if (cb && !quiet) {
        if (this.endColor) {
          // hold the last picture under the coloured wipe, then change screens behind it
          HW.colorWipe(this.endColor, function () {
            if (v.parentNode) v.parentNode.removeChild(v);
            cb();
          });
          return;
        }
        cb();
      }
    },
    /* the classic 640x480 picture area of the screen */
    place: function () {
      var v = this.v, s = HW.cssScale || 1;
      var key = HW.cssLeft + '|' + HW.cssTop + '|' + s + '|' + HW.OX;
      if (!v || key === this.placed) return;
      this.placed = key; this.drawn = 0;
      v.style.left = (HW.cssLeft + HW.OX * s) + 'px'; v.style.top = HW.cssTop + 'px';
      v.style.width = (640 * s) + 'px'; v.style.height = (480 * s) + 'px';
    },
    skipFrame: function () { return this.drawn > 2; },
    pauseVideo: function () { try { this.v.pause(); } catch (e) { } },
    resumeVideo: function () { if (!this.done) { var p = this.v.play(); if (p && p.catch) p.catch(function () { }); } },
    tick: function () {
      this.place();
      if (this.t > 100 * 120) this.finish();   // safety net
    },
    draw: function (ctx) {
      // the canvas under the film only needs to be black (drawn a few times, then the frame is left alone)
      this.drawn = (this.drawn || 0) + 1;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, HW.W, 480);
    },
    release: function () { if (this.t > 25) { HW.snd(18); this.finish(); } },
    leave: function () { this.finish(true); }
  });
  HW.playCinema = function (name, then, opts) { HW.setScene(new HW.CinemaScene(name, then, opts)); };

  /* ------------------------------------------------------------------ survival results */
  HW.SurvivalOverScene = defScene({
    setup: function (board) {
      var st = board.st, secs = Math.floor(Math.max(0, board.dist - board.survStart) / 200);
      this.secs = secs; this.st = st;
      this.pct = clamp(Math.round(st.kills * 100 / Math.max(1, st.spawned)), 0, 100);
      var name = (HW.campaignProfile && HW.campaignProfile.name) || 'TANKER';
      this.rank = addScore(HW.scores.survival, { name: name, time: secs }, 'time');
      this.best = HW.scores.survival[0] ? HW.scores.survival[0].time : secs;
      this.buttons.push(new Button(250, 420, 140, 44, 'MAIN', function () { HW.endSurvival(); }));
    },
    draw: function (ctx) {
      this.frame(ctx, 'nukebg');
      ctx.save(); ctx.translate(HW.OX, 0);
      panel(ctx, 80, 40, 480, 360, 0.8);
      F('RubberStampLET42').draw(ctx, 'GAME OVER', 320, 100, '#ff5050', 1);
      var n = F('Normal'), y = 150, rows = [['SURVIVAL TIME', HW.fmtTime(this.secs)], ['ENEMIES DESTROYED', this.st.kills], ['KILL PERCENTAGE', this.pct + '%'],
        ['FRIENDLIES DESTROYED', this.st.friendlies], ['YOUR BEST TIME', HW.fmtTime(this.best)]];
      for (var i = 0; i < rows.length; i++) { n.draw(ctx, rows[i][0], 120, y, '#cfc', 0); n.draw(ctx, String(rows[i][1]), 520, y, '#fff', 2); y += 36; }
      if (this.rank === 0) F('RubberStampLET20').draw(ctx, 'NEW HIGH SCORE!', 320, 360, '#ffff60', 1);
      this.drawButtons(ctx);
      ctx.restore();
    }
  });

  /* ------------------------------------------------------------------ hint dialogs (PLAY TIP, 0x423a30 / 0x4238f0) */
  var HINTS = {
    autofire: "You can auto-fire by holding down the FIRE button. Don't worry, you can't run out of ammo!",
    pup: "Don't shoot the white helicopters! They are your allies and will supply you with important powerups!",
    nuke: 'Press the NUKE button to detonate nukes! You can see how many you have by the red icons in the upper-left corner of the screen.',
    mega: 'Collect all four Megalaser parts to activate this amazingly destructive weapon!',
    atomic: 'Shoot down the atomic bombs before they hit the ground! Their blast destroys your tank wherever you are.'
  };
  function HintDialog(sc, key) {
    var self = this, X = 140, Y = 100, W = 360, H = 280;
    this.initScene(); this.key = key;
    this.disable = new Check(X + 40, Y + H - 100, 'Disable all hints', function () { return self.off; }, function (v) { self.off = v; });
    this.off = false;
    this.buttons.push(tintBtn(new Button(X + W / 2 - 60, Y + H - 60, 120, 30, 'OK', function () {
      if (self.off) { HW.settings.hints = false; HW.saveSettings(); }
      sc.dialog = null; HW.Input.showControls = true; HW.Audio.resumeAll();
    }), 'rgb(64,192,64)'));
  }
  HintDialog.prototype = Object.create(Dialog.prototype);
  HintDialog.prototype.press = function (x, y) { if (this.disable.hit(x, y)) { this.off = !this.off; HW.snd(17); } };
  HintDialog.prototype.draw = function (ctx) {
    var X = 140, Y = 100, W = 360, H = 280;
    ctx.save(); ctx.translate(HW.OX, 0);
    this.box(ctx, X, Y, W, H, true);
    var hb = dlgHeader(ctx, X, Y, W, 30, 'PLAY TIP');
    dlgLines(ctx, X, W, 30, hb + 36, HINTS[this.key], 'rgb(192,192,192)', 0);
    D.img(ctx, S(this.off ? 'checked' : 'unchecked'), X + 40, Y + H - 100);
    F('Normal').draw(ctx, 'Disable all hints', X + 75, Y + H - 80, 'rgb(192,192,192)', 0);
    this.drawButtons(ctx);
    ctx.restore();
  };
  HW.showHint = function (key) {
    var s = HW.settings;
    if (!s.hints || s.seenHints[key] || !HINTS[key]) return;
    var sc = HW.scene;
    if (!(sc instanceof HW.GameScene) || sc.dialog) return;
    s.seenHints[key] = true; HW.saveSettings();
    HW.Input.showControls = false; HW.Input.reset();
    HW.Audio.pauseAll();
    sc.dialog = new HintDialog(sc, key);
  };

  /* ------------------------------------------------------------------ level end (gas station) */
  /* After the boss's last explosion the station rolls in from the right and the tank drives up to the pumps; 500
     updates after the boss (0x41b690: dist == length + 500 - the tank is just pulling up) the debriefing opens, and
     with it come the victory song (PlayMusic(4, 73) in 0x426e60) and the victory call (sample 58, 0x426b50). */
  function LevelEnd(B) { this.B = B; this.done = false; }
  LevelEnd.prototype.update = function () {
    if (this.done) return;
    this.done = true;
    HW.onLevelComplete(this.B);
  };
  HW.LevelEnd = LevelEnd;

  /* ------------------------------------------------------------------ flow control */
  HW.startMission = function () {
    var P = HW.P;
    P.lives = 3;
    P.checkpoint = snapshot(P);
    HW.saveProfile();
    HW.setScene(new HW.GameScene(new HW.Board({ survival: false })));
  };
  HW.retryMission = function () {
    var P = HW.P, cp = P.checkpoint;
    if (cp) { HW.P = JSON.parse(JSON.stringify(cp)); HW.P.checkpoint = cp; }
    HW.P.lives = 3;
    HW.saveProfile();
    HW.setScene(new HW.MapScene());
  };
  HW.abandonGame = function (board) {
    if (board && board.survival) { HW.endSurvival(); return; }
    // restore the state from the start of the mission
    var cp = HW.P.checkpoint;
    if (cp) { HW.P = JSON.parse(JSON.stringify(cp)); HW.P.checkpoint = cp; }
    HW.saveProfile();
    HW.setScene(new HW.MenuScene());
  };
  /* game over: the GAME OVER dialog over the frozen game, with the mission or survival statistics */
  HW.onGameOver = function (board) {
    var sc = HW.scene, st = board.st, inf = { kills: st.kills, friendlies: st.friendlies || 0, rank: 10 };
    inf.pct = clamp(Math.round(st.kills * 100 / Math.max(1, st.spawned)), 0, 100);
    if (board.survival) {
      var units = Math.max(0, board.dist - board.survStart), secs = Math.floor(units / 200);
      var name = (HW.campaignProfile && HW.campaignProfile.name) || 'TANKER';
      var r = addScore(HW.scores.survival, { name: name, time: secs }, 'time');
      inf.rank = r >= 0 ? r : 10;
      inf.time = units;
      inf.best = (HW.scores.survival[0] ? HW.scores.survival[0].time : secs) * 200;
    } else {
      inf.score = HW.P.score;
      if (HW.P.score > 0) { var r2 = addScore(HW.scores.mission, { name: HW.P.name || 'TANKER', score: HW.P.score, level: HW.P.mission, rank: HW.P.mission }, 'score'); inf.rank = r2 >= 0 ? r2 : 10; }
    }
    if (sc instanceof HW.GameScene) {
      HW.Input.showControls = false; HW.Input.reset();
      sc.dialog = new GameOverDialog(board, inf);
    }
  };
  HW.restartSurvival = function () {
    var cp = HW.campaignProfile;
    HW.startSurvival();
    if (cp) HW.campaignProfile = cp;
  };
  HW.onLevelComplete = function (board) { HW.setScene(new HW.DebriefScene(board)); };
  /* after the debriefing: the next mission (0x427260) */
  HW.advanceProfile = function () {
    var P = HW.P;
    P.upgradePoints = (P.upgradePoints || 0) + 1;
  };
  HW.advanceMission = function () {
    var P = HW.P, m = P.mission;
    if (m >= 18) {
      // the campaign is won: the hero goes into the table as "WIN" with the nuclear insignia, the final movie and its
      // credits roll, then the heroes table comes up with the new entry blinking (as in the original)
      var hr = addScore(HW.scores.mission, { name: P.name || 'TANKER', score: P.score, level: 19, rank: 19 }, 'score');
      P.mission = 0; P.upgradePoints = 0; P.checkpoint = null;
      HW.clearProfile();
      HW.playCinema('final', function () { HW.setScene(new HW.HeroesScene('mission', hr)); }, { keepMusic: true, silent: true, endColor: 'rgb(153,51,51)' });
      return;
    }
    P.mission = m + 1;
    P.lives = 3;
    var rec = HW.userRec();
    if (P.mission > (rec.best || 0)) { rec.best = P.mission; HW.settings.bestMission = Math.max(HW.settings.bestMission || 0, P.mission); HW.saveSettings(); }
    HW.saveProfile();
    if (m === 8) HW.playCinema('middle', function () { HW.setScene(new HW.ArmoryScene()); }, { music: 5, silent: true, endColor: 'rgb(51,255,0)' });
    else HW.setScene(new HW.ArmoryScene());
  };
  HW.startSurvival = function () {
    HW.campaignProfile = HW.P || HW.loadProfile();
    HW.P = HW.newProfile((HW.campaignProfile && HW.campaignProfile.name) || 'TANKER');
    HW.P.survivalProfile = true;
    HW.P.lives = 1;
    HW.setScene(new HW.GameScene(new HW.Board({ survival: true })));
  };
  HW.endSurvival = function () {
    HW.P = HW.campaignProfile || HW.loadProfile();
    HW.campaignProfile = null;
    HW.setScene(new HW.MenuScene());
  };
  HW.quitApp = function () {
    var sc = HW.scene;
    HW.saveProfile();
    if (window.HWNative && HWNative.exitApp) HWNative.exitApp();
    else if (sc) sc.dialog = null;
  };
  /* Android back button */
  HW.onBack = function () {
    var sc = HW.scene;
    if (sc instanceof HW.CinemaScene) { sc.finish(); return; }
    if (sc instanceof HW.GameScene) { if (!sc.dialog) sc.pause(); else if (sc.dialog instanceof PauseDialog) sc.dialog.onClose(); return; }
    // an open box: OK / NO / CANCEL (the name box needs a name)
    if (sc.dialog) {
      var d = sc.dialog;
      if (d instanceof NameDialog) return;
      if (d.buttons && d.buttons.length) { d.buttons[d.buttons.length - 1].cb(); return; }
      sc.dialog = null; return;
    }
    if (sc instanceof HW.MenuScene) { if (!sc.backdrop) sc.quit(); return; }
    if (sc instanceof HW.TitleScene) { HW.quitApp(); return; }
    if (sc instanceof HW.HelpScene) { sc.finish(); return; }
    if (sc instanceof HW.CreditsScene) { var cb = sc.back; sc.back = null; if (cb) cb(); return; }
    if (sc instanceof HW.DebriefScene) { HW.advanceMission(); return; }
    if (sc instanceof HW.ArmoryScene || sc instanceof HW.MapScene) HW.saveProfile();
    HW.setScene(new HW.MenuScene());
  };
  HW.onAppPause = function () {
    var sc = HW.scene;
    if (sc instanceof HW.CinemaScene) sc.pauseVideo();
    if (sc instanceof HW.GameScene && !sc.dialog) sc.pause();
    HW.Audio.pauseAll();
    HW.saveProfile();
  };
  HW.onAppResume = function () {
    var sc = HW.scene;
    if (sc instanceof HW.CinemaScene) sc.resumeVideo();
    if (!(sc instanceof HW.GameScene && sc.dialog)) HW.Audio.resumeAll();
  };
  document.addEventListener('visibilitychange', function () { if (document.hidden) HW.onAppPause(); else HW.onAppResume(); });
})();
