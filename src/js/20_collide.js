/* Heavy Weapon mobile port - pixel perfect collision (mirrors the original's alpha-mask test) */
'use strict';
(function () {
  var maskCanvas = null, maskCtx = null;

  /* alpha mask for a whole sprite image: Uint8Array w*h, 1 where alpha > 0 */
  function getMask(s) {
    if (s.mask) return s.mask;
    if (!maskCanvas) { maskCanvas = document.createElement('canvas'); maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true }); }
    maskCanvas.width = s.w; maskCanvas.height = s.h;
    maskCtx.clearRect(0, 0, s.w, s.h);
    maskCtx.drawImage(s.image, 0, 0);
    var d;
    try { d = maskCtx.getImageData(0, 0, s.w, s.h).data; } catch (e) { d = null; }
    var m = new Uint8Array(s.w * s.h);
    if (d) { for (var i = 0, j = 3; i < m.length; i++, j += 4) m[i] = d[j] > 0 ? 1 : 0; }
    else m.fill(1);
    s.mask = m;
    return m;
  }
  HW.getMask = getMask;

  /* Collide(spriteA at (ax,ay) cel (ac,ar) mirrored af, spriteB ...). Positions are cell centres. */
  HW.collide = function (A, ax, ay, ac, ar, af, B, bx, by, bc, br, bf) {
    if (!A || !B) return false;
    var aw = A.cw, ah = A.ch, bw = B.cw, bh = B.ch;
    var ax0 = Math.round(ax - aw / 2) | 0, ay0 = Math.round(ay - ah / 2) | 0;
    var bx0 = Math.round(bx - bw / 2) | 0, by0 = Math.round(by - bh / 2) | 0;
    if (bx0 + bw <= ax0 || by0 + bh <= ay0 || bx0 >= ax0 + aw || by0 >= ay0 + ah) return false;
    var x0 = Math.max(ax0, bx0), y0 = Math.max(ay0, by0);
    var x1 = Math.min(ax0 + aw, bx0 + bw), y1 = Math.min(ay0 + ah, by0 + bh);
    var ma = getMask(A), mb = getMask(B);
    ac |= 0; ar |= 0; bc |= 0; br |= 0;
    var aox = ac * aw, aoy = ar * ah, box = bc * bw, boy = br * bh;
    for (var y = y0; y < y1; y++) {
      var arow = (aoy + y - ay0) * A.w, brow = (boy + y - by0) * B.w;
      for (var x = x0; x < x1; x++) {
        var lax = x - ax0, lbx = x - bx0;
        if (af) lax = aw - 1 - lax;
        if (bf) lbx = bw - 1 - lbx;
        if (ma[arow + aox + lax] && mb[brow + box + lbx]) return true;
      }
    }
    return false;
  };

  /* point / small box inside sprite mask */
  HW.pointHits = function (A, ax, ay, ac, ar, af, px, py) {
    var aw = A.cw, ah = A.ch;
    var lx = Math.floor(px - (ax - aw / 2)), ly = Math.floor(py - (ay - ah / 2));
    if (lx < 0 || ly < 0 || lx >= aw || ly >= ah) return false;
    if (af) lx = aw - 1 - lx;
    var m = getMask(A);
    return !!m[((ar | 0) * ah + ly) * A.w + (ac | 0) * aw + lx];
  };
})();
