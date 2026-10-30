/* Heavy Weapon mobile port - bombs, missiles and the player's secondary weapons (from the original projectile classes) */
'use strict';
(function () {
  var D = HW.Draw, rnd = HW.rnd, clamp = HW.clamp;
  var DEG = Math.PI / 180;
  function S(n) { return HW.img[n]; }

  /* ------------------------------------------------------------------ base projectile (0x447760) */
  function Proj() {}
  HW.Proj = Proj;
  var P = Proj.prototype;
  P.init = function (B, spr, x, y, vx, vy, flip) {
    this.B = B; this.spr = S(spr);
    this.x = x || 0; this.y = y || 0; this.vx = vx || 0; this.vy = vy || 0; this.flip = !!flip;
    this.frame = 0; this.hp = 0; this.points = 10; this.flash = 0;
    this.isEnemy = true; this.shootable = true; this.background = false; this.dead = false;
  };
  P.w = function () { return this.spr ? this.spr.cw : 20; };
  P.h = function () { return this.spr ? this.spr.ch : 20; };
  P.remove = function () { this.dead = true; };
  P.offX = function () { var e = this.B.half + this.w() / 2; return this.x < -e || this.x > e; };
  P.hitTest = function (spr, x, y, col, row, flip) {
    if (!this.spr) return false;
    return HW.collide(this.spr, this.x, this.y, Math.floor(this.frame), 0, this.flip, spr, x, y, col, row, flip);
  };
  P.groundBoom = function () {
    this.B.addExplosion(this.x, this.y, 70, 70, 0, -1, 0);
    this.B.addCrater(this.x, 0);
    this.remove();
  };
  /* shield check (0x447890): the shield absorbs the projectile */
  P.shieldCheck = function () {
    var B = this.B, PL = HW.P;
    this.flash -= 24; if (this.flash < 0) this.flash = 0;
    if (B.deathTimer) return false;
    if (!(PL.shield || B.shieldInv > 0)) return false;
    if (!HW.collide(S('shield'), B.tx, B.ty + 2, 0, 0, false, this.spr, this.x, this.y, Math.floor(this.frame), 0, this.flip)) return false;
    B.addExplosion(this.x, this.y, this.w() + 40, this.h() + 40, 0, -1, 0);
    if (B.shieldInv <= 0) {
      PL.shield--;
      if (!PL.shield) HW.snd(89, B.tx);
      B.shieldInv = 9;
      HW.snd(14, B.tx);
      if (window.HWNative && HWNative.vibrate) HWNative.vibrate(40);
    }
    this.remove();
    return true;
  };
  /* standard end-of-update checks shared by almost every enemy projectile */
  P.hits = function () {
    var B = this.B;
    if (this.offX()) { this.remove(); return; }
    if (this.y > 460) { this.groundBoom(); this.onGround && this.onGround(); return; }
    if (B.deathTimer) { this.shieldCheck(); return; }
    if (B.tankHit(this.spr, this.x, this.y, Math.floor(this.frame), 0, this.flip)) {
      B.addExplosion(this.x, this.y, 70, 70, 0, -1, 0);
      B.killTank();
      this.remove();
      return;
    }
    this.shieldCheck();
  };
  P.draw = function (ctx) {
    if (!this.spr) return;
    var x = Math.round(this.x), y = Math.round(this.y), f = Math.floor(this.frame);
    D.celC(ctx, this.spr, x, y, f, this.row || 0, this.flip ? D.FLIP : null);
    if (this.flash > 0) {
      ctx.save(); ctx.globalAlpha *= this.flash / 255;
      D.celC(ctx, D.mulTint(this.spr, '#ff0000'), x, y, f, this.row || 0, this.flip ? D.FLIP : null);
      ctx.restore();
    }
  };
  function defP(proto) {
    var K = function (B, a, b, c, d, e, f, g) { this.setup(B, a, b, c, d, e, f, g); };
    K.prototype = Object.create(Proj.prototype);
    for (var k in proto) K.prototype[k] = proto[k];
    return K;
  }
  HW.defProj = defP;

  /* falling bomb physics (0x449010) */
  function fall() {
    this.x += this.vx; this.y += this.vy;
    this.vx *= 0.995;
    if (this.vy < 2) this.vy += 0.05;
    if (this.frame < 9) this.frame += 0.1;
  }

  /* dumb bomb (0x4481c0) */
  HW.DumbBomb = defP({
    setup: function (B, x, y, vx, vy, flip) { this.init(B, 'dumbbomb', x, y, vx, vy, flip); HW.snd(8, x); },
    update: function () { fall.call(this); this.hits(); }
  });
  /* armored bomb (0x448f30) */
  HW.IronBomb = defP({
    setup: function (B, x, y, vx, vy, flip) { this.init(B, 'ironbomb', x, y, vx, vy, flip); this.hp = 10; this.points = 20; HW.snd(8, x); },
    update: function () { fall.call(this); this.hits(); }
  });
  /* frag bomb (0x448680 / 0x44b350): bursts into four fragments when it lands */
  HW.FragBomb = defP({
    setup: function (B, x, y, vx, vy, flip) { this.init(B, 'fragbomb', x, y, vx, vy, flip); this.points = 15; HW.snd(8, x); },
    update: function () { fall.call(this); this.hits(); },
    onGround: function () {
      var B = this.B;
      for (var a = 0.79; a <= 2.37; a += 0.52)
        B.bullets.push({ x: this.x, y: 460, vx: Math.cos(a) * 4, vy: -Math.sin(a) * 4, g: 0.05, enemy: true, spr: S('bombfrag'), frame: 0, row: 0 });
    }
  });
  /* atomic bomb (0x448290 / 0x448390 / 0x44a0e0): if it reaches the ground the tank is lost */
  HW.Fatboy = defP({
    setup: function (B, x, y, vx, vy, flip, vertical) {
      this.init(B, 'fatboy', x, y, vx, vy, flip);
      this.hp = 60; this.points = 200; this.boomT = 0.2; this.exploded = false;
      if (vertical) this.frame = 9;
      HW.snd(8, x);
    },
    update: function () {
      var B = this.B;
      if (this.exploded) {
        this.boomT += 0.2;
        if (this.boomT >= 6) { B.killTank(); this.remove(); }
        return;
      }
      fall.call(this);
      if (this.offX()) { this.remove(); return; }
      if (this.y > 460) { this.blast(); B.addCrater(this.x, 0); return; }
      if (B.deathTimer) { this.shieldCheck(); return; }
      var f = Math.floor(this.frame);
      if (B.tankHit(this.spr, this.x, this.y, f, 0, this.flip) ||
        HW.collide(S('shield'), B.tx, B.ty + 2, 0, 0, false, this.spr, this.x, this.y, f, 0, this.flip)) {
        this.blast(); B.killTank(); this.remove();
        return;
      }
      this.shieldCheck();
    },
    blast: function () {
      var B = this.B;
      this.exploded = true; this.shootable = false;
      B.nukeFlash = 128;
      B.addExplosion(this.x, this.y, 200, 200, 0, 0, 0.05);
      if (window.HWNative && HWNative.vibrate) HWNative.vibrate(200);
    },
    draw: function (ctx) {
      if (!this.exploded) { Proj.prototype.draw.call(this, ctx); return; }
      // 0x44a0e0: the atomic flash grows from 40x16 to 1200x480 while it fades (additive grey 512-84t, max 255)
      var g = S('fatboyflash');
      if (!g) return;
      var w = Math.trunc(g.w * this.boomT), h = Math.trunc(g.h * this.boomT);
      var c = Math.min(255, Math.trunc(512 - this.boomT * 84));
      if (c <= 0) return;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = c / 255;
      ctx.drawImage(g.image, 0, 0, g.w, g.h, Math.trunc(this.x - (w >> 1)), Math.trunc(this.y - (h >> 1)), w, h);
      ctx.restore();
    }
  });
  /* laser guided bomb (0x4491c0 / 0x4492b0) */
  HW.LGB = defP({
    setup: function (B, x, y, vx, vy, flip) {
      this.init(B, 'lgb', x, y, vx, vy, false);
      this.points = 15;
      this.ang = flip ? -90 : 90;
      this.frame = flip ? 0 : 20;
      HW.snd(8, x);
    },
    update: function () {
      var B = this.B;
      this.x += this.vx; this.y += this.vy;
      this.vx *= 0.95;
      if (this.vy < 1) this.vy += 0.05;
      if (this.ang >= 45) this.ang -= 2;
      if (this.ang <= -45) this.ang += 2;
      if (Math.abs(Math.trunc(this.ang)) < 45) {
        if (B.tx - 20 > this.x) this.ang += 2;
        if (B.tx + 20 < this.x) this.ang -= 2;
        var a = (this.ang - 90) * DEG;
        this.x += Math.cos(a) * 2;
        this.y -= Math.sin(a);
      }
      this.frame = (this.ang + 90) / 9;
      this.hits();
    }
  });
  /* homing air-to-surface missile used by helicopters (0x448b20 / 0x448c90) */
  HW.Hellfire = defP({
    setup: function (B, x, y, vx, vy, factor) {
      this.init(B, 'hellfire', 0, y, vx, vy, false);
      this.factor = factor || 1;
      this.points = 20;
      this.turn = (rnd(150) * 0.001 + 0.1) * this.factor;
      if (x < B.tx) { this.frame = 20; this.x = x + 20; } else { this.frame = 0; this.x = x - 20; }
      this.locked = false;
      HW.snd(11, x);
      B.addParticles(S('smoke'), this.x, this.y, vx, vy, 4, 0, -0.05, -0.5, 40, true, -1);
    },
    update: function () {
      var B = this.B;
      var cur = (this.frame - 10) * 17.143 * DEG, a = cur + 1.5705, sp = this.factor * 4;
      this.vx = Math.cos(a) * sp; this.vy = Math.sin(a) * sp;
      this.x -= this.vx; this.y += this.vy;
      B.addParticles(S('spark'), this.x + this.vx * 5, this.y - this.vy * 5, this.vx * 0.5, -this.vy * 0.5, 1, 0, 0, 0, 30, true, -1);
      if (!this.locked) {
        var want = Math.atan2(B.tx - this.x, B.ty - this.y);
        if (cur > want) { this.frame -= this.turn; if (cur - this.turn * 17.143 * DEG <= want) this.locked = true; }
        else { this.frame += this.turn; if (cur + this.turn * 17.143 * DEG >= want) this.locked = true; }
      }
      this.hits();
    }
  });
  /* the bust boss's homing missiles (0x448750 / 0x448890) */
  HW.HeadMissile = defP({
    setup: function (B, x, y, left) {
      this.init(B, 'headmissile', x, y, 0, 0, false);
      this.points = 50; this.hp = 20;
      this.turn = rnd(150) * 0.001 + 0.05;
      this.frame = left ? 3 : 17;
      this.locked = false;
      HW.snd(11, x);
      B.addParticles(S('smoke'), x, y, 0, 0, 4, 0, -0.05, -0.5, 40, true, -1);
    },
    update: function () {
      var B = this.B;
      var cur = (this.frame - 10) * 17.143 * DEG, a = cur + 1.5705;
      this.vx = Math.cos(a) * 3; this.vy = Math.sin(a) * 3;
      this.x -= this.vx; this.y += this.vy;
      B.addParticles(S('spark'), this.x + this.vx * 5, this.y - this.vy * 5, this.vx * 0.5, -this.vy * 0.5, 1, 0, 0, 0, 30, true, -1);
      if (!this.locked) {
        var want = Math.atan2(B.tx - this.x, B.ty - this.y);
        if (cur > want) { this.frame -= this.turn; if (cur - this.turn * 17.143 * DEG <= want) this.locked = true; }
        else { this.frame += this.turn; if (cur + this.turn * 17.143 * DEG >= want) this.locked = true; }
      }
      this.frame = clamp(this.frame, 0, 19.99);
      this.hits();
    }
  });
  /* rocket propelled grenade fired by trucks (0x449930 / 0x449a40) */
  HW.RPG = defP({
    setup: function (B, x, y, flip, rate, fx) {
      this.init(B, 'rpg', x, y, 0, 0, flip);
      this.points = 20; this.rate = rate; this.fx = fx || 1;   // fx: carries as far across the screen as on 640 px
      HW.snd(11, x);
      B.addParticles(S('smoke'), x, y, 0, 0, 4, 0, -0.05, -0.5, 40, true, -1);
    },
    update: function () {
      var B = this.B;
      this.frame += this.rate;
      if (this.frame > 9) this.frame = 9;
      var a = (30 - this.frame * 6.6) * DEG;
      this.vx = (this.flip ? Math.cos(a) * -3 : Math.cos(a) * 3) * this.fx;
      this.vy = Math.sin(a) * -3;
      this.x += this.vx; this.y += this.vy;
      B.addParticles(S('spark'), this.x - this.vx * 5, this.y - this.vy * 5, this.vx * 0.5, this.vy * 0.5, 1, 0, 0, 0, 30, true, -1);
      this.hits();
    }
  });
  /* meteor pulled down by the war blimp's tractor beam (0x449510 / 0x449630) */
  HW.Meteorite = defP({
    setup: function (B) {
      var x0 = rnd(Math.round(B.half * 2)) - B.half;
      var a = rnd(800) * 0.001 + 1.5701 - 0.4, d = rnd(1000) + 500, s = rnd(100) * 0.01 + 3;
      this.init(B, 'meteorite', Math.cos(a) * d + x0, 460 - Math.sin(a) * d, -Math.cos(a) * s, Math.sin(a) * s, false);
      this.shootable = false;
    },
    update: function () {
      var B = this.B;
      this.x += this.vx; this.y += this.vy;
      if (this.y >= 0 && this.y - this.vy < 0) HW.snd(74, this.x);
      // 0x449630: the head stays white (frame 0) and every third update drops a meteorite particle that burns down
      // through its own frames - white, yellow, orange, grey - while fading: the fiery orange tail of the original
      if (HW.frame % 3 === 0) B.addParticles(S('meteorite'), this.x, this.y, 0, 0, 1, 0, 0, 0, 60, true, -1);
      if (this.y < -60) { if (this.x < -B.half - 600 || this.x > B.half + 600) this.remove(); return; }
      this.hits();
    },
    offX: function () { var e = this.B.half + 15; return this.y > 0 && (this.x < -e || this.x > e); }
  });
  /* ICBM (0x431d20 / 0x431e30 / 0x432030): launched in the background, comes down on the tank */
  HW.BigMissile = defP({
    setup: function (B, x) {
      this.init(B, 'bigmissile', x, 460, 0, 0, false);
      var lv = Math.min(B.levelIdx(), 14);
      this.hp = Math.min(40, (lv + 1) * 7);
      this.points = 500;
      this.rising = true; this.background = true; this.shootable = false; this.abort = false;
      HW.snd(69, x, 1.3);   // the air-raid siren: one for the whole salvo (see HW.Audio.SINGLE), a little louder
    },
    update: function () {
      var B = this.B;
      if (B.deathTimer) this.abort = true;
      this.y += this.rising ? -1.5 : 3;
      // it turns over once it is out of sight above the top of the screen (above the zoomed view's top edge, not the
      // classic one: otherwise it would hang invisible for a second and a half on wide phones)
      if (this.rising && this.y < (480 - 480 / B.zoomK()) - this.h()) {
        this.rising = false; this.background = false; this.shootable = true;
        if (this.abort) { this.remove(); return; }
      }
      this.frame += 0.15; if (this.frame >= 10) this.frame -= 10;
      if (this.rising) { this.flash = Math.max(0, this.flash - 24); return; }
      if (this.y > 460) {
        B.addExplosion(this.x, this.y, this.w() + 40, this.h() + 40, 0, -1, 0);
        B.addCrater(this.x, 0);
        this.remove();
        return;
      }
      if (!B.deathTimer && B.tankHit(this.spr, this.x, this.y, Math.floor(this.frame), 0, false)) {
        B.addExplosion(this.x, this.y, this.w() + 40, this.h() + 40, 0, -1, 0);
        B.killTank(); this.remove(); return;
      }
      this.shieldCheck();
    },
    hitTest: function (spr, x, y, col, row, flip) {
      return HW.collide(this.spr, this.x, this.y, Math.floor(this.frame), 0, false, spr, x, y, col, row, flip);
    },
    draw: function (ctx) {
      this.row = this.rising ? 1 : 0;
      Proj.prototype.draw.call(this, ctx);
    }
  });
  /* the ape's bursting rocket: rolls along and bursts near the tank (0x448130 / 0x44b010 / 0x449fa0) */
  HW.BurstRocket = defP({
    setup: function (B, x, y, vx, vy, flip, count) {
      this.init(B, 'burstrocket', x, y, vx, vy, flip);
      this.hp = 80; this.points = 100; this.count = count || 8;
    },
    update: function () {
      var B = this.B;
      this.x += this.vx;
      this.frame += 0.2; if (this.frame >= 8) this.frame = 0;
      if (this.offX()) { this.remove(); return; }
      if (!(B.tx + 20 > this.x && B.tx - 20 < this.x) || B.deathTimer) { this.shieldCheck(); return; }
      B.addExplosion(this.x, this.y, 140, 70, this.vx, 0, 0);
      for (var a = 1.5707963; a < 7.8539; a += 6.282 / this.count)
        B.bullets.push({ x: this.x, y: this.y, vx: Math.cos(a) * 3, vy: -Math.sin(a) * 3, g: 0.05, enemy: true, spr: S('bombfrag'), frame: 0, row: 0 });
      this.remove();
    }
  });

  /* ------------------------------------------------------------------ player's homing missile (0x449830 / 0x44b510) */
  HW.HomingMissile = defP({
    setup: function (B) {
      this.init(B, 'missile', B.tx, B.ty, 0, 0, false);
      this.isEnemy = false; this.shootable = false;
      this.frame = 5;
      HW.snd(19, B.tx);
      B.addParticles(S('smoke'), this.x, this.y, 0, 0, 4, 0, -0.05, -0.5, 40, true, -1);
    },
    target: function () {
      var B = this.B, best = null, bd = 100000;
      for (var i = 0; i < B.crafts.length; i++) {
        var c = B.crafts[i];
        if (c.friendly || !c.collidable || c.dead) continue;
        var cx = c.wx(), cy = c.wy(), dx = cx - this.x, dy = cy - this.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d >= bd || cy > this.y + 1) continue;
        bd = d; best = c;
      }
      return best;
    },
    update: function () {
      var B = this.B;
      var a = this.frame * 0.3141690229343387;
      this.vx = Math.cos(a) * 4; this.vy = Math.sin(a) * 4;
      this.x += this.vx; this.y -= this.vy;
      B.addParticles(S('spark'), this.x - this.vx * 5, this.y + this.vy * 5, this.vx * 0.5, -this.vy * 0.5, 1, 0, 0, 0, 30, true, -1);
      var t = this.target();
      if (t) {
        var want = Math.atan2(this.x - t.wx(), this.y - t.wy()) + 1.5705;
        if (a < want) this.frame += 0.1;
        if (a > want) this.frame -= 0.1;
        this.frame = clamp(this.frame, 0, 10);
      }
      for (var i = 0; i < B.crafts.length; i++) {
        var c = B.crafts[i];
        if (!c.collidable || c.dead || c.friendly) continue;
        if (!c.hitTest(this.spr, this.x, this.y, this.cel(), 0, false)) continue;
        c.damage(15);
        if (c.armor >= 0) {
          HW.snd(7, this.x);
          B.addParticles(S('spark'), this.x, this.y, c.vx, c.vy, 10, 2, 0.05, 3, 30, true, -1);
        } else c.kill(true);
        this.remove();
        return;
      }
      var e = B.half + 15;
      if (this.x < -e || this.x > e || this.y < 0) this.remove();
    },
    // base projectile draw uses ftol(frame): frames 0..10 = nose right .. up .. left (18 degree steps)
    cel: function () { return clamp(Math.trunc(this.frame), 0, 19); },
    draw: function (ctx) { D.celC(ctx, this.spr, Math.round(this.x), Math.round(this.y), this.cel(), 0); }
  });
  /* player's rockets (0x449c80 / 0x44a6a0) */
  HW.Rocket = defP({
    setup: function (B, off) {
      this.init(B, 'rocket', 0, 0, 0, 0, false);
      this.isEnemy = false; this.shootable = false;
      this.frame = B.gunFrame;
      var a = (B.gunFrame * 9 - 4) * DEG, a2 = a + 1.5707963268794;
      this.x = B.tx - Math.cos(a) * 12 - Math.cos(a2) * off;
      this.y = (B.ty - 12) - Math.sin(a) * 12 - Math.sin(a2) * off;
      this.vx = Math.cos(a) * -4; this.vy = Math.sin(a) * 4;
      B.addParticles(S('smoke'), this.x, this.y, -this.vx * 0.5, this.vy * 0.5, 4, 0, -0.05, -0.5, 40, true, -1);
    },
    update: function () {
      var B = this.B;
      this.x += this.vx; this.y -= this.vy;
      B.addParticles(S('spark'), this.x - this.vx * 5, this.y + this.vy * 5, this.vx * 0.5, -this.vy * 0.5, 1, 0, 0, 0, 30, true, -1);
      var f = Math.trunc(this.frame);
      for (var i = 0; i < B.crafts.length; i++) {
        var c = B.crafts[i];
        if (!c.collidable || c.dead) continue;
        if (!c.hitTest(this.spr, this.x, this.y, f, 0, false)) continue;
        c.damage(6);
        if (c.armor >= 0) {
          HW.snd(7, this.x);
          B.addParticles(S('spark'), this.x, this.y, c.vx, c.vy, 10, 2, 0.05, 3, 30, true, -1);
        } else c.kill(true);
        this.remove();
        return;
      }
      if (B.damageProjs(this.spr, this.x, this.y, f, 0, 6)) { this.remove(); return; }
      var e = B.half + 15;
      if (this.x < -e || this.x > e || this.y < 0) this.remove();
    },
    draw: function (ctx) { D.celC(ctx, this.spr, Math.round(this.x), Math.round(this.y), Math.trunc(this.frame), 0); }
  });

  /* ------------------------------------------------------------------ flak cannon (0x44a220 / 0x44b120 / 0x448630) */
  function Flak(B) {
    this.B = B;
    this.cx = B.cursorX - 320; this.cy = B.cursorY;
    // The original bursts the flak right at the mouse cursor. The touch stick only gives a direction, so the burst
    // goes to the first enemy craft along the aim line (within reach of the burst), else as far up the line as the
    // view goes - not at a fixed distance halfway up the screen.
    if (!(HW.Input && HW.Input.mouseMode) && !B.demo) {
      var ox = B.tx, oy = B.ty - 12, dx = this.cx - ox, dy = this.cy - oy, L = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / L, uy = dy / L, best = null, bt = 1e9;
      for (var i = 0; i < B.crafts.length; i++) {
        var c = B.crafts[i];
        if (c.friendly || c.dead || !c.collidable) continue;
        var rx = c.wx() - ox, ry = c.wy() - oy, t = rx * ux + ry * uy;
        if (t < 50) continue;
        var d = Math.abs(rx * uy - ry * ux) - Math.min(c.w, c.h) * (c.m || 1) / 2;
        if (d < 35 && t < bt) { bt = t; best = c; }
      }
      if (best) { this.cx = best.wx(); this.cy = best.wy(); }
      else {
        var top = (B.viewTop ? B.viewTop() : 30) + 40, far = 2000;
        if (uy < -0.01) far = Math.min(far, (top - oy) / uy);
        if (Math.abs(ux) > 0.01) far = Math.min(far, ((ux > 0 ? 1 : -1) * (B.half - 30) - ox) / ux);
        far = Math.max(far, 80);
        this.cx = ox + ux * far; this.cy = oy + uy * far;
      }
    }
    var lvl = HW.P.weapons[4];
    this.radius = (lvl + 1) * 5;
    this.max = lvl * 8 + 8;
    this.n = 0; this.t = 0;
    this.x = this.cx; this.y = this.cy;
    HW.snd(68, this.x);
  }
  Flak.prototype.update = function () {
    var B = this.B, spr = S('flakflash');
    if (this.t === 0) {
      for (var i = 0; i < B.crafts.length; i++) {
        var c = B.crafts[i];
        if (!c.collidable || c.dead) continue;
        if (c.hitTest(spr, this.x, this.y, 0, 0, false)) {
          c.damage(0.75);
          if (c.armor < 0) c.kill(true); else HW.snd(9, this.x);
        }
      }
      B.damageProjs(spr, this.x, this.y, 0, 0, 0.5);
      B.addParticles(S('smoke'), this.x, this.y, 0, -0.5, 1, 0.1, -0.01, -0.5, 120, true, -1);
    }
    this.t += 1;
    if (this.t > 4) {
      this.t = 0; this.n++;
      if (this.n > this.max) return false;
      var a = rnd(6282) * 0.001, r = rnd(this.radius * 2 + 1) + this.radius;
      this.x = this.cx + Math.cos(a) * r; this.y = this.cy + Math.sin(a) * r;
    }
    return true;
  };
  Flak.prototype.draw = function (ctx) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    D.celC(ctx, S('flakflash'), Math.round(this.x), Math.round(this.y), Math.min(4, Math.floor(this.t)), 0);
    ctx.restore();
  };
  HW.Flak = Flak;

  /* ------------------------------------------------------------------ thunderstrike (0x44aa10 / 0x44aca0 / 0x447d00) */
  function Thunder(B) {
    this.B = B;
    this.px = []; this.py = [];
    for (var i = 0; i < 10; i++) { this.px.push(B.tx); this.py.push(B.ty - 4); }
    this.hops = HW.P.weapons[5] * 2;
    this.target = this.find();
    this.glows = [];
    HW.snd(45, B.tx);
  }
  Thunder.prototype.find = function () {
    var B = this.B, best = null, bd = 100000;
    for (var i = 0; i < B.crafts.length; i++) {
      var c = B.crafts[i];
      if (c.friendly || !c.collidable || c.dead || c === this.target || c.wy() >= 480) continue;
      var dx = c.wx() - this.px[0], dy = c.wy() - this.py[0], d = Math.sqrt(dx * dx + dy * dy);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };
  Thunder.prototype.update = function () {
    var B = this.B;
    for (var g = this.glows.length - 1; g >= 0; g--) if (--this.glows[g].life <= 0) this.glows.splice(g, 1);
    if (this.done) return this.glows.length > 0;
    if (!this.target || this.target.dead) this.target = this.find();
    var x = this.px[0], y = this.py[0];
    if (!this.hops || x < -B.half - 100 || x > B.half + 100 || y < -100 || y > 580) { this.done = true; return this.glows.length > 0; }
    for (var i = 9; i > 0; i--) { this.px[i] = this.px[i - 1]; this.py[i] = this.py[i - 1]; }
    this.px[1] += rnd(2000) * 0.01 - 10;
    this.py[1] += rnd(2000) * 0.01 - 10;
    var t = this.target, dx, dy;
    if (t) { dx = t.wx() - x; dy = t.wy() - y; } else { dx = -x; dy = -120 - y; }
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > 20) { dx *= 20 / d; dy *= 20 / d; }
    this.px[0] = x + dx; this.py[0] = y + dy;
    if (t && Math.abs(this.px[0] - t.wx()) < 0.01 && Math.abs(this.py[0] - t.wy()) < 0.01) {
      t.damage(HW.P.weapons[5]);
      B.addParticles(S('staticspark'), t.wx(), t.wy(), t.vx, t.vy, 10, 3, 0.05, 3, 100, true, -1);
      HW.snd(44, t.wx());
      this.glows.push({ t: t, life: 20 });
      if (t.armor < 0) t.kill(true);
      this.target = this.find();
      this.hops--;
    }
    return true;
  };
  Thunder.prototype.draw = function (ctx) {
    var bolt = S('bolt');
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    if (!this.done) {
      var v = 255;
      for (var i = 0; i < 9; i++) {
        for (var s = 0; s < 1; s += 0.1) {
          var x = this.px[i] + (this.px[i + 1] - this.px[i]) * s, y = this.py[i] + (this.py[i + 1] - this.py[i]) * s;
          ctx.globalAlpha = Math.max(0, v) / 255;
          D.celC(ctx, bolt, Math.round(x), Math.round(y), rnd(5), 0);
          v -= 2.55;
        }
      }
    }
    for (var g = 0; g < this.glows.length; g++) {
      var o = this.glows[g];
      ctx.globalAlpha = o.life / 20;
      D.celC(ctx, S('staticglow'), Math.round(o.t.wx ? o.t.wx() : o.t.x), Math.round(o.t.wy ? o.t.wy() : o.t.y), (20 - o.life) % 5, 0);
    }
    ctx.restore();
  };
  HW.Thunder = Thunder;

  /* ------------------------------------------------------------------ nuke mushroom cloud (0x4282e0 / 0x428ac0 / 0x428770) */
  function Mushroom(B) {
    this.B = B; this.x = 0; this.life = 1024;
    this.smoke = []; this.fire = [];
    var i, j, k;
    for (i = 128; i < 360; i += 64) this.smoke.push({ x: rnd(32) - 16, y: i, vx: 0, vy: -1.5, a: 160, f: rnd(3) });
    for (j = 2; j > 0; j--) {
      for (k = 3.13; k < 9.423; k += 3 - j) {
        var c = Math.cos(k), s = Math.sin(k);
        this.smoke.push({ x: rnd(16) + c * 5 * j - 8, y: rnd(16) + s * 1.25 * j - 56, vx: c * j / 3, vy: s * j * 0.25 - 1, a: 200, f: rnd(3) });
      }
    }
    for (j = 2; j > 0; j--) {
      for (k = 3.13; k < 9.423; k += 3 - j) {
        var c2 = Math.cos(k), s2 = Math.sin(k);
        var p = { x: rnd(16) + c2 * 10 * j - 8, y: rnd(16) + s2 * 2.5 * j - 8, vx: c2 * j * 0.25, vy: s2 * j / 7 - 0.3, a: 255, f: rnd(3) };
        this.fire.push(p);
        this.smoke.push({ x: p.x, y: p.y, vx: p.vx, vy: p.vy, a: 220, f: rnd(3) });
      }
    }
  }
  Mushroom.prototype.update = function () {
    this.x -= this.B.speed * 0.3;
    this.life -= 1;
    if (this.life <= 0 || this.x < -this.B.half - 200) return false;
    var i, p;
    for (i = 0; i < this.smoke.length; i++) { p = this.smoke[i]; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.vy *= 0.99; }
    for (i = 0; i < this.fire.length; i++) { p = this.fire[i]; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.vy *= 0.99; p.a = Math.max(0, p.a - 0.75); }
    return true;
  };
  Mushroom.prototype.draw = function (ctx) {
    var a = Math.min(255, this.life) / 255, ms = S('mushsmoke'), mf = S('mushfire'), i, p;
    ctx.save();
    for (i = 0; i < this.smoke.length; i++) {
      p = this.smoke[i];
      ctx.globalAlpha = a * (p.a / 255);
      D.celC(ctx, ms, Math.round(this.x + p.x), Math.round(p.y + 240), p.f, 0);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < this.fire.length; i++) {
      p = this.fire[i];
      if (p.a <= 0) continue;
      ctx.globalAlpha = Math.min(1, p.a / 255) * a;
      D.celC(ctx, mf, Math.round(this.x + p.x), Math.round(p.y + 240), p.f, 0);
    }
    ctx.restore();
  };
  HW.Mushroom = Mushroom;

  /* ------------------------------------------------------------------ DANGER warning before a boss (0x40ed50 / 0x40e800 / 0x40e920) */
  var SIGN = [[0, 110, 0], [220, 320, 1.5707963], [220, 180, 1.5707963], [220, 320, 1.5707963], [220, 300, 1.5707963],
    [0, 110, 0], [-220, 180, 4.712389], [-200, 380, 3.1415927], [0, 110, 0], [0, 110, 0]];
  function Danger(B) {
    this.B = B; this.flash = 254; this.pass = 0; this.chars = 0;
    var m = B.mission, idx = m >= 18 ? 9 : m % 9;
    this.idx = idx;
    if (m === 0) this.text = 'ENCOUNTERED: TWINBLADE\n\n- HOMING MISSILES';
    else { var bd = HW.bossData(HW.BOSS_NAMES[idx]); this.text = (bd && bd.info) || ''; }
    var t = SIGN[idx];
    this.sx = t[0]; this.sy = t[1]; this.ang = t[2];
  }
  /* a sign at the top (bosses coming down from the sky) moves down with the aircraft band on a zoomed screen, so it is
     not hidden under the status bar */
  Danger.prototype.shiftY = function () { return this.sy < 150 && this.B.skyShift ? this.B.skyShift() : 0; };
  /* how far the sign reaches above its centre: the bands of the triangle turned toward the boss, and the round sign */
  Danger.prototype.topExtent = function () {
    if (this._ext !== undefined) return this._ext;
    var ca = Math.cos(this.ang), sa = Math.sin(this.ang), m = 0;
    for (var k = 0; k < 6; k++) {
      var y = -54 + 20 * k, l = -10 - 10 * k, r = 10 + 10 * k;
      [[l + 8, y - 16], [r - 8, y - 16], [r, y], [l, y]].forEach(function (p) { m = Math.min(m, p[0] * sa + p[1] * ca); });
    }
    var d = S('danger');
    this._ext = Math.max(-m, d ? d.ch / 2 : 0);
    return this._ext;
  };
  /* the sign's height: the original's, moved down with the zoomed view's sky, and never so high that the status bar
     covers any of it */
  Danger.prototype.signY = function () {
    var B = this.B, top = B.viewTop ? B.viewTop() : 30;
    return Math.max(this.sy + this.shiftY(), top + this.topExtent() + 6);
  };
  Danger.prototype.update = function () {
    if (this.flash === 254) HW.snd(23);
    if (this.flash === 128 && !this.pass) HW.snd(61);
    if (this.flash) this.flash -= 2;
    if (!this.flash) {
      this.pass++;
      if (this.pass === 5) { this.B.danger = null; HW.music(2); return; }
      this.flash = 254;
    }
    if (this.chars >= this.text.length) return;
    if (this.pass <= 0 && this.flash >= 128) return;
    if (HW.frame % 2) return;
    this.chars++;
    HW.snd(52);
  };
  Danger.prototype.draw = function (ctx) {
    var B = this.B;
    if (!this.flash) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgb(' + this.flash + ',0,0)';
    ctx.fillRect(-B.half, 0, B.half * 2, 480);
    ctx.globalCompositeOperation = 'source-over';
    // pointer stripes toward the boss entry
    var sx = this.sx * (this.sx ? (B.half - 100) / 220 : 0), sy = this.signY();
    if (Math.abs(this.sx) < 1) sx = 0;
    ctx.translate(sx, sy); ctx.rotate(this.ang);
    // 0x40ed50 builds six bands from the apex down (y -54, -34 ... 46; each 20 px wider), turned toward the boss's
    // way in: an upright warning triangle behind the sign. 0x40e920 fills them (255, sin(((tick+i) % 100) * 0.03141)
    // * 255, 0) at alpha 128, so a glow runs down the bands.
    for (var i = 0, k = 0; i < 96; i += 16, k++) {
      var gg = Math.round(Math.sin(((HW.frame + i) % 100) * 0.03141) * 255);
      ctx.fillStyle = 'rgba(255,' + gg + ',0,0.502)';
      var y = -54 + 20 * k, l = -10 - 10 * k, r = 10 + 10 * k;
      ctx.beginPath(); ctx.moveTo(l + 8, y - 16); ctx.lineTo(r - 8, y - 16); ctx.lineTo(r, y); ctx.lineTo(l, y); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    if (HW.frame % 60 < 30) {
      var sxx = Math.abs(this.sx) < 1 ? 0 : this.sx * (B.half - 100) / 220;
      D.celC(ctx, S('danger'), Math.round(sxx), Math.round(this.signY()), 0, 0);
    }
    var f = HW.fonts.Keypunch16;
    if (f) f.drawWrapped(ctx, this.text.substr(0, this.chars), -190, this.textY(), 380, '#fff', 0);
  };
  /* the boss intel text sits at y 180 under a sign at the top (110); when the sign has moved down with the zoomed
     view the text moves down under it instead of being written across the triangle */
  Danger.prototype.textY = function () {
    if (Math.abs(this.sx) >= 1 || this.sy >= 300) return 180;
    return Math.max(180, Math.round(this.signY() + 46 + 24));
  };
  HW.Danger = Danger;
})();
