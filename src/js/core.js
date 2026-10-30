/* Heavy Weapon mobile port - core engine: canvas scaling, main loop, assets, drawing, fonts, audio */
'use strict';
var HW = window.HW = window.HW || {};

HW.H = 480;          // logical height (original game height)
HW.W = 640;          // logical width, grows with the screen aspect ratio
HW.OX = 0;           // x offset of the 640-wide "classic" area inside the logical width
HW.UPS = 100;        // original game updates 100 times per second
HW.time = 0;         // seconds since start
HW.frame = 0;        // update counter

/* ------------------------------------------------------------------ math */
HW.rand = Math.random;
HW.rnd = function (n) { return Math.floor(Math.random() * n); };
HW.rndf = function (a, b) { return a + Math.random() * (b - a); };
HW.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
HW.sign = function (v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); };
HW.dist = function (ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); };
HW.lerp = function (a, b, t) { return a + (b - a) * t; };

/* ------------------------------------------------------------------ canvas & scaling */
HW.initCanvas = function () {
  var c = document.getElementById('game');
  HW.canvas = c;
  HW.ctx = c.getContext('2d', { alpha: false });
  window.addEventListener('resize', HW.resize);
  window.addEventListener('orientationchange', function () { setTimeout(HW.resize, 200); });
  HW.resize();
};

HW.quality = 2; // max device pixel ratio used for the canvas backing store
/* performance level, chosen by HW.perf (below) when the device cannot keep up:
   0 = full: the frame is drawn into a logical-size buffer and scaled to a device-resolution canvas (crisp controls)
   1 = lean: the canvas itself is logical-size and the browser's compositor does the scaling (one full-screen pass
       less, much cheaper on phones whose WebView rasterises canvases in software)
   2 = lean + fewer particles */
HW.perfLevel = 0;

HW.resize = function () {
  var cw = window.innerWidth, ch = window.innerHeight;
  if (!cw || !ch) return;
  var dpr = Math.min(window.devicePixelRatio || 1, HW.quality);
  var W = Math.round(HW.H * cw / ch);
  if (W < 640) W = 640;
  if (W > 1140) W = 1140;
  var scale = Math.min(cw / W, ch / HW.H);
  var cssW = Math.round(W * scale), cssH = Math.round(HW.H * scale);
  var c = HW.canvas;
  c.style.width = cssW + 'px';
  c.style.height = cssH + 'px';
  c.style.left = Math.floor((cw - cssW) / 2) + 'px';
  c.style.top = Math.floor((ch - cssH) / 2) + 'px';
  HW.direct = HW.perfLevel >= 1;
  var bw = HW.direct ? W : Math.round(cssW * dpr), bh = HW.direct ? HW.H : Math.round(cssH * dpr);
  if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
  HW.W = W;
  HW.OX = Math.round((W - 640) / 2);
  HW.cssScale = scale;
  HW.pxScale = c.width / W;   // canvas pixels per logical pixel
  HW.cssLeft = Math.floor((cw - cssW) / 2);
  HW.cssTop = Math.floor((ch - cssH) / 2);
  HW.ctx.imageSmoothingEnabled = true;
  /* the game is drawn 1:1 into a logical-size buffer (like the original's 640x480 back buffer) and the finished
     frame is scaled to the screen in one blit: no seams between tiles, sprite cels or boss parts at odd scales.
     In the lean mode the visible canvas is that buffer. */
  if (HW.direct) { HW.buf = c; HW.bctx = HW.ctx; }
  else {
    if (!HW.buf || HW.buf === c) HW.buf = document.createElement('canvas');
    if (HW.buf.width !== W || HW.buf.height !== HW.H) { HW.buf.width = W; HW.buf.height = HW.H; }
    HW.bctx = HW.buf.getContext('2d', { alpha: false });
  }
  HW.bctx.imageSmoothingEnabled = true;
  if (HW.onResize) HW.onResize();
};

/* ------------------------------------------------------------------ battlefield zoom
   The original fills a 4:3 screen; on wider phones the extra width would make every unit look small, so the
   battlefield is magnified a little (anchored on the road, the sky's empty top band goes off screen) according to
   the screen's proportions: 4:3 tablets 1.0, 16:10 ~1.04, 16:9 ~1.09, 2:1 ~1.15, 21.6:9 ~1.2 (Options can change it). */
HW.zoomAuto = function () {
  var aspect = HW.W / HW.H;
  return Math.min(1.25, Math.max(1, 1 + (aspect - 1.45) * 0.28));
};
HW.getZoom = function () {
  var z = HW.settings && HW.settings.zoom;
  if (typeof z === 'number' && z >= 1 && z <= 1.4) return z;
  return HW.zoomAuto();
};

/* ------------------------------------------------------------------ main loop */
HW.scene = null;      // object with update(), draw(ctx), and optional input handlers
HW.setScene = function (s) {
  if (HW.scene && HW.scene.leave) HW.scene.leave();
  HW.scene = s;
  if (s && s.enter) s.enter();
};

HW.paused = false;
HW.speed = 1;  // debug time scale
HW.fpsCap = 60; // renders per second (90/120 Hz screens would otherwise draw every vsync and blow the frame budget)
HW.start = function () {
  var last = performance.now(), acc = 0, step = 1000 / HW.UPS, nextRender = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (HW.fpsCap) {
      // pace the frames to ~60/s: on 120 Hz every other vsync, on 90 Hz two out of three
      if (now < nextRender - 4) return;
      nextRender = Math.max(nextRender + 1000 / HW.fpsCap, now);
    }
    var dt = now - last; last = now;
    if (dt > 250) dt = 250;
    acc += dt * HW.speed;
    var n = 0, t0 = performance.now();
    while (acc >= step) {
      acc -= step;
      // at most 6 steps (60 ms of game time) per frame: after a hitch the game slows down for a moment instead of
      // spiralling into ever longer catch-up frames
      if (n < 6) {
        HW.frame++;
        HW.time += step / 1000;
        if (HW.scene && HW.scene.preStep) HW.scene.preStep();
        if (HW.Input) HW.Input.preUpdate();
        if (HW.scene && HW.scene.update) HW.scene.update();
        if (HW.Input) HW.Input.postUpdate();
        if (HW.Audio) HW.Audio.update();
      }
      n++;
    }
    if (n >= 6) acc = 0;
    // fraction of an update step since the last one: used to interpolate motion between the 100 Hz steps
    HW.alpha = HW.clamp(acc / step, 0, 1);
    HW.render();
    if (HW.perf) HW.perf.frame(now, performance.now() - t0);
  }
  requestAnimationFrame(loop);
};

/* ------------------------------------------------------------------ performance governor
   Watches the frame pace while a battle is on screen. When more than a fifth of the frames in a 3 s window come
   late (> 25 ms apart, i.e. a missed 60 Hz frame), the drawing is made cheaper one level (see HW.perfLevel) and the
   choice is remembered for the next start. */
HW.perf = {
  win: [], late: 0, lastT: 0, warm: 0,
  frame: function (now, work) {
    var sc = HW.scene, live = sc && sc.board && !sc.dialog && !sc.paused && !document.hidden && HW.perfLevel < 2;
    var gap = now - this.lastT; this.lastT = now;
    if (!live || gap > 400) { this.win.length = 0; this.late = 0; this.warm = 0; return; }
    if (++this.warm < 120) return;           // ignore the first 2 s of a battle (textures being uploaded)
    var isLate = gap > 25 ? 1 : 0;
    this.win.push(isLate); this.late += isLate;
    if (this.win.length > 180) this.late -= this.win.shift();
    if (this.win.length >= 180 && this.late > 36) {
      HW.setPerfLevel(HW.perfLevel + 1);
      this.win.length = 0; this.late = 0; this.warm = 0;
    }
  }
};
HW.setPerfLevel = function (lv) {
  lv = HW.clamp(lv | 0, 0, 2);
  if (lv === HW.perfLevel) return;
  HW.perfLevel = lv;
  HW.particleCap = lv >= 2 ? 300 : 600;
  if (HW.settings) { HW.settings.perfLevel = lv; if (HW.saveSettings) HW.saveSettings(); }
  HW.resize();
};
HW.particleCap = 600;

HW.alpha = 0;
HW.render = function () {
  var b = HW.bctx, ctx = HW.ctx;
  if (HW.scene && HW.scene.skipFrame && HW.scene.skipFrame()) return;   // nothing changes (a film is on top)
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.globalAlpha = 1;
  b.globalCompositeOperation = 'source-over';
  if (HW.scene && HW.scene.draw) HW.scene.draw(b);
  else { b.fillStyle = '#000'; b.fillRect(0, 0, HW.W, HW.H); }
  if (!HW.direct) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'copy';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(HW.buf, 0, 0, HW.W, HW.H, 0, 0, HW.canvas.width, HW.canvas.height);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (HW.Input && HW.Input.drawOverlay) {
    ctx.setTransform(HW.pxScale, 0, 0, HW.pxScale, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    HW.Input.drawOverlay(ctx);
  }
};

/* ------------------------------------------------------------------ assets */
HW.img = {};      // name -> sprite record
HW.sprites = {};  // name -> [cols, rows] layouts (filled from data)
HW.data = null;   // game data json

function Sprite(name, image, cols, rows) {
  this.name = name;
  this.image = image;
  this.w = image.width; this.h = image.height;
  this.cols = cols || 1; this.rows = rows || 1;
  this.cw = this.w / this.cols; this.ch = this.h / this.rows;
}
HW.Sprite = Sprite;

HW.loadImage = function (url) {
  return new Promise(function (resolve, reject) {
    var im = new Image();
    im.onload = function () { resolve(im); };
    im.onerror = function () { reject(new Error('image ' + url)); };
    im.src = url;
  });
};

HW.loadJSON = function (url) {
  return fetch(url).then(function (r) { if (!r.ok) throw new Error(url); return r.json(); });
};

HW.loadSprite = function (name) {
  var lay = HW.sprites[name] || [1, 1];
  return HW.loadImage('img/' + name + '.png').then(function (im) {
    var s = new Sprite(name, im, lay[0], lay[1]);
    HW.img[name] = s;
    return s;
  });
};

/* load a list of sprite names with progress callback, limited concurrency */
HW.loadSprites = function (names, onProgress) {
  var i = 0, done = 0, total = names.length;
  return new Promise(function (resolve) {
    if (!total) { resolve(); return; }
    function next() {
      if (i >= total) return;
      var n = names[i++];
      HW.loadSprite(n).catch(function (e) { console.warn('missing sprite', n, e); }).then(function () {
        done++;
        if (onProgress) onProgress(done / total);
        if (done === total) resolve(); else next();
      });
    }
    for (var k = 0; k < 6; k++) next();
  });
};

/* ------------------------------------------------------------------ drawing helpers */
var D = HW.Draw = {};

/* draw a cell, top-left at x,y */
D.cel = function (ctx, s, x, y, col, row) {
  if (!s) return;
  col = col | 0; row = row | 0;
  ctx.drawImage(s.image, col * s.cw, row * s.ch, s.cw, s.ch, x, y, s.cw, s.ch);
};
/* draw whole image top-left */
D.img = function (ctx, s, x, y) { if (s) ctx.drawImage(s.image, x, y); };

/* draw a cell centred at cx,cy. o: {flip, rot, alpha, add, sx, sy} */
D.FLIP = Object.freeze({ flip: true });   // shared option object for the common mirrored case (no allocation per draw)
D.celC = function (ctx, s, cx, cy, col, row, o) {
  if (!s) return;
  col = col | 0; row = row | 0;
  var w = s.cw, h = s.ch;
  if (!o) {
    ctx.drawImage(s.image, col * w, row * h, w, h, cx - w / 2, cy - h / 2, w, h);
    return;
  }
  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  if (o.add) ctx.globalCompositeOperation = 'lighter';
  ctx.translate(cx, cy);
  if (o.rot) ctx.rotate(o.rot);
  var sx = o.sx || o.s || 1, sy = o.sy || o.s || 1;
  if (o.flip) sx = -sx;
  if (o.vflip) sy = -sy;
  if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
  ctx.drawImage(s.image, col * w, row * h, w, h, -w / 2, -h / 2, w, h);
  ctx.restore();
};

/* white-flash / colour-tinted copies of sprites (cached) */
HW.tintCache = {};
D.tinted = function (s, color) {
  var key = s.name + '|' + color;
  var c = HW.tintCache[key];
  if (c) return c;
  var cv = document.createElement('canvas');
  cv.width = s.w; cv.height = s.h;
  var x = cv.getContext('2d');
  x.drawImage(s.image, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, s.w, s.h);
  c = new Sprite(key, cv, s.cols, s.rows);
  HW.tintCache[key] = c;
  return c;
};

/* multiplied tint (PopCap "colorize" with the given colour), cached: used for the red hit flash */
D.mulTint = function (s, color) {
  var key = s.name + '|mul|' + color;
  var c = HW.tintCache[key];
  if (c) return c;
  var cv = document.createElement('canvas');
  cv.width = s.w; cv.height = s.h;
  var x = cv.getContext('2d');
  x.drawImage(s.image, 0, 0);
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = color;
  x.fillRect(0, 0, s.w, s.h);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(s.image, 0, 0);
  c = new Sprite(key, cv, s.cols, s.rows);
  HW.tintCache[key] = c;
  return c;
};

D.rect = function (ctx, x, y, w, h, color, alpha) {
  ctx.save();
  if (alpha !== undefined) ctx.globalAlpha *= alpha;
  ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
  ctx.restore();
};

/* ------------------------------------------------------------------ PopCap image fonts */
function Font(def, images) {
  this.layers = def.layers.map(function (L) {
    var chars = {};
    Object.keys(L.chars).forEach(function (k) { chars[k] = L.chars[k]; });
    return {
      name: L.name, image: images[L.image], chars: chars, ascent: L.ascent,
      colorMult: L.colorMult, kerning: L.kerning || {}, lsOff: L.lineSpacingOffset || 0,
      ascentPadding: L.ascentPadding || 0
    };
  });
  var main = this.layers[this.layers.length - 1];
  this.ascent = main.ascent;
  var maxh = 0;
  Object.keys(main.chars).forEach(function (k) { var r = main.chars[k].r; if (r && r[3] > maxh) maxh = r[3]; });
  this.height = maxh;
  this.lineSpacing = maxh + main.lsOff;
  this.cache = {};
}
Font.prototype.charWidth = function (L, ch) {
  var c = L.chars[ch];
  if (c && c.w !== undefined) return c.w;
  if (ch === ' ') return L.chars[' '] ? L.chars[' '].w : 5;
  return 0;
};
Font.prototype.width = function (str) {
  var L = this.layers[this.layers.length - 1], w = 0, prev = null;
  for (var i = 0; i < str.length; i++) {
    var ch = str[i];
    if (!L.chars[ch] && ch !== ' ') {
      var up = ch.toUpperCase();
      if (L.chars[up]) ch = up;
    }
    w += this.charWidth(L, ch);
    if (prev !== null) { var k = L.kerning[prev + ch]; if (k) w += k; }
    prev = ch;
  }
  return w;
};
Font.prototype.tintedImage = function (L, color) {
  var mult = L.colorMult;
  var key = L.image.src + '|' + color + '|' + mult.join(',');
  var c = this.cache[key];
  if (c) return c;
  var im = L.image;
  var cv = document.createElement('canvas');
  cv.width = im.width; cv.height = im.height;
  var x = cv.getContext('2d');
  x.drawImage(im, 0, 0);
  var col = HW.parseColor(color);
  var r = Math.round(col[0] * mult[0]), g = Math.round(col[1] * mult[1]), b = Math.round(col[2] * mult[2]);
  if (!(r === 255 && g === 255 && b === 255)) {
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
    x.fillRect(0, 0, cv.width, cv.height);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(im, 0, 0);
  }
  this.cache[key] = cv;
  return cv;
};
/* draw string with baseline at y. align: 0 left, 1 centre, 2 right */
Font.prototype.draw = function (ctx, str, x, y, color, align, alpha) {
  str = String(str);
  if (align === 1) x -= this.width(str) / 2;
  else if (align === 2) x -= this.width(str);
  x = Math.round(x); y = Math.round(y);
  if (alpha !== undefined) { ctx.save(); ctx.globalAlpha *= alpha; }
  for (var li = 0; li < this.layers.length; li++) {
    var L = this.layers[li];
    var img = this.tintedImage(L, color || '#fff');
    var cx = x, prev = null;
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (!L.chars[ch] && ch !== ' ') { var up = ch.toUpperCase(); if (L.chars[up]) ch = up; }
      if (prev !== null) { var k = L.kerning[prev + ch]; if (k) cx += k; }
      var c = L.chars[ch];
      if (c && c.r && c.r[2] > 0) {
        var o = c.o || [0, 0];
        ctx.drawImage(img, c.r[0], c.r[1], c.r[2], c.r[3], cx + o[0], y - L.ascent + o[1], c.r[2], c.r[3]);
      }
      cx += this.charWidth(L, ch);
      prev = ch;
    }
  }
  if (alpha !== undefined) ctx.restore();
};
/* word-wrapped text inside width; returns height used */
Font.prototype.wrap = function (str, width) {
  var lines = [];
  String(str).split('\n').forEach(function (para) {
    var words = para.split(' '), line = '';
    for (var i = 0; i < words.length; i++) {
      var t = line ? line + ' ' + words[i] : words[i];
      if (this.width(t) > width && line) { lines.push(line); line = words[i]; }
      else line = t;
    }
    lines.push(line);
  }, this);
  return lines;
};
Font.prototype.drawWrapped = function (ctx, str, x, y, width, color, align, lineH) {
  var lines = this.wrap(str, width);
  lineH = lineH || this.lineSpacing;
  for (var i = 0; i < lines.length; i++) {
    var lx = align === 1 ? x + width / 2 : (align === 2 ? x + width : x);
    this.draw(ctx, lines[i], lx, y + this.ascent + i * lineH, color, align);
  }
  return lines.length * lineH;
};
HW.Font = Font;
HW.fonts = {};

HW.parseColor = function (c) {
  if (Array.isArray(c)) return c;
  if (c[0] === '#') {
    if (c.length === 4) return [parseInt(c[1] + c[1], 16), parseInt(c[2] + c[2], 16), parseInt(c[3] + c[3], 16)];
    return [parseInt(c.substr(1, 2), 16), parseInt(c.substr(3, 2), 16), parseInt(c.substr(5, 2), 16)];
  }
  var m = c.match(/\d+/g);
  return m ? [+m[0], +m[1], +m[2]] : [255, 255, 255];
};

HW.loadFonts = function (names) {
  var imgs = {};
  return Promise.all(names.map(function (n) { return HW.loadJSON('fonts/' + n + '.json').then(function (j) { return [n, j]; }); }))
    .then(function (defs) {
      var need = {};
      defs.forEach(function (d) { d[1].layers.forEach(function (L) { need[L.image] = 1; }); });
      return Promise.all(Object.keys(need).map(function (im) {
        return HW.loadImage('fonts/' + im + '.png').then(function (i) { imgs[im] = i; });
      })).then(function () {
        defs.forEach(function (d) { HW.fonts[d[0]] = new Font(d[1], imgs); });
      });
    });
};

/* ------------------------------------------------------------------ audio */
var A = HW.Audio = {
  ctx: null, master: null, sfxGain: null, buffers: {}, vols: {}, sfxVolume: 0.8, musicVolume: 0.7,
  playing: {}, unlocked: false, list: [], music: null, musicName: null
};
A.init = function (soundTable) {
  A.list = soundTable; // [[name, baseVolume], ...]
  soundTable.forEach(function (s) { A.vols[s[0]] = s[1]; });
};
A.unlock = function () {
  if (A.ctx) { if (A.ctx.state === 'suspended' || A.ctx.state === 'interrupted') A.ctx.resume(); return; }
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try { A.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { try { A.ctx = new AC(); } catch (e2) { return; } }
  A.master = A.ctx.createGain();
  A.master.connect(A.ctx.destination);
  A.sfxGain = A.ctx.createGain();
  A.sfxGain.gain.value = A.sfxVolume;
  // a soft clipper on the effects bus: in a big fight the stacked gunfire went past full scale and the hard digital
  // clipping crackled; this rounds the peaks off instead (and, unlike a compressor, never turns the other sounds down)
  if (A.ctx.createWaveShaper) {
    var ws = A.ctx.createWaveShaper(), n = 2048, curve = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = i * 2 / (n - 1) - 1, ax = Math.abs(x);
      curve[i] = ax < 0.6 ? x : (x < 0 ? -1 : 1) * (0.6 + 0.4 * Math.tanh((ax - 0.6) / 0.4));
    }
    ws.curve = curve; ws.oversample = '2x';
    A.sfxGain.connect(ws); ws.connect(A.master);
  } else A.sfxGain.connect(A.master);
  A.unlocked = true;
  A.loadAll();
};
A.loadAll = function () {
  A.list.forEach(function (s) {
    var name = s[0];
    fetch('sounds/' + name + '.ogg').then(function (r) { return r.arrayBuffer(); }).then(function (ab) {
      return new Promise(function (res, rej) { A.ctx.decodeAudioData(ab, res, rej); });
    }).then(function (buf) { A.buffers[name] = buf; }).catch(function (e) { console.warn('sound', name, e); });
  });
};
A.lastPlay = {};
/* play a sound effect. opts: {vol, pan (-1..1), rate, loop} returns handle */
/* Voices: a big fight asks for well over 100 sounds a second (bullet hits, small explosions, missiles), so - like the
   original's fixed set of sound channels - only so many play at once. The bookkeeping goes by each voice's own end
   time (not by 'ended' events, which a phone can lose, leaving a sample counted as playing for ever).
   - The sounds that tell the player something (pick-ups, the shield, the megalaser parts, voices, menu clicks, the big
     blasts, loops) always play: when the mixer is full the oldest ordinary sound makes room for them.
   - Ordinary sounds (gunfire, hits, small explosions) take the oldest ordinary voice when the mixer is full, and at
     most MAX_SAME copies of one sample sound together (the oldest copy gives way).
   - The same sample asked for twice in the same instant plays once (two copies on top of each other only double the
     loudness).
   - The ICBM siren is one voice: a salvo shares it. */
A.MAX_VOICES = 32; A.MAX_SAME = 3;
/* an ordinary sample is not started again within this many seconds (rapid fire otherwise rattles: a burst of the same
   short sample piling up at full rate) */
A.GAP = 0.03;
A.active = [];
A.KEEP = { nukeblast: 1, bossblast: 1, tankexplode: 1, bigexplode: 1, powerup: 1, upgrade: 1, shieldup: 1, shielddown: 1,
  sparking: 1, star: 1, megaup1: 1, megaup2: 1, megaup3: 1, megaup4: 1, deflect: 1, speedup: 1, gunpowerup: 1,
  denied: 1, buttondown: 1, buttonup: 1, stats: 1, statbeep: 1, mapover: 1, reinforcements: 1, megalaser_start: 1,
  megalaser_stop: 1, megalaser_out: 1, laserpowerup: 1, friendlydie: 1, orbhit: 1, alert: 1 };
A.SINGLE = { airraid: 1 };
A.prune = function (now) {
  var a = A.active, j = 0;
  for (var i = 0; i < a.length; i++) if (a[i].loop || a[i].end > now) a[j++] = a[i];
  a.length = j;
};
/* make room: the oldest matching voice is faded out over 8 ms (cutting a sound dead mid-wave clicks) */
A.steal = function (pred) {
  var a = A.active;
  for (var i = 0; i < a.length; i++) {
    if (a[i].loop || !pred(a[i])) continue;
    var v = a.splice(i, 1)[0], t = A.ctx.currentTime;
    try {
      v.gain.gain.cancelScheduledValues(t); v.gain.gain.setValueAtTime(v.gain.gain.value, t);
      v.gain.gain.linearRampToValueAtTime(0, t + 0.008);
      v.src.stop(t + 0.01);
    } catch (e) { try { v.src.stop(); } catch (e2) { } }
    return true;
  }
  return false;
};
A.play = function (name, opts) {
  if (!A.ctx || !A.buffers[name] || A.sfxVolume <= 0) return null;
  var now = A.ctx.currentTime, loop = !!(opts && opts.loop), force = opts && opts.force;
  var keep = force || loop || A.KEEP[name] || (name.charCodeAt(0) === 118 && name.charCodeAt(1) === 95);   // 'v_' voices
  A.prune(now);
  if (!loop) {
    if (A.lastPlay[name] !== undefined && now - A.lastPlay[name] < (keep ? 0.012 : A.GAP)) return null;
    var same = 0, i;
    for (i = 0; i < A.active.length; i++) if (A.active[i].name === name) same++;
    if (A.SINGLE[name] && same) return null;
    if (!keep && same >= A.MAX_SAME) A.steal(function (v) { return v.name === name; });
    if (A.active.length >= A.MAX_VOICES && !A.steal(function (v) { return !v.keep; }) && !keep) return null;
  }
  A.lastPlay[name] = now;
  var buf = A.buffers[name];
  var src = A.ctx.createBufferSource();
  src.buffer = buf;
  var g = A.ctx.createGain();
  var v = (A.vols[name] || 0.5) * (opts && opts.vol !== undefined ? opts.vol : 1);
  g.gain.value = v;
  var rate = opts && opts.rate ? opts.rate : 1;
  if (rate !== 1) src.playbackRate.value = rate;
  if (loop) src.loop = true;
  src.connect(g);
  var comp = 1, p = null;
  if (opts && opts.pan && A.ctx.createStereoPanner) {
    // DirectSound-style panning (the original's): the near side stays at full volume and only the far side is turned
    // down. The Web Audio panner is equal-power (both sides -3 dB in the middle), so its loss is made up here.
    var pan = HW.clamp(opts.pan, -1, 1), th = (pan + 1) * Math.PI / 4;
    comp = 1 / Math.max(Math.cos(th), Math.sin(th));
    g.gain.value = v * comp;
    p = A.ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p); p.connect(A.sfxGain);
  } else g.connect(A.sfxGain);
  var voice = { name: name, src: src, gain: g, keep: !!keep, loop: loop, end: now + buf.duration / rate + 0.05 };
  A.active.push(voice);
  src.onended = function () {
    var k = A.active.indexOf(voice);
    if (k >= 0) A.active.splice(k, 1);
    try { src.disconnect(); g.disconnect(); if (p) p.disconnect(); } catch (e) { }
  };
  src.start(0);
  return { src: src, gain: g, comp: comp };
};
A.stop = function (h) {
  if (h && h.src) {
    try { h.src.stop(); } catch (e) { }
    for (var i = 0; i < A.active.length; i++) if (A.active[i].src === h.src) { A.active.splice(i, 1); break; }
  }
};
A.setVolume = function (h, v) { if (h && h.gain) h.gain.gain.value = v * (h.comp || 1); };
A.setRate = function (h, r) { if (h && h.src) { try { h.src.playbackRate.value = r; } catch (e) { } } };
A.setSfxVolume = function (v) { A.sfxVolume = v; if (A.sfxGain) A.sfxGain.gain.value = v; };
A.update = function () { if (A.musicUpdate) A.musicUpdate(); };

/* ---- music: native Android player when available, otherwise HTML audio elements */
A.musicMeta = {};
A.setMusicVolume = function (v) {
  A.musicVolume = v;
  if (window.HWNative && HWNative.setMusicVolume) HWNative.setMusicVolume(v);
  if (A.music) A.music.forEach(function (el) { el.volume = v * (A.musicFade === undefined ? 1 : A.musicFade); });
};
A.playMusic = function (name, onStart) {
  if (A.musicName === name) { if (onStart) onStart(); return; }
  A.stopMusic();
  A.musicName = name;
  if (!name) { if (onStart) onStart(); return; }
  var meta = A.musicMeta[name] || {};
  if (window.HWNative && HWNative.playMusic) {
    // the native player reports back the moment the track has really started (HW.Audio.onMusicStart); whatever has
    // to go with it waits for that, with a short safety net in case the report never comes
    if (onStart) {
      var done = false, fire = function () { if (!done) { done = true; A.musicWait = null; onStart(); } };
      A.musicWait = { name: name, fire: fire };
      setTimeout(fire, 350);
    }
    HWNative.playMusic(name, (meta.intro ? 1 : 0) | (meta.noLoop ? 2 : 0), A.musicVolume);
    return;
  }
  var loop = new Audio('music/' + name + (meta.intro ? '_loop' : '') + '.ogg');
  loop.loop = !meta.noLoop; loop.volume = A.musicVolume;
  var els = [loop];
  if (meta.intro) {
    var intro = new Audio('music/' + name + '_intro.ogg');
    intro.volume = A.musicVolume;
    intro.addEventListener('ended', function () { if (A.musicName === name) loop.play().catch(function () { }); });
    els.unshift(intro);
    intro.play().catch(function () { A.pendingMusic = intro; });
  } else {
    loop.play().catch(function () { A.pendingMusic = loop; });
  }
  A.music = els;
  if (onStart) onStart();
};
A.onMusicStart = function (name) {
  var w = A.musicWait;
  if (w && w.name === name) w.fire();
};
/* get the opening piece of every track ready in the native player, so that a track starts the moment it is asked for */
A.preloadMusic = function () {
  if (!(window.HWNative && HWNative.preloadMusic)) return;
  var list = [];
  for (var n in A.musicMeta) list.push(n + ':' + (A.musicMeta[n].intro ? 1 : 0));
  try { HWNative.preloadMusic(list.join(',')); } catch (e) { }
};
/* the original's FadeOut: the current track dies away over ms (then the music is off) */
A.fadeOutMusic = function (ms) {
  if (!A.musicName) return;
  A.musicName = null; A.musicWait = null;
  if (window.HWNative && HWNative.fadeOutMusic) { HWNative.fadeOutMusic(ms | 0); return; }
  var els = A.music, t0 = Date.now(), v0 = A.musicVolume;
  A.music = null; A.pendingMusic = null;
  if (!els) return;
  var iv = setInterval(function () {
    var k = 1 - (Date.now() - t0) / ms;
    if (k <= 0) { clearInterval(iv); els.forEach(function (el) { el.pause(); el.src = ''; }); return; }
    els.forEach(function (el) { el.volume = Math.max(0, v0 * k); });
  }, 50);
};
A.stopMusic = function () {
  A.musicName = null; A.musicWait = null;
  if (window.HWNative && HWNative.stopMusic) HWNative.stopMusic();
  if (A.music) A.music.forEach(function (el) { el.pause(); el.src = ''; });
  A.music = null; A.pendingMusic = null;
};
A.resumePending = function () {
  if (A.pendingMusic) { var p = A.pendingMusic; A.pendingMusic = null; p.play().catch(function () { }); }
};
A.pauseAll = function () {
  if (A.ctx && A.ctx.state === 'running') A.ctx.suspend();
  if (window.HWNative && HWNative.pauseMusic) HWNative.pauseMusic();
  if (A.music) A.music.forEach(function (el) { if (!el.paused) { el.pause(); el._wasPlaying = true; } });
};
A.resumeAll = function () {
  if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume();
  if (window.HWNative && HWNative.resumeMusic) HWNative.resumeMusic();
  if (A.music) A.music.forEach(function (el) { if (el._wasPlaying) { el._wasPlaying = false; el.play().catch(function () { }); } });
};

/* ------------------------------------------------------------------ persistence */
HW.store = {
  get: function (k, def) {
    try { var v = localStorage.getItem('hw_' + k); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  },
  set: function (k, v) {
    try { localStorage.setItem('hw_' + k, JSON.stringify(v)); } catch (e) { }
  }
};
