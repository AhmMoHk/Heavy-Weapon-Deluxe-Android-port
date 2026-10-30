/* Heavy Weapon mobile port - input: touch joystick + buttons, mouse, keyboard, UI taps */
'use strict';
(function () {
  var I = HW.Input = {
    // gameplay state read by the game each update
    jx: 0, jy: 0,          // joystick vector (-1..1)
    jActive: false,
    fire: false,           // fire held
    nukePressed: false,    // edge-triggered
    pausePressed: false,   // edge-triggered
    // desktop mouse mode
    mouseMode: false, mouseX: 320, mouseY: 240,
    // controls overlay visible (only during gameplay)
    showControls: false,
    controlAlpha: 0.55,
    leftHanded: false,
    nukeCount: 0,
    nukeEnabled: true
  };

  var touches = {};        // id -> {role, x, y, sx, sy}
  var joy = { cx: 0, cy: 0, x: 0, y: 0, id: null, R: 58 };
  var btnFire = { x: 0, y: 0, r: 50, down: false };
  var btnNuke = { x: 0, y: 0, r: 33, down: false };
  var btnPause = { x: 0, y: 0, r: 22 };
  var keys = {};
  var queuedTaps = [];
  var mouseDown = false, rightDown = false;

  I.layout = function () {
    var W = HW.W, H = HW.H;
    joy.R = 58;
    joy.defX = 96; joy.defY = H - 92;
    btnFire.r = 50; btnFire.x = W - 92; btnFire.y = H - 88;
    btnNuke.r = 34; btnNuke.x = W - 190; btnNuke.y = H - 62;
    if (btnNuke.x < W * 0.55) btnNuke.x = W * 0.55;
    btnPause.x = W - 26; btnPause.y = 58;
    if (I.leftHanded) {
      joy.defX = W - 96;
      btnFire.x = 92; btnNuke.x = 190;
    }
    if (!joy.id) { joy.cx = joy.defX; joy.cy = joy.defY; joy.x = joy.cx; joy.y = joy.cy; }
  };

  function toLogical(clientX, clientY) {
    var x = (clientX - HW.cssLeft) / HW.cssScale;
    var y = (clientY - HW.cssTop) / HW.cssScale;
    return [x, y];
  }
  I.toLogical = toLogical;

  function inJoyZone(x, y) {
    if (I.leftHanded) return x > HW.W * 0.55 && y > 70;
    return x < HW.W * 0.45 && y > 70;
  }
  function near(b, x, y, k) { var dx = x - b.x, dy = y - b.y; return dx * dx + dy * dy <= (b.r * k) * (b.r * k); }
  // the original MENU button on the right end of the status bar doubles as the pause button
  function onMenu(x, y) {
    if (!HW.menuButtonRect) return false;
    var r = HW.menuButtonRect();
    return x >= r.x - 10 && x <= r.x + r.w + 10 && y >= r.y - 4 && y <= r.y + r.h + 14;
  }

  function updateJoy() {
    var dx = joy.x - joy.cx, dy = joy.y - joy.cy;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > joy.R) { dx *= joy.R / d; dy *= joy.R / d; }
    I.jx = dx / joy.R; I.jy = dy / joy.R;
  }

  function onTouchStart(e) {
    e.preventDefault();
    HW.Audio.unlock(); HW.Audio.resumePending();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      var p = toLogical(t.clientX, t.clientY);
      var rec = { role: 'tap', x: p[0], y: p[1], sx: p[0], sy: p[1], t0: HW.time };
      if (I.showControls) {
        if (onMenu(p[0], p[1])) { rec.role = 'pause'; I.menuDown = true; }
        else if (I.nukeEnabled && near(btnNuke, p[0], p[1], 1.25)) { rec.role = 'nuke'; I.nukePressed = true; btnNuke.down = true; }
        else if (inJoyZone(p[0], p[1]) && joy.id === null) {
          rec.role = 'joy'; joy.id = t.identifier;
          // floating joystick: centre where the thumb lands (kept on screen)
          joy.cx = HW.clamp(p[0], joy.R + 8, HW.W - joy.R - 8);
          joy.cy = HW.clamp(p[1], joy.R + 70, HW.H - joy.R - 4);
          joy.x = p[0]; joy.y = p[1];
          I.jActive = true; updateJoy();
        } else if (!inJoyZone(p[0], p[1])) {
          rec.role = 'fire'; btnFire.down = true;
        }
      }
      touches[t.identifier] = rec;
      if (rec.role === 'tap' && HW.scene && HW.scene.onPress) HW.scene.onPress(p[0], p[1]);
    }
    recomputeFire();
  }
  function onTouchMove(e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i], rec = touches[t.identifier];
      if (!rec) continue;
      var p = toLogical(t.clientX, t.clientY);
      rec.x = p[0]; rec.y = p[1];
      if (rec.role === 'joy') {
        joy.x = p[0]; joy.y = p[1];
        // drag the base along if the thumb goes far outside (keeps it responsive)
        var dx = joy.x - joy.cx, dy = joy.y - joy.cy, d = Math.sqrt(dx * dx + dy * dy);
        if (d > joy.R * 1.6) { var k = (d - joy.R * 1.6) / d; joy.cx += dx * k; joy.cy += dy * k; }
        updateJoy();
      } else if (rec.role === 'tap' && HW.scene && HW.scene.onDrag) HW.scene.onDrag(p[0], p[1]);
    }
  }
  function onTouchEnd(e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i], rec = touches[t.identifier];
      if (!rec) continue;
      delete touches[t.identifier];
      if (rec.role === 'joy') {
        joy.id = null; I.jActive = false; I.jx = 0; I.jy = 0;
        joy.cx = joy.defX; joy.cy = joy.defY; joy.x = joy.cx; joy.y = joy.cy;
      } else if (rec.role === 'nuke') btnNuke.down = false;
      else if (rec.role === 'pause') { I.menuDown = false; if (onMenu(rec.x, rec.y)) I.pausePressed = true; }
      else if (rec.role === 'tap') {
        if (HW.scene && HW.scene.onRelease) HW.scene.onRelease(rec.x, rec.y);
        queuedTaps.push([rec.x, rec.y]);
      }
    }
    recomputeFire();
  }
  function recomputeFire() {
    var f = false;
    for (var k in touches) if (touches[k].role === 'fire') f = true;
    btnFire.down = f;
    I.touchFire = f;
  }

  /* ---- mouse (desktop / testing) */
  function onMouseDown(e) {
    HW.Audio.unlock(); HW.Audio.resumePending();
    var p = toLogical(e.clientX, e.clientY);
    I.mouseX = p[0]; I.mouseY = p[1];
    if (e.button === 2) { rightDown = true; if (I.showControls) I.nukePressed = true; return; }
    if (I.showControls && onMenu(p[0], p[1])) { I.menuDown = true; return; }
    mouseDown = true;
    if (HW.scene && HW.scene.onPress) HW.scene.onPress(p[0], p[1]);
  }
  function onMouseMove(e) {
    var p = toLogical(e.clientX, e.clientY);
    I.mouseX = p[0]; I.mouseY = p[1];
    if (Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0) > 0 && !I.touchUsed) I.mouseMode = true;
    if (mouseDown && HW.scene && HW.scene.onDrag) HW.scene.onDrag(p[0], p[1]);
  }
  function onMouseUp(e) {
    var p = toLogical(e.clientX, e.clientY);
    if (e.button === 2) { rightDown = false; return; }
    if (I.menuDown) { I.menuDown = false; if (onMenu(p[0], p[1])) I.pausePressed = true; return; }
    if (!mouseDown) return;
    mouseDown = false;
    if (HW.scene && HW.scene.onRelease) HW.scene.onRelease(p[0], p[1]);
    queuedTaps.push([p[0], p[1]]);
  }

  /* ---- keyboard */
  function onKeyDown(e) {
    keys[e.code] = true;
    HW.Audio.unlock();
    if (e.code === 'Escape' || e.code === 'KeyP') I.pausePressed = true;
    if (e.code === 'KeyN' || e.code === 'KeyB') I.nukePressed = true;
    if (HW.scene && HW.scene.onKey) HW.scene.onKey(e.code, e.key);
  }
  function onKeyUp(e) { keys[e.code] = false; }

  I.init = function () {
    var c = HW.canvas;
    c.addEventListener('touchstart', function (e) { I.touchUsed = true; I.mouseMode = false; onTouchStart(e); }, { passive: false });
    c.addEventListener('touchmove', onTouchMove, { passive: false });
    c.addEventListener('touchend', onTouchEnd, { passive: false });
    c.addEventListener('touchcancel', onTouchEnd, { passive: false });
    document.body.addEventListener('touchstart', function (e) {
      if (e.target && e.target.tagName === 'INPUT') return;   // the name entry box gets the keyboard
      if (e.target !== c) { e.preventDefault(); onTouchStart(e); }
    }, { passive: false });
    document.body.addEventListener('touchmove', function (e) { if (e.target !== c && e.target.tagName !== 'INPUT') onTouchMove(e); }, { passive: false });
    document.body.addEventListener('touchend', function (e) { if (e.target !== c && e.target.tagName !== 'INPUT') onTouchEnd(e); }, { passive: false });
    window.addEventListener('mousedown', function (e) { if (!I.touchUsed) onMouseDown(e); });
    window.addEventListener('mousemove', function (e) { if (!I.touchUsed) onMouseMove(e); });
    window.addEventListener('mouseup', function (e) { if (!I.touchUsed) onMouseUp(e); });
    window.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    I.layout();
  };

  I.preUpdate = function () {
    // keyboard joystick emulation
    var kx = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
    var ky = (keys.ArrowDown || keys.KeyS ? 1 : 0) - (keys.ArrowUp || keys.KeyW ? 1 : 0);
    I.keyFire = !!(keys.Space || keys.KeyJ || keys.ControlLeft);
    if (!I.jActive && (kx || ky)) { I.kx = kx; I.ky = ky; } else { I.kx = 0; I.ky = 0; }
    I.fire = !!(I.touchFire || I.keyFire || (I.mouseMode && mouseDown && I.showControls));
    // deliver taps to the scene
    while (queuedTaps.length) {
      var t = queuedTaps.shift();
      if (HW.scene && HW.scene.onTap) HW.scene.onTap(t[0], t[1]);
    }
  };
  I.postUpdate = function () { I.nukePressed = false; I.pausePressed = false; };

  /* stick vector including keyboard */
  I.stick = function () {
    if (I.jActive) {
      var x = I.jx, y = I.jy, m = Math.sqrt(x * x + y * y);
      if (m < 0.12) return [0, 0, 0];
      return [x, y, Math.min(1, m)];
    }
    if (I.kx || I.ky) { var mm = Math.sqrt(I.kx * I.kx + I.ky * I.ky); return [I.kx / mm, I.ky / mm, 1]; }
    return [0, 0, 0];
  };

  I.reset = function () {
    I.menuDown = false;
    for (var k in touches) delete touches[k];
    joy.id = null; I.jActive = false; I.jx = I.jy = 0; btnFire.down = false; btnNuke.down = false;
    I.touchFire = false; mouseDown = false; queuedTaps.length = 0;
    joy.cx = joy.defX; joy.cy = joy.defY; joy.x = joy.cx; joy.y = joy.cy;
  };

  /* ---- overlay drawing */
  function circle(ctx, x, y, r, fill, stroke, lw) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = lw || 2; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  /* the controls are pre-drawn once into small canvases at the screen's pixel density (vector circles with radial
     gradients are slow to fill every frame on phones) and then just stamped */
  var ovCache = {};
  function ovSprite(key, r, paint) {
    var sc = HW.pxScale || 1, k = key + '|' + r + '|' + sc, c = ovCache[k];
    if (c) return c;
    var half = r + 4, size = Math.ceil(half * 2 * sc);
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var x = cv.getContext('2d');
    x.setTransform(size / (half * 2), 0, 0, size / (half * 2), 0, 0);
    paint(x, half, half);
    c = ovCache[k] = { cv: cv, half: half };
    return c;
  }
  function stamp(ctx, c, x, y) { ctx.drawImage(c.cv, x - c.half, y - c.half, c.half * 2, c.half * 2); }
  I.drawOverlay = function (ctx) {
    if (!I.showControls || I.mouseMode) return;
    var a = I.controlAlpha * (I.fade === undefined ? 1 : I.fade);
    ctx.save();
    // joystick
    ctx.globalAlpha = a * (I.jActive ? 1 : 0.7);
    stamp(ctx, ovSprite('base', joy.R + 8, function (c, x, y) {
      circle(c, x, y, joy.R + 6, 'rgba(10,20,10,0.35)', 'rgba(220,255,220,0.8)', 3);
      circle(c, x, y, joy.R * 0.42, null, 'rgba(220,255,220,0.25)', 2);
    }), joy.cx, joy.cy);
    stamp(ctx, ovSprite('knob', 29, function (c, x, y) {
      var g = c.createRadialGradient(x - 6, y - 8, 4, x, y, 30);
      g.addColorStop(0, 'rgba(240,255,240,0.95)'); g.addColorStop(1, 'rgba(90,140,90,0.85)');
      circle(c, x, y, 27, g, 'rgba(255,255,255,0.9)', 2);
    }), joy.cx + I.jx * joy.R, joy.cy + I.jy * joy.R);
    // fire button
    ctx.globalAlpha = a * (btnFire.down ? 1 : 0.8);
    var fd = btnFire.down;
    stamp(ctx, ovSprite(fd ? 'fire1' : 'fire0', btnFire.r + 2, function (c, x, y) {
      var r = btnFire.r * (fd ? 0.94 : 1);
      var fg = c.createRadialGradient(x - 12, y - 14, 6, x, y, btnFire.r);
      fg.addColorStop(0, fd ? 'rgba(255,230,140,0.95)' : 'rgba(255,190,90,0.85)');
      fg.addColorStop(1, fd ? 'rgba(200,60,20,0.95)' : 'rgba(150,40,10,0.75)');
      circle(c, x, y, r, fg, 'rgba(255,240,200,0.9)', 3);
      // crosshair icon
      c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 3;
      c.beginPath(); c.arc(x, y, 17, 0, Math.PI * 2); c.stroke();
      c.beginPath();
      c.moveTo(x - 27, y); c.lineTo(x - 9, y);
      c.moveTo(x + 9, y); c.lineTo(x + 27, y);
      c.moveTo(x, y - 27); c.lineTo(x, y - 9);
      c.moveTo(x, y + 9); c.lineTo(x, y + 27);
      c.stroke();
    }), btnFire.x, btnFire.y);
    // nuke button
    if (I.nukeEnabled) {
      var has = I.nukeCount > 0, nd = btnNuke.down;
      ctx.globalAlpha = a * (has ? (nd ? 1 : 0.85) : 0.4);
      stamp(ctx, ovSprite((nd ? 'nuke1' : 'nuke0') + (HW.img.nukeicon ? 'i' : ''), btnNuke.r + 2, function (c, x, y) {
        var ng = c.createRadialGradient(x - 8, y - 9, 4, x, y, btnNuke.r);
        ng.addColorStop(0, 'rgba(255,120,120,0.9)'); ng.addColorStop(1, 'rgba(110,0,0,0.85)');
        circle(c, x, y, btnNuke.r * (nd ? 0.92 : 1), ng, 'rgba(255,220,220,0.9)', 3);
        var ni = HW.img.nukeicon;
        if (ni) c.drawImage(ni.image, x - 16, y - 16, 32, 32);
      }), btnNuke.x, btnNuke.y);
      if (HW.fonts.Outlined) HW.fonts.Outlined.draw(ctx, 'x' + I.nukeCount, btnNuke.x + btnNuke.r - 4, btnNuke.y + btnNuke.r - 2, '#fff', 1);
    }
    ctx.restore();
  };
})();
