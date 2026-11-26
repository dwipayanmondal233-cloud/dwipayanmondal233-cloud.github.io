// addons/character-anim.js  (v2 - easier animating, tablet + laptop)
// Bones (hierarchy), per-channel keys, dope sheet, graph editor, clips, pose library,
// NEW: auto key ON by default, floating transport bar, keyboard shortcuts,
//      one-tap Quick Motion (swing / bob / sway / pulse / fade) with follow-through,
//      ease-all-keys, copy / paste keys.
(function () {
  'use strict';
  if (window.__addon_charanim) return;
  window.__addon_charanim = true;

  var $ = function (id) { return document.getElementById(id); };
  var say = function (m) { if (window.toast) window.toast(m); };
  var clamp = function (x, a, b) { return Math.min(b, Math.max(a, x)); };
  var r2 = function (v) { return Math.round(v * 100) / 100; };
  var r3 = function (v) { return Math.round(v * 1000) / 1000; };

  var CH = ['rot', 'tx', 'ty', 'sx', 'sy', 'op'];
  var CHN = { rot: 'Rotation', tx: 'Move X', ty: 'Move Y', sx: 'Scale X', sy: 'Scale Y', op: 'Opacity' };
  var uid = function () { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); };

  var S = {
    clips: [{ id: 'c1', name: 'Idle', length: 24, fps: 12, loop: true }], clip: 'c1',
    frame: 0, playing: false, acc: 0, auto: true, ease: 'smooth', mode: 'pose', tool: 'rot',
    view: 'classic', gch: 'rot', sel: [], gsel: null, poses: [], clipboard: null, keyclip: null,
    tabOn: false, dirty: true
  };
  var V = { cell: 14, sx: 0, sy: 0, W: 0, H: 0, dpr: 1, rows: [], range: null };
  var WORLD = {};

  function clip() { return S.clips.filter(function (c) { return c.id === S.clip; })[0] || S.clips[0]; }
  function rigOf(it) { return it && it.data && it.data.rig || null; }
  function boneList() { return allTopItems().filter(rigOf); }
  function curOf(it) {
    var r = it.data.rig;
    if (!r.cur) r.cur = { rot: 0, tx: 0, ty: 0, sx: 1, sy: 1, op: 1 };
    return r.cur;
  }
  function curBone() {
    var it = selection.length ? topLevelItem(selection[selection.length - 1]) : null;
    return it && rigOf(it) ? it : null;
  }
  function baseName(n) { return String(n || '').replace(/\s+\d+$/, ''); }
  function mirrorName(n) {
    var r = n.replace(/(^|[\s_.\-])L(?=$|[\s_.\-])/, '$1R'); if (r !== n) return r;
    r = n.replace(/(^|[\s_.\-])R(?=$|[\s_.\-])/, '$1L'); if (r !== n) return r;
    r = n.replace(/Left/, 'Right'); if (r !== n) return r;
    r = n.replace(/Right/, 'Left'); if (r !== n) return r;
    r = n.replace(/left/, 'right'); if (r !== n) return r;
    r = n.replace(/right/, 'left'); return r;
  }

  // ---------------- easing + channel values ----------------
  function bezY(t, x1, y1, x2, y2) {
    if (t <= 0) return 0; if (t >= 1) return 1;
    var lo = 0, hi = 1, s = t, i;
    for (i = 0; i < 22; i++) {
      s = (lo + hi) / 2;
      var x = 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
      if (x < t) lo = s; else hi = s;
    }
    return 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
  }
  function easeFn(t, e) {
    if (e === 'linear') return t;
    if (e === 'step') return 0;
    if (e === 'in') return t * t;
    if (e === 'out') return 1 - (1 - t) * (1 - t);
    if (typeof e === 'string' && e.indexOf('bez:') === 0) {
      var q = e.slice(4).split(',').map(Number);
      return bezY(t, q[0], q[1], q[2], q[3]);
    }
    return t * t * (3 - 2 * t);
  }
  function valAt(keys, f) {
    var n = keys.length;
    if (!n) return null;
    if (f <= keys[0].f) return keys[0].v;
    if (f >= keys[n - 1].f) return keys[n - 1].v;
    var i = 0;
    while (i < n - 1 && keys[i + 1].f <= f) i++;
    var a = keys[i], b = keys[i + 1], t = (f - a.f) / (b.f - a.f);
    return a.v + (b.v - a.v) * easeFn(t, a.e);
  }
  function actOf(it, make) {
    var d = it.data;
    if (!d.acts) { if (!make) return null; d.acts = {}; }
    var a = d.acts[S.clip];
    if (!a && make) a = d.acts[S.clip] = { rot: [], tx: [], ty: [], sx: [], sy: [], op: [] };
    return a || null;
  }
  function addKey(it, ch, f, v) {
    var arr = actOf(it, true)[ch], i;
    for (i = 0; i < arr.length; i++) if (arr[i].f === f) { arr[i].v = v; return arr[i]; }
    var k = { f: f, v: v, e: S.ease };
    arr.push(k);
    arr.sort(function (a, b) { return a.f - b.f; });
    return k;
  }
  function keyBone(it, list) { list.forEach(function (ch) { addKey(it, ch, S.frame, curOf(it)[ch]); }); }

  // ---------------- hierarchy + pose evaluation ----------------
  function buildTree() {
    var nodes = [], byUid = {}, roots = [];
    boneList().forEach(function (it) {
      var n = { it: it, kids: [], depth: 0, parent: null };
      nodes.push(n);
      if (it.data.uid) byUid[it.data.uid] = n;
    });
    nodes.forEach(function (n) {
      var pu = n.it.data.parent, p = pu && byUid[pu];
      if (p && p !== n) { p.kids.push(n); n.parent = p; } else roots.push(n);
    });
    (function d(list, k, guard) {
      if (guard > 100) return;
      list.forEach(function (n) { n.depth = k; d(n.kids, k + 1, guard + 1); });
    })(roots, 0, 0);
    return { roots: roots, nodes: nodes };
  }
  function localMatrix(it) {
    var r = it.data.rig, c = curOf(it), m = new paper.Matrix();
    m.translate(c.tx, c.ty);
    m.translate(r.pv[0], r.pv[1]);
    m.rotate(c.rot);
    m.scale(c.sx, c.sy);
    m.translate(-r.pv[0], -r.pv[1]);
    return m;
  }
  function isId(m) {
    return Math.abs(m.a - 1) < 1e-9 && Math.abs(m.d - 1) < 1e-9 && Math.abs(m.b) < 1e-9 &&
           Math.abs(m.c) < 1e-9 && Math.abs(m.tx) < 1e-9 && Math.abs(m.ty) < 1e-9;
  }
  function applyDelta(it, W) {
    if (!it.parent) return;
    var r = it.data.rig, Ai = mxFrom(r.ap).inverted();
    if (!Ai) return;
    var D = W.clone().append(Ai);
    if (!isId(D)) {
      animating = true;
      try { it.transform(D); } finally { animating = false; }
    }
    r.ap = mxArr(W);
    var o = (r.op0 == null ? 1 : r.op0) * curOf(it).op;
    if (Math.abs(it.opacity - o) > 1e-6) it.opacity = o;
  }
  function applyPose() {
    var t = buildTree();
    WORLD = {};
    (function walk(list, pw) {
      list.forEach(function (n) {
        var W = pw ? pw.clone().append(localMatrix(n.it)) : localMatrix(n.it);
        WORLD[n.it.id] = W;
        applyDelta(n.it, W);
        walk(n.kids, W);
      });
    })(t.roots, null);
    paper.project._needsUpdate = true;
  }
  function evalFrame(f) {
    boneList().forEach(function (it) {
      var a = actOf(it, false), c = curOf(it);
      if (!a) return;
      CH.forEach(function (ch) { if (a[ch].length) c[ch] = valAt(a[ch], f); });
    });
    applyPose();
  }
  function worldPivot(it) {
    var pv = it.data.rig.pv, W = WORLD[it.id];
    return W ? W.transform(new paper.Point(pv[0], pv[1])) : new paper.Point(pv[0], pv[1]);
  }
  function resetAll() {
    boneList().forEach(function (it) { it.data.rig.cur = { rot: 0, tx: 0, ty: 0, sx: 1, sy: 1, op: 1 }; });
    applyPose();
  }

  // ---------------- rigging ----------------
  function rigIt(it) {
    if (rigOf(it)) return true;
    if (it.data.keys && Object.keys(it.data.keys).length) { say('"' + it.name + '" has classic keys. Clear them first.'); return false; }
    var pv = getPivot(it);
    if (!it.data.uid) it.data.uid = newUid();
    it.data.rig = { pv: [pv.x, pv.y], ap: [1, 0, 0, 1, 0, 0], cur: { rot: 0, tx: 0, ty: 0, sx: 1, sy: 1, op: 1 }, op0: it.opacity };
    return true;
  }
  function unrigIt(it) {
    var r = rigOf(it);
    if (!r) return;
    var Ai = mxFrom(r.ap).inverted();
    if (Ai) { animating = true; try { it.transform(Ai); } finally { animating = false; } }
    it.opacity = r.op0 == null ? 1 : r.op0;
    delete it.data.rig; delete it.data.acts;
  }
  function enterRest() {
    S.playing = false; setPlayLabel();
    resetAll();
    boneList().forEach(function (it) { it.data.rig.ap = [1, 0, 0, 1, 0, 0]; });
    S.mode = 'rest';
    say('Rest mode: arrange the character and parents, then press the button again to lock it in');
  }
  function leaveRest() {
    boneList().forEach(function (it) {
      var r = it.data.rig, pv = getPivot(it);
      r.pv = [pv.x, pv.y]; r.ap = [1, 0, 0, 1, 0, 0]; r.op0 = it.opacity;
    });
    S.mode = 'pose';
    evalFrame(S.frame);
    saveState();
  }

  // ---------------- UI: tab + pane ----------------
  var tabBar = document.querySelector('.tab-bar'), tabBody = document.querySelector('.tab-body');
  if (!tabBar || !tabBody) return;
  var css = document.createElement('style');
  css.textContent =
    '#ra-switch{display:flex;gap:4px;margin-bottom:4px;flex-shrink:0}' +
    '#ra-switch button,#ra-bar button{padding:5px 9px;font-size:12px;background:#3a3a3a;color:#ddd;border:1px solid #555;border-radius:4px;cursor:pointer}' +
    '#ra-switch button.on,#ra-bar button.on,.ra-seg button.on,#rf-auto.on{background:#2f6fed;border-color:#2f6fed;color:#fff}' +
    '#ra-wrap{display:none;flex:1;min-height:0;flex-direction:column}' +
    '#ra-bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px;font-size:12px;color:#aaa}' +
    '#ra-bar input[type=number],#ra-bar select{padding:3px;background:#3a3a3a;color:#ddd;border:1px solid #555;border-radius:4px}' +
    '#ra-bar input[type=number]{width:56px}' +
    '#ra-hold{flex:1;min-height:0;position:relative;border:1px solid #111;background:#252525}' +
    '#ra-cv{position:absolute;left:0;top:0;width:100%;height:100%;touch-action:none}' +
    '.ra-seg{display:flex;gap:4px;margin-bottom:8px}.ra-seg button{flex:1;padding:7px 2px;background:#3a3a3a;color:#ddd;border:1px solid #555;border-radius:4px;cursor:pointer;font-size:12px}' +
    '#ra-bones{list-style:none;margin:0 0 8px}#ra-bones li{cursor:pointer;display:flex;gap:6px}' +
    '#ra-float{display:none;position:fixed;left:50%;transform:translateX(-50%);bottom:calc(var(--timeline-h,240px) + 14px);z-index:60;gap:6px;align-items:center;padding:6px 8px;background:rgba(30,30,30,.92);border:1px solid #555;border-radius:30px;box-shadow:0 2px 10px rgba(0,0,0,.5)}' +
    '#ra-float button{min-width:40px;height:36px;padding:0 10px;font-size:14px;background:#3a3a3a;color:#eee;border:1px solid #555;border-radius:18px;cursor:pointer}' +
    '#ra-float button.on{background:#2f6fed;border-color:#2f6fed}' +
    '#ra-float span{color:#ff9f1c;font-size:12px;min-width:44px;text-align:center}' +
    '.ra-step{display:inline-flex;align-items:center;gap:3px}.ra-step button,#ra-bar .ra-step button{width:30px;height:30px;padding:0;font-size:18px;line-height:1;background:#3a3a3a;color:#eee;border:1px solid #555;border-radius:4px;cursor:pointer;touch-action:manipulation;user-select:none}.ra-step input,#ra-bar .ra-step input[type=number]{width:62px;text-align:center}' +
    '#ra-ov{display:none;position:fixed;pointer-events:none;z-index:40}' +
    '@media (pointer:coarse){#ra-switch button,#ra-bar button{padding:9px 12px}#ra-float button{min-width:48px;height:44px}.ra-step button,#ra-bar .ra-step button{width:44px;height:40px}}';
  document.head.appendChild(css);

  var tabBtn = document.createElement('button');
  tabBtn.className = 'tab-btn'; tabBtn.dataset.tab = 'animate'; tabBtn.textContent = 'Anim';
  tabBar.appendChild(tabBtn);
  var pane = document.createElement('div');
  pane.className = 'tab-pane'; pane.dataset.pane = 'animate';
  pane.innerHTML =
    '<h3 class="section-title">Clip</h3>' +
    '<label class="prop-row">Clip <select id="ra-clip"></select></label>' +
    '<div class="layer-actions"><button id="ra-clip-new">＋ New</button><button id="ra-clip-dup">Duplicate</button><button id="ra-clip-ren">Rename</button><button id="ra-clip-del">🗑</button></div>' +
    '<label class="prop-row">Length (frames) <input type="number" id="ra-len" min="1" max="600" value="24"></label>' +
    '<label class="prop-row">FPS <input type="number" id="ra-fps" min="1" max="60" value="12"></label>' +
    '<label class="prop-row">Loop <input type="checkbox" id="ra-loop" checked></label>' +
    '<div class="layer-actions"><button id="ra-cycle" title="Copy the first key of every channel to the last frame">Make cycle</button></div>' +
    '<h3 class="section-title">Rig</h3>' +
    '<div class="layer-actions"><button id="ra-rig">Rig selected</button><button id="ra-rigall">Rig all</button><button id="ra-unrig">Unrig</button></div>' +
    '<div class="layer-actions"><button id="ra-mode">✎ Edit rest pose</button></div>' +
    '<p class="hint" id="ra-hint">Build parents with Arrange → Rig → Set parent (child first, then click the parent).</p>' +
    '<label class="prop-row">Show bones on canvas <input type="checkbox" id="ra-showb" checked></label>' +
    '<ul id="ra-bones"></ul>' +
    '<h3 class="section-title">Quick motion (1 tap animation)</h3>' +
    '<label class="prop-row">Motion <select id="ra-qm"><option value="swing">Swing (rotate)</option><option value="bob">Bob (up / down)</option><option value="sway">Sway (left / right)</option><option value="pulse">Pulse / breathe (scale)</option><option value="fade">Fade</option></select></label>' +
    '<label class="prop-row">Amount <input type="number" id="ra-qm-amt" value="15"></label>' +
    '<label class="prop-row">Children follow late <input type="checkbox" id="ra-qm-chain" checked></label>' +
    '<label class="prop-row">Delay per level (frames) <input type="number" id="ra-qm-delay" value="2" min="0" max="30"></label>' +
    '<div class="layer-actions"><button id="ra-qm-go">⚡ Apply motion to selected</button></div>' +
    '<p class="hint">Select a rigged part, press Apply. It makes a looping animation for the whole clip. Children lag behind the parent, so it looks natural (tail, arm, hair).</p>' +
    '<h3 class="section-title">Pose</h3>' +
    '<div class="layer-actions"><button id="ra-tool-btn">🦴 Pose tool (M)</button></div>' +
    '<div class="ra-seg" id="ra-seg"><button data-t="rot" class="on">⟳ Rotate</button><button data-t="move">✥ Move</button><button data-t="scale">⤢ Scale</button></div>' +
    CH.map(function (ch) {
      return '<label class="prop-row">' + CHN[ch] + ' <input type="number" id="ra-f-' + ch + '" step="' + (ch === 'rot' ? 1 : (ch === 'tx' || ch === 'ty') ? 1 : 0.05) + '"></label>';
    }).join('') +
    '<label class="prop-row">Auto key <input type="checkbox" id="ra-auto" checked></label>' +
    '<label class="prop-row">New key easing <select id="ra-ease"><option value="smooth">Smooth</option><option value="linear">Linear</option><option value="step">Step</option><option value="in">Ease in</option><option value="out">Ease out</option></select></label>' +
    '<div class="layer-actions"><button id="ra-key-all">◆ Key bone</button><button id="ra-key-rot">Rot</button><button id="ra-key-loc">Loc</button><button id="ra-key-scl">Scale</button><button id="ra-key-op">Op</button></div>' +
    '<div class="layer-actions"><button id="ra-key-allb">◆ Key ALL bones</button><button id="ra-unkey">Delete key (frame)</button></div>' +
    '<div class="layer-actions"><button id="ra-ease-all">Apply easing to ALL keys of bone</button></div>' +
    '<div class="layer-actions"><button id="ra-reset">Reset bone</button><button id="ra-reset-all">Reset all</button></div>' +
    '<h3 class="section-title">Pose library</h3>' +
    '<div class="layer-actions"><button id="ra-pose-save">Save pose</button><button id="ra-pose-copy">Copy</button><button id="ra-pose-paste">Paste</button><button id="ra-pose-flip">Paste flipped</button></div>' +
    '<label class="prop-row">Saved <select id="ra-poses"></select></label>' +
    '<div class="layer-actions"><button id="ra-pose-apply">Apply</button><button id="ra-pose-applyf">Apply flipped</button><button id="ra-pose-del">🗑</button></div>' +
    '<p class="hint">Flipped swaps bones named L/R or Left/Right, negates rotation and Move X. Name bones by double-clicking them in the Layers tab, e.g. "Arm L" and "Arm R".</p>' +
    '<h3 class="section-title">Export clip</h3>' +
    '<label class="prop-row">Scale % <input type="number" id="ra-ex-scale" value="100" min="10" max="400"></label>' +
    '<label class="prop-row">Columns <input type="number" id="ra-ex-cols" value="8" min="1" max="64"></label>' +
    '<div class="layer-actions"><button id="ra-ex-sheet">⬇ Sprite sheet</button><button id="ra-ex-gif">⬇ GIF</button></div>' +
    '<div class="layer-actions"><button id="ra-ex-json">⬇ Rig + all clips (JSON)</button></div>' +
    '<p class="hint">Exports the orange frame area. Background follows the Export tab. Classic Auto key (timeline) should stay OFF for rigged bones.</p>' +
    '<p class="hint"><b>Shortcuts</b> (when Anim tab is open): Space play · ← → frame · ↑ ↓ jump key · K key bone · Shift+K key all · Ctrl+C / Ctrl+V copy / paste keys (over the dope sheet) · Delete remove keys · M pose tool.</p>';
  tabBody.appendChild(pane);

  var tabs = document.querySelectorAll('.tab-btn');
  tabBtn.addEventListener('click', function () {
    document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.toggle('active', b === tabBtn); });
    document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.toggle('active', p === pane); });
    S.tabOn = true;
    if (S.view === 'classic') setView('dope');   // open the dope sheet automatically
    refreshAll(); updateFloat();
  });
  tabs.forEach(function (b) {
    if (b !== tabBtn) b.addEventListener('click', function () {
      tabBtn.classList.remove('active'); pane.classList.remove('active');
      S.tabOn = false; updateFloat();
    });
  });

  // ---------------- UI: bottom panel (dope sheet / graph) ----------------
  var footer = $('timeline'), tlBar = $('tl-bar'), tlScroll = $('tl-scroll');
  var sw = document.createElement('div');
  sw.id = 'ra-switch';
  sw.innerHTML = '<button data-v="classic" class="on">Classic timeline</button><button data-v="dope">Dope sheet</button><button data-v="graph">Graph</button>';
  footer.insertBefore(sw, footer.firstChild);
  var wrap = document.createElement('div');
  wrap.id = 'ra-wrap';
  wrap.innerHTML =
    '<div id="ra-bar"><button id="ra-first">⏮</button><button id="ra-prev">◀</button><button id="ra-play">▶ Play</button><button id="ra-next">▶</button>' +
    '<label>Frame <input type="number" id="ra-frame" value="0" min="0"></label>' +
    '<button id="ra-pk">◀ Key</button><button id="ra-nk">Key ▶</button>' +
    '<label>Interp <select id="ra-interp"><option value="smooth">Smooth</option><option value="linear">Linear</option><option value="step">Step</option><option value="in">Ease in</option><option value="out">Ease out</option><option value="bez">Bezier</option></select></label>' +
    '<button id="ra-copykeys">Copy keys</button><button id="ra-pastekeys">Paste keys</button>' +
    '<button id="ra-delkeys">Delete keys</button>' +
    '<label id="ra-gch-l">Channel <select id="ra-gch">' + CH.map(function (c) { return '<option value="' + c + '">' + CHN[c] + '</option>'; }).join('') + '</select></label>' +
    '<button id="ra-zin">🔍＋</button><button id="ra-zout">🔍−</button><span id="ra-status" style="color:#ff9f1c"></span></div>' +
    '<div id="ra-hold"><canvas id="ra-cv"></canvas></div>';
  footer.appendChild(wrap);
  var cv = $('ra-cv'), cx = cv.getContext('2d'), hold = $('ra-hold');
  var hover = false;
  hold.addEventListener('pointerenter', function () { hover = true; });
  hold.addEventListener('pointerleave', function () { hover = false; });

  // floating transport bar (easy on tablet: big buttons over the canvas)
  var fl = document.createElement('div');
  fl.id = 'ra-float';
  fl.innerHTML = '<button id="rf-prev">◀</button><button id="rf-play">▶</button><button id="rf-next">▶</button>' +
    '<span id="rf-fr">0</span><button id="rf-key">◆ Key</button><button id="rf-auto" class="on">Auto</button><button id="rf-eye" class="on" title="Show / hide bones">🦴</button>';
  document.body.appendChild(fl);
  function updateFloat() { fl.style.display = (S.tabOn || S.view !== 'classic') ? 'flex' : 'none'; }
  function setPlayLabel() {
    var t = S.playing ? '⏸ Pause' : '▶ Play';
    var a = $('ra-play'), b = $('rf-play');
    if (a) a.textContent = t;
    if (b) b.textContent = S.playing ? '⏸' : '▶';
  }

  function setView(v) {
    S.view = v;
    var classic = v === 'classic';
    tlBar.style.display = classic ? '' : 'none';
    tlScroll.style.display = classic ? '' : 'none';
    wrap.style.display = classic ? 'none' : 'flex';
    $('ra-gch-l').style.display = v === 'graph' ? '' : 'none';
    sw.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === v); });
    if (!classic) {
      try {
        if (parseFloat(getComputedStyle($('app')).getPropertyValue('--timeline-h')) < 250) setPanel('--timeline-h', 280);
      } catch (e) {}
      sizeCanvas();
    }
    updateFloat();
    S.dirty = true;
  }
  sw.querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { setView(b.dataset.v); }); });

  function sizeCanvas() {
    V.dpr = Math.min(2, window.devicePixelRatio || 1);
    V.W = hold.clientWidth; V.H = hold.clientHeight;
    cv.width = Math.max(1, Math.round(V.W * V.dpr)); cv.height = Math.max(1, Math.round(V.H * V.dpr));
    S.dirty = true;
  }
  new ResizeObserver(function () { if (S.view !== 'classic') sizeCanvas(); }).observe(hold);

  // ---------------- +/- steppers for every number box ----------------
  function addStepper(el, step, min, max, live) {
    if (!el) return;
    var box = document.createElement('span'); box.className = 'ra-step';
    el.parentNode.insertBefore(box, el);
    var dec = document.createElement('button'), inc = document.createElement('button');
    dec.type = inc.type = 'button'; dec.textContent = '−'; inc.textContent = '+';
    box.appendChild(dec); box.appendChild(el); box.appendChild(inc);
    var count = 0, active = false, t1, t2;
    function bump(dir) {
      if (el.disabled) return;
      var mul = count > 18 ? 5 : 1; count++;
      var v = Number(el.value) || 0, nv = Math.round((v + dir * step * mul) * 1000) / 1000;
      if (min != null) nv = Math.max(min, nv);
      if (max != null) nv = Math.min(max, nv);
      el.value = nv;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (live) el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function stop() {
      clearTimeout(t1); clearInterval(t2);
      if (active) { active = false; if (!live) el.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    [[dec, -1], [inc, 1]].forEach(function (p) {
      p[0].addEventListener('pointerdown', function (e) {
        e.preventDefault(); active = true; count = 0; bump(p[1]);
        t1 = setTimeout(function () { t2 = setInterval(function () { bump(p[1]); }, 70); }, 380);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { p[0].addEventListener(ev, stop); });
    });
  }
  CH.forEach(function (ch) {
    var big = ch === 'rot' || ch === 'tx' || ch === 'ty';
    addStepper($('ra-f-' + ch), big ? 2 : 0.05, ch === 'op' ? 0 : null, ch === 'op' ? 1 : null, false);
  });
  addStepper($('ra-frame'), 1, 0, null, true);
  addStepper($('ra-len'), 1, 1, 600, true);
  addStepper($('ra-fps'), 1, 1, 60, true);
  addStepper($('ra-qm-amt'), 1, null, null, false);
  addStepper($('ra-qm-delay'), 1, 0, 30, false);
  addStepper($('ra-ex-scale'), 10, 10, 400, false);
  addStepper($('ra-ex-cols'), 1, 1, 64, false);

  // ---------------- tool: pose ----------------
  tools.pose = new paper.Tool();
  var pd = null;
  tools.pose.onMouseDown = function (e) {
    if (S.mode !== 'pose') { say('Switch back from rest mode first (Anim tab)'); pd = null; return; }
    var hit = paper.project.hitTest(e.point, {
      fill: true, stroke: true, tolerance: 8,
      match: function (h) { return h.item.className !== 'Raster' || !!rasterPixel(h.item, e.point); }
    });
    var it = hit ? topLevelItem(hit.item) : curBone();
    if (!it) { say('Tap a part of the character'); pd = null; return; }
    if (!rigOf(it)) {
      if (!rigIt(it)) { pd = null; return; }
      say('Auto-rigged "' + (it.name || 'Part') + '"'); refreshBones();
    }
    if (selection.indexOf(it) < 0) setSelection([it]);
    pd = { it: it, last: e.point, changed: {} };
    applyPose();
  };
  tools.pose.onMouseDrag = function (e) {
    if (!pd) return;
    var it = pd.it, c = curOf(it), wp = worldPivot(it);
    if (S.tool === 'rot') {
      var d = e.point.subtract(wp).angle - pd.last.subtract(wp).angle;
      if (d > 180) d -= 360; if (d < -180) d += 360;
      c.rot += d; pd.changed.rot = 1;
    } else if (S.tool === 'move') {
      var delta = e.point.subtract(pd.last), t = buildTree(), par = null;
      t.nodes.forEach(function (n) { if (n.it === it) par = n.parent; });
      var Wp = par ? WORLD[par.it.id] : null;
      if (Wp) {
        var inv = new paper.Matrix(Wp.a, Wp.b, Wp.c, Wp.d, 0, 0).inverted();
        if (inv) delta = inv.transform(delta);
      }
      c.tx += delta.x; c.ty += delta.y; pd.changed.tx = 1; pd.changed.ty = 1;
    } else {
      var f = clamp(e.point.getDistance(wp) / Math.max(pd.last.getDistance(wp), 1e-3), 0.5, 2);
      c.sx *= f; c.sy *= f; pd.changed.sx = 1; pd.changed.sy = 1;
    }
    pd.last = e.point;
    applyPose(); syncFields();
  };
  tools.pose.onMouseUp = function () {
    if (!pd) return;
    if (S.auto) { keyBone(pd.it, Object.keys(pd.changed)); }
    pd = null;
    saveState(); refreshBones(); S.dirty = true;
  };

  var poseBtn = document.createElement('button');
  poseBtn.className = 'tool-btn'; poseBtn.dataset.tool = 'pose'; poseBtn.textContent = '🦴';
  poseBtn.title = 'Pose tool (M): drag a rigged part to pose it';
  $('toolbar').appendChild(poseBtn);
  poseBtn.addEventListener('click', function () { setTool('pose'); });
  var _setTool = setTool;
  setTool = function (name) { _setTool(name); S.toolName = name; poseBtn.classList.toggle('active', name === 'pose'); };
  $('ra-tool-btn').addEventListener('click', function () { setTool('pose'); });
  $('ra-seg').querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () {
      S.tool = b.dataset.t;
      $('ra-seg').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
    });
  });

  // ---------------- UI: clips ----------------
  function ensureClips() {
    var known = {};
    S.clips.forEach(function (c) { known[c.id] = 1; });
    allTopItems().forEach(function (it) {
      if (it.data && it.data.acts) Object.keys(it.data.acts).forEach(function (id) {
        if (!known[id]) { known[id] = 1; S.clips.push({ id: id, name: 'Clip ' + S.clips.length, length: 24, fps: 12, loop: true }); }
      });
    });
    if (!S.clips.some(function (c) { return c.id === S.clip; })) S.clip = S.clips[0].id;
  }
  function renderClipUI() {
    ensureClips();
    var sel = $('ra-clip');
    sel.innerHTML = S.clips.map(function (c) { return '<option value="' + c.id + '">' + c.name + '</option>'; }).join('');
    sel.value = S.clip;
    var c = clip();
    $('ra-len').value = c.length; $('ra-fps').value = c.fps; $('ra-loop').checked = !!c.loop;
    $('ra-ease').value = S.ease; $('ra-auto').checked = S.auto; syncAutoBtns();
  }
  function syncAutoBtns() { $('ra-auto').checked = S.auto; $('rf-auto').classList.toggle('on', S.auto); }
  function switchClip(id) {
    S.clip = id; S.playing = false; setPlayLabel(); S.sel = []; S.gsel = null;
    resetAll();
    S.frame = 0;
    if (S.mode === 'pose') evalFrame(0);
    renderClipUI(); refreshAll();
  }
  $('ra-clip').addEventListener('change', function () { switchClip(this.value); });
  $('ra-clip-new').addEventListener('click', function () {
    var n = prompt('Clip name:', 'Clip ' + (S.clips.length + 1));
    if (!n) return;
    S.clips.push({ id: uid(), name: n.trim() || 'Clip', length: 24, fps: 12, loop: true });
    switchClip(S.clips[S.clips.length - 1].id);
  });
  $('ra-clip-dup').addEventListener('click', function () {
    var src = clip(), id = uid();
    S.clips.push({ id: id, name: src.name + ' copy', length: src.length, fps: src.fps, loop: src.loop });
    boneList().forEach(function (it) {
      if (it.data.acts && it.data.acts[src.id]) it.data.acts[id] = JSON.parse(JSON.stringify(it.data.acts[src.id]));
    });
    switchClip(id); saveState();
  });
  $('ra-clip-ren').addEventListener('click', function () {
    var n = prompt('Clip name:', clip().name);
    if (n && n.trim()) { clip().name = n.trim(); renderClipUI(); }
  });
  $('ra-clip-del').addEventListener('click', function () {
    if (S.clips.length < 2) { say('Keep at least one clip'); return; }
    if (!confirm('Delete clip "' + clip().name + '" and all its keys?')) return;
    var id = S.clip;
    boneList().forEach(function (it) { if (it.data.acts) delete it.data.acts[id]; });
    S.clips = S.clips.filter(function (c) { return c.id !== id; });
    switchClip(S.clips[0].id); saveState();
  });
  $('ra-len').addEventListener('change', function () {
    clip().length = clamp(Math.round(Number(this.value) || 24), 1, 600);
    this.value = clip().length; setFrame(S.frame); S.dirty = true;
  });
  $('ra-fps').addEventListener('change', function () { clip().fps = clamp(Math.round(Number(this.value) || 12), 1, 60); this.value = clip().fps; });
  $('ra-loop').addEventListener('change', function () { clip().loop = this.checked; });
  function setAuto(v) { S.auto = v; syncAutoBtns(); say(S.auto ? 'Auto key ON: every pose change is keyed' : 'Auto key off: press ◆ Key to save a pose'); }
  $('ra-auto').addEventListener('change', function () { setAuto(this.checked); });
  $('rf-auto').addEventListener('click', function () { setAuto(!S.auto); });
  $('ra-ease').addEventListener('change', function () { S.ease = this.value; });
  $('ra-cycle').addEventListener('click', function () {
    var last = clip().length - 1, n = 0;
    if (last < 1) { say('Length must be at least 2'); return; }
    boneList().forEach(function (it) {
      var a = actOf(it, false);
      if (!a) return;
      CH.forEach(function (ch) {
        var arr = a[ch];
        if (!arr.length) return;
        if (!arr.some(function (k) { return k.f === last; })) { addKey(it, ch, last, arr[0].v); n++; }
      });
    });
    saveState(); S.dirty = true; say(n + ' key(s) added at frame ' + last);
  });

  // ---------------- UI: rig buttons + bone list ----------------
  $('ra-rig').addEventListener('click', function () {
    if (!selection.length) { say('Select objects first'); return; }
    var n = 0;
    selection.forEach(function (s) { var it = topLevelItem(s); if (!rigOf(it) && rigIt(it)) n++; });
    applyPose(); saveState(); refreshAll(); say(n + ' object(s) rigged');
  });
  $('ra-rigall').addEventListener('click', function () {
    var n = 0;
    allTopItems().forEach(function (it) { if (it.visible !== false && !rigOf(it) && rigIt(it)) n++; });
    applyPose(); saveState(); refreshAll(); say(n + ' object(s) rigged');
  });
  $('ra-unrig').addEventListener('click', function () {
    if (!selection.length) { say('Select rigged objects first'); return; }
    selection.forEach(function (s) { unrigIt(topLevelItem(s)); });
    applyPose(); saveState(); refreshAll();
  });
  $('ra-mode').addEventListener('click', function () {
    if (S.mode === 'pose') enterRest(); else leaveRest();
    refreshAll();
  });
  function refreshBones() {
    var ul = $('ra-bones'), t = buildTree(), list = [];
    (function walk(ns) { ns.forEach(function (n) { list.push(n); walk(n.kids); }); })(t.roots);
    ul.innerHTML = '';
    if (!list.length) { ul.innerHTML = '<li class="empty-note">No rigged parts yet. Select parts and press Rig selected.</li>'; return; }
    list.forEach(function (n) {
      var li = document.createElement('li');
      li.className = 'object-item' + (selection.indexOf(n.it) >= 0 ? ' selected' : '');
      li.style.marginLeft = (n.depth * 14) + 'px';
      var a = actOf(n.it, false), has = a && CH.some(function (ch) { return a[ch].length; });
      li.innerHTML = '<span class="object-icon">🦴</span><span class="object-name"></span><span>' + (has ? '◆' : '') + '</span>';
      li.querySelector('.object-name').textContent = n.it.name || 'Part';
      li.addEventListener('click', function () { setSelection([n.it]); });
      ul.appendChild(li);
    });
  }
  function syncFields() {
    var it = curBone();
    CH.forEach(function (ch) {
      var el = $('ra-f-' + ch);
      el.disabled = !it || S.mode !== 'pose';
      if (it && document.activeElement !== el) el.value = r2(curOf(it)[ch]);
      else if (!it) el.value = '';
    });
  }
  CH.forEach(function (ch) {
    var el = $('ra-f-' + ch);
    el.addEventListener('input', function () {
      var it = curBone(), v = Number(el.value);
      if (!it || S.mode !== 'pose' || isNaN(v)) return;
      curOf(it)[ch] = v; applyPose();
      if (S.auto) addKey(it, ch, S.frame, v);
      S.dirty = true;
    });
    el.addEventListener('change', function () { saveState(); refreshBones(); });
  });
  function needBone() { var it = curBone(); if (!it) say('Select a rigged part first'); return it; }
  function keyAndSave(it, list) { keyBone(it, list); saveState(); refreshBones(); S.dirty = true; }
  $('ra-key-all').addEventListener('click', function () { var it = needBone(); if (it) keyAndSave(it, CH); });
  $('ra-key-rot').addEventListener('click', function () { var it = needBone(); if (it) keyAndSave(it, ['rot']); });
  $('ra-key-loc').addEventListener('click', function () { var it = needBone(); if (it) keyAndSave(it, ['tx', 'ty']); });
  $('ra-key-scl').addEventListener('click', function () { var it = needBone(); if (it) keyAndSave(it, ['sx', 'sy']); });
  $('ra-key-op').addEventListener('click', function () { var it = needBone(); if (it) keyAndSave(it, ['op']); });
  function keyAllBones() {
    boneList().forEach(function (it) { keyBone(it, CH); });
    saveState(); refreshBones(); S.dirty = true; say('Keyed every bone at frame ' + S.frame);
  }
  $('ra-key-allb').addEventListener('click', keyAllBones);
  $('ra-unkey').addEventListener('click', function () {
    var it = needBone();
    if (!it) return;
    var a = actOf(it, false);
    if (!a) return;
    CH.forEach(function (ch) { a[ch] = a[ch].filter(function (k) { return k.f !== S.frame; }); });
    saveState(); refreshBones(); S.dirty = true;
  });
  $('ra-ease-all').addEventListener('click', function () {
    var it = needBone();
    if (!it) return;
    var a = actOf(it, false), n = 0;
    if (!a) { say('This bone has no keys'); return; }
    CH.forEach(function (ch) { a[ch].forEach(function (k) { k.e = S.ease; n++; }); });
    if (S.mode === 'pose') evalFrame(S.frame);
    saveState(); S.dirty = true; say(n + ' key(s) set to "' + S.ease + '"');
  });
  $('ra-reset').addEventListener('click', function () {
    var it = needBone();
    if (!it) return;
    it.data.rig.cur = { rot: 0, tx: 0, ty: 0, sx: 1, sy: 1, op: 1 };
    if (S.auto) keyBone(it, CH);
    applyPose(); saveState(); syncFields(); S.dirty = true;
  });
  $('ra-reset-all').addEventListener('click', function () {
    resetAll();
    if (S.auto) boneList().forEach(function (it) { keyBone(it, CH); });
    saveState(); syncFields(); S.dirty = true;
  });

  // ---------------- quick motion ----------------
  var QM = {
    swing: { amt: 15, f: function (p, a) { return { rot: a * Math.sin(2 * Math.PI * p) }; } },
    bob:   { amt: 8,  f: function (p, a) { return { ty: -a * (0.5 - 0.5 * Math.cos(2 * Math.PI * p)) }; } },
    sway:  { amt: 8,  f: function (p, a) { return { tx: a * Math.sin(2 * Math.PI * p) }; } },
    pulse: { amt: 6,  f: function (p, a) { var s = 1 + a / 100 * Math.sin(2 * Math.PI * p); return { sx: s, sy: s }; } },
    fade:  { amt: 50, f: function (p, a) { return { op: 1 - clamp(a, 0, 100) / 100 * (0.5 - 0.5 * Math.cos(2 * Math.PI * p)) }; } }
  };
  $('ra-qm').addEventListener('change', function () { $('ra-qm-amt').value = QM[this.value].amt; });
  function bakeMotion(it, type, amt, delay) {
    var len = clip().length, def = QM[type], a = actOf(it, true);
    var step = Math.max(1, Math.floor(len / 8)), frames = [], f;
    for (f = 0; f < len; f += step) frames.push(f);
    if (frames[frames.length - 1] !== len - 1) frames.push(len - 1);
    Object.keys(def.f(0, amt)).forEach(function (ch) { a[ch] = []; });
    frames.forEach(function (fr) {
      var p = (((fr - delay) % len) + len) % len / len, vals = def.f(p, amt);
      Object.keys(vals).forEach(function (ch) { a[ch].push({ f: fr, v: r3(vals[ch]), e: 'smooth' }); });
    });
  }
  $('ra-qm-go').addEventListener('click', function () {
    if (S.mode !== 'pose') { say('Lock the rest pose first'); return; }
    if (clip().length < 4) { say('Make the clip at least 4 frames long'); return; }
    var roots = selection.map(topLevelItem).filter(rigOf);
    if (!roots.length) { say('Select a rigged part first (Rig selected)'); return; }
    var type = $('ra-qm').value, amt = Number($('ra-qm-amt').value), chain = $('ra-qm-chain').checked;
    var dl = clamp(Number($('ra-qm-delay').value) || 0, 0, 30);
    if (isNaN(amt)) amt = QM[type].amt;
    var t = buildTree(), n = 0, seen = {};
    t.nodes.forEach(function (nd) {
      if (roots.indexOf(nd.it) < 0) return;
      (function go(x, lvl) {
        if (seen[x.it.id]) return;
        seen[x.it.id] = 1;
        bakeMotion(x.it, type, amt, chain ? lvl * dl : 0); n++;
        if (chain) x.kids.forEach(function (k) { go(k, lvl + 1); });
      })(nd, 0);
    });
    evalFrame(S.frame); saveState(); refreshBones(); S.dirty = true;
    if (!S.playing) togglePlay();
    say(n + ' bone(s) animated. Playing. Edit keys in the dope sheet or graph.');
  });

  // ---------------- pose library ----------------
  function snapshotPose() {
    var o = {};
    boneList().forEach(function (it) {
      var c = curOf(it);
      o[baseName(it.name)] = { rot: c.rot, tx: c.tx, ty: c.ty, sx: c.sx, sy: c.sy, op: c.op };
    });
    return o;
  }
  function applyPoseVals(vals, flip) {
    var by = {};
    boneList().forEach(function (b) { by[baseName(b.name)] = b; });
    var n = 0;
    Object.keys(vals).forEach(function (name) {
      var tgt = flip ? (by[mirrorName(name)] || by[name]) : by[name];
      if (!tgt) return;
      var c = curOf(tgt), v = vals[name];
      CH.forEach(function (ch) {
        var x = v[ch];
        if (flip && (ch === 'rot' || ch === 'tx')) x = -x;
        c[ch] = x;
      });
      if (S.auto) keyBone(tgt, CH);
      n++;
    });
    applyPose(); saveState(); syncFields(); refreshBones(); S.dirty = true;
    say(n + ' bone(s) posed');
  }
  function renderPoses() {
    $('ra-poses').innerHTML = S.poses.map(function (p, i) { return '<option value="' + i + '">' + p.name + '</option>'; }).join('');
  }
  $('ra-pose-save').addEventListener('click', function () {
    var n = prompt('Pose name:', 'Pose ' + (S.poses.length + 1));
    if (!n) return;
    S.poses.push({ name: n.trim() || 'Pose', vals: snapshotPose() });
    renderPoses(); $('ra-poses').value = String(S.poses.length - 1);
  });
  $('ra-pose-copy').addEventListener('click', function () { S.clipboard = snapshotPose(); say('Pose copied'); });
  $('ra-pose-paste').addEventListener('click', function () { if (S.clipboard) applyPoseVals(S.clipboard, false); else say('Copy a pose first'); });
  $('ra-pose-flip').addEventListener('click', function () { if (S.clipboard) applyPoseVals(S.clipboard, true); else say('Copy a pose first'); });
  $('ra-pose-apply').addEventListener('click', function () { var p = S.poses[Number($('ra-poses').value)]; if (p) applyPoseVals(p.vals, false); });
  $('ra-pose-applyf').addEventListener('click', function () { var p = S.poses[Number($('ra-poses').value)]; if (p) applyPoseVals(p.vals, true); });
  $('ra-pose-del').addEventListener('click', function () {
    var i = Number($('ra-poses').value);
    if (S.poses[i]) { S.poses.splice(i, 1); renderPoses(); }
  });

  // ---------------- frame control + playback ----------------
  function setFrame(f, quiet) {
    S.frame = clamp(Math.round(f), 0, clip().length - 1);
    if (S.mode === 'pose') evalFrame(S.frame);
    $('ra-frame').value = S.frame; $('rf-fr').textContent = S.frame;
    if (!quiet) syncFields();
    S.dirty = true;
  }
  function hasKeys(it) { var a = actOf(it, false); return !!a && CH.some(function (ch) { return a[ch].length; }); }
  function togglePlay() {
    S.playing = !S.playing; S.acc = 0; setPlayLabel();
    if (!S.playing) return;
    var bl = boneList();
    if (S.mode === 'rest') say('You are in REST mode. Anim tab → press "Lock rest pose" to play');
    else if (!bl.length) say('Nothing is rigged yet: Anim tab → Rig all');
    else if (!bl.some(hasKeys)) say('No keys in this clip yet: pose with Auto key ON, or use ⚡ Quick motion');
  }
  function keyFrames() {
    var set = {}, bl = curBone() ? [curBone()] : boneList();
    bl.forEach(function (it) {
      var a = actOf(it, false);
      if (a) CH.forEach(function (ch) { a[ch].forEach(function (k) { set[k.f] = 1; }); });
    });
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }
  function prevKey() { var p = keyFrames().filter(function (f) { return f < S.frame; }); if (p.length) setFrame(p[p.length - 1]); }
  function nextKey() { var n = keyFrames().filter(function (f) { return f > S.frame; }); if (n.length) setFrame(n[0]); }
  $('ra-first').addEventListener('click', function () { setFrame(0); });
  $('ra-prev').addEventListener('click', function () { setFrame(S.frame - 1); });
  $('ra-next').addEventListener('click', function () { setFrame(S.frame + 1); });
  $('ra-play').addEventListener('click', togglePlay);
  $('ra-frame').addEventListener('change', function () { setFrame(this.value); });
  $('ra-pk').addEventListener('click', prevKey);
  $('ra-nk').addEventListener('click', nextKey);
  $('rf-prev').addEventListener('click', function () { setFrame(S.frame - 1); });
  $('rf-next').addEventListener('click', function () { setFrame(S.frame + 1); });
  $('rf-play').addEventListener('click', togglePlay);
  $('rf-key').addEventListener('click', function () { var it = needBone(); if (it) { keyAndSave(it, CH); say('Keyed at frame ' + S.frame); } });
  $('ra-zin').addEventListener('click', function () { V.cell = Math.min(60, V.cell * 1.3); S.dirty = true; });
  $('ra-zout').addEventListener('click', function () { V.cell = Math.max(4, V.cell / 1.3); S.dirty = true; });
  $('ra-gch').addEventListener('change', function () { S.gch = this.value; S.gsel = null; S.dirty = true; });

  // ---------------- dope sheet ----------------
  var LW = 170, RHT = 24, ROW = 22;
  function dopeRows() {
    var t = buildTree(), out = [];
    (function walk(ns) {
      ns.forEach(function (n) {
        out.push({ t: 'b', it: n.it, d: n.depth });
        if (selection.indexOf(n.it) >= 0) CH.forEach(function (ch) { out.push({ t: 'c', it: n.it, ch: ch }); });
        walk(n.kids);
      });
    })(t.roots);
    return out;
  }
  function boneKeyMap(it) {
    var set = {}, a = actOf(it, false);
    if (a) CH.forEach(function (ch) { a[ch].forEach(function (k) { (set[k.f] = set[k.f] || []).push({ it: it, ch: ch, key: k }); }); });
    return set;
  }
  function isSel(k) { return S.sel.some(function (s) { return s.key === k; }); }
  function dia(c, x, y, sel, col) {
    c.beginPath(); c.moveTo(x, y - 6); c.lineTo(x + 6, y); c.lineTo(x, y + 6); c.lineTo(x - 6, y); c.closePath();
    c.fillStyle = sel ? '#fff' : col; c.fill(); c.strokeStyle = '#000'; c.stroke();
  }
  function drawDope() {
    var W = V.W, H = V.H, c = cx, cell = V.cell, len = clip().length, sx = V.sx, sy = V.sy;
    var R = dopeRows(); V.rows = R;
    var X = function (f) { return LW + f * cell - sx; };
    R.forEach(function (r, i) {
      var y = RHT + i * ROW - sy;
      if (y > H || y + ROW < RHT) return;
      c.fillStyle = r.t === 'b' ? (selection.indexOf(r.it) >= 0 ? '#1f3a6e' : '#2b2b2b') : '#222';
      c.fillRect(LW, y, W - LW, ROW);
    });
    c.fillStyle = 'rgba(0,0,0,.35)';
    if (X(len) < W) c.fillRect(X(len), RHT, W - X(len), H - RHT);
    var f0 = Math.max(0, Math.floor(sx / cell)), f1 = Math.min(len, Math.ceil((sx + W - LW) / cell)), f;
    for (f = f0; f <= f1; f++) {
      c.strokeStyle = f % clip().fps === 0 ? '#555' : '#333';
      c.beginPath(); c.moveTo(Math.round(X(f)) + .5, RHT); c.lineTo(Math.round(X(f)) + .5, H); c.stroke();
    }
    c.fillStyle = 'rgba(255,59,59,.18)'; c.fillRect(X(S.frame), RHT, cell, H - RHT);
    R.forEach(function (r, i) {
      var y = RHT + i * ROW - sy;
      if (y > H || y + ROW < RHT) return;
      var cy = y + ROW / 2;
      if (r.t === 'b') {
        var m = boneKeyMap(r.it);
        Object.keys(m).forEach(function (fr) {
          dia(c, X(Number(fr)) + cell / 2, cy, m[fr].some(function (q) { return isSel(q.key); }), '#ff9f1c');
        });
      } else {
        var a = actOf(r.it, false);
        if (a) a[r.ch].forEach(function (k) { dia(c, X(k.f) + cell / 2, cy, isSel(k), '#6cc4ff'); });
      }
    });
    c.fillStyle = '#1e1e1e'; c.fillRect(LW, 0, W - LW, RHT);
    var stepN = [1, 2, 5, 10, 20, 50, 100].filter(function (s) { return s * cell >= 30; })[0] || 100;
    c.textAlign = 'center'; c.fillStyle = '#aaa';
    for (f = f0; f < f1; f++) if (f % stepN === 0) c.fillText(String(f), X(f) + cell / 2, 9);
    c.fillStyle = '#ff3b3b'; c.fillRect(X(S.frame), RHT - 12, cell, 12);
    c.fillStyle = '#fff'; c.fillText(String(S.frame), X(S.frame) + cell / 2, RHT - 6);
    c.fillStyle = '#ff3b3b'; c.fillRect(Math.round(X(S.frame) + cell / 2), RHT, 1, H - RHT);
    c.textAlign = 'left'; c.fillStyle = '#2b2b2b'; c.fillRect(0, 0, LW, H);
    R.forEach(function (r, i) {
      var y = RHT + i * ROW - sy;
      if (y > H || y + ROW < RHT) return;
      c.fillStyle = r.t === 'b' ? (selection.indexOf(r.it) >= 0 ? '#1f4fa8' : '#2f2f2f') : (S.gch === r.ch ? '#35506f' : '#262626');
      c.fillRect(0, y, LW - 1, ROW);
      c.save(); c.beginPath(); c.rect(0, y, LW - 4, ROW); c.clip();
      c.fillStyle = '#ddd';
      if (r.t === 'b') c.fillText('🦴 ' + (r.it.name || 'Part'), 6 + r.d * 10, y + ROW / 2);
      else c.fillText('   ' + CHN[r.ch], 18, y + ROW / 2);
      c.restore();
    });
    c.fillStyle = '#1e1e1e'; c.fillRect(0, 0, LW, RHT); c.fillStyle = '#888'; c.fillText('Bones', 6, RHT / 2);
    c.fillStyle = '#111'; c.fillRect(LW - 1, 0, 1, H);
    if (!R.length) { c.fillStyle = '#888'; c.fillText('Rig parts first (Anim tab → Rig all)', LW + 12, RHT + 18); }
  }

  // ---------------- graph editor ----------------
  var GL = 54, GT = RHT + 8, GB = 14;
  function gchan() {
    var it = curBone();
    if (!it) return null;
    var a = actOf(it, false);
    return { it: it, keys: a ? a[S.gch] : [] };
  }
  function graphRange(ch) {
    if (V.range) return V.range;
    var vals = ch.keys.map(function (k) { return k.v; });
    if (!vals.length) vals = [curOf(ch.it)[S.gch]];
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    if (mx - mn < 0.2) { mn -= 0.5; mx += 0.5; }
    var pad = (mx - mn) * 0.2;
    return { min: mn - pad, max: mx + pad };
  }
  function handlePos(k, next) {
    var q = k.e.slice(4).split(',').map(Number), df = next.f - k.f, dv = next.v - k.v;
    return { h1: { f: k.f + q[0] * df, v: k.v + q[1] * dv }, h2: { f: k.f + q[2] * df, v: k.v + q[3] * dv }, dv: dv, df: df };
  }
  function drawGraph() {
    var W = V.W, H = V.H, c = cx, cell = V.cell, len = clip().length, sx = V.sx;
    var X = function (f) { return GL + f * cell + cell / 2 - sx; };
    var ch = gchan();
    c.fillStyle = '#1e1e1e'; c.fillRect(0, 0, W, RHT);
    var f0 = Math.max(0, Math.floor(sx / cell)), f1 = Math.min(len, Math.ceil((sx + W - GL) / cell)), f;
    var stepN = [1, 2, 5, 10, 20, 50, 100].filter(function (s) { return s * cell >= 30; })[0] || 100;
    c.textAlign = 'center'; c.fillStyle = '#aaa';
    for (f = f0; f < f1; f++) if (f % stepN === 0) c.fillText(String(f), X(f), 9);
    for (f = f0; f <= f1; f++) {
      c.strokeStyle = f % clip().fps === 0 ? '#444' : '#2e2e2e';
      c.beginPath(); c.moveTo(Math.round(X(f)) + .5, RHT); c.lineTo(Math.round(X(f)) + .5, H); c.stroke();
    }
    c.fillStyle = '#ff3b3b'; c.fillRect(X(S.frame) - cell / 2, RHT - 12, cell, 12);
    c.fillStyle = '#fff'; c.fillText(String(S.frame), X(S.frame), RHT - 6);
    c.fillStyle = '#ff3b3b'; c.fillRect(Math.round(X(S.frame)), RHT, 1, H - RHT);
    c.textAlign = 'left';
    if (!ch) {
      c.fillStyle = '#888'; c.fillText('Select a rigged bone to see its ' + CHN[S.gch] + ' curve', GL + 10, H / 2);
      return;
    }
    var rg = graphRange(ch), top = GT, ph = H - GT - GB;
    var Y = function (v) { return top + (rg.max - v) / (rg.max - rg.min) * ph; };
    V.map = { rg: rg, top: top, ph: ph };
    c.textAlign = 'right';
    for (var i = 0; i <= 4; i++) {
      var v = rg.min + (rg.max - rg.min) * i / 4, yy = Y(v);
      c.strokeStyle = '#2e2e2e'; c.beginPath(); c.moveTo(GL, yy); c.lineTo(W, yy); c.stroke();
      c.fillStyle = '#888'; c.fillText(String(r2(v)), GL - 6, yy);
    }
    c.textAlign = 'left';
    var keys = ch.keys;
    c.strokeStyle = '#ff9f1c'; c.lineWidth = 2; c.beginPath();
    var first = true;
    for (var px = GL; px < W; px += 2) {
      var fr = (px - GL - cell / 2 + sx) / cell;
      if (fr < 0 || fr > len - 1) continue;
      var val = keys.length ? valAt(keys, fr) : curOf(ch.it)[S.gch];
      if (first) { c.moveTo(px, Y(val)); first = false; } else c.lineTo(px, Y(val));
    }
    c.stroke(); c.lineWidth = 1;
    keys.forEach(function (k, idx) {
      var sel = S.gsel && S.gsel.key === k;
      var nxt = keys[idx + 1];
      if (sel && nxt && typeof k.e === 'string' && k.e.indexOf('bez:') === 0) {
        var hp = handlePos(k, nxt);
        [[k, hp.h1], [nxt, hp.h2]].forEach(function (pr) {
          c.strokeStyle = '#888';
          c.beginPath(); c.moveTo(X(pr[0].f), Y(pr[0].v)); c.lineTo(X(pr[1].f), Y(pr[1].v)); c.stroke();
          c.fillStyle = '#6cc4ff'; c.beginPath(); c.arc(X(pr[1].f), Y(pr[1].v), 5, 0, 6.3); c.fill();
        });
      }
      c.fillStyle = sel ? '#fff' : '#ff9f1c';
      c.strokeStyle = '#000';
      c.beginPath(); c.arc(X(k.f), Y(k.v), 6, 0, 6.3); c.fill(); c.stroke();
    });
    c.fillStyle = '#9ab'; c.fillText(CHN[S.gch] + ' · ' + (ch.it.name || ''), GL + 8, RHT + 14);
  }

  function redrawAll() {
    if (V.W < 50 || V.H < 40) return;
    cx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
    cx.fillStyle = '#252525'; cx.fillRect(0, 0, V.W, V.H);
    cx.font = '11px system-ui,sans-serif'; cx.textBaseline = 'middle';
    if (S.view === 'graph') drawGraph(); else drawDope();
  }

  // ---------------- canvas interaction ----------------
  var ptrs = {}, dr = null;
  function normalizeKeys(arr) {
    arr.sort(function (a, b) { return a.f - b.f; });
    for (var i = arr.length - 1; i > 0; i--) {
      if (arr[i].f === arr[i - 1].f) {
        var drop = S.sel.some(function (s) { return s.key === arr[i]; }) || (S.gsel && S.gsel.key === arr[i]) ? i - 1 : i;
        arr.splice(drop, 1);
      }
    }
  }
  function finishKeyEdit() {
    boneList().forEach(function (it) {
      var a = actOf(it, false);
      if (a) CH.forEach(function (ch) { normalizeKeys(a[ch]); });
    });
    if (S.mode === 'pose') evalFrame(S.frame);
    saveState(); refreshBones(); S.dirty = true;
  }
  function downDope(x, y, shift) {
    var f = Math.floor((x - LW + V.sx) / V.cell);
    if (y < RHT) { if (x >= LW) { dr = { t: 'scrub' }; setFrame(f); } return; }
    var i = Math.floor((y - RHT + V.sy) / ROW), r = V.rows[i];
    if (x < LW) {
      if (r) {
        if (selection.indexOf(r.it) < 0) setSelection([r.it]);
        if (r.t === 'c') { S.gch = r.ch; $('ra-gch').value = r.ch; }
        S.dirty = true;
      }
      return;
    }
    if (!r) { dr = { t: 'scrub' }; if (!shift) S.sel = []; setFrame(f); return; }
    var refs = [];
    if (r.t === 'b') { var m = boneKeyMap(r.it); refs = m[f] || []; }
    else { var a = actOf(r.it, false); if (a) a[r.ch].forEach(function (k) { if (k.f === f) refs.push({ it: r.it, ch: r.ch, key: k }); }); }
    if (!refs.length) { dr = { t: 'scrub' }; if (!shift) S.sel = []; setFrame(f); return; }
    if (shift) {
      var already = refs.every(function (q) { return isSel(q.key); });
      if (already) S.sel = S.sel.filter(function (s) { return !refs.some(function (q) { return q.key === s.key; }); });
      else refs.forEach(function (q) { if (!isSel(q.key)) S.sel.push(q); });
    } else if (!refs.some(function (q) { return isSel(q.key); })) S.sel = refs.slice();
    if (selection.indexOf(r.it) < 0) setSelection([r.it]);
    dr = { t: 'keys', x0: x, orig: S.sel.map(function (s) { return s.key.f; }), moved: false };
    S.dirty = true;
  }
  function moveDope(x) {
    if (!dr) return;
    if (dr.t === 'scrub') { setFrame(Math.floor((x - LW + V.sx) / V.cell)); return; }
    if (dr.t === 'keys') {
      var d = Math.round((x - dr.x0) / V.cell), mn = Math.min.apply(null, dr.orig), mx = Math.max.apply(null, dr.orig);
      d = clamp(d, -mn, clip().length - 1 - mx);
      S.sel.forEach(function (s, i) { s.key.f = dr.orig[i] + d; });
      if (d) dr.moved = true;
      S.dirty = true;
    }
  }
  function downGraph(x, y, shift) {
    var ch = gchan(), f = Math.floor((x - GL + V.sx) / V.cell);
    if (y < RHT) { dr = { t: 'scrub' }; setFrame(f); return; }
    if (!ch || !V.map) { dr = { t: 'scrub' }; setFrame(f); return; }
    var X = function (ff) { return GL + ff * V.cell + V.cell / 2 - V.sx; };
    var Y = function (v) { return V.map.top + (V.map.rg.max - v) / (V.map.rg.max - V.map.rg.min) * V.map.ph; };
    var keys = ch.keys, i;
    if (S.gsel && S.gsel.ch === S.gch) {                      // handles first
      var idx = keys.indexOf(S.gsel.key), k = S.gsel.key, nx = keys[idx + 1];
      if (nx && typeof k.e === 'string' && k.e.indexOf('bez:') === 0) {
        var hp = handlePos(k, nx);
        var cand = [['h1', hp.h1], ['h2', hp.h2]];
        for (i = 0; i < 2; i++) {
          if (Math.hypot(x - X(cand[i][1].f), y - Y(cand[i][1].v)) < 14) {
            dr = { t: 'handle', which: cand[i][0], k: k, nx: nx }; V.range = V.map.rg; return;
          }
        }
      }
    }
    for (i = 0; i < keys.length; i++) {
      if (Math.hypot(x - X(keys[i].f), y - Y(keys[i].v)) < 14) {
        S.gsel = { it: ch.it, ch: S.gch, key: keys[i] };
        S.sel = [{ it: ch.it, ch: S.gch, key: keys[i] }];
        dr = { t: 'gkey', k: keys[i], moved: false }; V.range = V.map.rg;
        S.dirty = true; return;
      }
    }
    S.gsel = null; S.sel = [];
    dr = { t: 'scrub' }; setFrame(f);
  }
  function moveGraph(x, y) {
    if (!dr) return;
    if (dr.t === 'scrub') { setFrame(Math.floor((x - GL + V.sx) / V.cell)); return; }
    var rg = V.range || (V.map && V.map.rg);
    if (!rg) return;
    var vOf = function (yy) { return rg.max - (yy - V.map.top) / V.map.ph * (rg.max - rg.min); };
    if (dr.t === 'gkey') {
      var nf = clamp(Math.floor((x - GL + V.sx) / V.cell), 0, clip().length - 1), ch = gchan();
      if (ch && !ch.keys.some(function (k) { return k !== dr.k && k.f === nf; })) dr.k.f = nf;
      dr.k.v = Math.round(vOf(y) * 1000) / 1000; dr.moved = true;
      ch.keys.sort(function (a, b) { return a.f - b.f; });
      if (S.mode === 'pose') evalFrame(S.frame);
      S.dirty = true;
    } else if (dr.t === 'handle') {
      var k = dr.k, nx = dr.nx, q = k.e.slice(4).split(',').map(Number), df = nx.f - k.f, dv = nx.v - k.v;
      var ff = (x - GL - V.cell / 2 + V.sx) / V.cell;
      var tx = clamp((ff - k.f) / (df || 1), 0, 1), ty = dv ? clamp((vOf(y) - k.v) / dv, -1, 2) : (dr.which === 'h1' ? q[1] : q[3]);
      if (dr.which === 'h1') { q[0] = tx; q[1] = ty; } else { q[2] = tx; q[3] = ty; }
      k.e = 'bez:' + q.map(function (n) { return Math.round(n * 1000) / 1000; }).join(',');
      if (S.mode === 'pose') evalFrame(S.frame);
      S.dirty = true;
    }
  }
  function endDrag() {
    if (!dr) return;
    var d = dr; dr = null; V.range = null;
    if (d.t === 'keys' && d.moved) finishKeyEdit();
    else if ((d.t === 'gkey' && d.moved) || d.t === 'handle') finishKeyEdit();
    S.dirty = true;
  }
  cv.addEventListener('pointerdown', function (e) {
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    var r = cv.getBoundingClientRect();
    ptrs[e.pointerId] = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (Object.keys(ptrs).length >= 2) { dr = null; return; }
    var p = ptrs[e.pointerId];
    if (S.view === 'graph') downGraph(p.x, p.y, e.shiftKey); else downDope(p.x, p.y, e.shiftKey);
  });
  cv.addEventListener('pointermove', function (e) {
    var p = ptrs[e.pointerId];
    if (!p) return;
    var r = cv.getBoundingClientRect(), nx = e.clientX - r.left, ny = e.clientY - r.top, dx = nx - p.x, dy = ny - p.y;
    p.x = nx; p.y = ny;
    if (Object.keys(ptrs).length >= 2) { V.sx = Math.max(0, V.sx - dx / 2); V.sy = Math.max(0, V.sy - dy / 2); S.dirty = true; return; }
    if (S.view === 'graph') moveGraph(nx, ny); else moveDope(nx);
  });
  function up(e) { delete ptrs[e.pointerId]; if (!Object.keys(ptrs).length) endDrag(); }
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (e.ctrlKey || S.view === 'graph') V.cell = clamp(V.cell * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 4, 60);
    else if (e.shiftKey) V.sx = Math.max(0, V.sx + e.deltaY);
    else V.sy = Math.max(0, V.sy + e.deltaY);
    S.dirty = true;
  }, { passive: false });

  $('ra-interp').addEventListener('change', function () {
    var v = this.value, e = v === 'bez' ? 'bez:0.333,0,0.667,1' : v;
    var targets = S.sel.length ? S.sel : (S.gsel ? [S.gsel] : []);
    if (!targets.length) { say('Select keys first'); return; }
    targets.forEach(function (s) { s.key.e = e; });
    if (S.mode === 'pose') evalFrame(S.frame);
    saveState(); S.dirty = true;
  });
  function selTargets() { return S.sel.length ? S.sel : (S.gsel ? [S.gsel] : []); }
  function deleteSelKeys() {
    var targets = selTargets();
    if (!targets.length) { say('Select keys first'); return; }
    targets.forEach(function (s) {
      var a = actOf(s.it, false);
      if (a) a[s.ch] = a[s.ch].filter(function (k) { return k !== s.key; });
    });
    S.sel = []; S.gsel = null;
    if (S.mode === 'pose') evalFrame(S.frame);
    saveState(); refreshBones(); S.dirty = true;
  }
  function copyKeys() {
    var t = selTargets();
    if (!t.length) { say('Select keys first (tap a ◆)'); return; }
    var m = Math.min.apply(null, t.map(function (s) { return s.key.f; }));
    S.keyclip = t.map(function (s) { return { it: s.it, ch: s.ch, d: s.key.f - m, v: s.key.v, e: s.key.e }; });
    say(t.length + ' key(s) copied');
  }
  function pasteKeys() {
    if (!S.keyclip || !S.keyclip.length) { say('Copy keys first'); return; }
    var one = S.keyclip.every(function (k) { return k.it === S.keyclip[0].it; }), cb = curBone();
    var target = one && cb ? cb : null, n = 0;      // one bone copied + another selected = paste onto it
    S.keyclip.forEach(function (k) {
      var f = S.frame + k.d;
      if (f > clip().length - 1) return;
      var it = target || k.it;
      if (!rigOf(it)) return;
      addKey(it, k.ch, f, k.v).e = k.e; n++;
    });
    if (S.mode === 'pose') evalFrame(S.frame);
    saveState(); refreshBones(); S.dirty = true; say(n + ' key(s) pasted at frame ' + S.frame);
  }
  $('ra-delkeys').addEventListener('click', deleteSelKeys);
  $('ra-copykeys').addEventListener('click', copyKeys);
  $('ra-pastekeys').addEventListener('click', pasteKeys);

  // ---------------- keyboard shortcuts ----------------
  document.addEventListener('keydown', function (e) {
    var tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.altKey) return;
    var k = e.key, low = k.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (!mod && low === 'm') { setTool('pose'); return; }
    if (!(S.tabOn || S.view !== 'classic')) return;       // below: only while animating
    if (mod && hover && low === 'c') { e.preventDefault(); e.stopImmediatePropagation(); copyKeys(); return; }
    if (mod && hover && low === 'v') { e.preventDefault(); e.stopImmediatePropagation(); pasteKeys(); return; }
    if (mod) return;
    if (k === ' ') { e.preventDefault(); togglePlay(); }
    else if (k === 'ArrowLeft') { e.preventDefault(); setFrame(S.frame - (e.shiftKey ? 5 : 1)); }
    else if (k === 'ArrowRight') { e.preventDefault(); setFrame(S.frame + (e.shiftKey ? 5 : 1)); }
    else if (k === 'ArrowUp') { e.preventDefault(); prevKey(); }
    else if (k === 'ArrowDown') { e.preventDefault(); nextKey(); }
    else if (low === 'k') { if (e.shiftKey) keyAllBones(); else { var it = needBone(); if (it) keyAndSave(it, CH); } }
  });
  window.addEventListener('keydown', function (e) {
    var tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (!hover || S.view === 'classic') return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault(); e.stopImmediatePropagation(); deleteSelKeys();
    }
  }, true);

  // ---------------- export ----------------
  function frameArea() { return new paper.Rectangle(frame.x, frame.y, frame.w, frame.h); }
  function exportBgColor() { return expBg.value === 'color' ? expBgColor.value : null; }
  $('ra-ex-sheet').addEventListener('click', function () {
    var cl = clip(), n = cl.length, keep = S.frame;
    var sc = clamp(Number($('ra-ex-scale').value) || 100, 10, 400) / 100;
    var cols = clamp(Math.round(Number($('ra-ex-cols').value) || 8), 1, 64);
    var cw = Math.max(1, Math.round(frame.w * sc)), ch = Math.max(1, Math.round(frame.h * sc));
    cols = Math.min(cols, n);
    var rows = Math.ceil(n / cols), W = cols * cw, H = rows * ch;
    if (W > 8192 || H > 8192 || W * H > 16000000) { alert('The sheet would be ' + W + ' x ' + H + '. Lower Scale % or increase Columns.'); return; }
    var sheet = document.createElement('canvas'); sheet.width = W; sheet.height = H;
    var sctx = sheet.getContext('2d'), bg = exportBgColor(), meta = [];
    if (bg) { sctx.fillStyle = bg; sctx.fillRect(0, 0, W, H); }
    S.playing = false; setPlayLabel();
    for (var i = 0; i < n; i++) {
      evalFrame(i);
      var f = renderArea(frameArea(), cw, ch, false, bg), x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
      sctx.drawImage(f, x, y); meta.push({ index: i, x: x, y: y, w: cw, h: ch });
    }
    evalFrame(keep); paper.view.update();
    var name = cl.name.replace(/[^\w\-]+/g, '_');
    var json = { image: name + '.png', clip: cl.name, frameWidth: cw, frameHeight: ch, columns: cols, rows: rows, fps: cl.fps, frameCount: n, loop: cl.loop, frames: meta };
    sheet.toBlob(function (b) {
      if (!b) { alert('Export failed. Try a smaller size.'); return; }
      downloadBlob(b, name + '.png');
      setTimeout(function () { downloadBlob(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }), name + '.json'); }, 500);
    }, 'image/png');
  });
  $('ra-ex-gif').addEventListener('click', async function () {
    if (!window.MediaExport) { alert('GIF export needs the Day 7 export code (MediaExport) in app.js.'); return; }
    var cl = clip(), n = cl.length, keep = S.frame;
    var sc = clamp(Number($('ra-ex-scale').value) || 100, 10, 400) / 100;
    var cw = Math.max(1, Math.round(frame.w * sc)), ch = Math.max(1, Math.round(frame.h * sc));
    if (cw > 1024 || ch > 1024 || cw * ch * n > 30000000) { alert('Too big. Lower Scale %.'); return; }
    var bg = exportBgColor();
    S.playing = false; setPlayLabel();
    try {
      var blob = await MediaExport.gif(function (i) { evalFrame(i); return renderArea(frameArea(), cw, ch, false, bg); }, n, cw, ch, cl.fps, !bg, cl.loop, say);
      downloadBlob(blob, cl.name.replace(/[^\w\-]+/g, '_') + '.gif');
    } catch (err) { alert('GIF export failed: ' + err.message); }
    evalFrame(keep); paper.view.update();
  });
  $('ra-ex-json').addEventListener('click', function () {
    var t = buildTree(), out = { format: 'vector-studio-rig', version: 1, clips: S.clips, bones: [] };
    (function walk(ns) {
      ns.forEach(function (n) {
        var it = n.it, r = it.data.rig, chans = {};
        Object.keys(it.data.acts || {}).forEach(function (id) {
          chans[id] = {};
          CH.forEach(function (ch) { chans[id][ch] = it.data.acts[id][ch].map(function (k) { return { f: k.f, v: k.v, e: k.e }; }); });
        });
        out.bones.push({ name: it.name, parent: n.parent ? n.parent.it.name : null, pivot: r.pv, opacity: r.op0, channels: chans });
        walk(n.kids);
      });
    })(t.roots);
    downloadBlob(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), 'rig-animation.json');
  });

  // ---------------- persistence + hooks ----------------
  var _pd = projectData;
  projectData = function () {
    var d = _pd();
    d.rigAnim = { clips: S.clips, clip: S.clip, poses: S.poses };
    return d;
  };
  var _ld = loadProjectData;
  loadProjectData = function (data) {
    if (data && data.rigAnim) {
      if (data.rigAnim.clips && data.rigAnim.clips.length) S.clips = data.rigAnim.clips;
      if (data.rigAnim.clip) S.clip = data.rigAnim.clip;
      S.poses = data.rigAnim.poses || [];
    }
    var r = _ld(data);
    S.sel = []; S.gsel = null; S.frame = 0;
    renderClipUI(); renderPoses(); refreshAll();
    return r;
  };
  var _rs = restoreState;
  restoreState = function () {
    var r = _rs.apply(this, arguments);
    S.sel = []; S.gsel = null; applyPose(); refreshAll();
    return r;
  };
  var _lps = loadProjectSnapshot;
  loadProjectSnapshot = function () {
    var r = _lps.apply(this, arguments);
    S.sel = []; S.gsel = null; refreshAll();
    return r;
  };

  function refreshAll() {
    $('ra-mode').textContent = S.mode === 'pose' ? '✎ Edit rest pose' : '✔ Lock rest pose and return to posing';
    $('ra-hint').textContent = S.mode === 'rest'
      ? 'REST MODE: move parts, set parents and pivots with the normal tools. Then lock it in.'
      : 'Build parents with Arrange → Rig → Set parent (child first, then click the parent).';
    refreshBones(); syncFields(); S.dirty = true;
  }

  // ---------------- visible bones overlay ----------------
  S.showBones = true;
  var ov = document.createElement('canvas'); ov.id = 'ra-ov';
  document.body.appendChild(ov);
  var octx = ov.getContext('2d');
  function drawBones() {
    var show = S.showBones && (S.tabOn || S.view !== 'classic' || S.toolName === 'pose');
    var list = show ? boneList() : [];
    if (!list.length) { ov.style.display = 'none'; return; }
    var el = paper.view.element, r = el.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    ov.style.display = 'block';
    ov.style.left = r.left + 'px'; ov.style.top = r.top + 'px'; ov.style.width = r.width + 'px'; ov.style.height = r.height + 'px';
    var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (ov.width !== w || ov.height !== h) { ov.width = w; ov.height = h; }
    octx.setTransform(dpr, 0, 0, dpr, 0, 0); octx.clearRect(0, 0, r.width, r.height);
    var kx = r.width / (paper.view.viewSize.width || r.width), ky = r.height / (paper.view.viewSize.height || r.height);
    var P = function (pt) { var q = paper.view.projectToView(pt); return { x: q.x * kx, y: q.y * ky }; };
    var t = buildTree(), c = octx;
    c.lineCap = 'round'; c.font = '11px system-ui,sans-serif'; c.textBaseline = 'bottom';
    t.nodes.forEach(function (n) {
      if (!n.parent) return;
      var p = P(worldPivot(n.it)), q = P(worldPivot(n.parent.it));
      c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(p.x, p.y);
      c.strokeStyle = 'rgba(0,0,0,.65)'; c.lineWidth = 6; c.stroke();
      c.strokeStyle = '#ff9f1c'; c.lineWidth = 3; c.stroke();
    });
    t.nodes.forEach(function (n) {
      var p = P(worldPivot(n.it)), sel = selection.indexOf(n.it) >= 0, nm = n.it.name || 'Part';
      c.beginPath(); c.arc(p.x, p.y, sel ? 10 : 7, 0, 6.3);
      c.fillStyle = sel ? '#2f6fed' : '#ff9f1c'; c.fill();
      c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
      c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.8)'; c.strokeText(nm, p.x + 12, p.y - 6);
      c.fillStyle = '#fff'; c.fillText(nm, p.x + 12, p.y - 6);
    });
  }
  function setShowBones(v) {
    S.showBones = v; $('ra-showb').checked = v; $('rf-eye').classList.toggle('on', v);
  }
  $('ra-showb').addEventListener('change', function () { setShowBones(this.checked); });
  $('rf-eye').addEventListener('click', function () { setShowBones(!S.showBones); });

  // ---------------- main loop (own requestAnimationFrame, playback does not depend on the app's tick) ----------------
  var lastT = 0, lastSig = '';
  function loop(t) {
    requestAnimationFrame(loop);
    var dt = lastT ? Math.min((t - lastT) / 1000, 0.25) : 0.016; lastT = t;
    if (S.playing && S.mode === 'pose') {
      S.acc += dt;
      var cl = clip(), step = 1 / cl.fps, adv = 0;
      while (S.acc >= step) { S.acc -= step; adv++; }
      if (adv) {
        var f = S.frame + adv;
        if (f >= cl.length) {
          if (cl.loop) f = f % cl.length; else { f = cl.length - 1; S.playing = false; setPlayLabel(); }
        }
        setFrame(f, true);
        try { paper.view.update(); } catch (e) {}
      }
    }
    var sig = selection.map(function (i) { return i.id; }).join(',') + '|' + boneList().length;
    if (sig !== lastSig) { lastSig = sig; refreshBones(); syncFields(); S.dirty = true; }
    if (S.dirty && S.view !== 'classic') { S.dirty = false; redrawAll(); }
    if (S.view !== 'classic') {
      var it = curBone(), msg = 'Clip: ' + clip().name + ' · frame ' + S.frame + '/' + (clip().length - 1);
      if (S.mode === 'rest') msg += ' · REST MODE';
      else if (S.auto) msg += ' · AUTO KEY';
      if (it && S.mode !== 'rest' && !hasKeys(it)) msg += ' · no keys on this bone';
      $('ra-status').textContent = msg;
    }
    try { drawBones(); } catch (e) {}
  }
  requestAnimationFrame(loop);

  renderClipUI(); renderPoses(); refreshAll(); setView('classic'); setPlayLabel();
  window.charAnim = { state: S, evalFrame: evalFrame, applyPose: applyPose };
})();