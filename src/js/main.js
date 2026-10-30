/* Heavy Weapon mobile port - boot: load assets with a progress bar, then show the title screen */
'use strict';
(function () {
  var D = HW.Draw;
  function S(n) { return HW.img[n]; }

  var progress = 0, stage = 'boot', error = null;
  var MASKED = ['tank', 'shield', 'bullets', 'bombfrag', 'dumbbomb', 'ironbomb', 'fragbomb', 'fatboy', 'lgb', 'hellfire', 'headmissile', 'rpg',
    'missile', 'rocket', 'orb', 'beam', 'beamfire', 'flakflash', 'powerups', 'crates', 'pupcopter', 'meteorite', 'airmine', 'boulder', 'burstrocket',
    'hugecopter/hugecopter', 'hugecopter/launcher', 'hugecopter/turret', 'battleship/hull', 'battleship/main', 'battleship/gun', 'rainer/rainer',
    'wrecker/body', 'wrecker/tower', 'wrecker/ball', 'ape/ape', 'eye/body', 'eye/hand', 'head/head', 'worm/head', 'worm/turret', 'robot/body',
    'robot/arms', 'robot/foot', 'robot/launchers', 'robot/waist', 'finalboss/body1', 'finalboss/body2', 'finalboss/body3', 'finalboss/turret', 'finalboss/laser'];

  var LoadingScene = {
    update: function () {},
    draw: function (ctx) {
      var W = HW.W, ox = HW.OX;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, 480);
      var t = S('title');
      if (t) ctx.drawImage(t.image, ox, 0);
      var fr = S('loadingframe'), ins = S('loadinginside'), sl = S('loadingslider');
      var x = ox + 320, y = 430;
      if (fr && ins && sl) {
        D.celC(ctx, ins, x, y, 0, 0);
        var w = Math.max(1, Math.round(sl.w * progress));
        ctx.drawImage(sl.image, 0, 0, w, sl.h, Math.round(x - sl.w / 2), Math.round(y - sl.h / 2), w, sl.h);
        D.celC(ctx, fr, x, y, 0, 0);
      } else {
        ctx.fillStyle = '#333'; ctx.fillRect(ox + 170, 420, 300, 16);
        ctx.fillStyle = '#6c6'; ctx.fillRect(ox + 170, 420, 300 * progress, 16);
      }
      if (error) {
        ctx.fillStyle = '#f66'; ctx.font = '14px monospace'; ctx.fillText(error, 10, 20);
      }
    }
  };

  function boot() {
    HW.initCanvas();
    HW.Input.init();
    HW.Audio.init(HW.SOUNDS);
    HW.onResize = function () { if (HW.Input) HW.Input.layout(); };
    HW.setScene(LoadingScene);
    HW.start();
    var first = ['title', 'loadingframe', 'loadinginside', 'loadingslider', 'loadingbullet', 'loadingglow', 'atomictank'];
    Promise.all([HW.loadJSON('data/sprites.json'), HW.loadJSON('imgmanifest.json'), HW.loadJSON('data/gamedata.json'),
      HW.loadJSON('music/music.json').catch(function () { return {}; })])
      .then(function (r) {
        HW.sprites = r[0];
        HW.data = r[2];
        HW.Audio.musicMeta = r[3] || {};
        // LoveTheme.ogg is played once, not looped (PlayMusic(0, -1, noLoop) in 0x42eab0)
        HW.Audio.musicMeta.lovetheme = Object.assign({}, HW.Audio.musicMeta.lovetheme, { noLoop: true });
        HW.Audio.preloadMusic();
        var names = Object.keys(r[1]).filter(function (n) { return n.indexOf('cursor_') !== 0; });
        return HW.loadSprites(first).then(function () {
          progress = 0.02;
          // as in the original, the intro movie plays while the rest loads (0x42f050); the title screen's bullet
          // shows how far the loading has got if the movie is skipped early
          HW.loadProgress = function () { return progress; };
          HW.playCinema('intro', function () { HW.setScene(new HW.TitleScene()); });
          stage = 'fonts';
          return HW.loadFonts(['Computer', 'Keypunch16', 'Normal', 'Outline', 'Outlined', 'RubberStampLET20', 'RubberStampLET42', 'StationFont']);
        }).then(function () {
          stage = 'sprites';
          var rest = names.filter(function (n) { return first.indexOf(n) < 0; });
          return HW.loadSprites(rest, function (p) { progress = 0.02 + p * 0.88; });
        });
      })
      .then(function () {
        // pre-build the pixel collision masks so the first hit never stutters
        var list = MASKED.concat(HW.data.craft.map(function (c) { return c.name.toLowerCase(); })).filter(function (n) { return S(n); });
        return new Promise(function (resolve) {
          var i = 0;
          (function step() {
            var t0 = performance.now();
            while (i < list.length && performance.now() - t0 < 12) HW.getMask(S(list[i++]));
            progress = 0.9 + 0.1 * i / list.length;
            if (i < list.length) setTimeout(step, 0); else resolve();
          })();
        });
      })
      .then(function () {
        progress = 1;
        HW.applySettings();
        HW.P = HW.loadProfile();
        HW.loaded = true;
      })
      .catch(function (e) { error = 'Load error: ' + (e && e.message ? e.message : e); console.error(e); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
