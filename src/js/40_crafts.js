/* Heavy Weapon mobile port - enemy aircraft / vehicles (re-implemented from the original game's craft classes) */
'use strict';
(function () {
  var D = HW.Draw, rnd = HW.rnd, clamp = HW.clamp;
  function S(n) { return HW.img[n]; }

  var DEF = {};
  HW.craftDef = function (name) {
    if (!DEF[name]) HW.data.craft.forEach(function (c) { DEF[c.name] = c; });
    return DEF[name];
  };

  /* ------------------------------------------------------------------ base craft (0x431550) */
  function Craft() {}
  HW.Craft = Craft;
  var C = Craft.prototype;
  C.init = function (B, name, sprName) {
    var def = HW.craftDef(name) || { points: 0, armor: 1 };
    this.B = B; this.name = name;
    this.spr = S(sprName || name.toLowerCase());
    this.w = this.spr ? this.spr.cw : 40; this.h = this.spr ? this.spr.ch : 40;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.frame = 0; this.dir = 0;
    this.flash = 0; this.armor = def.armor; this.maxArmor = def.armor; this.points = def.points;
    this.collidable = true; this.friendly = false; this.dead = false;
    this.cd = 0;
    B.st.spawned++;
  };
  /* choose the side to enter from, avoiding the friendly supply helicopter (0x431650) */
  C.chooseSide = function () {
    var B = this.B, pup = null;
    for (var i = 0; i < B.crafts.length; i++) if (B.crafts[i].friendly && !B.crafts[i].dead) { pup = B.crafts[i]; break; }
    if (!pup || Math.abs(pup.x) < 160) this.dir = rnd(2);
    else this.dir = pup.x < 0 ? 1 : 0;
  };
  C.enterX = function () { return this.dir ? (this.B.half + this.w / 2) : -(this.B.half + this.w / 2); };
  /* altitude inside the flight band 50..50+range (upper half only for some); with the battlefield zoom the band's top
     moves down by skyShift so nothing flies hidden behind the status bar (its bottom stays where it was) */
  C.airY = function (range, halfRange) {
    var sh = this.B.skyShift ? this.B.skyShift() : 0;
    range -= sh;
    var r = halfRange ? Math.floor((range - this.h) / 2) : range - this.h;
    return rnd(Math.max(1, r)) + Math.floor(this.h / 2) + 50 + sh;
  };
  /* standard flying entrance: random height, enter from a side with speed lo..lo+span */
  C.flyIn = function (range, lo, span, halfRange) {
    this.y = this.airY(range, halfRange);
    this.chooseSide();
    this.x = this.enterX();
    var v = rnd(Math.round(span * 100)) * 0.01 + lo;
    this.vx = this.dir ? -v : v;
  };
  C.baseUpdate = function () { this.flash -= 24; if (this.flash < 0) this.flash = 0; if (this.cd > 0) this.cd--; };
  C.update = function () { this.baseUpdate(); this.checkOff(); };
  C.offscreen = function () { var e = this.B.half + this.w / 2; return this.x < -e || this.x > e; };
  C.checkOff = function () { if (this.offscreen()) this.remove(); };
  C.remove = function () { if (this.dead) return; this.dead = true; if (this.onRemove) this.onRemove(); };
  C.move = function (f) { this.x += this.vx * f; this.y += this.vy * f; };
  C.inRange = function (r) { return this.x > -(this.B.half - (320 - r)) && this.x < this.B.half - (320 - r); };
  C.tankAlive = function () { return !this.B.deathTimer; };
  /* position in world units (a boss works in its own space and converts, see 60_bosses.js) */
  C.wx = function () { return this.x; };
  C.wy = function () { return this.y; };
  C.drawSpr = function (ctx, spr, x, y, col, row, flip) {
    if (!spr) return;
    D.celC(ctx, spr, Math.round(x), Math.round(y), col, row, flip ? D.FLIP : null);
    if (this.flash > 0) {
      var t = D.mulTint(spr, '#ff0000');
      ctx.save(); ctx.globalAlpha *= this.flash / 255;
      D.celC(ctx, t, Math.round(x), Math.round(y), col, row, flip ? D.FLIP : null);
      ctx.restore();
    }
  };
  C.draw = function (ctx) { this.drawSpr(ctx, this.spr, this.x, this.y, Math.floor(this.frame), 0, this.dir); };
  C.hitTest = function (spr, x, y, col, row, flip) {
    if (!this.spr) return false;
    return HW.collide(this.spr, this.x, this.y, Math.floor(this.frame), 0, !!this.dir, spr, x, y, col, row, flip);
  };
  C.damage = function (d) { this.armor -= d; this.flash = 255; };
  /* destroyed by the player (0x431330 + 0x431480 + score) */
  C.kill = function () {
    if (this.dead) return;
    this.dead = true;
    this.onDestroyed();
    if (this.onRemove) this.onRemove();
  };
  C.onDestroyed = function () { this.baseDestroyed(); this.explode(); this.B.addScore(this.points, this.x, this.y); };
  C.baseDestroyed = function () {
    var B = this.B;
    if (this.friendly) { B.st.friendlies++; return; }
    B.st.kills++;
    if (rnd(20) === 0 && (B.dist < B.length - 4000 || B.survival) && this.y <= 280 && Math.abs(this.x) < B.half &&
      !B.mega && !B.crateCooldown) {
      B.dropCrate(this.x, this.y);
      B.crateCooldown = 500;
    }
  };
  C.explode = function () {
    var s = Math.max(this.w, this.h) + 20;
    this.B.addExplosion(this.x, this.y, s, s, this.vx, this.vy, 0);
  };
  C.dropBomb = function (T) { this.B.addProj(new T(this.B, this.x, this.y + Math.floor(this.h / 2), this.vx, this.vy, this.dir)); };

  function def(name, proto, base) {
    var K = function (B, a, b, c) { this.init(B, name); if (this.setup) this.setup(a, b, c); };
    K.prototype = Object.create((base || Craft).prototype);
    for (var k in proto) K.prototype[k] = proto[k];
    K.prototype.constructor = K;
    return K;
  }
  HW.defCraft = def;

  var T = HW.CraftTypes = {};

  /* 1 PROPFIGHTER (0x434430 / 0x4345c0) */
  T[1] = def('PROPFIGHTER', {
    setup: function () { this.flyIn(230, 1, 2); },
    update: function () { this.baseUpdate(); this.frame += 0.4; if (this.frame >= 4) this.frame -= 4; this.checkOff(); }
  });
  /* 2 SMALLJET (0x434690 / 0x434810) */
  T[2] = def('SMALLJET', {
    setup: function () { this.flyIn(230, 1, 2); },
    update: function () {
      this.baseUpdate();
      if (this.inRange(300) && rnd(80) === 0 && !this.cd && this.tankAlive()) { this.dropBomb(HW.DumbBomb); this.cd = 200; }
      this.checkOff();
    }
  });
  /* 3 BOMBER (0x4324f0 / 0x432670) */
  T[3] = def('BOMBER', {
    setup: function () { this.flyIn(230, 1, 2); },
    update: function () {
      this.baseUpdate();
      if (this.inRange(300) && this.tankAlive() && rnd(40) === 0 && !this.cd) { this.dropBomb(HW.DumbBomb); this.cd = 100; }
      this.checkOff();
    }
  });
  /* 4 JETFIGHTER (0x433e90 / 0x434010): laser guided bombs */
  T[4] = def('JETFIGHTER', {
    setup: function () { this.flyIn(230, 2, 2); },
    update: function () {
      this.baseUpdate();
      if (this.inRange(300) && this.tankAlive() && rnd(40) === 0 && !this.cd) { this.dropBomb(HW.LGB); this.cd = 150; }
      this.checkOff();
    }
  });

  /* ground vehicles block a 95px lane at their screen edge (0x435650 / 0x435790) */
  var Ground = {
    groundSetup: function (y) {
      var B = this.B;
      this.y = y;
      if (B.tx >= 0) { this.dir = 0; this.vx = 1; this.x = -(B.half + this.w / 2); B.laneLeft = true; }
      else { this.dir = 1; this.vx = -1; this.x = B.half + this.w / 2; B.laneRight = true; }
    },
    groundMove: function (acc, max) {
      var B = this.B;
      if (B.deathTimer || (B.dist >= B.length - 700 && !B.survival)) {
        this.vx += this.dir ? acc : -acc;
        this.vx = clamp(this.vx, -max, max);
      } else if (Math.abs(this.x) < B.half) this.vx *= 0.98;
      this.frame += this.vx / 3 + 0.3;
      if (this.frame >= 10) this.frame -= 10;
      if (this.frame < 0) this.frame += 9;
    },
    onRemove: function () { this.B.laneLeft = false; this.B.laneRight = false; }
  };

  /* 5 TRUCK: rocket propelled grenades */
  T[5] = def('TRUCK', {
    setup: function () { this.groundSetup(448); },
    groundSetup: Ground.groundSetup, groundMove: Ground.groundMove, onRemove: Ground.onRemove,
    update: function () {
      var B = this.B;
      this.baseUpdate();
      this.groundMove(0.02, 1);
      if (!this.cd && this.tankAlive() && Math.abs(this.x) < B.half && rnd(20) === 0) {
        this.cd = 100;
        B.addProj(new HW.RPG(B, this.x, this.y - 25, this.dir, (rnd(100) + 50) * 0.001, B.half / 320));
      }
      this.checkOff();
    },
    draw: function (ctx) {
      D.celC(ctx, S('enemytankshadow'), Math.round(this.x), 465, 0, 0);
      Craft.prototype.draw.call(this, ctx);
    }
  });

  /* 6 BIGBOMBER (0x431730 / 0x4318c0): carpet bombing bursts */
  T[6] = def('BIGBOMBER', {
    setup: function () { this.flyIn(230, 1, 1.5); this.burst = 0; this.gap = 0; },
    update: function () {
      this.baseUpdate();
      if (this.gap > 0) this.gap--;
      if (this.inRange(300) && this.tankAlive() && rnd(20) === 0 && !this.cd) { this.gap = 0; this.burst = rnd(2) + 3; this.cd = 200; }
      if (this.inRange(300) && this.tankAlive() && this.burst && !this.gap) { this.dropBomb(HW.DumbBomb); this.gap = 20; this.burst--; }
      this.checkOff();
    }
  });

  /* 7 SMALLCOPTER (0x434c80 / 0x434e10): aimed energy shots */
  T[7] = def('SMALLCOPTER', {
    setup: function () { this.flyIn(180, 1, 1.5); this.muzzle = 0; },
    update: function () {
      var B = this.B;
      this.baseUpdate();
      this.frame += 0.4; if (this.frame >= 5) this.frame -= 5;
      if (this.muzzle) this.muzzle--;
      if (this.inRange(300) && rnd(20) === 0 && !this.cd && this.tankAlive()) {
        var a = Math.atan2(B.tx - this.x, B.ty - this.y) + 1.5705;
        B.enemyBullet(this.x, this.y + Math.floor(this.h / 2), a, 0);
        this.cd = 150; this.muzzle = 5;
      }
      this.checkOff();
    },
    draw: function (ctx) {
      Craft.prototype.draw.call(this, ctx);
      if (this.muzzle) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        D.celC(ctx, S('muzzleflash'), Math.round(this.x), Math.round(this.y + this.h / 2), this.muzzle - 1, 0);
        ctx.restore();
      }
    }
  });

  /* assault helicopters: tilt frame drives the motion, they dodge the player's bullets (0x4367d0 / 0x435ad0) */
  var Heli = {
    heliSetup: function (neutral) {
      this.y = this.airY(230);
      this.frame = neutral; this.vx = 0; this.vy = 0; this.rotor = 0;
      this.chooseSide(); this.x = this.enterX();
      this.newHome();
    },
    /* The original hovers every assault helicopter over the middle 200 px of its 640 px screen (x -100..100). On the
       wider phone screens that left them all queueing on the same spot, so each one picks its own patch of sky
       somewhere across the width (and moves to another every few seconds), always far enough in from the edges for
       the whole helicopter to stay on the screen. */
    newHome: function () {
      var B = this.B, lim = Math.max(0, B.half - 100 - this.w / 2 - 10);
      this.homeX = lim > 0 ? rnd(Math.round(lim * 2) + 1) - lim : 0;
      this.homeT = 500 + rnd(700);
    },
    heliUpdate: function (tilt, maxF, yAcc, fireCd, rotorFrames) {
      // the hover band 100..200 moves down with the aircraft band on a zoomed screen (KB-31 / KB-72 would otherwise
      // climb behind the status bar)
      var B = this.B, sh = B.skyShift ? B.skyShift() : 0, hx = this.homeX || 0;
      this.baseUpdate();
      this.rotor += 0.5; if (this.rotor >= rotorFrames) this.rotor -= rotorFrames;
      if (--this.homeT <= 0) this.newHome();
      if (!B.deathTimer && (B.dist < B.length - 700 || B.survival)) {
        var n = 0, sx = 0, sy = 0;
        for (var i = 0; i < B.bullets.length; i++) {
          var b = B.bullets[i];
          if (b.enemy) continue;
          var dx = b.x - this.x, dy = b.y - this.y;
          if (Math.sqrt(dx * dx + dy * dy) < 200) { n++; sx += b.x; sy += b.y; }
        }
        if (n > 0 && this.x > hx - 160 && this.x < hx + 160 && this.y > 100 + sh && this.y < 200 + sh) {
          sx /= n; sy /= n;
          if (sx - 10 > this.x) this.frame -= tilt;
          if (sx + 10 < this.x) this.frame += tilt;
          if (sy > this.y) this.vy -= 0.02;
          if (sy < this.y) this.vy += 0.02;
        } else {
          if (this.x < hx - 100) this.frame += tilt;
          if (this.x > hx + 100) this.frame -= tilt;
        }
        // never out over the screen's edge once on it
        var edge = B.half - this.w / 2 - 4;
        if (this.x > -edge && this.x < edge) this.inside = true;
        if (this.inside) {
          if (this.x > edge - 20) this.frame -= tilt * 2;
          if (this.x < -edge + 20) this.frame += tilt * 2;
        }
      } else {
        if (this.x < 0) this.frame -= tilt; else this.frame += tilt;
      }
      this.frame = clamp(this.frame, 0, maxF);
      if (rnd(10) === 0) this.vy += rnd(3) * 0.05 - 0.05;
      if (this.y < 100 + sh) this.vy += yAcc;
      if (this.y > 200 + sh) this.vy -= yAcc;
      this.vy = clamp(this.vy, -0.5, 0.5);
      if (this.inRange(300) && rnd(30) === 0 && !this.cd) {
        B.addProj(new HW.Hellfire(B, this.x, this.y, this.vx, this.vy, 1));
        this.cd = fireCd;
      }
      this.checkOff();
    }
  };
  /* 8 MEDCOPTER */
  T[8] = def('MEDCOPTER', {
    setup: function () { this.heliSetup(3); },
    heliSetup: Heli.heliSetup, heliUpdate: Heli.heliUpdate, newHome: Heli.newHome,
    update: function () { this.heliUpdate(0.15, 6, 0.02, 125, 6); },
    move: function (f) { this.x += (this.frame - 3) * 0.5 * f; this.y += this.vy * f; },
    draw: function (ctx) {
      this.drawSpr(ctx, this.spr, this.x, this.y, Math.floor(this.frame), 0, false);
      this.drawSpr(ctx, S('medrotor'), this.x, this.y - 22, Math.floor(this.rotor), 0, false);
    },
    hitTest: function (spr, x, y, col, row, flip) {
      return HW.collide(this.spr, this.x, this.y, Math.floor(this.frame), 0, false, spr, x, y, col, row, flip);
    }
  });
  /* 9 BIGCOPTER */
  T[9] = def('BIGCOPTER', {
    setup: function () { this.heliSetup(4); },
    heliSetup: Heli.heliSetup, heliUpdate: Heli.heliUpdate, newHome: Heli.newHome,
    update: function () { this.heliUpdate(0.1, 8, 0.05, 75, 7); },
    move: function (f) { this.x += (this.frame - 4) / 3 * f; this.y += this.vy * f; },
    draw: function (ctx) {
      this.drawSpr(ctx, this.spr, this.x, this.y, Math.floor(this.frame), 0, false);
      var r = S('rotors');
      if (r) this.drawSpr(ctx, r, this.x - this.w / 2 + r.cw / 2, this.y - this.h / 2 + r.ch / 2, Math.floor(this.rotor), 0, false);
    },
    hitTest: function (spr, x, y, col, row, flip) {
      return HW.collide(this.spr, this.x, this.y, Math.floor(this.frame), 0, false, spr, x, y, col, row, flip);
    }
  });
  /* 10 DELTABOMBER: frag bombs */
  T[10] = def('DELTABOMBER', {
    setup: function () { this.flyIn(230, 2, 2); },
    update: function () {
      this.baseUpdate();
      if (this.inRange(300) && this.tankAlive() && rnd(40) === 0 && !this.cd) { this.dropBomb(HW.FragBomb); this.cd = 100; }
      this.checkOff();
    }
  });
  /* 11 DELTAJET: armored bombs */
  T[11] = def('DELTAJET', {
    setup: function () { this.flyIn(230, 2, 2); },
    update: function () {
      this.baseUpdate();
      if (this.inRange(300) && this.tankAlive() && rnd(40) === 0 && !this.cd) { this.dropBomb(HW.IronBomb); this.cd = 75; }
      this.checkOff();
    }
  });
  /* 13 SUPERBOMBER: steady stream of armored bombs */
  T[13] = def('SUPERBOMBER', {
    setup: function () { this.flyIn(230, 1, 1.5); },
    update: function () {
      this.baseUpdate();
      if (this.inRange(300) && !this.cd) { this.dropBomb(HW.IronBomb); this.cd = 50; }
      this.checkOff();
    }
  });
  /* 14 FATBOMBER: atomic bombs */
  T[14] = def('FATBOMBER', {
    setup: function () { this.flyIn(230, 1, 1, true); },
    update: function () {
      this.baseUpdate();
      if (this.inRange(300) && !this.cd) { this.dropBomb(HW.Fatboy); this.cd = 150; if (!this.B.survival) HW.showHint('atomic'); }
      this.checkOff();
    }
  });
  /* 15 BLIMP (0x4320c0 / 0x432250 / 0x435f50) */
  T[15] = def('BLIMP', {
    setup: function () { this.flyIn(230, 0.5, 1); this.prop = 0; this.cd2 = 0; },
    update: function () {
      this.baseUpdate();
      if (this.cd2 > 0) this.cd2--;
      this.prop += 0.4; if (this.prop >= 4) this.prop -= 4;
      if (this.inRange(300)) {
        if (rnd(40) === 0 && !this.cd) { this.dropBomb(HW.DumbBomb); this.cd = 50; }
        if (rnd(40) === 0 && !this.cd2) { this.dropBomb(HW.DumbBomb); this.cd2 = 50; }
      }
      this.checkOff();
    },
    draw: function (ctx) {
      Craft.prototype.draw.call(this, ctx);
      var p = S('blimpprop'), f = Math.floor(this.prop);
      this.drawSpr(ctx, p, this.x + 28, this.y + 21, f, 0, false);
      this.drawSpr(ctx, p, this.x - 88, this.y + 20, f, 0, false);
    },
    onDestroyed: function () {
      var B = this.B;
      Craft.prototype.onDestroyed.call(this);
      for (var i = 0; i < 10; i++) {
        var a = rnd(3141) * 0.001, s = rnd(15) * 0.1 + 1;
        B.bullets.push({ x: Math.cos(a) * 100 + this.x, y: this.y - Math.sin(a) * 30, vx: Math.cos(a) * s, vy: -Math.sin(a) * s,
          g: 0.05, enemy: true, spr: S('bombfrag'), frame: 0, row: 0 });
      }
    }
  });

  /* 16 SATELLITE (0x434950 / 0x436c80 / 0x434ac0): orbital laser */
  T[16] = def('SATELLITE', {
    setup: function () {
      this.y = this.airY(230); this.cd = 200; this.beam = 0; this.glow = 0; this.chat = 0; this.key = 0; this.sparkT = 0;
      this.chooseSide(); this.x = this.enterX();
    },
    update: function () {
      var B = this.B, sh = B.skyShift ? B.skyShift() : 0;
      this.baseUpdate();
      if (this.beam > 0) this.beam--;
      if (this.key) this.key--;
      if (this.chat) this.chat--;
      this.frame += 0.2; if (this.frame >= 10) this.frame -= 10;
      this.glow += 0.5; if (this.glow >= 10) this.glow -= 10;
      if (!B.deathTimer && (B.dist < B.length - 700 || B.survival)) {
        var n = 0, sx = 0, sy = 0;
        for (var i = 0; i < B.bullets.length; i++) {
          var b = B.bullets[i];
          if (b.enemy) continue;
          var dx = b.x - this.x, dy = b.y - this.y;
          if (Math.sqrt(dx * dx + dy * dy) < 150) { n++; sx += b.x; sy += b.y; }
        }
        if (n > 0 && this.x > -160 && this.x < 160 && this.y > 100 + sh && this.y < 200 + sh) {
          sx /= n; sy /= n;
          if (this.x < sx) this.vx -= 0.1;
          if (this.x > sx) this.vx += 0.1;
          if (sy > this.y) this.vy -= 0.03;
          if (sy < this.y) this.vy += 0.03;
        } else {
          if (this.x < B.tx) this.vx += 0.02;
          if (this.x > B.tx) this.vx -= 0.02;
        }
      } else {
        if (this.x < 0) this.vx -= 0.03; else this.vx += 0.03;
      }
      if (rnd(80) === 0) this.vy += (rnd(4) - 1.5) * 0.1;
      if (this.y < 100 + sh) this.vy += 0.1;
      if (this.y > 200 + sh) this.vy -= 0.1;
      this.vx = clamp(this.vx, -2, 2); this.vy = clamp(this.vy, -1, 1);
      if (this.inRange(300) && rnd(40) === 0 && !this.cd && !B.deathTimer) { this.cd = 400; this.beam = 200; HW.snd(26, this.x); }
      if (this.beam === 100) HW.snd(27, this.x);
      if (this.beam > 0 && this.beam < 100 && !B.deathTimer) {
        var P = HW.P;
        if (Math.abs(B.tx - this.x) < 50 && P.shield) { P.shield = 0; B.shieldInv = 9; HW.snd(14, B.tx); }
        if (Math.abs(B.tx - this.x) < 32) B.killTank();
      }
      if (rnd(100) === 0 && !this.chat) { HW.snd(28 + rnd(7), this.x); this.chat = 100; }
      else if (rnd(4) === 0 && !this.key) { var k = rnd(2); HW.snd(35 + k, this.x); this.key = k ? 22 : 12; }
      if (++this.sparkT > 3) {
        this.sparkT = 0;
        B.addParticles(S('spark'), this.x + 22, this.y + 28, this.vx + 2, this.vy + 1, 1, 1, 0, 0, 30, true, -1);
        B.addParticles(S('spark'), this.x - 22, this.y + 28, this.vx - 2, this.vy + 1, 1, 1, 0, 0, 30, true, -1);
      }
      this.checkOff();
    },
    draw: function (ctx) {
      Craft.prototype.draw.call(this, ctx);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      if (this.beam > 0 && this.beam < 100) {
        var cols = [[255, 255, 255], [223, 191, 223], [191, 127, 191], [159, 63, 159]];
        for (var k = 0; k < 4; k++) {
          ctx.strokeStyle = 'rgb(' + cols[k].join(',') + ')'; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(this.x + k + 0.5, this.y + 48); ctx.lineTo(this.x + k + 0.5, 460);
          ctx.moveTo(this.x - k + 0.5, this.y + 48); ctx.lineTo(this.x - k + 0.5, 460);
          ctx.stroke();
        }
        D.celC(ctx, S('laserburn'), Math.round(this.x), 460, Math.floor((HW.frame % 40) / 4), 0);
      }
      if (this.beam) D.celC(ctx, S('satlaser'), Math.round(this.x), Math.round(this.y + 47), Math.floor(this.glow), 0);
      ctx.restore();
    }
  });

  /* 17 STRAFER (0x435020 / 0x435190): dives in from above */
  T[17] = def('STRAFER', {
    setup: function () {
      var B = this.B;
      this.y = rnd(Math.max(1, 160 - this.h)) + this.h / 2 - 80;
      this.dir = rnd(2);
      this.spd = rnd(50) * 0.02 + 2;
      // its dive and its shots are stretched across the screen in proportion to the original's 640 px, so the two
      // balls come down where they did there (about the middle, then the far side) and never beyond the edge
      this.fx = B.half / 320;
      this.x = this.dir ? B.half + 140 * this.fx : -(B.half + 140 * this.fx);
      HW.snd(82, this.x);
    },
    update: function () {
      var B = this.B;
      this.baseUpdate();
      var a = 0.7854 - this.frame * 0.08726612678022899;
      this.vx = Math.cos(a) * this.spd * (this.dir ? -1 : 1) * this.fx;
      this.vy = Math.sin(a) * this.spd;
      if (this.y > 180) this.frame += 0.08;
      if (this.frame > 9) this.frame = 9;
      var lim = B.half - this.w / 2;
      if (this.x > -lim && this.x < lim && !this.cd && !B.deathTimer && this.frame < 6) {
        // the energy ball leaves from the black nose cone (about 40 px ahead of the middle along the flight path,
        // mirrored when it flies left) rather than from the middle of the fuselage
        var nx = this.x + (this.dir ? -1 : 1) * Math.cos(a) * 40, ny = this.y + Math.sin(a) * 40 + 3;
        var nb = B.bullets.length;
        B.enemyBullet(nx, ny, this.dir ? a : 3.142 - a, this.spd + 1.5);
        if (B.bullets.length > nb) B.bullets[B.bullets.length - 1].vx *= this.fx;
        this.cd = 75;
      }
      if (this.x < -(B.half + 140 * this.fx) || this.x > B.half + 140 * this.fx) this.remove();
    }
  });

  /* 18 ENEMYTANK (0x433960 / 0x436410) */
  T[18] = def('ENEMYTANK', {
    setup: function () { this.groundSetup(440); this.cd = 120; this.gun = 7; this.gunV = 0.03; },
    groundSetup: Ground.groundSetup, groundMove: Ground.groundMove, onRemove: Ground.onRemove,
    update: function () {
      var B = this.B;
      this.baseUpdate();
      this.groundMove(0.02, 1);
      this.gun += this.gunV;
      if (this.gun >= 8) { this.gunV = -0.04; this.gun = 7; }
      if (this.gun < 0) { this.gunV = 0.04; this.gun = 0; }
      if (!this.cd && !B.deathTimer && Math.abs(this.x) < B.half) {
        var a = this.gun * 0.1571;
        if (this.dir) a = 3.1416 - a;
        var ca = Math.cos(a), sa = Math.sin(a), s = this.gun * 0.5 + 2;
        var bx = (this.dir ? -18 : 18) + ca * 24 + this.x, by = this.y - 5 - sa * 24;
        // the lobs reach across the screen as they do across the original's 640 px (middle, quarter, far corner): on a
        // wider (or narrower) screen they carry further in proportion, never off its edge
        B.bullets.push({ x: bx, y: by, vx: s * ca * (B.half / 320), vy: -s * sa, g: 0.05, enemy: true, spr: S('bombfrag'), frame: 0, row: 0 });
        this.cd = 120;
        HW.snd(42, this.x);
        B.addMuzzle(bx, by, this.vx, this.vy);
      }
      this.checkOff();
    },
    draw: function (ctx) {
      D.celC(ctx, S('enemytankshadow'), Math.round(this.x), 465, 0, 0);
      this.drawSpr(ctx, S('enemygun'), this.x, 423, Math.floor(this.gun), this.dir, false);
      Craft.prototype.draw.call(this, ctx);
    }
  });

  /* 19 DOZER (0x433520 / 0x433660): pushes toward the tank, shooting pushes it back */
  T[19] = def('DOZER', {
    setup: function () {
      var B = this.B;
      this.y = 425;
      if (B.tx >= 0) { this.dir = 0; this.vx = 1; this.x = -(B.half + this.w / 2); }
      else { this.dir = 1; this.vx = -1; this.x = B.half + this.w / 2; }
      B.noDozer = true;
    },
    onRemove: function () { this.B.noDozer = false; },
    update: function () {
      var B = this.B;
      this.baseUpdate();
      if (!B.deathTimer && B.tankHit(this.spr, this.x, this.y, Math.floor(this.frame), 0, !!this.dir)) B.killTank();
      var sgn = this.dir * 2 - 1;
      if (B.deathTimer || (B.dist >= B.length - 700 && !B.survival)) {
        this.vx += this.dir ? 0.03 : -0.03;
        this.vx = clamp(this.vx, -5, 5);
      } else if (!this.flash) {
        this.vx -= sgn * 0.02;
        this.vx = clamp(this.vx, -1.5, 1.5);
      } else if (this.w / 2 + Math.abs(this.x) < B.half) {
        this.vx += sgn * 0.02;
        if (this.vx < -0.5 && !this.dir) this.vx = -0.5;
        if (this.vx > 0.5 && this.dir) this.vx = 0.5;
      }
      this.frame -= this.vx / 3 + 0.3;
      if (this.frame >= 10) this.frame -= 10;
      if (this.frame < 0) this.frame += 9;
      this.checkOff();
    },
    draw: function (ctx) {
      D.celC(ctx, S('dozershadow'), Math.round(this.x), 460, 0, 0);
      Craft.prototype.draw.call(this, ctx);
    }
  });

  /* 20 DEFLECTOR (0x432c80 / 0x436110): reflects the player's bullets */
  T[20] = def('DEFLECTOR', {
    setup: function () { this.flyIn(230, 2, 1, true); this.glowT = 0; this.charge = 60; },
    update: function () {
      var B = this.B;
      this.baseUpdate();
      if (this.charge > 0) {
        for (var i = 0; i < B.bullets.length; i++) {
          var b = B.bullets[i];
          if (b.enemy) continue;
          var dx = b.x - this.x, dy = b.y - this.y;
          if (Math.sqrt(dx * dx + dy * dy) <= 60) {
            b.enemy = true;
            var n = -Math.atan2(dx, dy) - 1.57, cn = Math.cos(n), sn = Math.sin(n);
            var dot = cn * b.vx + sn * b.vy;
            b.vx -= dot * cn * 1.5; b.vy -= dot * sn * 1.5;
            b.spr = S('bombfrag'); b.frame = 0; b.row = 0;
            this.glowT = 255;
            this.charge = Math.floor(this.charge - (b.dmg || 1));
            HW.snd(83, b.x);
            B.addMuzzle(b.x, b.y, 0, 0);
          }
        }
      }
      if (this.glowT) this.glowT = Math.max(0, this.glowT - 8);
      if (this.inRange(300) && !B.deathTimer && rnd(40) === 0 && !this.cd) {
        B.addProj(new HW.Hellfire(B, this.x, this.y, this.vx, this.vy, 1));
        this.cd = 75;
      }
      this.checkOff();
    },
    draw: function (ctx) {
      Craft.prototype.draw.call(this, ctx);
      if (this.charge > 0) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        D.celC(ctx, D.mulTint(S('deflectshield'), '#ff0080'), Math.round(this.x), Math.round(this.y), Math.floor(HW.frame / 4) % 4, 0);
        if (this.glowT) { ctx.globalAlpha = this.glowT / 255; D.celC(ctx, S('deflectshield'), Math.round(this.x), Math.round(this.y), 0, 0); }
        ctx.restore();
      }
    }
  });

  /* 21 CRUISE missile (0x4327b0 / 0x432930): dives onto the tank */
  T[21] = def('CRUISE', {
    setup: function () {
      this.y = this.airY(230, true);
      this.chooseSide();
      this.vx = this.dir ? -5 : 5;
      this.x = this.enterX();
      this.B.st.spawned--;
    },
    update: function () {
      var B = this.B, P = HW.P;
      this.baseUpdate();
      if (this.offscreen()) { this.remove(); return; }
      if (this.frame > 0) {
        this.frame += 0.2;
        if (this.frame > 7) this.frame = 7;
        this.vx = (1 - this.dir * 2) * (7 - this.frame) * 0.7142857142857143;
        this.vy = this.frame * 0.7142857142857143;
      }
      if (this.frame === 0 && Math.abs(this.x - B.tx) < 90) this.frame += 0.2;
      if (this.y > 470 - this.h / 2) {
        this.vy = 0;
        B.addCrater(this.x, 0);
        this.boom();
        return;
      }
      if (B.deathTimer) return;
      if ((P.shield || B.shieldInv > 0) && HW.collide(S('shield'), B.tx, B.ty + 2, 0, 0, false, this.spr, this.x, this.y, Math.floor(this.frame), 0, !!this.dir)) {
        if (B.shieldInv <= 0) {
          P.shield--; if (!P.shield) HW.snd(89, B.tx);
          B.shieldInv = 9; HW.snd(14, B.tx);
        }
        this.boom();
        return;
      }
      if (B.tankHit(this.spr, this.x, this.y, Math.floor(this.frame), 0, !!this.dir)) { B.killTank(); this.boom(); }
    },
    boom: function () { this.explode(); this.remove(); },
    // shot down: the usual kill (0x431330) and blast, but it was never counted as an enemy (its constructor takes the
    // spawn back), so the kill is taken back too (0x432c20) - otherwise the kill percentage goes past 100%
    onDestroyed: function () {
      Craft.prototype.onDestroyed.call(this);
      this.B.st.kills--;
    }
  });

  /* supply helicopter (0x437450 / 0x437940 / 0x437710 / 0x437c50) */
  HW.PupCopter = def('PUPCOPTER', {
    setup: function (type) {
      var B = this.B;
      this.spr = S('pupcopter'); this.w = this.spr.cw; this.h = this.spr.ch;
      this.type = type; this.dropped = false;
      var lv = Math.min(B.levelIdx(), 14);
      this.armor = this.maxArmor = (lv * 5 + 50) * 2;
      var sh = B.skyShift ? B.skyShift() : 0;
      this.y = rnd(Math.max(1, 180 - sh - this.h)) + Math.floor(this.h / 2) + 50 + sh;
      this.dir = rnd(2);
      this.points = -1500;
      this.friendly = true;
      this.dropX = rnd(200) - 100;
      this.rotor = 0; this.sign = 0; this.chatter = 0; this.hinted = false;
      B.pupCount++;
      B.st.spawned--;
      var e = B.half + 200;
      if (!this.dir) { this.x = -e; this.vx = rnd(50) * 0.01 + 2; }
      else { this.x = e; this.vx = -(rnd(50) * 0.01 + 2); }
      this.sound = HW.Audio.play('pupcopter', { loop: true, vol: 0 });
    },
    update: function () {
      var B = this.B;
      var hit = this.flash === 255;
      this.baseUpdate();
      this.rotor += 0.5; if (this.rotor >= 7) this.rotor -= 7;
      if (this.sign > 0) this.sign = Math.max(0, this.sign - 5);
      // (it keeps its course and still drops its load while the tank is being replaced: the power-up waits on the road)
      if (Math.abs(this.x - this.dropX) < 5 && !this.dropped) {
        B.addPowerup(this.type, this.x, this.y, this.vy);
        this.dropped = true;
      }
      if (this.sound) {
        var ax = Math.abs(this.x), v = ax > B.half ? Math.max(0, (B.half + 200 - ax) * 0.005) : 1;
        HW.Audio.setVolume(this.sound, v * (HW.Audio.vols.pupcopter || 0.7));
      }
      if (hit) {
        this.sign = 255;
        var lim = [0.75, 0.5, 0.25];
        if (this.chatter < 3 && this.armor < this.maxArmor * lim[this.chatter]) { HW.snd(37 + this.chatter, this.x); this.chatter++; }
        if (!this.hinted && !B.survival) HW.showHint('pup');
        this.hinted = true;
      }
      var e = B.half + 200;
      if (this.x < -e || this.x > e) this.remove();
    },
    onRemove: function () {
      this.B.pupCount--;
      if (this.sound) { HW.Audio.stop(this.sound); this.sound = null; }
    },
    onDestroyed: function () {
      var B = this.B;
      this.baseDestroyed();
      this.explode();
      if (!B.survival) B.addScore(-1000, this.x, this.y);
      else {
        B.popup('-0:30', this.x, this.y, false, '#f00');
        B.survStart += 6000;
        if (B.dist - B.survStart < 0) B.survStart = B.dist;
      }
      HW.snd(40, this.x);
    },
    draw: function (ctx) {
      this.drawSpr(ctx, this.spr, this.x, this.y, 0, 0, this.dir);
      var r = S('puprotor'), f = Math.floor(this.rotor);
      if (!this.dir) { this.drawSpr(ctx, r, this.x - 47, this.y - 24, f, 0, false); this.drawSpr(ctx, r, this.x + 27, this.y - 18, f, 0, false); }
      else { this.drawSpr(ctx, r, this.x - 27, this.y - 18, f, 0, false); this.drawSpr(ctx, r, this.x + 47, this.y - 24, f, 0, false); }
      if (this.sign) {
        ctx.save(); ctx.globalAlpha = this.sign / 255;
        D.celC(ctx, S('dontshoot'), Math.round(this.x), Math.round(this.y), 0, 0);
        ctx.restore();
      }
    },
    hitTest: function (spr, x, y, col, row, flip) {
      return HW.collide(this.spr, this.x, this.y, 0, 0, !!this.dir, spr, x, y, col, row, flip);
    }
  });
})();
