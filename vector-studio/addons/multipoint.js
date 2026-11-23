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