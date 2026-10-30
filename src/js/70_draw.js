/* Heavy Weapon mobile port - battlefield rendering, tank and status bar (draw order of the original 0x415530) */
'use strict';
(function () {
  var D = HW.Draw, rnd = HW.rnd, clamp = HW.clamp;
  var DEG = Math.PI / 180;
  function S(n) { return HW.img[n]; }
  var B = HW.Board.prototype;

  HW.GAS_NAMES = ['NUKE n GO', 'GROUND ZERO GAS', "ROD'S FUEL RODS", "NED'S NUKES"];
  var SHIELD_COL = ['#ff4000', '#ff4000', '#ffff00', '#00ff00'];

  /* tile a background strip horizontally across the world's width */
  function tile(ctx, s, x, y, period, W) {
    if (!s) return;
    x = Math.floor(x);
    while (x > 0) x -= period;
    for (; x < W; x += period) ctx.drawImage(s.image, x, y);
  }
  /* scratch canvases: the magnified world, and the nuke tint of the near background layers */
  var worldBuf = null, tintA = null, tintB = null;
  function scratch(cv, w, h) {
    if (!cv) cv = document.createElement('canvas');
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return cv;
  }
  /* draw some layers multiplied by one colour, as the original does by colourising each background layer while a nuke
     is lit (0x415530: colour (255, 255-n, 255-n)): render them alone, multiply, keep their own alpha, lay them down */
  function drawTinted(ctx, W, color, fn) {
    var T = ctx.getTransform(), cw = ctx.canvas.width, ch = ctx.canvas.height;
    tintA = scratch(tintA, cw, ch); tintB = scratch(tintB, cw, ch);
    var a = tintA.getContext('2d'), b = tintB.getContext('2d');
    a.setTransform(1, 0, 0, 1, 0, 0); a.globalCompositeOperation = 'source-over'; a.globalAlpha = 1; a.clearRect(0, 0, cw, ch);
    a.setTransform(T);
    fn(a);
    a.setTransform(1, 0, 0, 1, 0, 0);
    b.setTransform(1, 0, 0, 1, 0, 0); b.globalAlpha = 1;
    b.globalCompositeOperation = 'copy'; b.drawImage(tintA, 0, 0);
    b.globalCompositeOperation = 'multiply'; b.fillStyle = color; b.fillRect(0, 0, cw, ch);
    b.globalCompositeOperation = 'destination-in'; b.drawImage(tintA, 0, 0);
    b.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(tintB, 0, 0); ctx.restore();
  }

  B.drawAnimSlot = function (ctx, slot) { this.drawAnim(ctx, slot); };

  /* The battlefield is drawn 1:1 into its own buffer as wide as the world (W/k) and magnified by the zoom k in one
     blit anchored on the bottom edge (one resampling, so no seams between tiles or boss parts); the status bar, nuke
     icons, boss bar and big texts are then drawn at the screen's own scale. */
  B.draw = function (ctx) {
    var k = this.zoomK();
    if (k === 1) this.drawWorld(ctx, HW.W);
    else {
      var Wv = HW.W / k, bw = Math.ceil(Wv);
      worldBuf = scratch(worldBuf, bw, 480);
      var wc = worldBuf.getContext('2d');
      wc.setTransform(1, 0, 0, 1, 0, 0); wc.globalAlpha = 1; wc.globalCompositeOperation = 'source-over';
      wc.imageSmoothingEnabled = true;
      this.drawWorld(wc, Wv);
      ctx.drawImage(worldBuf, 0, 0, bw, 480, 0, 480 - 480 * k, bw * k, 480 * k);
    }
    // nukes / boss bar / big texts
    // from the boss's final flash on (the tank heading for the gas station) the status bar slides up out of the
    // screen like an auto-hiding taskbar (two thirds of a second), the HUD under it going with it
    var ho = this.levelDone ? (this.hudOut || 0) : 0;
    if (ho < 1) {
      var e = ho * ho * (3 - 2 * ho);
      if (e > 0) {
        ctx.save(); ctx.globalAlpha = 1 - e; ctx.translate(0, -e * 70); this.drawOverlayHud(ctx); ctx.restore();
        ctx.save(); ctx.translate(0, -Math.round(e * 34)); this.drawStatusBar(ctx); ctx.restore();
      } else {
        this.drawOverlayHud(ctx);
        this.drawStatusBar(ctx);
      }
    }
  };

  B.drawWorld = function (ctx, W) {
    var half = this.half = W / 2, i;
    var P = HW.P;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, Math.ceil(W), 480);
    ctx.save();
    var shk = Math.max(this.flash > 0 ? Math.floor(this.flash) : 0, this.shake || 0);
    if (shk > 0 && HW.settings.shake) {
      var f = shk;
      ctx.translate(rnd(Math.floor(f / 16) + 1) - Math.floor(f / 32), rnd(Math.floor(f / 16) + 1) - Math.floor(f / 32));
    }
    // while a nuke is lit every background layer is colourised (255, 255-n, 255-n) - the same colour for all of
    // them, so the far layers get it in one pass and the near ones (drawn over the mushroom cloud) in another
    var nf = this.nukeFlash > 0 ? Math.min(255, Math.round(this.nukeFlash)) : 0;
    var tint = nf > 0 ? 'rgb(255,' + (255 - nf) + ',' + (255 - nf) + ')' : null;
    tile(ctx, this.imgSky, this.skyX, 0, 640, W);
    if (this.country === 5) D.img(ctx, S('moon'), 200 + (half - 320) - 50, 110);
    this.drawAnim(ctx, 3);
    // background projectiles (ICBM launches)
    ctx.save(); ctx.translate(half, 0);
    for (i = 0; i < this.projs.length; i++) if (this.projs[i].background) this.projs[i].draw(ctx);
    ctx.restore();
    if (HW.settings.detail > 0) tile(ctx, this.imgBg2, this.bg2X, 180, 960, W);
    this.drawAnim(ctx, 2);
    if (tint) { ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = tint; ctx.fillRect(-50, -50, W + 100, 580); ctx.restore(); }
    ctx.save(); ctx.translate(half, 0);
    for (i = 0; i < this.mushrooms.length; i++) this.mushrooms[i].draw(ctx);
    ctx.restore();
    var self = this;
    var near = function (c) {
      tile(c, self.imgBg, self.bgX, 180, 960, W);
      self.drawAnim(c, 1);
      // mile marker (0x415b4f): the "ENEMY HQ" sign stands on the roadside at y 350, rolling in from the right edge
      // with the road (1 px per step); the ground strip drawn next covers the bottom of its posts. "n MILES" goes on
      // the panel at (+10, 372).
      if (self.mileX < 0 && !self.survival) {
        var mx = W + self.mileX;
        D.img(c, S('milemarker'), Math.round(mx), 350);
        var n = Math.floor((self.length - self.dist) / 5000);
        if (n >= 0 && n < 5) D.cel(c, S('miletext'), Math.round(mx + 10), 372, n, 0);
      }
      tile(c, self.imgGround, self.groundX, 420, 640, W);
      self.drawAnim(c, 0);
    };
    if (tint) drawTinted(ctx, W, tint, near); else near(ctx);

    ctx.translate(half, 0);
    // gas station at the end of a level
    if (this.gasX < 1000) {
      var gx = Math.round(this.gasX);
      D.celC(ctx, S('gasstation'), gx, 405, 0, 0);
      var sf = HW.fonts.StationFont;
      if (sf) sf.draw(ctx, HW.GAS_NAMES[this.gasName] || '', gx, 370, '#fff', 1);
      D.celC(ctx, S('gassign'), gx - 135, 350, 0, 0);
    }
    // tank tracks
    var tr = S('tracks');
    for (i = 0; tr && i < this.tracks.length; i++) {
      // 0x415e1c draws one strip up to 644 px; wider screens need several (the tread pattern repeats every 4 px)
      // the tread pattern (4 px period) is laid in step with the road, not with the strip's own left end: when strips
      // join after a respawn, or the left end is trimmed, the marks already on the road never shift or flip
      var t = this.tracks[i], tx0 = Math.round(t.x1), w = Math.round(t.x2) - tx0;
      var ph = ((Math.round(t.x1 - this.groundX) % 4) + 4) % 4;
      while (w > 0) {
        var cw = Math.min(w, 640);
        ctx.drawImage(tr.image, ph, 0, cw, 17, tx0, 455, cw, 17);
        tx0 += cw; w -= cw;
      }
    }
    // craters (0x415e89): opaque, then alpha life/2 over the last 512 steps
    var cr = S('crater');
    for (i = 0; i < this.craters.length; i++) {
      var c = this.craters[i];
      if (c.life < 512) ctx.globalAlpha = Math.max(0, c.life / 2) / 255;
      D.celC(ctx, cr, Math.round(c.x), 460, c.frame, 0);
      ctx.globalAlpha = 1;
    }
    // bullet scorches (additive glow on the ground)
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    var bg = S('bulletglow');
    for (i = 0; i < this.scorches.length; i++) {
      var s = this.scorches[i];
      if (s.a <= 0) continue;
      ctx.globalAlpha = clamp(s.a / 255, 0, 1);
      D.celC(ctx, bg, Math.round(s.x), 460, s.player ? 1 : 0, 0);
    }
    ctx.restore();
    // aircraft & ground units
    for (i = 0; i < this.crafts.length; i++) if (!this.crafts[i].dead || this.crafts[i].dying) this.crafts[i].draw(ctx);
    // the tank
    if (!this.deathTimer) this.drawTank(ctx);
    // shell casings
    var cs = S('casing');
    for (i = 0; i < this.casings.length; i++) D.celC(ctx, cs, Math.round(this.casings[i].x), Math.round(this.casings[i].y), 0, 0);
    if (this.gasX < 1000) {
      D.celC(ctx, S('gaspump'), Math.round(this.gasX) - 65, 455, 0, 0);
      D.celC(ctx, S('gaspump'), Math.round(this.gasX) + 55, 455, 0, 0);
    }
    // particles
    this.drawParticles(ctx);
    // explosions
    var ex = S('explosion');
    for (i = 0; i < this.explosions.length; i++) {
      var e = this.explosions[i], fr = Math.floor(e.frame);
      if (fr > 19) continue;
      ctx.drawImage(ex.image, fr * 160, 0, 160, 160, Math.round(e.x - e.w / 2), Math.round(e.y - e.h / 2), e.w, e.h);
    }
    // power-up messages
    this.drawPopups(ctx);
    // megalaser crates
    var crs = S('crates');
    for (i = 0; i < this.crates.length; i++) D.celC(ctx, crs, Math.round(this.crates[i].x), Math.round(this.crates[i].y), this.crates[i].part, 0);
    // power-ups
    var pu = S('powerups');
    for (i = 0; i < this.powerups.length; i++) {
      var p = this.powerups[i];
      D.celC(ctx, pu, Math.round(p.x), Math.round(p.y), p.type, 0);
    }
    // tank laser
    if (this.laserCd > 50 && this.laserCd < 100 && P.weapons[2] > 0 && !this.deathTimer) this.drawLaser(ctx);
    if (this.mega > 0 && this.megaFiring && !this.deathTimer) this.drawMega(ctx);
    // flak & thunder
    for (i = 0; i < this.flaks.length; i++) this.flaks[i].draw(ctx);
    for (i = 0; i < this.thunders.length; i++) this.thunders[i].draw(ctx);
    // projectiles
    for (i = 0; i < this.projs.length; i++) if (!this.projs[i].background && !this.projs[i].dead) this.projs[i].draw(ctx);
    // bullets
    for (i = 0; i < this.bullets.length; i++) {
      var b = this.bullets[i];
      D.celC(ctx, b.spr, Math.round(b.x), Math.round(b.y), b.frame, b.row);
    }
    // muzzle flashes
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    var mf = S('muzzleflash');
    for (i = 0; i < this.muzzles.length; i++) {
      var m = this.muzzles[i];
      D.celC(ctx, mf, Math.round(m.x), Math.round(m.y), clamp(Math.floor(5 - m.life), 0, 4), 0);
    }
    ctx.restore();
    // score texts
    this.drawScoreTexts(ctx);
    ctx.restore(); // (shake)

    // full screen flashes
    var FW = Math.ceil(W);
    if (this.nukeFlash > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgb(' + Math.round(this.nukeFlash) + ',' + Math.round(this.nukeFlash * 0.25) + ',0)';
      ctx.fillRect(0, 0, FW, 480); ctx.restore();
    }
    if (this.flash > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      var fl = Math.round(this.flash);
      ctx.fillStyle = 'rgb(' + fl + ',' + fl + ',' + fl + ')';
      ctx.fillRect(0, 0, FW, 480); ctx.restore();
    }
    if (this.deathFlash > 0 && this.deathFlash < 25) {
      var k = this.deathFlash * 0.125, sc = 150 * (Math.sin(k) * 1.3 + 0.2);
      var tf = S('tankflash');
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      if (tf && sc > 0) ctx.drawImage(tf.image, Math.round(half + this.deathX - sc * 2 / 3), Math.round(this.deathY - sc / 2), Math.round(sc * 4 / 3), Math.round(sc));
      var v = (25 - this.deathFlash) * 10;
      ctx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
      ctx.fillRect(0, 0, FW, 480);
      ctx.restore();
    }
    ctx.save(); ctx.translate(half, 0);
    if (this.danger) this.danger.draw(ctx);
    ctx.restore();
  };

  /* ------------------------------------------------------------------ HOW TO PLAY demo board (0x421620)
     Drawn by the help screen inside the picture frame (already clipped and translated to the board centre): the
     mushroom clouds sit behind the grass (drawMushrooms, clip 20,40,600,360), everything else in the original order. */
  B.drawDemoBack = function (ctx) {
    for (var i = 0; i < this.mushrooms.length; i++) this.mushrooms[i].draw(ctx);
  };
  B.drawDemo = function (ctx) {
    var i;
    for (i = 0; i < this.crafts.length; i++) if (!this.crafts[i].dead || this.crafts[i].dying) this.crafts[i].draw(ctx);
    this.drawTank(ctx);
    var cs = S('casing');
    for (i = 0; i < this.casings.length; i++) D.celC(ctx, cs, Math.round(this.casings[i].x), Math.round(this.casings[i].y), 0, 0);
    this.drawParticles(ctx);
    var ex = S('explosion');
    for (i = 0; i < this.explosions.length; i++) {
      var e = this.explosions[i], fr = Math.floor(e.frame);
      if (fr > 19) continue;
      ctx.drawImage(ex.image, fr * 160, 0, 160, 160, Math.round(e.x - e.w / 2), Math.round(e.y - e.h / 2), e.w, e.h);
    }
    this.drawPopups(ctx);
    var pu = S('powerups');
    for (i = 0; i < this.powerups.length; i++) D.celC(ctx, pu, Math.round(this.powerups[i].x), Math.round(this.powerups[i].y), this.powerups[i].type, 0);
    for (i = 0; i < this.projs.length; i++) if (!this.projs[i].background && !this.projs[i].dead) this.projs[i].draw(ctx);
    for (i = 0; i < this.bullets.length; i++) {
      var b = this.bullets[i];
      D.celC(ctx, b.spr, Math.round(b.x), Math.round(b.y), b.frame, b.row);
    }
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    var mf = S('muzzleflash');
    for (i = 0; i < this.muzzles.length; i++) {
      var m = this.muzzles[i];
      D.celC(ctx, mf, Math.round(m.x), Math.round(m.y), clamp(Math.floor(5 - m.life), 0, 4), 0);
    }
    if (this.nukeFlash > 0) {
      ctx.fillStyle = 'rgb(' + Math.round(this.nukeFlash) + ',' + Math.round(this.nukeFlash * 0.25) + ',0)';
      ctx.fillRect(-320, 0, 640, 480);
    }
    if (this.flash > 0) {
      var fl = Math.round(this.flash);
      ctx.fillStyle = 'rgb(' + fl + ',' + fl + ',' + fl + ')';
      ctx.fillRect(-320, 0, 640, 480);
    }
    ctx.restore();
  };

  /* ------------------------------------------------------------------ tank (0x401b80) */
  B.drawTank = function (ctx) {
    var P = HW.P, x = Math.round(this.tx), y = Math.round(this.ty), g = Math.floor(this.gunFrame);
    g = clamp(g, 0, 20);
    D.celC(ctx, S('tankshadow'), x, y + 22, 0, 0);
    D.celC(ctx, S('tank'), x, y, Math.floor(this.tankFrame) % 10, 0);
    D.cel(ctx, S('gun'), x - 40, y - 52, g, Math.min(4, P.spread));
    var W = P.weapons;
    if (W[2] > 0) D.cel(ctx, S('lasers'), x - 40, y - 42, g, W[2] - 1);
    if (W[4] > 0) D.cel(ctx, S('flakguns'), x - 40, y - 52, g, W[4] - 1);
    if (W[1] > 0) D.celC(ctx, S('homing'), x, y - 2, W[1] - 1, 0);
    if (W[5] > 0) D.celC(ctx, S('staticstrike'), x, y + 4, 0, W[5] - 1);
    // rocket pods
    if (W[3] > 0) {
      var n = W[3], a = this.gunFrame * 9 * DEG, a2 = a + 1.5707963268794;
      var px = this.tx - Math.cos(a) * 12, py = this.ty - 12 - Math.sin(a) * 12;
      for (var j = 0; j < n; j++) {
        var off = j * Math.floor(90 / n);
        if (n > 1) off += -22 - (n === 3 ? 8 : 0);
        D.celC(ctx, S('rocketpod'), Math.round(px - Math.cos(a2) * off), Math.round(py - Math.sin(a2) * off), g, 0);
      }
    }
    // defense orbs
    if (this.orbs) {
      var ob = S('orb');
      // orbs follow the (interpolated) tank
      var odx = this._lerping ? this.tx - this._cv.tx : 0, ody = this._lerping ? this.ty - this._cv.ty : 0;
      for (var k = 0; k < this.orbs.length; k++) {
        var orx = Math.round(this.orbs[k][0] + odx), ory = Math.round(this.orbs[k][1] + ody);
        D.celC(ctx, ob, orx, ory, 0, 0);
        if (this.orbFlash[k] > 0) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = this.orbFlash[k];
          D.celC(ctx, ob, orx, ory, 1, 0);
          ctx.restore();
        }
      }
    }
    // shield
    if (P.shield > 0 || this.shieldInv > 0) {
      var lvl = clamp(P.shield, 0, 3);
      var col = SHIELD_COL[lvl] || '#ff4000';
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = P.shield > 0 ? 0.5 : (this.shieldInv / 9) * 0.5;
      D.celC(ctx, D.mulTint(S('shield'), col), x, y + 2, Math.floor((HW.frame % 100) / 10), 0);
      ctx.restore();
    }
    if (this.shieldZap > 0) {
      var sz = S('shieldzap'), k2 = 1 + this.shieldZap / 255;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = this.shieldZap / 255;
      var fz = Math.floor((HW.frame % 100) / 10);
      ctx.drawImage(sz.image, fz * sz.cw, 0, sz.cw, sz.ch, x - sz.cw * k2 / 2, y + 2 - sz.ch * k2 / 2, sz.cw * k2, sz.ch * k2);
      ctx.restore();
    }
  };

  /* ------------------------------------------------------------------ particles */
  B.drawParticles = function (ctx) {
    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i], s = p.spr;
      var a = 1;
      if (p.fade) {
        if (p.ttl !== undefined) a = p.ttl / p.life; else a = 1 - p.frame / s.cols;
      }
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      D.celC(ctx, s, Math.round(p.x), Math.round(p.y), Math.min(s.cols - 1, Math.floor(p.frame)), 0);
    }
    ctx.globalAlpha = 1;
  };

  /* ------------------------------------------------------------------ texts */
  B.drawPopups = function (ctx) {
    var f = HW.fonts.Keypunch16 || HW.fonts.Normal;
    if (!f) return;
    for (var i = 0; i < this.popups.length; i++) {
      var p = this.popups[i];
      f.draw(ctx, p.s, p.x, Math.round(p.life / 2 + p.y0 - 128), p.color, 0, p.life / 255);
    }
  };
  B.drawScoreTexts = function () { };   // (the points are popups now, as in the original)

  /* ------------------------------------------------------------------ tank laser & megalaser */
  B.drawLaser = function (ctx) {
    var lvl = HW.P.weapons[2], a = this.beamAng, ca = Math.cos(a), sa = Math.sin(a);
    var ox = this.tx, oy = this.ty - 12, L0 = 35, L1 = this.beamLen;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (var j = 2; j > 0; j--) {
      var w = j * (lvl + 1) / 2, nx = -sa * w, ny = ca * w;
      ctx.fillStyle = j === 2 ? 'rgb(32,128,64)' : '#fff';
      ctx.beginPath();
      ctx.moveTo(ox + ca * L0 + nx, oy + sa * L0 + ny); ctx.lineTo(ox + ca * L1 + nx, oy + sa * L1 + ny);
      ctx.lineTo(ox + ca * L1 - nx, oy + sa * L1 - ny); ctx.lineTo(ox + ca * L0 - nx, oy + sa * L0 - ny);
      ctx.closePath(); ctx.fill();
    }
    D.celC(ctx, S('laserglare'), Math.round(ox + ca * L0), Math.round(oy + sa * L0), this.laserCd % 10, 0);
    var hx = ox + ca * L1, hy = oy + sa * L1;
    if (L1 < 800 && hx > -this.half && hx < this.half && hy > 0) D.celC(ctx, S('laserburn'), Math.round(hx), Math.round(hy), Math.floor((HW.frame % 40) / 4), 0);
    ctx.restore();
  };
  B.drawMega = function (ctx) {
    var a = this.beamAng, ca = Math.cos(a), sa = Math.sin(a), ox = this.tx, oy = this.ty - 12, L = this.megaLen || 800;
    var bf = S('beamfire'), fr = S('beamfringe'), bm = S('beam'), m = this.mega, d;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (d = 20 - (m * 2) % 20; d <= L; d += 20) D.celC(ctx, bf, Math.round(ox + ca * d), Math.round(oy + sa * d), ((m >> 2) + (d / 20 | 0)) % 5, 0);
    for (d = 0; d <= L; d += 15) D.celC(ctx, bm, Math.round(ox + ca * d), Math.round(oy + sa * d), 0, 0);
    for (d = 50 - (m * 2) % 50; d <= L; d += 50) D.celC(ctx, fr, Math.round(ox + ca * d), Math.round(oy + sa * d), (m >> 2) % 5, 0);
    D.celC(ctx, bf, Math.round(ox + ca * 35), Math.round(oy + sa * 35), (m >> 2) % 5, 0);
    ctx.restore();
  };

  /* ------------------------------------------------------------------ nukes, boss health, big texts */
  B.drawOverlayHud = function (ctx) {
    var P = HW.P, half = this.half, i;
    var f = HW.fonts.Outlined || HW.fonts.Normal;
    if (!P.nukes) {
      // 0x415530: red "NO NUKES - COLLECT" at (15,55) with a nuke icon centred at (200,50) while blinking
      if (this.noNukeBlink && this.noNukeBlink % 30 > 10 && f) {
        f.draw(ctx, 'NO NUKES - COLLECT', 15, 55, '#ff0000', 0);
        D.celC(ctx, S('nukeicon'), 200, 50, 0, 0);
      }
    } else if (this.dist <= this.length || this.survival) {
      for (i = 0; i < P.nukes; i++) D.celC(ctx, S('nukeicon'), 20 + 30 * i, 50, 0, 0);
    }
    if (this.boss && !this.bossEntering && !this.boss.dying) {
      // "BOSS" right-aligned at 215, bar at (220,37) 200x15: pulsing red while the boss can be hit, faint white otherwise
      var bx = HW.OX, vuln = this.boss.collidableBody !== undefined ? !!this.boss.collidableBody : !!this.boss.collidable;
      if (f) f.draw(ctx, 'BOSS', bx + 215, 50, '#fff', 2);
      var w = Math.max(0, Math.floor(200 / this.boss.maxArmor * this.boss.armor));
      if (w > 200) w = 200;
      ctx.fillStyle = vuln ? 'rgb(' + Math.round(Math.cos((this.tick % 31) * 0.1) * 64 + 192) + ',0,0)' : 'rgba(255,255,255,0.314)';
      ctx.fillRect(bx + 220, 37, w, 15);
      ctx.fillStyle = vuln ? '#000' : 'rgba(0,0,0,0.314)';
      ctx.fillRect(bx + 220 + w, 37, 200 - w, 15);
    }
    for (i = 0; i < this.texts.length; i++) {
      var t = this.texts[i];
      if (t.kind === 'big' && t.delay <= 0) this.drawBigText(ctx, t);
    }
  };
  /* one letter at a time, each glyph stretched about its own centre and placed relative to the screen centre */
  B.drawBigText = function (ctx, t) {
    var font = HW.fonts[t.font] || HW.fonts.RubberStampLET42;
    if (!font) return;
    var L = font.layers[font.layers.length - 1], img = L.image, cx = HW.W / 2;
    var xoff = -Math.floor(font.width(t.s) / 2), top = t.y - L.ascent;
    ctx.save();
    for (var i = 0; i < t.s.length; i++) {
      var ch = t.s[i];
      if (!L.chars[ch] && ch !== ' ') { var up = ch.toUpperCase(); if (L.chars[up]) ch = up; }
      var c = L.chars[ch], z = t.z[i];
      if (c && c.r && c.r[2] > 0 && z <= 8) {
        var fade = Math.max(0, z * 32);
        if (z <= -70) fade = Math.min(255, (z + 70) * -50);
        var alpha = 255 - fade;
        if (alpha > 0) {
          var s = z < 1 ? 1 : z, k = Math.cos(t.o[i]) * t.a[i] + s, s2 = s * 0.25 + 0.75;
          var w = c.r[2], h = c.r[3], hw = w >> 1, hh = h >> 1;
          var x0 = Math.trunc(xoff * s2) + hw, y0 = Math.trunc((top - 240) * s2 + 240) + hh;
          var dx = Math.trunc(x0 - hw * k), dy = Math.trunc(y0 - hh * k);
          var dw = Math.trunc(w * k), dh = Math.trunc(h * k);
          if (dw > 0 && dh > 0) {
            ctx.globalAlpha = Math.min(1, alpha / 255);
            ctx.drawImage(img, c.r[0], c.r[1], w, h, cx + dx, dy, dw, dh);
          }
        }
      }
      // advance by the character width plus kerning with the next character
      xoff += font.charWidth(L, ch);
      if (i < t.s.length - 1) { var kn = L.kerning[ch + t.s[i + 1]]; if (kn) xoff += kn; }
    }
    ctx.restore();
  };

  /* ------------------------------------------------------------------ status bar (0x42e220) */
  /* Graphics::DrawImageBox for a 3-cel strip: caps keep their width, the middle cel stretches */
  HW.drawBox3 = function (ctx, spr, x, y, w) {
    if (!spr) return;
    var c = spr.cw, h = spr.ch, im = spr.image;
    x = Math.round(x); y = Math.round(y); w = Math.round(w);
    ctx.drawImage(im, 0, 0, c, h, x, y, c, h);
    if (w > 2 * c) ctx.drawImage(im, c, 0, c, h, x + c, y, w - 2 * c, h);
    ctx.drawImage(im, 2 * c, 0, c, h, x + w - c, y, c, h);
  };
  /* the in-game MENU button (0x41cec0 / 0x41d010) sitting on the right end of the bar */
  HW.menuButtonRect = function () { return { x: HW.W - 105, y: 0, w: 100, h: 30 }; };
  B.drawMenuButton = function (ctx) {
    var r = HW.menuButtonRect(), b = S('button'), bb = S('buttonbracket');
    if (!b || !bb) return;
    var down = HW.Input && HW.Input.menuDown;
    HW.drawBox3(ctx, bb, r.x, r.y, r.w);
    HW.drawBox3(ctx, D.mulTint(b, 'rgb(32,128,64)'), r.x, r.y + (down ? 1 : 0), r.w);
    var f = HW.fonts.Normal;
    if (f) f.draw(ctx, 'MENU', r.x + r.w / 2, r.y + 21 + (down ? 1 : 0), '#fff', 1);
    if (down) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      HW.drawBox3(ctx, S('buttonglow'), r.x, r.y + 1, r.w);
      ctx.restore();
    }
  };
  B.drawStatusBar = function (ctx) {
    var P = HW.P, ox = HW.OX, sb = S('statusbar'), W = HW.W;
    if (sb) {
      if (ox > 0) {
        // wide screens: the bar carries on in plain metal on both sides (left: the profile of the metal beside the
        // weapon frame, right: the profile of its own right end) ...
        ctx.drawImage(sb.image, 407, 0, 1, 30, 0, 0, Math.max(0, ox - 29), 30);
        ctx.drawImage(sb.image, 639, 0, 1, 30, ox + 640, 0, W - ox - 640, 30);
      }
      ctx.drawImage(sb.image, ox, 0);
      // ... and the score slot, cut by the screen edge on a 640 screen, gets the same bracket, bolt and rounded end
      // as the weapon frame, so the two frames match
      if (ox > 0) ctx.drawImage(sb.image, 407, 0, 39, 30, ox - 29, 0, 39, 30);
    }
    var f = HW.fonts.Computer || HW.fonts.Normal, green = '#00ff00';
    if (!this.survival) {
      if (f) f.draw(ctx, String(P.score), ox + 10, 20, green, 0);
      var lives = Math.min(2, Math.max(0, P.lives - (this.deathTimer && this.wasAlive ? 1 : 0)));
      for (var i = 0; i < lives; i++) D.img(ctx, S('tankicon'), ox + 117 + 22 * i, 7);
    } else {
      D.img(ctx, S('statuscovers'), ox + 108, 2);
      var secs = Math.floor(Math.max(0, this.dist - this.survStart) / 200);
      var hh = Math.floor(secs / 3600), mm = Math.floor(secs / 60) % 60, ss = secs % 60;
      if (f) f.draw(ctx, hh + ':' + (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss, ox + 10, 20, green, 0);
    }
    // megalaser parts (tinted green) or the draining meter (pulsing red-yellow)
    if (this.mega > 0) {
      var mm2 = S('megameter');
      if (mm2) {
        var t = (this.mega * 20) % 512, g = t > 255 ? t - 256 : 255 - t;
        g = Math.round(g / 17) * 17;
        var tint = D.mulTint(mm2, 'rgb(255,' + g + ',0)');
        var mw = Math.max(1, Math.round(this.mega * 0.0293));
        ctx.drawImage(tint.image, 0, 0, mw, mm2.h, ox + 436, 6, mw, mm2.h);
      }
    } else if (this.megaParts > 0) {
      var ml = D.mulTint(S('megalaser'), '#00ff00');
      for (var k = 0; k < this.megaParts && k < 4; k++) D.cel(ctx, ml, ox + 438 + 20 * k, 7, k, 0);
    }
    if (this.survival) {
      if (f) f.draw(ctx, 'SURVIVAL MODE', ox + 209, 20, green, 0);
    } else {
      // "M<n>" is centred on the widget (320) after a 65px shift
      if (f) f.draw(ctx, 'M' + (this.mission + 1), ox + 385, 20, green, 1);
      if (this.imgMap) {
        D.img(ctx, this.imgMap, ox + 196, 6);
        var px = ox + 205 + Math.round(119 * Math.min(1, this.dist / this.length));
        D.celC(ctx, S('mappointer'), px, 11, 0, 0);
      }
    }
    this.drawMenuButton(ctx);
  };
})();
