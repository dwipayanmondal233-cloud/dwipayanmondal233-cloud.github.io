// ======================================================
// ADD-ON 1: MULTI-POINT SELECTION (Node tool)
// ======================================================
(function () {
  if (document.getElementById('np-all')) return;          // already installed
  var $ = function (id) { return document.getElementById(id); };
  var say = function (m) { if (window.toast) window.toast(m); };

  var css = document.createElement('style');
  css.textContent =
    '.pt-mark{position:absolute;display:none;z-index:9;pointer-events:none;width:14px;height:14px;border-radius:50%;' +
    'background:#00e676;border:2px solid #fff;box-shadow:0 0 0 2px #00a152,0 0 8px 2px rgba(0,230,118,.8);transform:translate(-50%,-50%)}' +
    '@media (pointer:coarse){.pt-mark{width:20px;height:20px}}';
  document.head.appendChild(css);

  var set = [], pool = [];
  var mode = null, start = null, rect = null, base = [], moved = false, keepSel = false;
  var ok = function (s) { return !!(s && s.path && s.path.parent); };
  var toGlobal = function (s) { return s.path.localToGlobal ? s.path.localToGlobal(s.point) : s.point; };

  function leafPaths(items, out) {
    items.forEach(function (i) {
      if (!i.visible) return;
      if (i.className === 'Path') out.push(i);
      else if (i.children && i.className !== 'Layer') leafPaths(i.children, out);
    });
    return out;
  }
  function candidates() {
    var out = leafPaths(selection, []);
    if (out.length) return out;
    paper.project.layers.forEach(function (l) { if (l.visible) leafPaths(l.children, out); });
    return out;
  }
  function showPaths() { leafPaths(selection, []).forEach(function (p) { p.fullySelected = true; }); }
  function topsOf(segs) {
    var tops = [];
    segs.forEach(function (s) { var t = topLevelItem(s.path); if (tops.indexOf(t) < 0) tops.push(t); });
    return tops;
  }

  // ---------- mouse ----------
  var prevDown = tools.node.onMouseDown, prevDrag = tools.node.onMouseDrag, prevUp = tools.node.onMouseUp;

  tools.node.onMouseDown = function (event) {
    mode = null; moved = false; keepSel = false;
    set = set.filter(ok);
    var shift = !!event.modifiers.shift;
    var add = (typeof addPointMode !== 'undefined') && addPointMode;
    var hit = paper.project.hitTest(event.point, { segments: true, handles: true, fill: true, stroke: true, tolerance: 6 });
    var isDouble = !!(event.event && event.event.detail >= 2);

    if (hit && hit.type === 'segment' && ok(hit.segment)) {
      var seg = hit.segment;
      if (shift) {                                           // Shift+tap: add / remove one point
        var i = set.indexOf(seg);
        if (i >= 0) set.splice(i, 1); else set.push(seg);
        nodeSel = set[set.length - 1] || null;
        var top = topLevelItem(seg.path);
        if (selection.indexOf(top) < 0) setSelection(selection.concat(top));
        showPaths();
        mode = 'none';
        return;
      }
      var wasIn = set.indexOf(seg) >= 0;
      if (wasIn && set.length > 1 && !isDouble) {            // drag all selected points together
        nodeSel = seg; nodeHit = null; mode = 'group';
        return;
      }
      prevDown(event);
      if (!wasIn) set = [seg];
      nodeSel = ok(seg) ? seg : null;
      mode = 'single';
      return;
    }

    var insideSelected = hit && hit.type === 'fill' && selection.indexOf(topLevelItem(hit.item)) >= 0;
    if ((hit && !insideSelected) || add) {                   // handles, curves, other shapes, add-point mode
      var onHandle = hit && (hit.type === 'handle-in' || hit.type === 'handle-out');
      if (!onHandle && !shift) set = [];
      prevDown(event);
      if (!set.length && ok(nodeSel)) set = [nodeSel];
      mode = 'single';
      return;
    }

    mode = 'marquee';                                        // empty space, or inside an already selected shape
    keepSel = !!insideSelected;
    start = event.point; rect = null;
    base = shift ? set.slice() : [];
    if (!shift) set = [];
  };

  tools.node.onMouseDrag = function (event) {
    if (mode === 'marquee') {
      var z = paper.view.zoom;
      if (!rect && event.point.getDistance(start) * z < 5) return;
      if (rect) rect.remove();
      rect = new paper.Path.Rectangle({
        from: start, to: event.point, strokeColor: '#00e676', strokeWidth: 1 / z, dashArray: [4 / z, 4 / z],
        fillColor: new paper.Color(0, 0.9, 0.46, 0.12)
      });
      return;
    }
    if (mode === 'none') return;
    if (mode === 'group') {
      set.forEach(function (s) { if (ok(s)) s.point = s.point.add(event.delta); });
      moved = true;
      return;
    }
    prevDrag(event);
  };

  tools.node.onMouseUp = function (event) {
    if (mode === 'marquee') {
      var box = null;
      if (rect) { box = rect.bounds; rect.remove(); rect = null; }
      if (!box) {                                            // just a tap
        if (!event.modifiers.shift) {
          set = [];
          if (!keepSel) { nodeSel = null; clearSelection(); }
        }
      } else {
        var found = [];
        candidates().forEach(function (p) {
          p.segments.forEach(function (s) {
            if (box.contains(toGlobal(s)) && base.indexOf(s) < 0 && found.indexOf(s) < 0) found.push(s);
          });
        });
        set = base.concat(found).filter(ok);
        if (set.length) {
          setSelection(topsOf(set));
          showPaths();
          nodeSel = set[set.length - 1];
        }
        say(set.length + ' point(s) selected');
      }
      mode = null;
      return;
    }
    if (mode === 'none') { mode = null; return; }
    if (mode === 'group') {
      if (moved) {
        set.forEach(function (s) { if (ok(s)) clearRound(s.path); });
        saveState();
      }
      mode = null; moved = false;
      return;
    }
    prevUp(event);
    mode = null;
  };

  // ---------- actions ----------
  function deletePoints() {
    set = set.filter(ok);
    if (!set.length && ok(nodeSel)) set = [nodeSel];
    if (!set.length) { say('Select points first (drag a box with the Node tool)'); return; }
    var paths = [], n = 0, skipped = 0;
    set.forEach(function (s) { if (paths.indexOf(s.path) < 0) paths.push(s.path); });
    paths.forEach(function (p) {
      var mine = set.filter(function (s) { return s.path === p; });
      if (p.segments.length - mine.length < 2) { skipped += mine.length; return; }
      clearRound(p);
      mine.forEach(function (s) { s.remove(); n++; });
      p.fullySelected = true;
    });
    set = []; nodeSel = null;
    if (n) saveState();
    say(n + ' point(s) deleted' + (skipped ? ', ' + skipped + ' kept (a path needs 2 points)' : ''));
  }
  function toggleSmooth() {
    var s = set.filter(ok);
    if (!s.length && ok(nodeSel)) s = [nodeSel];
    if (!s.length) { say('Select points first'); return; }
    var allCorner = s.every(function (g) { return g.handleIn.isZero() && g.handleOut.isZero(); });
    s.forEach(function (g) {
      clearRound(g.path);
      if (allCorner) g.smooth();
      else { g.handleIn = new paper.Point(0, 0); g.handleOut = new paper.Point(0, 0); }
    });
    saveState();
  }
  function alignPts(axis) {
    var s = set.filter(ok);
    if (s.length < 2) { say('Select 2 or more points'); return; }
    var sum = 0;
    s.forEach(function (g) { sum += g.point[axis]; });
    var avg = sum / s.length;
    s.forEach(function (g) {
      clearRound(g.path);
      g.point = axis === 'x' ? new paper.Point(avg, g.point.y) : new paper.Point(g.point.x, avg);
    });
    saveState();
  }
  function selectAllPts() {
    if (currentToolName !== 'node') { var keep = selection.slice(); setTool('node'); setSelection(keep); }
    var arr = [];
    candidates().forEach(function (p) { p.segments.forEach(function (s) { arr.push(s); }); });
    set = arr; nodeSel = arr[arr.length - 1] || null;
    if (arr.length) { setSelection(topsOf(arr)); showPaths(); }
    say(arr.length + ' point(s) selected');
  }

  // replace the old single-point buttons (cloning removes their old click handlers)
  ['node-del', 'node-type'].forEach(function (id) {
    var b = $(id);
    if (b) b.parentNode.replaceChild(b.cloneNode(true), b);
  });
  $('node-del').addEventListener('click', deletePoints);
  $('node-type').addEventListener('click', toggleSmooth);
  $('node-type').parentNode.insertAdjacentHTML('afterend',
    '<div class="layer-actions"><button id="np-all">Select all points</button><button id="np-none">Select none</button></div>' +
    '<div class="layer-actions"><button id="np-ax" title="Put the selected points on the same X (vertical line)">Same X</button>' +
    '<button id="np-ay" title="Put the selected points on the same Y (horizontal line)">Same Y</button></div>' +
    '<p class="hint">Node tool (N): drag a box on empty space to select many points. Shift+tap (or the ⇧ button) adds or removes one point. ' +
    'Drag a selected point to move them all. Delete removes them. Arrow keys move them (Shift = 10×). Ctrl+A selects all points.</p>');
  $('np-all').addEventListener('click', selectAllPts);
  $('np-none').addEventListener('click', function () { set = []; nodeSel = null; });
  $('np-ax').addEventListener('click', function () { alignPts('x'); });
  $('np-ay').addEventListener('click', function () { alignPts('y'); });

  // ---------- keyboard (runs before the old handlers) ----------
  var nt = null;
  window.addEventListener('keydown', function (e) {
    var tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (currentToolName !== 'node') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault(); e.stopImmediatePropagation(); selectAllPts(); return;
    }
    set = set.filter(ok);
    if (!set.length) return;
    if (e.key === 'Escape') { set = []; return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault(); e.stopImmediatePropagation(); deletePoints(); return;
    }
    if (e.key.indexOf('Arrow') === 0 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); e.stopImmediatePropagation();
      var s = (typeof nudgeStep === 'function' ? nudgeStep() : 1) * (e.shiftKey ? 10 : 1);
      var dx = e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0;
      var dy = e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0;
      set.forEach(function (g) { g.point = g.point.add(new paper.Point(dx, dy)); });
      clearTimeout(nt);
      nt = setTimeout(function () {
        set.forEach(function (g) { if (ok(g)) clearRound(g.path); });
        saveState();
      }, 400);
    }
  }, true);

  // ---------- green markers on every selected point ----------
  var prevTick = window.tickTimeline;
  window.tickTimeline = function (e) {
    if (prevTick) prevTick(e);
    if (currentToolName !== 'node') set = [];
    set = set.filter(ok);
    var n = Math.min(set.length, 400);
    while (pool.length < n) {
      var d = document.createElement('div');
      d.className = 'pt-mark';
      canvasArea.appendChild(d);
      pool.push(d);
    }
    for (var i = 0; i < pool.length; i++) {
      var m = pool[i];
      if (i >= n) { if (m.style.display !== 'none') m.style.display = 'none'; continue; }
      var v = paper.view.projectToView(toGlobal(set[i]));
      m.style.display = 'block';
      m.style.left = v.x + 'px';
      m.style.top = v.y + 'px';
    }
  };
  window.__nodePointSet = function () { return set; };
})();

// ======================================================
// ADD-ON 2: TRACE BITMAP (like Inkscape: Path > Trace Bitmap)
// ======================================================
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var say = function (m) { if (window.toast) window.toast(m); };
  var anchor = $('img-cut');
  if (!anchor) return;

  // ---------- UI (Arrange tab, under Image tools) ----------
  var hint = anchor.parentNode.nextElementSibling;
  (hint && hint.className === 'hint' ? hint : anchor.parentNode).insertAdjacentHTML('afterend',
    '<h3 class="section-title">Trace bitmap</h3>' +
    '<label class="prop-row">Mode<select id="tr-mode">' +
    '<option value="bright">Brightness (black &amp; white)</option>' +
    '<option value="colors">Colors (multi-scan)</option>' +
    '<option value="edges">Edge detection</option></select></label>' +
    '<label class="prop-row">Threshold <span id="tr-thr-label">50%</span><input type="range" id="tr-thr" min="1" max="99" value="50"></label>' +
    '<label class="prop-row">Colors <input type="number" id="tr-colors" value="6" min="2" max="16"></label>' +
    '<label class="prop-row">Fill color <input type="color" id="tr-color" value="#000000"></label>' +
    '<label class="prop-row">Invert <input type="checkbox" id="tr-invert"></label>' +
    '<label class="prop-row">Stack layers (no gaps) <input type="checkbox" id="tr-stack" checked></label>' +
    '<label class="prop-row">Smoothness <span id="tr-smooth-label">3</span><input type="range" id="tr-smooth" min="0" max="10" value="3"></label>' +
    '<label class="prop-row">Remove specks (px²) <input type="number" id="tr-speck" value="8" min="0" max="5000"></label>' +
    '<label class="prop-row">Trace size (px) <input type="number" id="tr-size" value="600" min="100" max="1600" step="50"></label>' +
    '<label class="prop-row">Hide image after <input type="checkbox" id="tr-hide"></label>' +
    '<div class="layer-actions"><button id="tr-run" title="Select an image first, then press this">▶ Trace bitmap</button></div>' +
    '<p class="hint">Select an image (Select tool) and press Trace. Brightness: pixels darker than the threshold become one shape. ' +
    'Colors: the image is split into N colors, one shape per color. Smoothness 0 gives sharp polygon corners, higher gives fewer, smoother curve nodes. ' +
    'A bigger Trace size is more exact but slower. The result is normal vector paths you can edit with the Node tool.</p>');

  function syncUI() {
    var m = $('tr-mode').value;
    function row(id, on) { var r = $(id).closest('.prop-row'); if (r) r.style.display = on ? '' : 'none'; }
    row('tr-thr', m !== 'colors');
    row('tr-colors', m === 'colors');
    row('tr-color', m !== 'colors');
    row('tr-stack', m === 'colors');
  }
  $('tr-mode').addEventListener('change', syncUI);
  $('tr-thr').addEventListener('input', function () { $('tr-thr-label').textContent = this.value + '%'; });
  $('tr-smooth').addEventListener('input', function () { $('tr-smooth-label').textContent = this.value; });
  syncUI();

  // ---------- reading the image ----------
  function readPixels(raster, maxSide) {
    var rw = Math.round(raster.size.width), rh = Math.round(raster.size.height);
    var s = Math.min(1, maxSide / Math.max(rw, rh));
    var tw = Math.max(1, Math.round(rw * s)), th = Math.max(1, Math.round(rh * s));
    var c = document.createElement('canvas');
    c.width = tw; c.height = th;
    var x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    x.drawImage(raster.canvas, 0, 0, rw, rh, 0, 0, tw, th);
    return { w: tw, h: th, rw: rw, rh: rh, data: x.getImageData(0, 0, tw, th).data };
  }
  function lum(d, i) { return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; }

  // ---------- masks (1 = shape, 0 = nothing) ----------
  function maskBright(img, thr, invert) {
    var d = img.data, N = img.w * img.h, m = new Uint8Array(N);
    for (var p = 0; p < N; p++) {
      var i = p * 4;
      if (d[i + 3] < 128) continue;
      var v = lum(d, i) < thr;
      m[p] = (invert ? !v : v) ? 1 : 0;
    }
    return m;
  }
  function maskEdges(img, thrPct, invert) {
    var w = img.w, h = img.h, d = img.data, g = new Float32Array(w * h), m = new Uint8Array(w * h);
    for (var p = 0; p < w * h; p++) g[p] = d[p * 4 + 3] < 128 ? 255 : lum(d, p * 4);
    var cut = (100 - thrPct) / 100 * 600;                       // Sobel magnitude cut-off
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var q = y * w + x;
        var gx = -g[q - w - 1] - 2 * g[q - 1] - g[q + w - 1] + g[q - w + 1] + 2 * g[q + 1] + g[q + w + 1];
        var gy = -g[q - w - 1] - 2 * g[q - w] - g[q - w + 1] + g[q + w - 1] + 2 * g[q + w] + g[q + w + 1];
        var e = Math.sqrt(gx * gx + gy * gy) > cut;
        m[q] = (invert ? !e : e) ? 1 : 0;
      }
    }
    return m;
  }

  // ---------- color quantizing (k-means) ----------
  function quantize(img, n) {
    var d = img.data, N = img.w * img.h, step = Math.max(1, Math.floor(N / 20000)), S = [], i, j;
    for (i = 0; i < N; i += step) if (d[i * 4 + 3] >= 128) S.push([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]);
    if (!S.length) return null;
    var dist = function (a, b) { var x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return x * x + y * y + z * z; };
    var C = [S[0].slice()], best = S.map(function (s) { return dist(s, C[0]); });
    while (C.length < n) {                                      // farthest-point start
      var bi = 0;
      for (i = 1; i < S.length; i++) if (best[i] > best[bi]) bi = i;
      if (best[bi] === 0) break;
      C.push(S[bi].slice());
      for (i = 0; i < S.length; i++) best[i] = Math.min(best[i], dist(S[i], C[C.length - 1]));
    }
    for (var it = 0; it < 8; it++) {
      var sum = C.map(function () { return [0, 0, 0, 0]; });
      S.forEach(function (s) {
        var k = 0, bd = 1e12;
        for (j = 0; j < C.length; j++) { var dd = dist(s, C[j]); if (dd < bd) { bd = dd; k = j; } }
        sum[k][0] += s[0]; sum[k][1] += s[1]; sum[k][2] += s[2]; sum[k][3]++;
      });
      C = C.map(function (c, k) {
        return sum[k][3] ? [sum[k][0] / sum[k][3], sum[k][1] / sum[k][3], sum[k][2] / sum[k][3]] : c;
      });
    }
    var idx = new Int16Array(N);
    for (i = 0; i < N; i++) {
      if (d[i * 4 + 3] < 128) { idx[i] = -1; continue; }
      var px = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]], k2 = 0, b2 = 1e12;
      for (j = 0; j < C.length; j++) { var e = dist(px, C[j]); if (e < b2) { b2 = e; k2 = j; } }
      idx[i] = k2;
    }
    return { centers: C, idx: idx };
  }
  function hex(c) {
    return '#' + c.map(function (v) { return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }).join('');
  }

  // ---------- outline tracing (pixel borders chained into closed loops) ----------
  function traceMask(m, w, h) {
    var W = w + 1, has = new Uint8Array(W * (h + 1) * 4), x, y;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        if (!m[y * w + x]) continue;
        if (y === 0 || !m[(y - 1) * w + x]) has[(y * W + x) * 4] = 1;                 // top, going right
        if (x === w - 1 || !m[y * w + x + 1]) has[(y * W + x + 1) * 4 + 1] = 1;       // right, going down
        if (y === h - 1 || !m[(y + 1) * w + x]) has[((y + 1) * W + x + 1) * 4 + 2] = 1; // bottom, going left
        if (x === 0 || !m[y * w + x - 1]) has[((y + 1) * W + x) * 4 + 3] = 1;         // left, going up
      }
    }
    var loops = [], total = W * (h + 1), step = [1, W, -1, -W];
    for (var v = 0; v < total; v++) {
      for (var d = 0; d < 4; d++) {
        if (!has[v * 4 + d]) continue;
        var pts = [], cv = v, cd = d;
        for (;;) {
          has[cv * 4 + cd] = 0;
          pts.push(cv % W, (cv / W) | 0);
          var nv = cv + step[cd], r = (cd + 1) & 3, l = (cd + 3) & 3, nd = -1;
          if (has[nv * 4 + r]) nd = r; else if (has[nv * 4 + cd]) nd = cd; else if (has[nv * 4 + l]) nd = l;
          if (nd < 0) break;
          cv = nv; cd = nd;
        }
        loops.push(pts);
      }
    }
    return loops;
  }
  function area2(p) {
    var a = 0, n = p.length / 2;
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
    }
    return Math.abs(a) / 2;
  }
  function smoothLoop(p, k) {
    if (k < 1) return p;
    var n = p.length / 2, out = new Array(p.length);
    for (var i = 0; i < n; i++) {
      var sx = 0, sy = 0;
      for (var j = -k; j <= k; j++) {
        var q = (((i + j) % n) + n) % n;
        sx += p[q * 2]; sy += p[q * 2 + 1];
      }
      out[i * 2] = sx / (2 * k + 1); out[i * 2 + 1] = sy / (2 * k + 1);
    }
    return out;
  }
  function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    var t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
    var x = ax + t * dx - px, y = ay + t * dy - py;
    return Math.sqrt(x * x + y * y);
  }
  function rdp(P, eps) {                                        // P = [[x,y],...] open polyline, iterative
    var n = P.length, keep = new Uint8Array(n), stack = [[0, n - 1]];
    keep[0] = 1; keep[n - 1] = 1;
    while (stack.length) {
      var se = stack.pop(), s = se[0], e = se[1], md = -1, mi = -1;
      for (var i = s + 1; i < e; i++) {
        var dd = segDist(P[i][0], P[i][1], P[s][0], P[s][1], P[e][0], P[e][1]);
        if (dd > md) { md = dd; mi = i; }
      }
      if (md > eps) { keep[mi] = 1; stack.push([s, mi], [mi, e]); }
    }
    var out = [];
    for (var k = 0; k < n; k++) if (keep[k]) out.push(P[k]);
    return out;
  }
  function reduceLoop(flat, eps) {                              // closed polygon
    var P = [], n = flat.length / 2, i;
    for (i = 0; i < n; i++) P.push([flat[i * 2], flat[i * 2 + 1]]);
    if (n < 4) return P;
    var f = 0, fd = -1;
    for (i = 1; i < n; i++) {
      var dd = (P[i][0] - P[0][0]) * (P[i][0] - P[0][0]) + (P[i][1] - P[0][1]) * (P[i][1] - P[0][1]);
      if (dd > fd) { fd = dd; f = i; }
    }
    var a = rdp(P.slice(0, f + 1), eps), b = rdp(P.slice(f).concat([P[0]]), eps);
    return a.concat(b.slice(1, b.length - 1));
  }

  // ---------- mask -> one compound path ----------
  function maskToPaths(m, w, h, o) {
    var loops = traceMask(m, w, h), paths = [], nodes = 0;
    var sm = o.smooth, k = Math.min(3, Math.round(sm / 2)), eps = 0.5 + sm * 0.1, tol = 0.5 + sm * 0.5;
    loops.forEach(function (lp) {
      if (area2(lp) < o.speck) return;
      var sl = smoothLoop(lp, k), poly;
      if (sm > 0) {                                   // curve fit needs the dense outline, or corners bulge
        poly = [];
        for (var z = 0; z < sl.length; z += 2) poly.push([sl[z], sl[z + 1]]);
      } else poly = reduceLoop(sl, eps);
      if (poly.length < 3) return;
      var path;
      if (sm > 0) {                                   // simplify as an open path (more reliable), then close it
        var pp = poly.map(function (q) { return new paper.Point(q[0], q[1]); });
        pp.push(pp[0].clone());
        path = new paper.Path({ segments: pp, insert: false });
        path.simplify(tol);
        path.closePath(0.5);
        if (path.segments.length > 1 && path.firstSegment.point.getDistance(path.lastSegment.point) < 0.5) path.lastSegment.remove();
        path.closed = true;
      } else path = new paper.Path({ segments: poly.map(function (q) { return new paper.Point(q[0], q[1]); }), closed: true, insert: false });
      if (path.segments.length < 2) return;
      var segs = path.segments.map(function (s) {
        return new paper.Segment(o.M.transform(s.point), o.L.transform(s.handleIn), o.L.transform(s.handleOut));
      });
      nodes += segs.length;
      paths.push(new paper.Path({ segments: segs, closed: true }));
    });
    return { paths: paths, nodes: nodes };
  }

  // ---------- run ----------
  function run() {
    var raster = null;
    for (var i = 0; i < selection.length; i++) if (selection[i].className === 'Raster') { raster = selection[i]; break; }
    if (!raster) { alert('Select an image first (Select tool, click the image).'); return; }

    var mode = $('tr-mode').value;
    var thr = Number($('tr-thr').value) || 50;
    var invert = $('tr-invert').checked;
    var img = readPixels(raster, Math.max(100, Math.min(1600, Number($('tr-size').value) || 600)));
    var rw = img.rw, rh = img.rh;

    // trace pixels -> project coordinates
    var M = raster.matrix.clone();
    M.translate(-rw / 2, -rh / 2);
    M.scale(rw / img.w, rh / img.h);
    var L = new paper.Matrix(M.a, M.b, M.c, M.d, 0, 0);
    var o = { smooth: Number($('tr-smooth').value) || 0, speck: Math.max(0, Number($('tr-speck').value) || 0), M: M, L: L };

    var layers = [], totalNodes = 0, totalPaths = 0;
    function addLayer(mask, color) {
      var r = maskToPaths(mask, img.w, img.h, o);
      if (!r.paths.length) return;
      var cp = new paper.CompoundPath({ children: r.paths, fillRule: 'evenodd', fillColor: color });
      cp.strokeColor = null;
      layers.push(cp);
      totalNodes += r.nodes; totalPaths += r.paths.length;
    }

    if (mode === 'colors') {
      var n = Math.max(2, Math.min(16, Math.round(Number($('tr-colors').value) || 6)));
      var q = quantize(img, n);
      if (!q) { alert('The image is fully transparent.'); return; }
      var order = q.centers.map(function (c, k) { return { k: k, l: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] }; })
        .sort(function (a, b) { return b.l - a.l; });
      var rank = []; order.forEach(function (e, r) { rank[e.k] = r; });
      var stack = $('tr-stack').checked, N = img.w * img.h;
      order.forEach(function (e, r) {
        var mask = new Uint8Array(N), any = false;
        for (var p = 0; p < N; p++) {
          var id = q.idx[p];
          if (id < 0) continue;
          var on = stack ? rank[id] >= r : rank[id] === r;
          if (on) { mask[p] = 1; any = true; }
        }
        if (any) addLayer(mask, hex(q.centers[e.k]));
      });
    } else {
      var mask = mode === 'edges' ? maskEdges(img, thr, invert) : maskBright(img, thr / 100 * 255, invert);
      addLayer(mask, $('tr-color').value);
    }

    if (!layers.length) { alert('Nothing was traced. Try a different Threshold or lower Remove specks.'); return; }

    var result;
    if (layers.length === 1) { result = layers[0]; registerItem(result, 'Trace', '⌘'); }
    else { result = new paper.Group({ children: layers }); registerItem(result, 'Trace', '⌘'); }
    result.insertAbove(raster);
    if ($('tr-hide').checked) raster.visible = false;
    setSelection([result]);
    saveState();
    renderLayers();
    say('Traced: ' + totalPaths + ' shape(s), ' + totalNodes + ' nodes' + (layers.length > 1 ? ', ' + layers.length + ' colors' : ''));
  }

  $('tr-run').addEventListener('click', function () {
    say('Tracing…');
    setTimeout(function () {
      try { run(); } catch (err) { alert('Trace failed: ' + err.message); }
    }, 40);
  });
  window.__traceRun = run;
})();