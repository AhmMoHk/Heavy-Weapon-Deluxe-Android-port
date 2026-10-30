/* Heavy Weapon mobile port - end of level bosses (parameters from data/bosses.xml) */
'use strict';
(function () {
  var D = HW.Draw, rnd = HW.rnd, clamp = HW.clamp;
  var DEG = Math.PI / 180;
  function S(n) { return HW.img[n]; }

  HW.BOSS_NAMES = ['Helicopter', 'Battleship', 'Rainer', 'Wrecker', 'Ape', 'Eye', 'Head', 'Worm', 'Robot', 'Final'];
  HW.bossData = function (name) {
    var a = HW.data.bosses;
    for (var i = 0; i < a.length; i++) if (a[i].name === name) return a[i];
    return null;
  };

  /* ------------------------------------------------------------------ boss space
     The battlefield is magnified on wide phone screens (B.zoomK), which made the bosses - drawn for the original's
     640x480 screen - too big for it: tops and antennas went behind the status bar, the Eyebot had to be pushed down
     onto the ground. So a boss lives in its own "boss space": the original's screen units, laid on the world with its
     own scale m around an anchor height ya:
         world x = bx * m        world y = ya + (by - ya) * m
     - flying bosses: m = 1/k, ya = 480 - on the screen they stand exactly where and as big as on the original;
     - ground bosses: m = 1/k, ya = 460 (the road), so their wheels and feet stay on the magnified road;
     - the battleship: as much of it across the screen as the original shows (two of its four deck guns), as large as
       the height allows with its bridge under the status bar.
     The boss code itself is unchanged: it sees the board through a view (bossView) that hands it the tank, the
     screen half and everything it adds (shots, bullets, explosions, particles, scores) converted between the two
     spaces. The rest of the game sees the boss through hitTest / draw / wx / wy, which convert the other way. */
  function bossView(boss, RB) {
    var bound = {};
    var conv = {
      tx: function () { return boss.toBx(RB.tx); },
      ty: function () { return boss.toBy(RB.ty); },
      half: function () { return RB.half / boss.m; }
    };
    var fns = {
      skyShift: function () { return 0; },
      addProj: function (p) { boss.projToWorld(p); return RB.addProj(p); },
      enemyBullet: function (x, y, a, sp) { return RB.enemyBullet(boss.toWx(x), boss.toWy(y), a, sp); },
      addExplosion: function (x, y, w, h, vx, vy, sp) {
        var m = boss.m; return RB.addExplosion(boss.toWx(x), boss.toWy(y), w * m, h * m, (vx || 0) * m, (vy || 0) * m, sp);
      },
      addParticles: function (spr, x, y, vx, vy, n, spread, g, maxv, life, fade, fixed) {
        var m = boss.m;
        return RB.addParticles(spr, boss.toWx(x), boss.toWy(y), vx * m, vy * m, n, spread * m, g * m, maxv * m, life, fade, fixed);
      },
      addMuzzle: function (x, y, vx, vy) { return RB.addMuzzle(boss.toWx(x), boss.toWy(y), (vx || 0) * boss.m, (vy || 0) * boss.m); },
      addScore: function (pts, x, y) { return RB.addScore(pts, boss.toWx(x), boss.toWy(y)); },
      addScorch: function (x, a, pl) { return RB.addScorch(boss.toWx(x), a, pl); },
      addCrater: function (x, n) { return RB.addCrater(boss.toWx(x), n); },
      tankHit: function (spr, x, y, col, row, flip) {
        if (RB.deathTimer) return false;
        return HW.collide(S('tank'), boss.toBx(RB.tx), boss.toBy(RB.ty), 0, 0, false, spr, x, y, col || 0, row || 0, !!flip);
      },
      bullets: { push: function (b) { b.x = boss.toWx(b.x); b.y = boss.toWy(b.y); return RB.bullets.push(b); } }
    };
    if (typeof Proxy !== 'function') return RB;
    return new Proxy(RB, {
      get: function (t, k) {
        if (conv.hasOwnProperty(k)) return conv[k]();
        if (fns.hasOwnProperty(k)) return fns[k];
        var v = t[k];
        if (typeof v === 'function') {
          var b = bound[k];
          if (!b || b.orig !== v) { b = bound[k] = v.bind(t); b.orig = v; }
          return b;
        }
        return v;
      },
      set: function (t, k, v) { t[k] = v; return true; }
    });
  }

  /* ------------------------------------------------------------------ boss base */
  function Boss() {}
  Boss.prototype = Object.create(HW.Craft.prototype);
  var BP = Boss.prototype;
  BP.anchorY = 480;
  /* the boss space's scale for the current zoom (cheap; redone every update and draw, the zoom can change) */
  BP.viewSetup = function () {
    var RB = this.RB, k = RB.zoomK ? RB.zoomK() : 1, m = 1 / k;
    if (this.fitWidth) {
      // as much across the screen as the original's 640 px, but the top (fitTop) no higher than y 34 on the screen
      var lim = (446 / k - (480 - this.anchorY)) / (this.anchorY - this.fitTop);
      m = Math.max(1 / k, Math.min(RB.half / 320, lim));
    }
    this.m = m; this.ya = this.anchorY;
  };
  BP.toWx = function (x) { return x * this.m; };
  BP.toWy = function (y) { return this.ya + (y - this.ya) * this.m; };
  BP.toBx = function (x) { return x / this.m; };
  BP.toBy = function (y) { return this.ya + (y - this.ya) / this.m; };
  BP.wx = function () { return this.toWx(this.x); };
  BP.wy = function () { return this.toWy(this.y); };
  /* a shot fired by the boss goes into the world in world units, belonging to the real board */
  BP.projToWorld = function (p) {
    p.B = this.RB;
    p.x = this.toWx(p.x); p.y = this.toWy(p.y);
    if (typeof p.tailX === 'number') { p.tailX = this.toWx(p.tailX); p.tailY = this.toWy(p.tailY); }
    if (typeof p._px === 'number') { p._px = p.x; p._py = p.y; }
  };
  BP.initBoss = function (B, name, level) {
    var bd = HW.bossData(name);
    this.RB = B; this.viewSetup();
    this.B = bossView(this, B); this.name = name;
    this.d = bd.levels[Math.min(level, bd.levels.length - 1)];
    this.level = level;
    this.armor = this.maxArmor = this.d.armor; this.points = this.d.score;
    this.x = 0; this.y = -400; this.vx = 0; this.vy = 0; this.frame = 0; this.dir = 0;
    this.flash = 0; this.collidable = false; this.friendly = false; this.dead = false; this.dying = false;
    this.isBoss = true; this.parts = []; this.t = 0; this.hitPart = null;
    this.w = 200; this.h = 100;
    this.bodies = []; // [{spr, ox, oy, col, row, flip}] collision/draw pieces
  };
  /* how far the flying bosses' heights move down on a zoomed screen (the aircraft band's shift, 0 at 4:3): the original
     keeps them just under its 30 px status bar, and with the battlefield magnified more of the sky is out of view */
  BP.sky = function () { return this.B.skyShift ? this.B.skyShift() : 0; };
  BP.part = function (spr, ox, oy, armor, points) {
    var p = { spr: S(spr), ox: ox, oy: oy, col: 0, row: 0, flip: false, armor: armor, maxArmor: armor, dead: false,
      flash: 0, points: points || 1000, cd: 0, x: 0, y: 0, ang: 0 };
    this.parts.push(p);
    return p;
  };
  BP.placeParts = function () {
    for (var i = 0; i < this.parts.length; i++) { var p = this.parts[i]; p.x = this.x + p.ox; p.y = this.y + p.oy; }
  };
  BP.baseBoss = function () {
    this.t++;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - 24);
    for (var i = 0; i < this.parts.length; i++) { var p = this.parts[i]; if (p.flash > 0) p.flash = Math.max(0, p.flash - 24); if (p.cd > 0) p.cd--; }
    this.placeParts();
  };
  BP.move = function () {};
  BP.offscreen = function () { return false; };
  /* the world asks in world units: the shot's position is taken into boss space for the boss's own test */
  BP.hitTest = function (spr, x, y, col, row, flip) {
    return this.hitTestB(spr, this.toBx(x), this.toBy(y), col, row, flip);
  };
  BP.hitTestB = function (spr, x, y, col, row, flip) {
    if (!this.collidable || this.dying) return false;
    // the main craft comes first in the original craft list, its parts after it in creation order
    var i, p;
    for (i = 0; i < this.bodies.length; i++) {
      var b = this.bodies[i];
      if (!b.spr || b.noHit) continue;
      if (HW.collide(b.spr, this.x + b.ox, this.y + b.oy, b.col || 0, b.row || 0, !!b.flip, spr, x, y, col, row, flip)) { this.hitPart = null; return true; }
    }
    for (i = 0; i < this.parts.length; i++) {
      p = this.parts[i];
      if (p.dead || !p.spr || p.noHit) continue;
      if (HW.collide(p.spr, p.x, p.y, p.col, p.row, p.flip, spr, x, y, col, row, flip)) { this.hitPart = p; return true; }
    }
    return false;
  };
  BP.damage = function (d) {
    var p = this.hitPart;
    this.hitPart = null;
    if (p && !p.dead) {
      p.armor -= d; p.flash = 255;
      if (p.armor < 0) this.destroyPart(p);
      return;
    }
    this.armor -= d; this.flash = 255;
  };
  BP.destroyPart = function (p) {
    p.dead = true;
    var s = Math.max(p.spr ? p.spr.cw : 40, p.spr ? p.spr.ch : 40) + 30;
    this.B.addExplosion(p.x, p.y, s, s, 0, 0, 0);
    this.B.addScore(p.points, p.x, p.y);
    if (p.onDie) p.onDie.call(this, p);
  };
  BP.kill = function () {
    if (this.dying) return;
    this.dying = true; this.collidable = false;
    this.B.addScore(this.points, this.x, this.y);
    this.B.bossDefeated(this);
  };
  BP.remove = function () { this.dead = true; if (this.onRemove) this.onRemove(); };
  BP.drawPiece = function (ctx, spr, x, y, col, row, flip, flash) {
    if (!spr) return;
    x = Math.round(x); y = Math.round(y);
    D.celC(ctx, spr, x, y, col || 0, row || 0, flip ? D.FLIP : null);
    if (flash > 0) {
      ctx.save(); ctx.globalAlpha *= flash / 255;
      D.celC(ctx, D.mulTint(spr, '#ff0000'), x, y, col || 0, row || 0, flip ? D.FLIP : null);
      ctx.restore();
    }
  };
  BP.drawBodies = function (ctx) {
    for (var i = 0; i < this.bodies.length; i++) {
      var b = this.bodies[i];
      if (b.hidden) continue;
      this.drawPiece(ctx, b.spr, this.x + b.ox, this.y + b.oy, b.col, b.row, b.flip, this.flash);
    }
  };
  BP.drawParts = function (ctx) {
    for (var i = 0; i < this.parts.length; i++) {
      var p = this.parts[i];
      if (p.dead || p.hidden) continue;
      this.drawPiece(ctx, p.spr, p.x, p.y, p.col, p.row, p.flip, p.flash);
    }
  };
  BP.drawB = function (ctx) { this.drawBodies(ctx); this.drawParts(ctx); };
  BP.draw = function (ctx) {
    this.viewSetup();
    ctx.save();
    ctx.translate(0, this.ya); ctx.scale(this.m, this.m); ctx.translate(0, -this.ya);
    this.drawB(ctx);
    ctx.restore();
  };
  BP.tankAlive = function () { return !this.B.deathTimer && !this.dying; };
  BP.angTo = function (x, y) { return Math.atan2(this.B.tx - x, (this.B.ty - 10) - y) + 1.5705; };
  BP.shoot = function (x, y, spd) { this.B.enemyBullet(x, y, this.angTo(x, y), spd || 2.5); };
  /* aim a 21 frame turret at the tank: frame 0 points left, 10 straight down, 20 right */
  BP.aimFrame = function (x, y) {
    var a = Math.atan2(this.B.ty - y, this.B.tx - x) / DEG; // 0 = right, 90 = down
    return clamp(Math.round((180 - a) / 9), 0, 20);
  };
  BP.contactKill = function (spr, x, y, col, row, flip) {
    var B = this.B;
    if (B.deathTimer) return false;
    if (B.tankHit(spr, x, y, col || 0, row || 0, !!flip)) { B.killTank(); return true; }
    return false;
  };
  BP.edgeIn = function (target, speed) {
    // returns true when arrived
    var d = target - this.x;
    if (Math.abs(d) <= speed) { this.x = target; return true; }
    this.x += d > 0 ? speed : -speed;
    return false;
  };
  function defBoss(name, proto) {
    var K = function (B, level) { this.initBoss(B, name, level); this.setup(); this.placeParts(); };
    K.prototype = Object.create(Boss.prototype);
    // a boss's own draw and hit test work in boss space; the base class wraps them (see BP.draw / BP.hitTest)
    for (var k in proto) K.prototype[k === 'draw' ? 'drawB' : k === 'hitTest' ? 'hitTestB' : k === 'update' ? 'updateB' : k] = proto[k];
    return K;
  }
  BP.update = function () { this.viewSetup(); this.updateB(); };
  var Bosses = HW.Bosses = {};

  /* ================================================================== 1. TWINBLADE helicopter (0x440300 / 0x43f4d0 / 0x43f6f0, parts 0x440820 / 0x440ab0) */
  Bosses.Helicopter = defBoss('Helicopter', {
    setup: function () {
      var d = this.d, B = this.B;
      this.body = S('hugecopter/hugecopter');
      this.bodies = [{ spr: this.body, ox: 0, oy: 0 }];
      this.w = 320; this.h = 118;
      this.y = -this.h; this.x = 0; this.rotor = 0;
      var la = d.Launcher || { armor: 100, fire: 250, speed: 0.75 };
      this.la = la;
      this.launchers = [this.part('hugecopter/launcher', -75, 45, la.armor, 0), this.part('hugecopter/launcher', 75, 45, la.armor, 0)];
      this.launchers.forEach(function (p) { p.cd = la.fire; });
      this.turrets = [];
      if (B.mission > 0) {
        var tu = d.Turret || { armor: 80, fire: 175 };
        this.tu = tu;
        this.turrets = [this.part('hugecopter/turret', -122, 33, tu.armor, 0), this.part('hugecopter/turret', 122, 33, tu.armor, 0)];
        this.turrets.forEach(function (p, i) { p.col = 10; p.fr = 10; p.spd = i ? 0.05 : -0.05; p.cd = tu.fire; });
      }
      this.sound = HW.Audio.play('bosscopter', { loop: true, vol: 0 });
    },
    onRemove: function () { if (this.sound) HW.Audio.stop(this.sound); this.sound = null; },
    update: function () {
      var B = this.B, i, p;
      this.baseBoss();
      this.rotor += 0.4; if (this.rotor >= 5) this.rotor -= 5;
      if (this.sound) HW.Audio.setVolume(this.sound, (this.y < this.h ? Math.max(0, (this.h + this.y) / (2 * this.h)) : 1) * 0.8);
      // (0x43f4d0 has no death check: the helicopter goes on hovering, rotors turning, through its death explosions)
      this.x += this.vx; this.y += this.vy;
      var sk = this.sky();
      if (this.y < 140 + sk) this.vy += 0.01;
      else {
        if (!this.dying) this.collidable = true;
        if (this.y > 200 + sk) this.vy -= 0.01; else this.vy += rnd(20) * 0.001 - 0.01;
      }
      if (this.x < -120) this.vx += 0.01;
      else if (this.x > 120) this.vx -= 0.01;
      else this.vx += rnd(20) * 0.001 - 0.01;
      this.vx = clamp(this.vx, -0.5, 0.5); this.vy = clamp(this.vy, -0.5, 0.5);
      this.placeParts();
      var canFire = this.y > 50 && B.nukeFlash === 0 && !B.bossDeath;
      var on = this.collidable || this.dying;
      for (i = 0; i < this.launchers.length; i++) {
        p = this.launchers[i];
        if (p.dead || !on) continue;
        p.cd = B.deathTimer ? this.la.fire : p.cd - 1;
        if (p.x > -B.half + 20 && p.x < B.half - 20 && p.cd <= 0 && canFire && !this.dying) {
          B.addProj(new HW.Hellfire(B, p.x, p.y, this.vx, this.vy, this.la.speed || 1));
          p.cd = this.la.fire;
        }
      }
      for (i = 0; i < this.turrets.length; i++) {
        p = this.turrets[i];
        if (p.dead || !on) continue;
        p.fr += p.spd;
        if (p.fr >= 21) { p.spd = -0.05; p.fr = 20; }
        else if (p.fr < 0) { p.spd = 0.05; p.fr = 0; }
        p.col = Math.floor(p.fr);
        p.cd = B.deathTimer ? this.tu.fire : p.cd - 1;
        if (p.cd <= 0 && canFire && !B.deathTimer && !this.dying) {
          B.enemyBullet(p.x, p.y, p.fr / (21 * 0.6369426751592356) + 0.7854, 0);
          p.cd = this.tu.fire;
        }
      }
    },
    draw: function (ctx) {
      var bl = S('hugecopter/copterblades'), f = Math.floor(this.rotor);
      this.drawBodies(ctx);
      D.celC(ctx, bl, Math.round(this.x - 122), Math.round(this.y - 68), f, 0);
      D.celC(ctx, bl, Math.round(this.x + 122), Math.round(this.y - 68), f, 0);
      this.drawParts(ctx);
    }
  });

  /* ================================================================== 2. BATTLESHIP (0x439e60 / 0x438df0 / 0x439000, turrets 0x43a1c0 / 0x43a300) */
  Bosses.Battleship = defBoss('Battleship', {
    fitWidth: true, anchorY: 380, fitTop: 176,   // hull bottom on the water line; main deck top at y 176
    setup: function () {
      var d = this.d, B = this.B;
      this.main = S('battleship/main'); this.hull = S('battleship/hull');
      this.bodies = [{ spr: this.main, ox: 0, oy: 0 }];
      this.w = 900; this.h = 220;
      this.x = 770 + (B.half - 320); this.y = 260; this.vx = -1;
      this.stopX = 240; // decelerates once inside
      var ta = d.turretarmor || 200;
      var offs = [[-219, 51], [-306, 47], [219, 49], [306, 43]];
      this.guns = [];
      for (var i = 0; i < 4; i++) {
        var g = this.part('battleship/gun', offs[i][0], offs[i][1], ta, 0);
        var td = d['Turret' + (i + 1)] || { fire: 150, speed: 0.1 };
        g.idx = i; g.fire = td.fire; g.speed = td.speed; g.spd = td.speed; g.fr = 10; g.col = 10; g.cd = td.fire;
        g.onDie = this.gunDied;
        this.guns.push(g);
      }
      this.lfire = (d.Launcher || { fire: 250 }).fire;
      this.lcd = this.lfire;
    },
    gunDied: function () {
      if (this.guns.every(function (g) { return g.dead; })) this.lfire = Math.floor(this.lfire / 2);
    },
    update: function () {
      var B = this.B, i, g;
      this.baseBoss();
      // (0x438df0 has no death check: the ship sails on and the turrets keep sweeping while it blows up)
      this.x += this.vx;
      var leftGone = this.guns[0].dead && this.guns[1].dead;
      if (leftGone) {
        if (this.x > -50) this.vx -= 0.005;
        else { this.vx += 0.005; if (this.vx > 0) this.vx = 0; }
      } else if (this.x < this.stopX) {
        this.vx += 0.005; if (this.vx > 0) this.vx = 0;
      }
      this.vx = clamp(this.vx, -1, 1);
      if (this.vx === 0 && !this.dying) this.collidable = true;
      this.placeParts();
      // missile launcher
      if (this.lcd) this.lcd--;
      if (B.deathTimer) this.lcd = this.lfire;
      if ((this.vx === 0 || this.collidable) && !this.lcd && !B.deathTimer && B.nukeFlash === 0 && !B.bossDeath && !this.dying) {
        B.addProj(new HW.Hellfire(B, this.x < 0 ? this.x + 120 : this.x - 120, 300, 0, 0, 0.75));
        this.lcd = this.lfire;
      }
      // deck guns sweep and lob shells
      for (i = 0; i < this.guns.length; i++) {
        g = this.guns[i];
        if (g.dead) continue;
        if (g.x > B.half + 37) { g.fr = 10; g.cd = g.fire; continue; }
        if (!this.collidable && !this.dying) continue;
        g.fr += g.spd;
        if (g.idx < 2) {
          if (g.fr >= 21) { g.fr = 20; g.spd = -g.speed; }
          else if (g.fr < 7) { g.fr = 7; g.spd = g.speed; }
        } else {
          if (g.fr >= 14) { g.fr = 13; g.spd = -g.speed; }
          else if (g.fr < 0) { g.fr = 0; g.spd = g.speed; }
        }
        g.col = clamp(Math.floor(g.fr), 0, 20);
        g.cd = B.deathTimer ? g.fire : g.cd - 1;
        if (g.cd <= 0 && this.y > 50 && !B.deathTimer && B.nukeFlash === 0 && !B.bossDeath) {
          var a = g.fr / (21 * 0.6369426751592356) + 0.7854;
          for (var k = -12; k <= 12; k += 24) {
            var bx = (g.fr - 10) * 2 + g.x - k, by = g.y - 17;
            B.bullets.push({ x: bx, y: by, vx: Math.cos(a) * -3.75, vy: Math.sin(a) * -3.75, g: 0.05, enemy: true, spr: S('bombfrag'), frame: 0, row: 0 });
            B.addMuzzle(bx, by, 0, 0);
            B.addParticles(S('smoke'), bx, by - 20, 0, -0.5, 4, 0.5, -0.01, -0.5, 100, true, -1);
          }
          HW.snd(42, g.x);
          g.cd = g.fire;
        }
      }
    },
    draw: function (ctx) {
      this.drawPiece(ctx, this.hull, this.x, this.y + 89, 0, 0, false, 0);
      this.drawBodies(ctx);
      this.drawParts(ctx);
    }
  });

  /* ================================================================== 3. RAINER war blimp (0x441c30 / 0x440d20 / 0x441240): roto-mines + meteor tractor beam */
  /* roto-mine (0x447a30 / 0x447ac0): popped out of the top of the blimp, falls while homing on the tank */
  function AirMine(B, x, y, vx) {
    this.init(B, 'airmine', x, y, vx, -1, false);
    this.hp = 20; this.points = 40;
  }
  AirMine.prototype = Object.create(HW.Proj.prototype);
  AirMine.prototype.update = function () {
    var B = this.B;
    this.x += this.vx; this.y += this.vy;
    if (this.vy < 3) this.vy += 0.02;
    var k = 0.1 - Math.cos(this.y * 0.0032710416666666665) * 0.1;
    this.vx += this.x >= B.tx ? -k : k;
    this.vx = clamp(this.vx, -3, 3);
    this.frame += 0.5; if (this.frame >= 5) this.frame -= 5;
    if (this.y < -40) return;
    this.hits();
  };
  HW.AirMine = AirMine;

  Bosses.Rainer = defBoss('Rainer', {
    setup: function () {
      var B = this.B, dd = this.d.Dish || { down: 800, up: 400, meteors: 15 };
      this.body = S('rainer/rainer');
      this.bodies = [{ spr: this.body, ox: 0, oy: 0 }];
      this.w = 400; this.h = 220;
      this.x = 520 + (B.half - 320); this.y = 200 + this.sky(); this.vx = -0.75; this.vy = 0;
      this.dish = dd; this.dishA = 0; this.beamOn = false; this.timer = dd.up; this.prop = 0;
      this.fire = this.d.fire || 80; this.mcd = this.fire;
      this.sound = null;
    },
    stopBeamSound: function () { if (this.sound) { HW.Audio.stop(this.sound); this.sound = null; } },
    onRemove: function () { this.stopBeamSound(); },
    update: function () {
      var B = this.B;
      this.baseBoss();
      // (0x440d20: it drifts on, propellers turning, while it blows up - only the beam and the mines stop)
      if (B.bossDeath || this.dying) this.stopBeamSound();
      if (this.x < 20 && !this.collidable && !this.dying && !this.entered) { this.collidable = true; this.entered = true; }
      else {
        // 0x440d20 wanders on the way in too (the pull toward the centre keeps it drifting left at -0.75)
        this.vx += (rnd(100) - 50) * 0.0005;
        this.vx -= this.x * 0.00025;
        this.vy += (rnd(100) - 50) * 0.00025 + (200 - this.y) * 0.0005;
        this.vx = clamp(this.vx, -0.75, 0.75); this.vy = clamp(this.vy, -0.25, 0.25);
      }
      this.x += this.vx; this.y += this.vy;
      this.prop += 0.5; if (this.prop >= 8) this.prop -= 8;
      if (this.entered) {
        if (this.beamOn && !B.deathTimer) {
          if (this.dishA < 1.5701) this.dishA += 0.01;
          if (B.nukeFlash === 0 && !B.bossDeath) {
            if (--this.timer < 0) {
              this.stopBeamSound();
              this.beamOn = false; this.timer = this.dish.up;
              for (var i = 0; i < this.dish.meteors; i++) B.addProj(new HW.Meteorite(B));
            } else if (this.dishA > 1.56 && !this.sound && !this.dying) this.sound = HW.Audio.play('tractorbeam', { loop: true });
          }
        } else {
          this.stopBeamSound();
          this.beamOn = false;
          if (this.dishA > 0) this.dishA = Math.max(0, this.dishA - 0.01);
          if (--this.timer < 0) { this.beamOn = true; this.timer = this.dish.down; }
        }
      }
      if (!B.deathTimer && this.entered && this.dishA <= 0.02) this.mcd--; else this.mcd = this.fire;
      if (this.mcd <= 0 && B.nukeFlash === 0 && !B.bossDeath && !this.dying) {
        B.addProj(new AirMine(B, this.x, this.y - 115, rnd(400) * 0.01 - 2));
        HW.snd(73, this.x);
        this.mcd = this.fire;
      }
    },
    draw: function (ctx) {
      var x = this.x, y = this.y;
      // 0x441240: the mast rises sin(dishA)*44 out of the top of the saucer
      this.drawPiece(ctx, S('rainer/dish'), x, y - 80 - Math.sin(this.dishA) * 44, 0, 0, false, this.flash);
      this.drawBodies(ctx);
      var pr = S('rainer/prop'), f = Math.floor(this.prop);
      this.drawPiece(ctx, pr, x - 139, y - 96, f, 0, true, this.flash);
      this.drawPiece(ctx, pr, x + 140, y - 96, f, 0, false, this.flash);
      if (this.beamOn && this.dishA > 1.56 && !this.B.bossDeath) {
        // a 50x162 window of the beam texture scrolling upward, additive, rooted on the dish
        var bm = S('rainer/beam'), sy = 37 - ((HW.frame * 3) % 38);
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(bm.image, 0, sy, 50, 162, Math.trunc(x - 25), Math.trunc(y - 299), 50, 162);
        ctx.restore();
      }
    }
  });

  /* ================================================================== 4. WAR WRECKER (0x447210 / 0x445f60 / 0x4466f0): crane with a wrecking ball */
  Bosses.Wrecker = defBoss('Wrecker', {
    anchorY: 460,
    setup: function () {
      var B = this.B;
      this.tower = S('wrecker/tower'); this.body = S('wrecker/body');
      this.bodies = [{ spr: this.tower, ox: 0, oy: 0 }];
      this.w = 600; this.h = 400;
      this.y = 190; this.baseX = 640 + (B.half - 320); this.spd = -1; this.x = this.baseX;
      this.a1 = Math.PI / 2; this.a2 = Math.PI / 2;
      this.bx = this.baseX; this.by = 250; this.bvx = 0; this.bvy = 0;
      this.L = 200; this.maxL = this.d.longchain === 'yes' ? 368 : 352;
      this.wheel = 0; this.grounded = false; this.shakeT = 0;
      this.diesel = HW.Audio.play('diesel', { loop: true, vol: 0 });
      this.chain = null;
      this.loose = null;
    },
    /* 0x446a30: when it is destroyed the wrecking ball breaks off and flies on with its swing, falling, while the
       chain winds back up into the crane (0x445f60: L -= 2 per update) */
    kill: function () {
      if (this.dying) return;
      this.loose = { x: this.bx, y: this.by, vx: this.bvx, vy: this.bvy + 0.5 };
      if (this.chain) { HW.Audio.stop(this.chain); this.chain = null; }
      BP.kill.call(this);
    },
    onRemove: function () {
      if (this.diesel) HW.Audio.stop(this.diesel); this.diesel = null;
      if (this.chain) HW.Audio.stop(this.chain); this.chain = null;
    },
    update: function () {
      var B = this.B;
      this.baseBoss();
      if (!B.bossDeath) { this.a1 += 0.005; this.a2 += 0.015; }
      if (!this.collidable && !this.dying && !this.parked) {
        this.baseX += this.spd;
        this.wheel += this.spd * 0.4; if (this.wheel < 0) this.wheel += 12;
        if (this.baseX < 20) {
          this.spd = this.baseX * -0.05;
          if (this.baseX < 0.5) { this.collidable = true; this.parked = true; HW.snd(77, this.x); }
        }
        // 0x445f60: the engine fades in as the truck rolls onto the screen ((640 - x) * 0.005 beyond 320) and drops
        // in pitch while it brakes ((20 - x) * -0.1 semitones); then it idles at that pitch for the whole fight
        if (this.diesel) {
          HW.Audio.setVolume(this.diesel, (HW.Audio.vols.diesel || 0.7) * (Math.abs(this.baseX) > 320 + (B.half - 320) ? clamp((640 + (B.half - 320) - this.baseX) * 0.005, 0, 1) : 1));
          if (this.baseX > 1 && this.baseX < 20) HW.Audio.setRate(this.diesel, Math.pow(2, (20 - this.baseX) * -0.1 / 12));
        }
      } else if (this.parked && !this.dying && !B.bossDeath && !B.deathTimer) {
        // On the original's 640 px screen the crane parked in the middle sweeps its ball out to both edges of the
        // road. A wider screen leaves corners out of reach, so there the truck rolls slowly over to the tank's side
        // (as far as puts that edge as near as on the original) - the long swing reaches a tank in the corner again.
        var A = Math.max(0, B.half - 320), tgt = clamp(B.tx, -A, A), dv = clamp((tgt - this.baseX) * 0.01, -0.45, 0.45);
        this.baseX += dv;
        this.wheel += dv * 0.4; if (this.wheel < 0) this.wheel += 12; if (this.wheel >= 12) this.wheel -= 12;
      }
      if (this.a1 >= 6.28318) this.a1 -= 6.28318;
      if (this.a2 >= 6.28318) this.a2 -= 6.28318;
      this.x = (Math.cos(this.a2) + Math.cos(this.a1)) * 100 + this.baseX;
      // wrecking ball on its chain, hanging from the top of the tower (x, 50)
      this.bx += this.bvx; this.by += this.bvy + 0.5;
      var dx = this.bx - this.x, dy = this.by - 50, d = Math.sqrt(dx * dx + dy * dy) || 1, k = this.L / d;
      this.bx = dx * k + this.x; this.by = dy * k + 50;
      this.bvx += (this.x - this.bx) * 0.00025;
      this.bvy = (this.L + 50 - this.by) * 0.01;
      if (this.loose) {
        var q = this.loose;
        q.x += q.vx; q.y += q.vy; q.vy += 0.1;
        this.L = Math.max(0, this.L - 2);
      }
      if (this.dying) return;
      if (!B.bossDeath && !B.deathTimer && B.tankHit(S('wrecker/ball'), this.bx, this.by, 0, 0, false)) B.killTank();
      if (this.by < 410) this.grounded = false;
      else if (this.L === this.maxL && B.mission === 12 && !this.grounded) {
        for (var i = 0; i < 10; i++)
          B.addProj(new HW.Boulder(B, this.bx + rnd(80) - 40, 460, rnd(600) * 0.01 + this.bvx * 0.25 - 3, rnd(200) * 0.01 - 5, true));
        B.addParticles(S('rock'), this.bx, 460, this.bvx * 0.25, -1, 20, 2, 0.05, 3, 200, true, -1);
        B.addParticles(S('smoke'), this.bx, 460, this.bvx * 0.25, -2, 10, 1, 0.05, 3, 200, false, -1);
        this.grounded = true; B.shake = Math.max(B.shake, 128);
        HW.snd(79, this.bx);
      }
      if (!B.deathTimer && this.collidable) {
        if (this.maxL > this.L) { this.L += 0.5; if (!this.chain) this.chain = HW.Audio.play('chain', { loop: true }); }
        else if (this.chain) { HW.Audio.stop(this.chain); this.chain = null; }
      } else if (HW.P.lives > 0 && this.L > 200) {
        this.L -= 0.5; if (!this.chain) this.chain = HW.Audio.play('chain', { loop: true });
      } else if (this.chain) { HW.Audio.stop(this.chain); this.chain = null; }
    },
    draw: function (ctx) {
      var x = this.x, y = this.y, bx = this.bx, by = this.by;
      this.drawPiece(ctx, this.body, this.baseX, y + 181, 0, 0, false, this.flash);
      this.drawPiece(ctx, this.tower, x, y, 0, 0, false, this.flash);
      var sh = S('wrecker/shadow'), sby = this.loose ? this.loose.y : by, sbx = this.loose ? this.loose.x : bx;
      if (sh && sby < 470) { ctx.save(); ctx.globalAlpha = clamp((sby - 200) / 255, 0, 1); D.celC(ctx, sh, Math.round(sbx), 465, 0, 0); ctx.restore(); }
      var wh = S('wrecker/wheel'), f = Math.floor(this.wheel) % 12;
      [-215, 215, -133, 133].forEach(function (o) { this.drawPiece(ctx, wh, this.baseX + o, y + 225, f, 0, false, this.flash); }, this);
      var link = S('wrecker/link'), n = Math.max(1, Math.floor(this.L / 16));
      if (this.L > 8) for (var i = 1; i < n; i++) D.celC(ctx, link, Math.round(x + (bx - x) * i / n), Math.round(50 + (by - 50) * i / n), 0, 0);
      if (this.loose) { if (this.loose.y < 600) D.celC(ctx, S('wrecker/ball'), Math.round(this.loose.x), Math.round(this.loose.y), 0, 0); }
      else D.celC(ctx, S('wrecker/ball'), Math.round(bx), Math.round(by), 0, 0);
      ctx.fillStyle = 'rgb(192,192,192)'; ctx.fillRect(Math.round(x - 12), 35, 24, 10);
    }
  });

  /* ================================================================== 5. KOMMIE KONG ape (0x438be0 / 0x437e50 / 0x4382a0) */
  Bosses.Ape = defBoss('Ape', {
    anchorY: 460,
    setup: function () {
      var B = this.B, j = this.d.Jump || { xspeed: 1.35, yspeed: 4, gravity: 0.06 };
      this.spr = S('ape/ape');
      this.bodies = [{ spr: this.spr, ox: 0, oy: 0 }];
      this.w = 300; this.h = 300;
      this.dir = 1; this.x = 380 + (B.half - 320); this.y = 315; this.vx = 0; this.vy = 0;
      this.timer = 100; this.throws = 0; this.jumpCd = 0; this.throwing = false; this.shakeT = 0;
      this.J = j; this.throwSpd = this.d.throw || 0.04; this.frame = 0; this.airborne = false;
    },
    update: function () {
      var B = this.B;
      this.baseBoss();
      // (0x437e50 has no death check: the ape goes on with its jump while it blows up; only throws stop)
      // walk in with the scrolling ground and stop at the classic spot (~260 px right of centre)
      if (this.x > 260 && !this.collidable && !this.arrived) { this.x -= Math.max(0.6, B.speed * 1.35); this.syncBody(); return; }
      this.arrived = true;
      if (!this.dying) this.collidable = true;
      if (B.deathTimer) this.throws = 3;
      if (this.timer) {
        if (--this.timer === 0) {
          if (this.throws === 3) { this.jumpCd = 50; this.frame = 6; this.throws = 0; this.throwing = false; }
          else this.throwing = true;
        }
      } else if (this.throwing && !B.bossDeath && !this.dying) {
        var f0 = this.frame;
        this.frame += this.throwSpd;
        if (this.frame > 5.9) { this.frame = 0; this.throws++; this.timer = 1; }
        if (this.frame >= 4 && f0 < 4 && !B.bossDeath) {
          B.addProj(new HW.BurstRocket(B, this.x, this.y - 120, 3 - this.dir * 6, 0, !!this.dir, 6));
          HW.snd(11, this.x);
        }
      } else if (this.jumpCd) {
        if (--this.jumpCd === 0) {
          this.frame = 7; this.vy = -this.J.yspeed;
          this.vx = -(this.dir * 2 - 1) * this.J.xspeed;
          this.airborne = true;
        }
      } else if (this.airborne) {
        this.vy += this.J.gravity;
        if (this.vy > this.J.yspeed) this.vy = this.J.yspeed;
        if (this.vy > 0.5) this.frame = 8;
        this.y += this.vy; this.x += this.vx;
        if (this.y > 315) {
          if (!B.bossDeath) { B.shake = Math.max(B.shake, 128); HW.snd(79, this.x); if (window.HWNative && HWNative.vibrate) HWNative.vibrate(120); }
          this.y = 315; this.vx = 0; this.vy = 0; this.frame = 0; this.airborne = false;
          if (Math.abs(this.x) < 100) { this.jumpCd = 50; this.frame = 6; }
          else { this.timer = 1; if (!B.bossDeath) this.dir ^= 1; }
        }
      }
      // hold the respawning tank while the ape is in its way on the left
      if (B.deathTimer === 2 && ((this.throws === 3 && this.dir === 1) || (!this.dir && this.x < 0))) B.deathTimer = 3;
      this.syncBody();
      if (!B.bossDeath && !B.deathTimer) this.contactKill(this.spr, this.x, this.y, Math.floor(this.frame), 0, !!this.dir);
    },
    syncBody: function () { this.bodies[0].col = Math.floor(this.frame); this.bodies[0].flip = !!this.dir; },
    draw: function (ctx) {
      var sh = S('ape/shadow');
      if (sh) { ctx.save(); ctx.globalAlpha = clamp((255 - (315 - this.y)) / 255, 0, 1); D.celC(ctx, sh, Math.round(this.x + (this.dir ? 10 : -10)), 455, 0, 0); ctx.restore(); }
      this.drawBodies(ctx);
    }
  });

  /* ================================================================== 6. EYEBOT (0x43ba90 / 0x43aaa0 / 0x43a700, hands 0x43c000 / 0x43c080) */
  var EYE_HANDS = [[-54, -54], [-76, 0], [-54, 54], [54, -54], [76, 0], [54, 54]];
  /* 0x43ba90 ctor / 0x43aaa0 update / 0x43a700 draw; hands 0x43c000 (update 0x43c080, destroyed 0x43c0d0).
     Each tentacle is 8 points 12px apart rooted on the body at (tx,ty); the hand is the last point. Every frame the
     hand drifts toward its home spot, the chain is relaxed back from the hand and then re-laid from the root, so the
     tentacle always stays attached and the hand can never reach further than 84px. */
  Bosses.Eye = defBoss('Eye', {
    setup: function () {
      var hd = this.d.Hand || { armor: 300, fire: 20 };
      this.body = S('eye/body'); this.eyeSpr = S('eye/eye');
      this.bodies = [{ spr: this.eyeSpr, ox: 0, oy: 0 }];
      this.w = 160; this.h = 130;
      this.x = 0; this.y = -100; this.vx = 0; this.vy = 0;
      this.tgx = 0; this.tgy = 180 + this.sky(); this.open = 0; this.openT = 499; this.glow = 0;
      this.fire = this.d.fire || 60; this.fcd = this.fire;
      this.hfire = hd.fire; this.hcd = hd.fire; this.active = -1; this.charge = 0; this.strike = 0;
      this.everOpen = false;
      this.hands = []; this.arms = [];
      // (flying boss: boss space anchored at the screen bottom, so it hovers as high and as large as on the original)
      for (var k = 0; k < 6; k++) {
        var t = EYE_HANDS[k], step = k < 3 ? -12 : 12, pts = [];
        for (var i = 0; i < 8; i++) pts.push([t[0] + this.x + i * step, t[1] + this.y]);
        this.arms.push(pts);
        var h = this.part('eye/hand', 0, 0, hd.armor, 0);
        h.k = k; h.hx = (k < 3 ? -96 : 96) + t[0]; h.hy = t[1]; h.hvx = 0; h.hvy = 0;
        h.x = pts[7][0]; h.y = pts[7][1];
        h.onDie = this.handDied;
        this.hands.push(h);
      }
      this.alive = 6;
    },
    handDied: function (h) {
      if (this.active === h.k) { this.hcd = this.hfire; this.active = -1; this.strike = 0; this.charge = 0; }
      this.alive--;
    },
    placeParts: function () {},
    update: function () {
      var B = this.B, i, k, h, p, d, dx, dy, sk = this.sky();
      this.baseBoss();
      if (this.y > 160 + sk) this.openT++;
      if ((this.openT % 1000 < 500 || B.bossDeath) && this.alive > 0) { this.open -= 0.2; if (this.open < 0) this.open = 0; }
      else { this.open += 0.2; if (this.open > 5) this.open = 5; }
      if (this.open > 0) {
        this.collidableBody = true; this.everOpen = true;
        this.glow = Math.trunc((Math.cos((HW.frame % 63) * 0.1) + 1) * this.open * 0.2 * 127);
      } else { this.collidableBody = false; this.glow = 0; }
      // the craft stays in the hit loops while any hand can be shot; the eye itself only while open
      this.collidable = !this.dying && (this.collidableBody || (this.everOpen && this.alive > 0));
      if (HW.frame % 50 === 0) {
        this.tgx = (rnd(400) - 200) * Math.max(1, B.half / 320); this.tgy = rnd(20) + 180 + sk;
        for (k = 0; k < 6; k++) { h = this.hands[k]; h.hx = rnd(40) - 20 + EYE_HANDS[k][0]; h.hy = rnd(40) - 20 + EYE_HANDS[k][1]; }
      }
      if (this.x < this.tgx && this.vx < 1.5) this.vx += 0.02;
      if (this.x > this.tgx && this.vx > -1.5) this.vx -= 0.02;
      if (this.y < this.tgy && this.vy < 0.5) this.vy += 0.01;
      if (this.y > this.tgy && this.vy > -0.5) this.vy -= 0.01;
      this.x += this.vx; this.y += this.vy;
      for (k = 0; k < 6; k++) {
        var t = EYE_HANDS[k], A = this.arms[k];
        h = this.hands[k];
        var wx = t[0] + h.hx + this.x, wy = t[1] + h.hy + this.y, e = A[7];
        if (wx > e[0] && h.hvx < 1) h.hvx += 0.01;
        if (wx < e[0] && h.hvx > -1) h.hvx -= 0.01;
        if (e[1] < wy && h.hvy < 1) h.hvy += 0.01;
        if (e[1] > wy && h.hvy > -1) h.hvy -= 0.01;
        e[0] += h.hvx + this.vx; e[1] += h.hvy + this.vy;
        for (i = 6; i >= 0; i--) {
          p = A[i]; dx = p[0] - A[i + 1][0]; dy = p[1] - A[i + 1][1]; d = Math.sqrt(dx * dx + dy * dy);
          if (Math.trunc(d) !== 12 && d > 0) { p[0] = dx * 12 / d + A[i + 1][0]; p[1] = dy * 12 / d + A[i + 1][1]; }
        }
        A[0][0] = t[0] + this.x; A[0][1] = t[1] + this.y;
        for (i = 1; i < 8; i++) {
          p = A[i]; dx = p[0] - A[i - 1][0]; dy = p[1] - A[i - 1][1]; d = Math.sqrt(dx * dx + dy * dy);
          if (Math.trunc(d) !== 12 && d > 0) { p[0] = dx * 12 / d + A[i - 1][0]; p[1] = dy * 12 / d + A[i - 1][1]; }
        }
        if (!h.dead) { h.x = A[7][0]; h.y = A[7][1]; }
      }
      // (0x43aaa0: the tentacles keep writhing through the death explosions; shots and strikes stop)
      if (this.dying) { this.active = -1; this.strike = 0; this.charge = 0; return; }
      // energy shot from the open eye
      if (!B.deathTimer && B.nukeFlash === 0 && this.y >= 160 + sk) { if (this.fcd) this.fcd--; }
      else this.fcd = this.fire;
      if (!this.fcd && this.collidableBody && this.open === 5 && !B.bossDeath) {
        var a = rnd(157) * 0.01 + 3.926;
        B.bullets.push({ x: this.x, y: this.y, vx: Math.cos(a) * -3, vy: Math.sin(a) * -3, g: 0, enemy: true, spr: S('bombfrag'), frame: 0, row: 0 });
        this.fcd = this.fire;
        HW.snd(51, this.x);
      }
      // lightning hands while the eye is shut
      if (!this.collidableBody && this.active === -1 && this.y > 160 + sk) {
        if (B.deathTimer || B.nukeFlash) this.hcd = this.hfire;
        else if (this.hcd) this.hcd--;
        if (!this.hcd && !B.bossDeath) {
          var cand = this.hands.filter(function (hh) { return !hh.dead && hh.y > 80 + sk; });
          if (cand.length) { this.active = cand[rnd(cand.length)].k; this.hcd = this.hfire; HW.snd(81, this.x); }
        }
      }
      if (this.active >= 0) {
        h = this.hands[this.active];
        if (B.nukeFlash) { this.active = -1; this.strike = 0; this.charge = 0; }
        else if (this.charge < 255 && !this.strike) {
          this.charge += 2.5;
          if (this.charge >= 255) { this.charge = 255; this.strike = 50; HW.snd(80, h.x); }
        } else if (this.strike > 0) {
          if (!B.deathTimer && B.tx + 40 > h.x && B.tx - 40 < h.x) B.killTank();
          if (--this.strike === 0) { this.charge = 0; this.active = -1; }
        }
      }
    },
    hitTest: function (spr, x, y, col, row, flip) {
      if (this.dying) return false;
      if (this.collidableBody && HW.collide(this.eyeSpr, this.x, this.y, Math.floor(this.open), 0, false, spr, x, y, col, row, flip)) {
        this.hitPart = null; return true;
      }
      if (!this.everOpen) return false;
      for (var i = 0; i < 6; i++) {
        var h = this.hands[i];
        if (h.dead) continue;
        if (HW.collide(h.spr, h.x, h.y, 0, 0, false, spr, x, y, col, row, flip)) { this.hitPart = h; return true; }
      }
      return false;
    },
    draw: function (ctx) {
      var i, k, h, A, arm = S('eye/arm');
      for (k = 0; k < 6; k++) {
        A = this.arms[k];
        for (i = 7; i >= 0; i--) D.celC(ctx, arm, Math.trunc(A[i][0]), Math.trunc(A[i][1]), 0, 0);
        h = this.hands[k];
        if (h.dead) continue;
        this.drawPiece(ctx, h.spr, Math.trunc(h.x), Math.trunc(h.y), 0, 0, false, h.flash);
        if (this.charge > 0 && this.active === k) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.trunc(this.charge) / 255;
          D.celC(ctx, S('eye/handglow'), Math.trunc(h.x), Math.trunc(h.y), 0, 0);
          ctx.restore();
        }
      }
      this.drawPiece(ctx, this.body, this.x, this.y, 0, 0, false, 0);
      if (this.collidableBody) {
        this.drawPiece(ctx, this.eyeSpr, this.x, this.y, Math.floor(this.open), 0, false, this.flash);
        if (this.glow > 0) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, this.glow / 255);
          D.celC(ctx, S('eye/glow'), Math.round(this.x), Math.round(this.y), 0, 0);
          ctx.restore();
        }
      }
      if (this.strike > 0 && this.active >= 0) {
        // the bolt hangs from the hand and the whole screen flickers with it (additive grey)
        h = this.hands[this.active];
        var g = Math.trunc((HW.frame % 10) * 25.5) / 255;
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = g;
        D.cel(ctx, S('eye/bolt'), Math.trunc(h.x - 30), Math.trunc(h.y - 22), 0, 0);
        ctx.fillStyle = '#fff'; ctx.fillRect(-this.B.half - 50, -1500, this.B.half * 2 + 100, 3000);
        ctx.restore();
      }
    }
  });

  /* ================================================================== 7. BUSTCZAR head (0x43f310 / 0x43e2c0) */
  Bosses.Head = defBoss('Head', {
    setup: function () {
      var B = this.B;
      this.spr = S('head/head');
      this.bodies = [{ spr: this.spr, ox: 0, oy: 0 }];
      this.w = 232; this.h = 250;
      this.dir = 0; this.x = -440 - (B.half - 320); this.y = 160 + this.sky(); this.tx = this.x; this.ty = 160 + this.sky();
      this.speed = this.d.speed || 3;
      this.l1 = (this.d.Launcher1 || { fire: 100 }).fire; this.l2 = (this.d.Launcher2 || { fire: 150 }).fire;
      this.cd1 = this.l1; this.cd2 = this.l2;
      this.bomb = this.d.Bomb || { on: 30, off: 30, freq: 6 };
      this.chargeT = (this.d.Charge || { delay: 500 }).delay; this.chargeDelay = this.chargeT;
      this.sweep = false; this.bombT = 0;
    },
    update: function () {
      var B = this.B, e = B.half - 320, sk = this.sky();
      this.baseBoss();
      this.x += this.vx; this.y += this.vy;
      this.vx = (this.tx - this.x) * 0.02; this.vy = (this.ty - this.y) * 0.02;
      var v = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
      if (v > this.speed) { this.vx *= this.speed / v; this.vy *= this.speed / v; }
      this.bodies[0].flip = !!this.dir;
      if (this.dying || B.bossDeath) { this.tx = 0; this.ty = 200 + sk; return; }
      if (!this.sweep) {
        this.ty = 160 + sk; this.tx = this.dir ? 220 : -220;
        if (v < 0.1) {
          this.collidable = true;
          if (this.chargeT) this.chargeT--;
          else {
            this.sweep = true; this.bombT = this.bomb.on + this.bomb.off;
            this.ty = 220 + sk; this.tx = this.dir ? 440 + e : -440 - e;
          }
        }
      } else {
        this.tx += this.dir ? -3 : 3;
        if (this.x < -520 - e || this.x > 520 + e) { this.sweep = false; this.dir ^= 1; this.chargeT = this.chargeDelay; }
      }
      if (this.x > -B.half + 20 && this.x < B.half - 20 && B.nukeFlash === 0) {
        if (!this.sweep) {
          if (B.deathTimer) { this.cd1 = this.l1; this.cd2 = this.l2; }
          else { this.cd1--; this.cd2--; }
          if (this.cd1 <= 0) { B.addProj(new HW.HeadMissile(B, this.x + 76 - this.dir * 152, this.y - 40, !!this.dir)); this.cd1 = this.l1; }
          if (this.cd2 <= 0) { B.addProj(new HW.HeadMissile(B, this.x + 104 - this.dir * 208, this.y - 40, !!this.dir)); this.cd2 = this.l2; }
        }
      }
      if (this.sweep && B.nukeFlash === 0) {
        if (this.bombT) this.bombT--; else this.bombT = this.bomb.off + this.bomb.on;
        if (this.bombT < this.bomb.on && HW.frame % this.bomb.freq === 0 && !B.deathTimer)
          B.addProj(new HW.IronBomb(B, this.x + rnd(40) - 20, this.y + 135, 0, 0, false));
      }
    }
  });

  /* ================================================================== 8. MECHWORM */
  /* boulder (0x447e00 / 0x447fa0 / 0x447ed0) */
  function Boulder(B, x, y, vx, vy, dark) {
    this.init(B, 'boulder', x, y, vx, vy, false);
    this.frame = rnd(5); this.points = 0; this.hp = 20; this.dark = !!dark;
  }
  Boulder.prototype = Object.create(HW.Proj.prototype);
  Boulder.prototype.update = function () {
    this.x += this.vx; this.y += this.vy;
    if (this.vy < 2) this.vy += 0.05;
    if (this.offX()) { this.remove(); return; }
    if (this.y > 460) { this.B.addExplosion(this.x, this.y, 90, 90, 0, -1, 0); this.B.addCrater(this.x, 0); this.remove(); return; }
    if (this.B.deathTimer) { this.shieldCheck(); return; }
    if (this.B.tankHit(this.spr, this.x, this.y, this.frame, 0, false)) {
      this.B.addExplosion(this.x, this.y, 90, 90, 0, -1, 0); this.B.killTank(); this.remove(); return;
    }
    this.shieldCheck();
  };
  Boulder.prototype.draw = function (ctx) {
    HW.Proj.prototype.draw.call(this, ctx);
    if (this.dark) { ctx.save(); ctx.globalAlpha = 0.5; D.celC(ctx, D.mulTint(this.spr, '#000000'), Math.round(this.x), Math.round(this.y), this.frame, 0); ctx.restore(); }
  };
  HW.Boulder = Boulder;

  /* 0x445800 ctor / 0x4442b0 update / 0x443f80 draw; turret segments 0x445b90 / 0x445c30.
     The body is a 30 point trail (each point eases 1/8 toward the one ahead), turrets ride on points 9, 19 and 29. */
  Bosses.Worm = defBoss('Worm', {
    anchorY: 460,
    setup: function () {
      var d = this.d, tu = d.Turret || { armor: 500, fire: 60 };
      this.head = S('worm/head'); this.rib = S('worm/rib'); this.sandSpr = S('worm/sand');
      this.w = 150; this.h = 150;
      this.bodies = [{ spr: this.head, ox: 0, oy: 0, col: 0 }];
      this.tFire = tu.fire;
      this.px = []; this.py = [];
      this.fireT = d.fire; this.angry = false;
      this.sandX = 0; this.sandA = 0; this.sandR = 0;
      this.params();
      this.relaunch(true);
      this.segs = [];
      for (var i = 0; i < 3; i++) {
        var p = this.part('worm/turret', 0, 0, tu.armor, 0);
        p.idx = 9 + i * 10; p.ft = tu.fire; p.vx = 0; p.vy = 0;
        p.x = this.px[p.idx]; p.y = this.py[p.idx];
        this.segs.push(p);
      }
      this.x = this.px[0]; this.y = this.py[0];
    },
    params: function () {
      var J = (this.angry && this.d.JumpFast) || this.d.Jump || { depth: 1100, jump: 4, gravity: 0.02, lateral: 1 };
      this.depth = J.depth; this.jump = J.jump; this.grav = J.gravity; this.lateral = J.lateral;
    },
    /* 0x4441b0: dive back in somewhere new */
    relaunch: function (first) {
      var B = this.B, x;
      if (this.angry) x = B.tx;
      else if (!first) x = (rnd(160) + 100) * (rnd(2) ? 1 : -1);
      else x = -200;
      if (B.tx < -B.half + 20) x = 200;
      for (var i = 0; i < 30; i++) { this.px[i] = x; this.py[i] = this.depth; }
      this.y = this.depth; this.vy = -this.jump;
    },
    placeParts: function () {},
    hitTest: function (spr, x, y, col, row, flip) {
      if (this.dying) return false;
      for (var i = 0; i < 3; i++) {
        var p = this.segs[i];
        if (p.dead || p.y > 520) continue;
        if (HW.collide(p.spr, p.x, p.y, 0, 0, false, spr, x, y, col, row, flip)) { this.hitPart = p; return true; }
      }
      if (this.y < 480 && HW.collide(this.head, this.x, this.y, Math.floor(this.frame), 0, false, spr, x, y, col, row, flip)) {
        this.hitPart = null; return true;
      }
      return false;
    },
    update: function () {
      var B = this.B, P = this.px, Q = this.py, i, p;
      this.baseBoss();
      var dying = this.dying || !!B.bossDeath;
      this.angry = !this.segs.some(function (s) { return !s.dead; });
      this.params();
      if (this.angry) {
        // all three turrets gone: the head launches homing missiles itself
        if (B.deathTimer) this.fireT = this.d.fire; else this.fireT--;
        if (this.y < 280 && this.fireT <= 0 && B.nukeFlash === 0 && !dying) {
          B.addProj(new HW.Hellfire(B, this.x, this.y, this.vx, this.vy, 1));
          this.fireT = this.d.fire;
        }
      }
      if (!dying) {
        this.frame += 0.3; if (this.frame >= 10) this.frame -= 10;
        Q[0] += this.vy;
        if (Q[0] < 520) {
          P[0] += this.vx;
          this.vy += this.grav;
          if (this.vy > this.jump) this.vy = this.jump;
        } else {
          this.vx = clamp((B.tx - P[0]) * 0.01, -this.lateral, this.lateral);
        }
      } else {
        if (HW.frame % 50 === 0) {
          this.vx = rnd(200) * 0.01 - 1 - P[0] * 0.0015625;
          this.vy = rnd(200) * 0.01 - 1 - (Q[0] - 240) * 0.0020833333333333333;
        }
        P[0] += this.vx; Q[0] += this.vy;
      }
      this.x = P[0]; this.y = Q[0];
      if (Q[29] > 795 && this.depth < Q[0]) this.relaunch(false);
      for (i = 1; i < 30; i++) { P[i] -= (P[i] - P[i - 1]) * 0.125; Q[i] -= (Q[i] - Q[i - 1]) * 0.125; }
      this.collidable = !this.dying && (this.y < 480 || this.segs.some(function (s) { return !s.dead && s.y < 480; }));
      // burrowing dust where the body breaks the surface
      var A = Q[0], T = Q[29];
      if ((A < 460 && T >= 460) || (A > 460 && T <= 460) || (A > 500 && this.vy < 0)) {
        if (this.sandR !== 8) { this.sandX = Math.trunc(P[0]); this.sandR = 8; HW.snd(72, this.sandX); }
      } else this.sandR = -2;
      if (A > 460 && A + this.vy < 460 && this.d.boulders > 0) {
        for (i = 0; i < this.d.boulders; i++)
          B.addProj(new Boulder(B, rnd(80) + P[0] - 40, 460, rnd(400) * 0.01 + this.vx - 2, rnd(200) * 0.01 - 5));
        if (window.HWNative && HWNative.vibrate) HWNative.vibrate(120);
      }
      this.sandA += this.sandR;
      if (this.sandA > 255) {
        this.sandA = 255;
        if (HW.frame % 5 === 0) B.addParticles(S('sanddust'), this.sandX + rnd(100) - 50, 500, 0, -1, 1, 0.5, -0.01, -1, 120, true, -1);
      } else if (this.sandA < 0) this.sandA = 0;
      // the whole body crushes the tank (the original head test reads past the trail arrays, so only the ribs count)
      if (!B.bossDeath && !B.deathTimer) {
        for (i = 0; i < 30; i++) {
          if (Q[i] > 520) continue;
          if (B.tankHit(this.rib, P[i], Q[i], 0, 0, false)) { B.killTank(); break; }
        }
      }
      if (B.deathTimer === 2 && (this.y < 460 || Q[29] < 460)) B.deathTimer = 3;
      // turret segments (separate crafts in the original, updated after the worm)
      for (i = 0; i < 3; i++) {
        p = this.segs[i];
        if (p.dead) continue;
        var k = p.idx;
        p.vx = P[k] - p.x; p.vy = Q[k] - p.y;
        p.x = P[k]; p.y = Q[k];
        if (p.y < 460) {
          if (B.deathTimer) p.ft = this.tFire; else p.ft--;
          if (p.ft <= 0 && p.y < 280 && B.nukeFlash === 0 && p.vy < 1 && !B.bossDeath) {
            p.ft = this.tFire;
            var bvx = clamp((B.tx - p.x) * 0.0125, -3, 3) + rnd(200) * 0.01 - 1;
            B.addProj(new HW.IronBomb(B, p.x, p.y, bvx, p.vy, bvx < 0));
          }
        }
      }
    },
    draw: function (ctx) {
      var P = this.px, Q = this.py, i;
      for (i = 29; i >= 0; i--) {
        if (Q[i] > 540) continue;
        D.celC(ctx, this.rib, Math.round(P[i]), Math.round(Q[i]), i & 3, 0);
      }
      for (i = 0; i < 3; i++) {
        var p = this.segs[i];
        if (!p.dead && p.y < 540) this.drawPiece(ctx, p.spr, p.x, p.y, 0, 0, false, p.flash);
      }
      if (this.y < 560) this.drawPiece(ctx, this.head, this.x, this.y, Math.floor(this.frame), 0, false, this.flash);
      if (this.sandA > 0) {
        ctx.save(); ctx.globalAlpha = this.sandA / 255;
        D.celC(ctx, this.sandSpr, Math.round(this.sandX), 460, (HW.frame >> 3) & 3, 0);
        ctx.restore();
      }
    }
  });

  /* ================================================================== 9. X-BOT robot (0x443210 / update 0x441fb0 / draw 0x442490; arms 0x443720, launchers 0x443d00) */
  /* eye beam (0x4438f0 / 0x443a00 / 0x443ba0): a 50px tapered bolt that scorches the ground */
  HW.EyeBeam = HW.defProj({
    setup: function (B, x, y) {
      this.init(B, 'rock', x, y, 0, 0, false);
      this.shootable = false; this.points = 0;
      this.tailX = x; this.tailY = y; this.burnt = false;
      this.ang = Math.atan2(x - B.tx, B.ty - y) + 1.57;
      this.vx = Math.cos(this.ang) * 4; this.vy = Math.sin(this.ang) * 4;
      HW.snd(71, x);
    },
    update: function () {
      var B = this.B, tail = true;
      if (this.y < 460) {
        this.x += this.vx; this.y += this.vy;
        var dx = this.x - this.tailX, dy = this.y - this.tailY;
        if (Math.sqrt(dx * dx + dy * dy) <= 50) tail = false;
      } else if (!this.burnt) {
        B.addScorch(this.x, 255, false);
        this.burnt = true;
      }
      if (tail) { this.tailX += this.vx; this.tailY += this.vy; }
      if (this.tailX < -B.half || this.tailX > B.half || this.tailY > 460) { this.remove(); return; }
      if (B.deathTimer) { this.shieldCheck(); return; }
      if (B.tankHit(this.spr, this.x, this.y, 0, 0, false)) { B.killTank(); this.remove(); return; }
      this.shieldCheck();
    },
    draw: function (ctx) {
      var c = Math.cos(this.ang + 1.57), s = Math.sin(this.ang + 1.57);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (var e = 2; e >= 1; e--) {
        var w1 = e * 4 + 1, w2 = e + 1;
        ctx.fillStyle = e === 2 ? 'rgb(128,32,64)' : '#fff';
        ctx.beginPath();
        ctx.moveTo(this.x + c * w1, this.y + s * w1);
        ctx.lineTo(this.x - c * w1, this.y - s * w1);
        ctx.lineTo(this.tailX - c * w2, this.tailY - s * w2);
        ctx.lineTo(this.tailX + c * w2, this.tailY + s * w2);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  });

  /* The robot drops in from the sky at the centre and keeps hopping at the tank: it accelerates down while above
     y=210 and springs back up below it, so the feet (y+208, stopped by the ground at 410) stamp on every landing.
     The two launchers fire homing missiles; once both arms are shot off the eye charges up and fires beams. */
  Bosses.Robot = defBoss('Robot', {
    anchorY: 460,
    setup: function () {
      var d = this.d, la = d.Launcher || { armor: 700, fire: 200 }, ar = d.Arm || { armor: 750 };
      this.J = d.Jump || { downaccel: 0.04, downmax: 3, upaccel: 0.2, upmax: 3 };
      this.body = S('robot/body'); this.foot = S('robot/foot');
      this.bodies = [{ spr: this.body, ox: 0, oy: 0 }];
      this.w = 240; this.h = 420;
      this.x = 0; this.y = -240; this.vx = 0; this.vy = 0;
      this.footY = 0; this.prevFootY = 0; this.panel = 0;
      this.fireT = d.fire;
      this.arms = [this.part('robot/arms', -59, 60, ar.armor, 0), this.part('robot/arms', 59, 60, ar.armor, 0)];
      this.arms[0].col = 0; this.arms[1].col = 1;
      this.lns = [this.part('robot/launchers', -52, -26, la.armor, 0), this.part('robot/launchers', 52, -26, la.armor, 0)];
      this.lns[0].col = 0; this.lns[1].col = 1;
      this.lns.forEach(function (p) { p.ft = la.fire; p.fire = la.fire; });
      this.collidable = true;
    },
    placeParts: function () {
      var x = Math.trunc(this.x), y = Math.trunc(this.y);
      for (var i = 0; i < this.parts.length; i++) { var p = this.parts[i]; p.x = x + p.ox; p.y = y + p.oy; }
    },
    update: function () {
      var B = this.B, J = this.J, e = B.half - 320, i, p;
      this.baseBoss();
      this.panel += 0.1; if (this.panel >= 4) this.panel -= 4;
      if (this.y < 210) { this.vy += J.downaccel; if (this.vy > J.downmax) this.vy = J.downmax; }
      else if (!B.bossDeath) { this.vy -= J.upaccel; if (this.vy < -J.upmax) this.vy = -J.upmax; }
      var fy = this.y + 208;
      if (fy > this.footY) this.footY = fy;
      if (this.footY >= 410) this.footY = 410;
      if (this.footY === 410 && this.prevFootY < 410) {
        HW.snd(70, this.x); B.shake = Math.max(B.shake, 128);
        if (window.HWNative && HWNative.vibrate) HWNative.vibrate(120);
      }
      if (fy < this.footY) this.footY = fy;
      if (this.prevFootY === 410 && this.footY < 410) {
        // take off: hop toward the tank (target range widened with the screen)
        var lim = 240 + e, t;
        if (!B.deathTimer && B.tx >= -300 - e) t = clamp(B.tx, -lim, lim); else t = lim;
        this.vx = clamp((rnd(1000) * 0.0005 + 0.5) * (t - this.x) * 0.02, -1.5, 1.5);
      }
      this.prevFootY = this.footY;
      if (!B.bossDeath && !B.deathTimer && B.tankHit(this.foot, this.x, this.footY, 0, 0, false)) B.killTank();
      if (this.footY < 410) this.x += this.vx;
      if (this.y < 260) this.y += this.vy;
      this.placeParts();
      if (this.dying) return;
      var inX = this.x > -300 - e && this.x < 300 + e;
      if (!B.deathTimer && this.arms[0].dead && this.arms[1].dead) this.fireT--; else this.fireT = this.d.fire;
      if (inX && this.fireT <= 0 && B.nukeFlash === 0 && !B.bossDeath) {
        B.addProj(new HW.EyeBeam(B, this.x - 10, this.y - 55));
        B.addProj(new HW.EyeBeam(B, this.x + 10, this.y - 55));
        this.fireT = this.d.fire;
      }
      for (i = 0; i < 2; i++) {
        p = this.lns[i];
        if (p.dead) continue;
        if (B.deathTimer) p.ft = p.fire; else p.ft--;
        if (p.x > -300 - e && p.x < 300 + e && p.ft <= 0 && B.nukeFlash === 0) {
          if (!B.bossDeath) B.addProj(new HW.Hellfire(B, p.x, p.y, this.vx, this.vy, 1));
          p.ft = p.fire;
        }
      }
    },
    hitTest: function (spr, x, y, col, row, flip) {
      if (this.dying) return false;
      if (HW.collide(this.body, this.x, this.y, 0, 0, false, spr, x, y, col, row, flip)) { this.hitPart = null; return true; }
      for (var i = 0; i < this.parts.length; i++) {
        var p = this.parts[i];
        if (p.dead) continue;
        if (HW.collide(p.spr, p.x, p.y, p.col, 0, false, spr, x, y, col, row, flip)) { this.hitPart = p; return true; }
      }
      return false;
    },
    draw: function (ctx) {
      var x = Math.round(this.x), y = Math.round(this.y);
      this.drawPiece(ctx, this.body, x, y, 0, 0, false, this.flash);
      D.celC(ctx, S('robot/panel'), x, y + 37, Math.floor(this.panel), 0);
      this.drawPiece(ctx, S('robot/waist'), x, y + 126, 0, 0, false, this.flash);
      this.drawPiece(ctx, this.foot, x, Math.round(this.footY), 0, 0, false, this.flash);
      if (this.fireT > 0 && this.arms[0].dead && this.arms[1].dead) {
        var g = clamp(255 - 255 / this.d.fire * this.fireT, 0, 255);
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = g / 255;
        D.celC(ctx, S('robot/eyeglow'), x, y - 55, 0, 0);
        ctx.restore();
      }
      this.drawParts(ctx);
    }
  });

  /* ================================================================== 10. SECRET WEAPON (0x43de30 / update 0x43c620 / draw 0x43c240) */
  /* stage-one laser (0x44b950 / 0x44ba10 / 0x44a990): a 40 point trail of glowing blobs; type 0 drops straight,
     type 1 cuts diagonally inward, type 2 weaves. It is not stopped by the shield. */
  HW.FinalLaser = HW.defProj({
    setup: function (B, x, y, type, dir) {
      this.init(B, 'bombfrag', x, y, 0, 0, false);
      this.type = type; this.dir = dir; this.acc = dir * 0.1; this.vx = 0;
      this.shootable = false; this.points = 0; this.burnt = false;
      this.px = []; this.py = [];
    },
    update: function () {
      var B = this.B;
      if (this.type === 0) this.y += 3.5;
      else if (this.type === 1) { this.x += this.dir * 3; this.y += 3; }
      else {
        this.x += this.vx; this.vx += this.acc;
        if (this.vx < -5) this.acc = 0.075;
        if (this.vx > 5) this.acc = -0.075;
        this.y += 2;
      }
      if (this.y > 460 && !this.burnt) { this.burnt = true; B.addScorch(this.x, 300, false); }
      if (this.py.length && this.py[0] > 460) { this.remove(); return; }
      this.px.push(Math.trunc(this.x)); this.py.push(Math.trunc(this.y));
      if (this.px.length > 40) { this.px.shift(); this.py.shift(); }
      if (B.deathTimer) return;
      for (var i = 0; i < this.px.length; i++) {
        if (B.tankHit(this.spr, this.px[i], this.py[i], 0, 0, false)) { B.killTank(); break; }
      }
    },
    draw: function (ctx) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < this.px.length; i++) if (this.py[i] < 460) D.celC(ctx, this.spr, this.px[i], this.py[i], 0, 0);
      ctx.restore();
    }
  });

  /* The secret weapon sinks in from the top and becomes vulnerable below y=150. It changes body at 66% and 33%
     armour: stage one fires twin lasers from its wing cannons whenever it settles at a new spot, stage two spins a
     turret spraying arcing shots and drops atomic bombs, stage three fires homing missiles from two launcher pairs. */
  Bosses.Final = defBoss('Final', {
    setup: function () {
      var d = this.d;
      this.stages = [S('finalboss/body1'), S('finalboss/body2'), S('finalboss/body3')];
      this.stage = 0;
      this.bodies = [{ spr: this.stages[0], ox: 0, oy: 0 }];
      this.w = 360; this.h = 234;
      this.x = 0; this.y = -140; this.vx = 0; this.vy = 0.5;
      this.tgx = 0; this.tgy = 160 + this.sky();
      this.timer = 80; this.phase = 0; this.anim = 0; this.lastLaser = 2;
      this.prevArmor = this.armor;
      this.fTurret = (d.Turret || { fire: 60 }).fire;
      this.slF = (d.SmallLauncher || { fire: 120 }).fire; this.blF = (d.BigLauncher || { fire: 160 }).fire;
      this.bombF = (d.Bomb || { fire: 200 }).fire;
      this.slT = this.slF; this.blT = this.blF; this.bombT = this.bombF;
      this.collidable = false;
    },
    nextStage: function (n) {
      var B = this.B, spr = this.stages[this.stage];
      var s = Math.max(spr.cw, spr.ch) + 20;
      B.addExplosion(this.x, this.y, s, s, this.vx, this.vy, 0);
      this.stage = n;
      this.bodies[0].spr = this.stages[n];
      this.w = this.stages[n].cw; this.h = this.stages[n].ch;
      if (n === 1) { this.anim = 0; this.timer = this.fTurret; }
    },
    ai: function () {
      var B = this.B, k = Math.max(1, B.half / 320), sk = this.sky();
      if (this.stage === 0) {
        if (Math.abs(this.x - this.tgx) < 10 && Math.abs(this.y - this.tgy) < 10) {
          if (!B.deathTimer) this.timer--; else this.timer = 80;
          if (this.timer < 80 && B.nukeFlash === 0) {
            if (this.phase === 0) HW.snd(86, this.x);
            if (this.phase > 1.5 && this.phase < 1.54 && !B.bossDeath) {
              var i;
              do { i = rnd(3); } while (i === this.lastLaser);
              this.lastLaser = i;
              B.addProj(new HW.FinalLaser(B, this.x - 156, this.y + 10, i, 1));
              B.addProj(new HW.FinalLaser(B, this.x + 157, this.y + 10, i, -1));
              HW.snd(87, this.x);
            }
          }
          var t = this.timer;
          if ((t < 80 || (this.phase > 0 && B.deathTimer)) && (B.nukeFlash === 0 || this.phase !== 0) && this.phase < Math.PI) {
            this.anim += Math.sin(this.phase) * 0.5; if (this.anim >= 5) this.anim -= 5;
            this.phase += 0.04; if (this.phase > Math.PI) this.phase = Math.PI;
          }
          if (!t) {
            var n = 0;
            do { this.tgx = (rnd(200) - 100) * k; this.tgy = rnd(40) + 140 + sk; }
            while (Math.sqrt((this.tgx - this.x) * (this.tgx - this.x) + (this.tgy - this.y) * (this.tgy - this.y)) < 60 && ++n < 50);
            this.phase = 0; this.timer = 80;
          }
        }
        var dvx = (this.tgx - this.x) * 0.2, dvy = (this.tgy - this.y) * 0.2;
        if (this.vx < dvx) this.vx += 0.1;
        if (this.vx > dvx) this.vx -= 0.1;
        if (dvy > this.vy) this.vy += 0.03;
        if (dvy < this.vy) this.vy -= 0.03;
        if (Math.abs(dvx) < Math.abs(this.vx)) this.vx = dvx;
        if (Math.abs(dvy) < Math.abs(this.vy)) this.vy = dvy;
      } else {
        if (HW.frame % 50 === 0) {
          this.tgx = (rnd(400) - 200) * k;
          this.tgy = rnd(40) - 20 + (this.stage + 16) * 10 + sk;
        }
        if (this.x < this.tgx && this.vx < 2) this.vx += 0.04;
        if (this.x > this.tgx && this.vx > -2) this.vx -= 0.04;
        if (this.y < this.tgy && this.vy < 0.5) this.vy += 0.01;
        if (this.y > this.tgy && this.vy > -0.5) this.vy -= 0.01;
      }
    },
    jets: function (pts, dvx) {
      var B = this.B, m = S('meteorite');
      for (var i = 0; i < pts.length; i++)
        B.addParticles(m, this.x + pts[i][0], this.y + pts[i][1], this.vx + (dvx ? dvx[i] : 0), this.vy + 2, 1, 0.5, 0, 0, 20, true, -1);
    },
    update: function () {
      var B = this.B, live = !B.bossDeath;
      this.baseBoss();
      // (0x43c620 goes on moving it about while it blows up; its shots stop)
      if (this.y > 150 + this.sky() && !this.collidable && !this.dying && !this.arrived) { this.collidable = true; this.arrived = true; }
      else if (this.arrived) this.ai();
      var t1 = this.maxArmor * 0.66, t2 = this.maxArmor * 0.33;
      if (t1 < this.prevArmor && t1 >= this.armor) this.nextStage(1);
      else if (t2 < this.prevArmor && t2 >= this.armor) this.nextStage(2);
      this.x += this.vx; this.y += this.vy;
      this.prevArmor = this.armor;
      var even = (HW.frame & 1) === 0, ok = !B.deathTimer && this.collidable;
      if (this.stage === 0) {
        if (even) this.jets([[92, 105], [-91, 105], [71, 109], [-70, 109], [42, 110], [-41, 110]]);
      } else if (this.stage === 1) {
        this.anim += 0.2; if (this.anim >= 16) this.anim -= 16;
        if (even) this.jets([[98, 20], [-97, 20]]);
        if (ok) { this.timer--; this.bombT--; } else { this.timer = this.fTurret; this.bombT = this.bombF; }
        if (B.nukeFlash === 0 && live) {
          if (this.bombT <= 0) { B.addProj(new HW.Fatboy(B, this.x, this.y + 100, this.vx, this.vy, false, true)); this.bombT = this.bombF; }
          if (this.timer <= 0) {
            for (var j = 0; j <= 3.141; j += 3.141) {
              var a = this.anim * 0.19630938358853553 + j, c = Math.cos(a), sn = Math.sin(a);
              var bx = 45 * c + this.x, by = this.y - 84 - sn * 45;
              B.bullets.push({ x: bx, y: by, vx: c * 2.5, vy: sn * -2.5, g: 0.1, enemy: true, spr: S('bombfrag'), frame: 0, row: 0 });
              B.addMuzzle(bx, by, this.vx, this.vy);
            }
            HW.snd(54, this.x);
            this.timer = this.fTurret;
          }
        }
      } else {
        if (even) this.jets([[75, 64], [-74, 64]], [0.5, -0.5]);
        if (ok) { this.slT--; this.blT--; } else { this.slT = this.slF; this.blT = this.blF; }
        if (this.slT <= 0 && B.nukeFlash === 0 && live) {
          if (!B.deathTimer) {
            B.addProj(new HW.Hellfire(B, this.x - 84, this.y + 3, this.vx, this.vy, 1));
            B.addProj(new HW.Hellfire(B, this.x + 85, this.y + 3, this.vx, this.vy, 1));
          }
          this.slT = this.slF;
        }
        if (this.blT <= 0 && B.nukeFlash === 0 && live) {
          B.addProj(new HW.HeadMissile(B, this.x - 52, this.y - 52, true));
          B.addProj(new HW.HeadMissile(B, this.x + 53, this.y - 52, false));
          this.blT = this.blF;
        }
      }
    },
    draw: function (ctx) {
      var x = Math.round(this.x), y = Math.round(this.y);
      this.drawPiece(ctx, this.stages[this.stage], x, y, 0, 0, false, this.flash);
      if (this.stage === 1) this.drawPiece(ctx, S('finalboss/turret'), x, y - 84, Math.floor(this.anim) % 16, 0, false, this.flash);
      else if (this.stage === 0) {
        var L = S('finalboss/laser'), f = Math.floor(this.anim) % 5;
        this.drawPiece(ctx, L, x - 156, y - 15, f, 0, false, this.flash);
        this.drawPiece(ctx, L, x + 157, y - 15, f, 0, true, this.flash);
        if (this.phase > 0) {
          var G = S('finalboss/laserglow');
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(Math.sin(this.phase), 0, 1);
          D.celC(ctx, G, x - 156, y - 15, f, 0);
          D.celC(ctx, G, x + 157, y - 15, f, 0, D.FLIP);
          ctx.restore();
        }
      }
    }
  });

  /* ------------------------------------------------------------------ boss death sequence (0x41bf20 / 0x41bf70 / 0x4138e0):
     21 explosions on the boss at random 11-20 frame intervals, then everything is cleared under a white flash */
  function BossDeath(B, boss) {
    // (0x41bf20: the boss song keeps playing through the explosions; it fades from the final flash, see finishBoss)
    this.B = B; this.boss = boss; this.t = 20; this.count = 0;
  }
  BossDeath.prototype.pointOn = function (b) {
    var body = b.bodies && b.bodies[0], spr = body && body.spr, bl = S('bullets');
    var cx = b.x + (body ? body.ox : 0), cy = b.y + (body ? body.oy : 0);
    var w = spr ? spr.cw : (b.w || 200), h = spr ? spr.ch : (b.h || 150);
    for (var n = 0; n < 40; n++) {
      var x = cx + rnd(w) - w / 2, y = cy + rnd(h) - h / 2;
      if (!spr || !bl || HW.collide(spr, cx, cy, body.col || 0, body.row || 0, !!body.flip, bl, x, y, 0, 0, false)) return [x, y];
    }
    return [cx, cy];
  };
  BossDeath.prototype.update = function () {
    var B = this.B, b = this.boss, i, m = b.m || 1;
    if (++this.t > 20) {
      this.t = rnd(10);
      this.count++;
      var p = this.pointOn(b);   // (in the boss's own space)
      B.addExplosion(b.toWx(p[0]), b.toWy(p[1]), 160 * m, 160 * m, 0, 0, 0);
      if (this.count === 1) {
        for (i = B.projs.length - 1; i >= 0; i--) if (B.projs[i].isEnemy) B.projs.splice(i, 1);
        for (i = B.bullets.length - 1; i >= 0; i--) if (B.bullets[i].enemy) B.bullets.splice(i, 1);
      }
    }
    if (this.count <= 20) return;
    // remaining parts go up with the rest of the board
    for (i = 0; i < b.parts.length; i++) {
      var q = b.parts[i];
      if (q.dead) continue;
      var s = (Math.max(q.spr ? q.spr.cw : 40, q.spr ? q.spr.ch : 40) + 20) * m;
      B.addExplosion(b.toWx(q.x), b.toWy(q.y), s, s, 0, 0, 0);
    }
    if (window.HWNative && HWNative.vibrate) HWNative.vibrate(400);
    b.remove();
    B.finishBoss();
  };
  HW.BossDeath = BossDeath;
})();
