paper.setup(document.getElementById('canvas'));

// ---------- Shared style for new shapes ----------
const style = { fill: '#2f6fed', stroke: '#000000', strokeWidth: 2 };

// ---------- Property panel elements ----------
const fillInput = document.getElementById('fill-color');
const strokeInput = document.getElementById('stroke-color');
const widthInput = document.getElementById('stroke-width');
const blurInput = document.getElementById('blur');
const blurLabel = document.getElementById('blur-label');

// ---------- Tools ----------
const tools = {
  select: new paper.Tool(),
  rect:   new paper.Tool(),
  circle: new paper.Tool(),
  brush:  new paper.Tool(),
  pen:    new paper.Tool(),
  node:   new paper.Tool(),
  line:   new paper.Tool(),
  star:   new paper.Tool(),
  spray:  new paper.Tool(),
  text:   new paper.Tool(),
  eraser: new paper.Tool(),
  bucket: new paper.Tool(),
  picker: new paper.Tool(),
  lasso:  new paper.Tool(),
  wand:   new paper.Tool()
};

let currentToolName = 'rect';
let selection = [];
let selectedItem = null;
let objCounter = 0;

// ---------- New panel elements ----------
const fillTypeSel = document.getElementById('fill-type');
const fill2Input = document.getElementById('fill-color2');
const gradAngleInput = document.getElementById('grad-angle');
const opacityInput = document.getElementById('opacity');
const opacityLabel = document.getElementById('opacity-label');
const blendSel = document.getElementById('blend-mode');

// ---------- Fill / stroke opacity helpers ----------
const fillOpInput = document.getElementById('fill-opacity');
const fillOpLabel = document.getElementById('fill-op-label');
const strokeOpInput = document.getElementById('stroke-opacity');
const strokeOpLabel = document.getElementById('stroke-op-label');

function colorWithAlpha(hex, percent) {
  const c = new paper.Color(hex);
  c.alpha = percent / 100;
  return c;
}

function alphaOf(c) {
  if (!c) return 1;
  if (c.type === 'gradient') c = c.gradient.stops[0].color;
  return c.alpha === undefined ? 1 : c.alpha;
}

// Show the selected item's look in the panel
function syncPanelFromItem(item) {
  const fc = item.fillColor;
  if (fc) {
    if (fc.type === 'gradient') {
      const stops = fc.gradient.stops;
      fillInput.value = stops[0].color.toCSS(true);
      fill2Input.value = stops[stops.length - 1].color.toCSS(true);
      fillTypeSel.value = fc.gradient.radial ? 'radial' : 'linear';
    } else {
      fillInput.value = fc.toCSS(true);
      fillTypeSel.value = 'solid';
    }
  } else if (item.className !== 'Group') {
    fillTypeSel.value = 'none';
  }
  if (item.strokeColor && item.strokeColor.type !== 'gradient') strokeInput.value = item.strokeColor.toCSS(true);
  widthInput.value = item.strokeWidth;
  fillOpInput.value = Math.round(alphaOf(item.fillColor) * 100);
  fillOpLabel.textContent = fillOpInput.value + '%';
  strokeOpInput.value = Math.round(alphaOf(item.strokeColor) * 100);
  strokeOpLabel.textContent = strokeOpInput.value + '%';
  opacityInput.value = Math.round(item.opacity * 100);
  opacityLabel.textContent = opacityInput.value + '%';
  blendSel.value = item.blendMode || 'normal';

  const b = Number(item.data && item.data.blur) || 0;
  blurInput.value = b;
  blurLabel.textContent = b + ' px';

  const cr = getCornerR(item);
  document.getElementById('corner-radius').value = cr;
  document.getElementById('corner-label').textContent = cr + ' px';

  let leaf = item;
  while (leaf.className === 'Group' && leaf.children.length) leaf = leaf.children[0];
  document.getElementById('stroke-cap').value = leaf.strokeCap || 'butt';
  document.getElementById('stroke-dash').value = (leaf.data && leaf.data.dash) || 'solid';
}

// Build the fill for one item from the panel settings
function makeFill(item) {
  const type = fillTypeSel.value;
  const fa = Number(fillOpInput.value);
  if (type === 'none') return null;
  if (type === 'solid') return colorWithAlpha(fillInput.value, fa);

  const b = item.bounds;
  const stops = [
    colorWithAlpha(fillInput.value, fa),
    colorWithAlpha(fill2Input.value, fa)
  ];

  if (type === 'radial') {
    return {
      gradient: { stops: stops, radial: true },
      origin: b.center,
      destination: b.rightCenter
    };
  }

  const a = (Number(gradAngleInput.value) || 0) * Math.PI / 180;
  const dir = new paper.Point(Math.cos(a), Math.sin(a));
  const len = Math.abs(b.width * dir.x) + Math.abs(b.height * dir.y);
  return {
    gradient: { stops: stops, radial: false },
    origin: b.center.subtract(dir.multiply(len / 2)),
    destination: b.center.add(dir.multiply(len / 2))
  };
}

function paintFill(item) {
  if (item.className === 'Group') {
    item.children.forEach(paintFill);
    return;
  }
  item.fillColor = makeFill(item);
}

function registerItem(item, label, icon) {
  objCounter++;
  item.name = label + ' ' + objCounter;
  item.data.icon = icon;
}

// ======================================================
// BLUR  — real Gaussian blur via canvas filter.
// ======================================================
(function patchItemDrawForBlur() {
  const originalDraw = paper.Item.prototype.draw;
  paper.Item.prototype.draw = function (ctx, param, parentStrokeMatrix) {
    const px = this.data && Number(this.data.blur);
    if (px > 0 && 'filter' in ctx) {
      const scale = paper.view.zoom * (paper.view.pixelRatio || 1);
      ctx.save();
      ctx.filter = 'blur(' + (px * scale) + 'px)';
      originalDraw.call(this, ctx, param, parentStrokeMatrix);
      ctx.restore();
    } else {
      originalDraw.call(this, ctx, param, parentStrokeMatrix);
    }
  };
})();

function applyBlurToItem(item, px) {
  if (item.className === 'Group') {
    item.children.forEach(function (c) { applyBlurToItem(c, px); });
    return;
  }
  item.data.blur = px;
}
function forceRedraw() {
  paper.project._needsUpdate = true;
  if (paper.view.requestUpdate) paper.view.requestUpdate();
  paper.view.update();
  requestAnimationFrame(function () {
    paper.project._needsUpdate = true;
    paper.view.update();
  });
}

function applyBlurToSelection() {
  const px = Number(blurInput.value) || 0;
  blurLabel.textContent = px + ' px';
  if (!selection.length) {
    if (window.toast) toast('Select a shape first (Select tool)');
    return;
  }
  selection.forEach(function (i) {
    applyBlurToItem(i, px);
    // a real property change makes Paper.js mark the item dirty
    const v = i.visible; i.visible = !v; i.visible = v;
  });
  forceRedraw();
}

blurInput.addEventListener('input', applyBlurToSelection);
blurInput.addEventListener('change', function () {
  if (selection.length) saveState();
});

// ======================================================
// PAGES  — each page is a full exportJSON snapshot.
// ======================================================
const pageBar = {
  label:  document.getElementById('page-label'),
  prev:   document.getElementById('page-prev'),
  next:   document.getElementById('page-next'),
  add:    document.getElementById('page-add'),
  dup:    document.getElementById('page-dup'),
  del:    document.getElementById('page-del')
};

let pages = [];
let currentPageIndex = 0;

function snapshotProject() {
  return {
    json: paper.project.exportJSON(),
    active: paper.project.activeLayer.index,
    name: pages[currentPageIndex] ? pages[currentPageIndex].name : ('Page ' + (currentPageIndex + 1))
  };
}

function loadProjectSnapshot(snap) {
  if (penPath) { penPath.remove(); penPath = null; }
  paper.project.clear();
  if (snap.json) paper.project.importJSON(snap.json);
  const layers = paper.project.layers;
  (layers[snap.active] || layers[layers.length - 1]).activate();
  paper.project.deselectAll();
  selection = [];
  selectedItem = null;
  nodeSel = null;
  history = [];
  historyIndex = -1;
  saveState();
  renderLayers();
}

function saveCurrentPage() {
  if (!pages[currentPageIndex]) return;
  pages[currentPageIndex] = snapshotProject();
}

function refreshPageBar() {
  pageBar.label.textContent = pages[currentPageIndex]
    ? pages[currentPageIndex].name
    : ('Page ' + (currentPageIndex + 1));
  pageBar.prev.disabled = currentPageIndex === 0;
  pageBar.next.disabled = currentPageIndex >= pages.length - 1;
  pageBar.del.disabled = pages.length <= 1;
}

function switchToPage(index) {
  if (index === currentPageIndex) return;
  if (index < 0 || index >= pages.length) return;
  saveCurrentPage();
  currentPageIndex = index;
  loadProjectSnapshot(pages[currentPageIndex]);
  refreshPageBar();
}

function addPage(duplicate) {
  saveCurrentPage();
  let snap;
  if (duplicate) {
    snap = JSON.parse(JSON.stringify(pages[currentPageIndex]));
    snap.name = (pages[currentPageIndex].name || 'Page') + ' copy';
  } else {
    snap = { json: '', active: 0, name: 'Page ' + (pages.length + 1) };
  }
  pages.splice(currentPageIndex + 1, 0, snap);
  switchToPage(currentPageIndex + 1);
}

function deletePage() {
  if (pages.length <= 1) return;
  pages.splice(currentPageIndex, 1);
  currentPageIndex = Math.max(0, currentPageIndex - 1);
  loadProjectSnapshot(pages[currentPageIndex]);
  refreshPageBar();
}

pageBar.prev.addEventListener('click', function () { switchToPage(currentPageIndex - 1); });
pageBar.next.addEventListener('click', function () { switchToPage(currentPageIndex + 1); });
pageBar.add .addEventListener('click', function () { addPage(false); });
pageBar.dup .addEventListener('click', function () { addPage(true);  });
pageBar.del .addEventListener('click', deletePage);
pageBar.label.addEventListener('dblclick', function () {
  const name = prompt('Page name:', pages[currentPageIndex].name);
  if (name && name.trim()) {
    pages[currentPageIndex].name = name.trim();
    refreshPageBar();
  }
});

// ======================================================
// SELECTION
// ======================================================
function setSelection(items) {
  paper.project.deselectAll();
  selection = items;
  selectedItem = items.length ? items[items.length - 1] : null;
  items.forEach(function (i) { i.selected = true; });
  if (selectedItem) {
    syncPanelFromItem(selectedItem);
    selectedItem.layer.activate();
  }
  renderLayers();
}

function clearSelection() {
  setSelection([]);
}

function topLevelItem(item) {
  while (item.parent && item.parent.className !== 'Layer') item = item.parent;
  return item;
}

// ======================================================
// UNDO / REDO  (per current page)
// ======================================================
let history = [];
let historyIndex = -1;

function saveState() {
  const state = {
    json: paper.project.exportJSON(),
    active: paper.project.activeLayer.index
  };
  history = history.slice(0, historyIndex + 1);
  history.push(state);
  if (history.length > 50) history.shift();
  historyIndex = history.length - 1;
  if (pages[currentPageIndex]) {
    pages[currentPageIndex].json = state.json;
    pages[currentPageIndex].active = state.active;
  }
  scheduleAutosave();
}

function restoreState(state) {
  if (penPath) { penPath.remove(); penPath = null; }
  paper.project.clear();
  paper.project.importJSON(state.json);
  const layers = paper.project.layers;
  (layers[state.active] || layers[layers.length - 1]).activate();
  paper.project.deselectAll();
  selection = [];
  selectedItem = null;
  nodeSel = null;
  renderLayers();
}

function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    restoreState(history[historyIndex]);
  }
}

function redo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    restoreState(history[historyIndex]);
  }
}

// ======================================================
// LAYERS + OBJECTS PANEL
// ======================================================
const layerList = document.getElementById('layer-list');
let layerCounter = 1;

paper.project.activeLayer.name = 'Layer 1';

function renderLayers() {
  layerList.innerHTML = '';
  const layers = paper.project.layers;

  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const block = document.createElement('li');

    const row = document.createElement('div');
    row.className = 'layer-item';
    if (layer === paper.project.activeLayer) row.classList.add('active');

    const arrow = document.createElement('span');
    arrow.className = 'layer-arrow';
    arrow.textContent = layer.data.collapsed ? '▸' : '▾';
    arrow.addEventListener('click', function (e) {
      e.stopPropagation();
      layer.data.collapsed = !layer.data.collapsed;
      renderLayers();
    });

    const eye = document.createElement('span');
    eye.className = 'layer-eye';
    eye.textContent = layer.visible ? '👁' : '—';
    eye.addEventListener('click', function (e) {
      e.stopPropagation();
      layer.visible = !layer.visible;
      renderLayers();
      saveState();
    });

    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = layer.name;

    row.appendChild(arrow);
    row.appendChild(eye);
    row.appendChild(name);

    row.addEventListener('click', function () { setActiveLayer(layer); });

    row.addEventListener('dblclick', function () {
      const newName = prompt('Layer name:', layer.name);
      if (newName && newName.trim()) {
        layer.name = newName.trim();
        renderLayers();
        saveState();
      }
    });

    block.appendChild(row);

    if (!layer.data.collapsed) {
      if (layer.children.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-note';
        empty.textContent = '(empty)';
        block.appendChild(empty);
      } else {
        const objList = document.createElement('ul');
        objList.className = 'object-list';

        for (let j = layer.children.length - 1; j >= 0; j--) {
          const item = layer.children[j];

          const li = document.createElement('li');
          li.className = 'object-item';
          if (selection.indexOf(item) >= 0) li.classList.add('selected');

          const par = item.data && item.data.parent ? findByUid(item.data.parent) : null;
          const kids = childrenOf(item);
          if (par) li.classList.add('is-child');
          if (kids.length) li.classList.add('is-parent');

          let depth = 0, up = par;
          while (up && depth < 20) {
            depth++;
            up = up.data && up.data.parent ? findByUid(up.data.parent) : null;
          }
          li.style.marginLeft = (depth * 14) + 'px';

          const icon = document.createElement('span');
          icon.className = 'object-icon';
          icon.textContent = item.data.icon || '◆';

          const label = document.createElement('span');
          label.className = 'object-name';
          label.textContent = item.name || 'Object';

          const itemEye = document.createElement('span');
          itemEye.textContent = item.visible ? '👁' : '—';
          itemEye.addEventListener('click', function (e) {
            e.stopPropagation();
            item.visible = !item.visible;
            renderLayers();
            saveState();
          });

          li.appendChild(icon);
          li.appendChild(label);
          if (kids.length) {
            const pb = document.createElement('span');
            pb.className = 'rig-badge parent';
            pb.textContent = '👑 ' + kids.length;
            pb.title = 'Parent of ' + kids.length + ' part(s)';
            li.appendChild(pb);
          }
          if (par) {
            const cb = document.createElement('span');
            cb.className = 'rig-badge child';
            cb.textContent = '↳ ' + par.name;
            cb.title = 'Child of ' + par.name;
            li.appendChild(cb);
          }
          li.appendChild(itemEye);

          li.addEventListener('click', function () { selectItem(item); });

          li.addEventListener('dblclick', function () {
            const newName = prompt('Object name:', item.name || '');
            if (newName && newName.trim()) {
              item.name = newName.trim();
              renderLayers();
              saveState();
            }
          });
          objList.appendChild(li);
        }
        block.appendChild(objList);
      }
    }

    layerList.appendChild(block);
  }
}

function setActiveLayer(layer) {
  finishPen();
  clearSelection();
  layer.activate();
  renderLayers();
}

function addLayer() {
  finishPen();
  layerCounter++;
  new paper.Layer({ name: 'Layer ' + layerCounter });
  clearSelection();
  saveState();
}

function deleteLayer() {
  if (paper.project.layers.length <= 1) {
    alert('You need at least one layer.');
    return;
  }
  finishPen();
  clearSelection();
  const layer = paper.project.activeLayer;
  const index = layer.index;
  layer.remove();
  paper.project.layers[Math.max(0, index - 1)].activate();
  renderLayers();
  saveState();
}

function moveLayerUp() {
  const layer = paper.project.activeLayer;
  const above = paper.project.layers[layer.index + 1];
  if (above) layer.insertAbove(above);
  renderLayers();
  saveState();
}

function moveLayerDown() {
  const layer = paper.project.activeLayer;
  const below = paper.project.layers[layer.index - 1];
  if (below) layer.insertBelow(below);
  renderLayers();
  saveState();
}

function selectItem(item) {
  finishPen();
  if (currentToolName !== 'select') setTool('select');
  setSelection([item]);
}

function raiseObject() {
  if (!selectedItem) return;
  const next = selectedItem.nextSibling;
  if (next) selectedItem.insertAbove(next);
  renderLayers();
  saveState();
}

function lowerObject() {
  if (!selectedItem) return;
  const prev = selectedItem.previousSibling;
  if (prev) selectedItem.insertBelow(prev);
  renderLayers();
  saveState();
}

function deleteObject() {
  if (!selection.length) return;
  selection.forEach(function (i) { i.remove(); });
  clearSelection();
  saveState();
}

// ======================================================
// NEW OBJECT ACTIONS
// ======================================================
function selectAllInLayer() {
  if (currentToolName !== 'select') setTool('select');
  setSelection(paper.project.activeLayer.children.slice());
}

function groupSelection() {
  if (selection.length < 2) {
    alert('Select 2 or more shapes first (hold Shift and click).');
    return;
  }
  selectedItem.layer.activate();
  const group = new paper.Group(selection.slice());
  registerItem(group, 'Group', '▣');
  setSelection([group]);
  saveState();
}

function ungroupSelection() {
  const groups = selection.filter(function (i) { return i.className === 'Group'; });
  if (!groups.length) return;
  const freed = [];
  groups.forEach(function (g) {
    let ref = g;
    g.children.slice().forEach(function (c) {
      c.insertAbove(ref);
      ref = c;
      freed.push(c);
    });
    g.remove();
  });
  setSelection(freed);
  saveState();
}

function flipSelection(horizontal) {
  if (!selection.length) return;
  selection.forEach(function (i) {
    i.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
  });
  saveState();
}

function duplicateSelection() {
  if (!selection.length) return;
  const map = {};
  const copies = selection.map(function (i) {
    const c = i.clone();
    const old = c.data.uid;
    if (old) { c.data.uid = newUid(); map[old] = c.data.uid; }
    c.position = c.position.add(new paper.Point(20, 20));
    c.name = (i.name || 'Object') + ' copy';
    return c;
  });
  copies.forEach(function (c) {
    const p = c.data.parent;
    if (p && map[p]) c.data.parent = map[p];
  });
  setSelection(copies);
  saveState();
}

function pasteToNewPage() {
  if (!selection.length) return;
  const clones = selection.map(function (i) { return i.clone(); });
  saveCurrentPage();

  const snap = { json: '', active: 0, name: 'Page ' + (pages.length + 1) };
  pages.push(snap);
  currentPageIndex = pages.length - 1;
  loadProjectSnapshot(pages[currentPageIndex]);

  paper.project.activeLayer.activate();
  const pasted = clones.map(function (c) {
    c.selected = false;
    paper.project.activeLayer.addChild(c);
    registerItem(c, c.name || 'Pasted', (c.data && c.data.icon) || '◆');
    return c;
  });

  setSelection(pasted);
  saveState();
  refreshPageBar();
}

// ---------- Panel buttons ----------
const wire = function (id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
};
wire('layer-add', addLayer);
wire('layer-delete', deleteLayer);
wire('layer-up', moveLayerUp);
wire('layer-down', moveLayerDown);
wire('obj-up', raiseObject);
wire('obj-down', lowerObject);
wire('obj-delete', deleteObject);
wire('btn-undo', undo);
wire('btn-redo', redo);
wire('btn-group', groupSelection);
wire('btn-ungroup', ungroupSelection);
wire('btn-dup', duplicateSelection);
wire('btn-flip-h', function () { flipSelection(true); });
wire('btn-flip-v', function () { flipSelection(false); });

document.addEventListener('click', function (e) {
  if (e.target.tagName === 'BUTTON') e.target.blur();
});

// ======================================================
// TOOLS
// ======================================================

// ----- Select / Move -----
let dragged = false;
let toggleCandidate = false;
let handleMode = 'scale';
let marquee = null, marqueeStart = null, marqueeBase = [];

tools.select.onMouseDown = function (event) {
  ignoreDrag = false;
  if (pickingParent) { ignoreDrag = true; finishPickParent(event.point); return; }

  dragged = false;
  toggleCandidate = false;
  const hit = paper.project.hitTest(event.point, {
    fill: true, stroke: true, tolerance: 5,
    match: function (h) {
      if (h.item.className === 'Raster') return !!rasterPixel(h.item, event.point);
      return true;
    }
  });

  if (!hit) {
    marqueeBase = event.modifiers.shift ? selection.slice() : [];
    if (!event.modifiers.shift) clearSelection();
    marqueeStart = event.point;
    return;
  }

  const item = topLevelItem(hit.item);

  if (event.modifiers.shift) {
    if (selection.indexOf(item) >= 0) {
      setSelection(selection.filter(function (s) { return s !== item; }));
    } else {
      setSelection(selection.concat(item));
    }
  } else if (selection.indexOf(item) < 0) {
    setSelection([item]);
  } else {
    toggleCandidate = true;
  }
};

tools.select.onMouseDrag = function (event) {
  if (ignoreDrag) return;

  if (marqueeStart) {
    if (marquee) marquee.remove();
    marquee = new paper.Path.Rectangle({
      from: marqueeStart, to: event.point,
      strokeColor: '#2f6fed', strokeWidth: 1, dashArray: [4, 4],
      fillColor: new paper.Color(0.18, 0.44, 0.93, 0.12)
    });
    return;
  }
  selection.forEach(function (i) { i.position = i.position.add(event.delta); });
  if (selection.length) dragged = true;
};

tools.select.onMouseUp = function (event) {
  if (marqueeStart) {
    if (marquee) {
      const box = marquee.bounds;
      marquee.remove();
      marquee = null;
      const found = [];
      paper.project.layers.forEach(function (layer) {
        if (!layer.visible) return;
        layer.children.forEach(function (item) {
          if (!item.visible) return;
          const hit = event.modifiers.alt ? box.intersects(item.bounds) : box.contains(item.bounds);
          if (hit && marqueeBase.indexOf(item) < 0) found.push(item);
        });
      });
      setSelection(marqueeBase.concat(found));
    }
    marqueeStart = null;
    return;
  }
  if (dragged) saveState();
  else if (toggleCandidate) handleMode = handleMode === 'rotate' ? 'scale' : 'rotate';
  dragged = false;
  toggleCandidate = false;
};

// ----- Rectangle (FIXED: clamped + rebuilt on mouse-up) -----
let currentShape = null;
let startPoint = null;
let rectEnd = null;

function drawRectShape() {
  if (currentShape) currentShape.remove();

  const from = startPoint;
  const to = rectEnd;
  if (!from || !to) { currentShape = null; return; }

  const w = Math.abs(to.x - from.x);
  const h = Math.abs(to.y - from.y);
  if (w < 0.5 || h < 0.5) { currentShape = null; return; }

  // Clamp the radius so Paper.js can actually round the corners:
  // it must not exceed half of the shorter side.
  const radiusEl = document.getElementById('rect-radius');
  let r = radiusEl ? (Number(radiusEl.value) || 0) : 0;
  r = Math.max(0, Math.min(r, w / 2, h / 2));

  currentShape = new paper.Path.Rectangle({
    from: from,
    to: to,
    radius: r,
    fillColor: style.fill,
    strokeColor: style.stroke,
    strokeWidth: style.strokeWidth
  });
}

tools.rect.onMouseDown = function (event) {
  startPoint = event.point;
  rectEnd = event.point;
};

tools.rect.onMouseDrag = function (event) {
  rectEnd = event.point;
  drawRectShape();
};

tools.rect.onMouseUp = function () {
  // Rebuild with the final pointer position so the committed shape
  // has the correct size (and therefore the correct rounded corners).
  drawRectShape();
  if (currentShape) {
    registerItem(currentShape, 'Rectangle', '▭');
    saveState();
  }
  currentShape = null;
  startPoint = null;
  rectEnd = null;
  renderLayers();
};

// ----- Circle -----
tools.circle.onMouseDown = function (event) { startPoint = event.point; };

tools.circle.onMouseDrag = function (event) {
  if (currentShape) currentShape.remove();
  currentShape = new paper.Path.Circle({
    center: startPoint,
    radius: event.point.getDistance(startPoint),
    fillColor: style.fill,
    strokeColor: style.stroke,
    strokeWidth: style.strokeWidth
  });
};

tools.circle.onMouseUp = function () {
  if (currentShape) {
    registerItem(currentShape, 'Circle', '◯');
    saveState();
  }
  currentShape = null;
  renderLayers();
};

// ----- Freehand Brush / Pencil -----
const brushSizeInput = document.getElementById('brush-size');
const brushOpInput = document.getElementById('brush-opacity');
const brushSmoothInput = document.getElementById('brush-smooth');
const brushPressureInput = document.getElementById('brush-pressure');

let brushPath = null;
let brushPoints = [];
let lastPointerType = 'mouse';
let currentPressure = 1;

function trackPointer(e) {
  lastPointerType = e.pointerType;
  if (e.pointerType === 'pen') {
    if (e.pressure > 0) currentPressure = e.pressure;
  } else {
    currentPressure = 1;
  }
}
const canvasForPointer = document.getElementById('canvas');
canvasForPointer.addEventListener('pointerdown', trackPointer);
canvasForPointer.addEventListener('pointermove', trackPointer);

function brushColor() {
  return colorWithAlpha(strokeInput.value, Number(brushOpInput.value) || 100);
}

function buildPressureStroke(pts, size) {
  const left = [];
  const right = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)].point;
    const next = pts[Math.min(pts.length - 1, i + 1)].point;
    let dir = next.subtract(prev);
    if (dir.length < 0.0001) dir = new paper.Point(1, 0);
    const normal = dir.normalize().rotate(90);
    const half = size * (0.15 + 0.85 * pts[i].pressure) / 2;
    left.push(pts[i].point.add(normal.multiply(half)));
    right.push(pts[i].point.subtract(normal.multiply(half)));
  }
  const outline = new paper.Path({
    segments: left.concat(right.reverse()),
    closed: true,
    fillColor: brushColor()
  });
  outline.smooth();
  return outline;
}

tools.brush.onMouseDown = function (event) {
  brushPoints = [{ point: event.point, pressure: currentPressure }];
  brushPath = new paper.Path({
    strokeColor: brushColor(),
    strokeWidth: Number(brushSizeInput.value) || 8,
    strokeCap: 'round',
    strokeJoin: 'round'
  });
  brushPath.add(event.point);
};

tools.brush.onMouseDrag = function (event) {
  if (!brushPath) return;
  const smooth = (Number(brushSmoothInput.value) || 0) / 100;
  const last = brushPoints[brushPoints.length - 1].point;
  const follow = 1 - smooth * 0.8;
  const p = last.add(event.point.subtract(last).multiply(follow));
  if (p.getDistance(last) < 1) return;
  brushPoints.push({ point: p, pressure: currentPressure });
  brushPath.add(p);
};

tools.brush.onMouseUp = function () {
  if (!brushPath) return;
  const size = Number(brushSizeInput.value) || 8;
  const usePressure = brushPressureInput.checked && lastPointerType === 'pen';
  let result;

  if (brushPoints.length < 2) {
    result = new paper.Path.Circle({
      center: brushPoints[0].point,
      radius: size / 2,
      fillColor: brushColor()
    });
    brushPath.remove();
  } else if (usePressure) {
    result = buildPressureStroke(brushPoints, size);
    brushPath.remove();
  } else {
    const smooth = Number(brushSmoothInput.value) || 0;
    if (smooth > 0) brushPath.simplify(smooth / 100 * 20);
    result = brushPath;
  }

  registerItem(result, 'Brush', '✎');
  saveState();
  brushPath = null;
  brushPoints = [];
  renderLayers();
};

// ----- Pen Tool (Bezier) -----
let penPath = null;

function finishPen() {
  if (!penPath) return;
  if (penPath.segments.length < 2) {
    penPath.remove();
    penPath = null;
  } else {
    penPath.selected = false;
    registerItem(penPath, 'Path', '✒');
    penPath = null;
    saveState();
  }
  renderLayers();
}

tools.pen.onMouseDown = function (event) {
  if (!penPath) {
    penPath = new paper.Path({
      strokeColor: style.stroke,
      strokeWidth: style.strokeWidth,
      fillColor: style.fill,
      strokeCap: 'round',
      strokeJoin: 'round'
    });
    penPath.selected = true;
  }

  if (penPath.segments.length > 2 &&
      event.point.getDistance(penPath.firstSegment.point) < 10) {
    penPath.closed = true;
    finishPen();
    return;
  }

  penPath.add(event.point);
};

tools.pen.onMouseDrag = function (event) {
  if (!penPath) return;
  const seg = penPath.lastSegment;
  seg.handleOut = event.point.subtract(seg.point);
  seg.handleIn = seg.handleOut.multiply(-1);
};

// ======================================================
// SWITCHING TOOLS
// ======================================================
const buttons = document.querySelectorAll('.tool-btn');

function setTool(name) {
  finishPen();
  clearSelection();
  nodeSel = null;
  currentToolName = name;
  tools[name].activate();
  updateToolExtras(name);
  buttons.forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.tool === name);
  });
}

buttons.forEach(function (btn) {
  btn.addEventListener('click', function () { setTool(btn.dataset.tool); });
});

// ---------- Color pickers ----------
function applyFillToSelection() {
  style.fill = fillTypeSel.value === 'none'
    ? null
    : colorWithAlpha(fillInput.value, Number(fillOpInput.value));
  selection.forEach(paintFill);
}

function applyStrokeToSelection() {
  style.stroke = colorWithAlpha(strokeInput.value, Number(strokeOpInput.value));
  selection.forEach(function (i) {
    i.strokeColor = colorWithAlpha(strokeInput.value, Number(strokeOpInput.value));
  });
}

fillInput.addEventListener('input', applyFillToSelection);
fill2Input.addEventListener('input', applyFillToSelection);
gradAngleInput.addEventListener('input', applyFillToSelection);

fillOpInput.addEventListener('input', function () {
  fillOpLabel.textContent = fillOpInput.value + '%';
  applyFillToSelection();
});

fillTypeSel.addEventListener('change', function () {
  applyFillToSelection();
  if (selection.length) saveState();
});

strokeInput.addEventListener('input', applyStrokeToSelection);

strokeOpInput.addEventListener('input', function () {
  strokeOpLabel.textContent = strokeOpInput.value + '%';
  applyStrokeToSelection();
});

widthInput.addEventListener('input', function () {
  const w = Number(widthInput.value) || 0;
  style.strokeWidth = w;
  selection.forEach(function (i) { i.strokeWidth = w; });
});

opacityInput.addEventListener('input', function () {
  opacityLabel.textContent = opacityInput.value + '%';
  const v = Number(opacityInput.value) / 100;
  selection.forEach(function (i) { i.opacity = v; });
});

blendSel.addEventListener('change', function () {
  selection.forEach(function (i) { i.blendMode = blendSel.value; });
  if (selection.length) saveState();
});

// ======================================================
// ROUND CORNERS (live, non-destructive) + STROKE JOIN
// ======================================================
const cornerInput = document.getElementById('corner-radius');
const cornerLabel = document.getElementById('corner-label');
const joinSel = document.getElementById('stroke-join');

function applyCornerToPath(path, radius) {
  if (path.className !== 'Path') return false;
  if (!path.data) path.data = {};
  // Remember the original (sharp) geometry the first time
  if (!path.data.origSegs) {
    path.data.origSegs = path.segments.map(function (s) {
      return [s.point.x, s.point.y, s.handleIn.x, s.handleIn.y, s.handleOut.x, s.handleOut.y];
    });
  }
  const o = path.data.origSegs;
  const n = o.length;
  const pt = function (i) { return new paper.Point(o[i][0], o[i][1]); };
  const out = [];

  for (let i = 0; i < n; i++) {
    const s = o[i];
    const isEnd = !path.closed && (i === 0 || i === n - 1);
    const sharp = !s[2] && !s[3] && !s[4] && !s[5];
    if (radius <= 0 || n < 3 || isEnd || !sharp) {
      out.push(new paper.Segment(pt(i),
        new paper.Point(s[2], s[3]), new paper.Point(s[4], s[5])));
      continue;
    }
    const p = pt(i);
    const prev = pt((i - 1 + n) % n);
    const next = pt((i + 1) % n);
    const v1 = prev.subtract(p), v2 = next.subtract(p);
    const l1 = v1.length, l2 = v2.length;
    if (l1 < 0.001 || l2 < 0.001) { out.push(new paper.Segment(p)); continue; }
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const a = p.add(v1.normalize(r));
    const b = p.add(v2.normalize(r));
    const k = 0.552;
    out.push(new paper.Segment(a, null, p.subtract(a).multiply(k)));
    out.push(new paper.Segment(b, p.subtract(b).multiply(k), null));
  }
  path.segments = out;
  path.data.cornerR = radius;
  return true;
}

function applyCornerToItem(item, radius) {
  if (item.className === 'Group' || item.className === 'CompoundPath') {
    let any = false;
    item.children.forEach(function (c) { if (applyCornerToItem(c, radius)) any = true; });
    return any;
  }
  return applyCornerToPath(item, radius);
}

function getCornerR(item) {
  if (!item) return 0;
  if (item.children && item.children.length) return getCornerR(item.children[0]);
  return Number(item.data && item.data.cornerR) || 0;
}

function clearRound(path) {            // call when the shape is edited by hand
  if (path && path.data) { delete path.data.origSegs; delete path.data.cornerR; }
}

cornerInput.addEventListener('input', function () {
  const r = Number(cornerInput.value) || 0;
  cornerLabel.textContent = r + ' px';
  selection.forEach(function (i) { applyCornerToItem(i, r); });
  paper.view.update();
});
cornerInput.addEventListener('change', function () {
  if (selection.length) saveState();
});

joinSel.addEventListener('change', function () {
  function setJoin(i) {
    if (i.children && i.children.length) i.children.forEach(setJoin);
    else i.strokeJoin = joinSel.value;
  }
  selection.forEach(setJoin);
  if (selection.length) saveState();
});

// ======================================================
// STROKE STYLE: line ends + dash patterns
// ======================================================
const capSel = document.getElementById('stroke-cap');
const dashSel = document.getElementById('stroke-dash');

function eachStrokeLeaf(item, fn) {
  if (item.className === 'Group') {
    item.children.forEach(function (c) { eachStrokeLeaf(c, fn); });
  } else {
    fn(item);
  }
}

function dashArrayFor(kind, width) {
  const w = Math.max(width || 1, 1);
  if (kind === 'dashed')  return [w * 4, w * 2.5];
  if (kind === 'long')    return [w * 8, w * 3];
  if (kind === 'dotted')  return [0.01, w * 2];
  if (kind === 'dashdot') return [w * 4, w * 2, 0.01, w * 2];
  return [];
}

function applyDash(leaf) {
  const kind = (leaf.data && leaf.data.dash) || 'solid';
  leaf.dashArray = dashArrayFor(kind, leaf.strokeWidth);
  if (kind === 'dotted' || kind === 'dashdot') leaf.strokeCap = 'round';
}

capSel.addEventListener('change', function () {
  selection.forEach(function (i) {
    eachStrokeLeaf(i, function (leaf) {
      const kind = (leaf.data && leaf.data.dash) || 'solid';
      leaf.strokeCap = (kind === 'dotted' || kind === 'dashdot') ? 'round' : capSel.value;
    });
  });
  if (selection.length) saveState();
});

dashSel.addEventListener('change', function () {
  selection.forEach(function (i) {
    eachStrokeLeaf(i, function (leaf) {
      leaf.data.dash = dashSel.value;
      applyDash(leaf);
    });
  });
  if (selection.length) {
    const first = selection[0];
    eachStrokeLeaf(first, function (leaf) { capSel.value = leaf.strokeCap || 'butt'; });
    saveState();
  }
});

// keep dashes in proportion when the stroke width changes
widthInput.addEventListener('input', function () {
  selection.forEach(function (i) {
    eachStrokeLeaf(i, function (leaf) {
      if (leaf.data && leaf.data.dash && leaf.data.dash !== 'solid') applyDash(leaf);
    });
  });
});

[fillInput, fill2Input, gradAngleInput, fillOpInput, strokeInput,
 strokeOpInput, widthInput, opacityInput].forEach(function (input) {
  input.addEventListener('change', function () {
    if (selection.length) saveState();
  });
});

// ======================================================
// ZOOM AND PAN
// ======================================================
const canvasEl = document.getElementById('canvas');
const canvasArea = document.getElementById('canvas-area');
const zoomLabel = document.getElementById('zoom-label');

function updateZoomLabel() {
  zoomLabel.textContent = Math.round(paper.view.zoom * 100) + '%';
}

function resetView() {
  paper.view.zoom = 1;
  paper.view.center = new paper.Point(
    paper.view.viewSize.width / 2,
    paper.view.viewSize.height / 2
  );
  updateZoomLabel();
}

zoomLabel.addEventListener('click', resetView);

canvasEl.addEventListener('wheel', function (e) {
  e.preventDefault();
  const view = paper.view;
  const mouse = new paper.Point(e.offsetX, e.offsetY);
  const mouseProject = view.viewToProject(mouse);

  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const newZoom = Math.min(20, Math.max(0.1, view.zoom * factor));
  const beta = view.zoom / newZoom;
  const pc = mouseProject.subtract(view.center);
  const offset = mouseProject.subtract(pc.multiply(beta)).subtract(view.center);

  view.zoom = newZoom;
  view.center = view.center.add(offset);
  updateZoomLabel();
}, { passive: false });

let spaceDown = false;
let panning = false;

// ---------- PAN LISTENERS ----------
canvasArea.addEventListener('mousedown', function (e) {
  if (spaceDown || e.button === 1) {
    panning = true;
    e.preventDefault();
    e.stopPropagation();
    canvasArea.style.cursor = 'grabbing';
  }
}, true);

window.addEventListener('mousemove', function (e) {
  if (!panning) return;
  const move = new paper.Point(e.movementX, e.movementY).divide(paper.view.zoom);
  paper.view.center = paper.view.center.subtract(move);
});

window.addEventListener('mouseup', function () {
  if (!panning) return;
  panning = false;
  canvasArea.style.cursor = spaceDown ? 'grab' : '';
});
// ---------- END PAN LISTENERS ----------

// ======================================================
// TOUCH SUPPORT: pinch zoom, 2-finger pan, hand mode, touch buttons
// ======================================================
canvasEl.style.touchAction = 'none';
canvasArea.style.touchAction = 'none';
document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

function zoomAtView(px, py, factor) {
  const view = paper.view;
  const mp = view.viewToProject(new paper.Point(px, py));
  const nz = Math.min(20, Math.max(0.1, view.zoom * factor));
  const beta = view.zoom / nz;
  const pc = mp.subtract(view.center);
  const off = mp.subtract(pc.multiply(beta)).subtract(view.center);
  view.zoom = nz;
  view.center = view.center.add(off);
  updateZoomLabel();
}

let handOn = false, shiftOn = false;
let gesture = null, toolTouchActive = false, tStartHistory = 0;

function touchInfo(e) {
  const r = canvasEl.getBoundingClientRect();
  const a = e.touches[0], b = e.touches[1];
  if (b) {
    return {
      x: (a.clientX + b.clientX) / 2 - r.left,
      y: (a.clientY + b.clientY) / 2 - r.top,
      d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    };
  }
  return { x: a.clientX - r.left, y: a.clientY - r.top, d: 0 };
}

// A second finger arrived after the tool already started: cancel that stroke
function cancelToolTouch(t) {
  document.dispatchEvent(new MouseEvent('mouseup', {
    bubbles: true, clientX: t.clientX, clientY: t.clientY
  }));
  if (historyIndex > tStartHistory) undo();
  toolTouchActive = false;
}

canvasArea.addEventListener('touchstart', function (e) {
  if (e.target !== canvasEl) return;           // handles / buttons work normally
  if (e.touches.length >= 2 || handOn) {
    if (toolTouchActive) cancelToolTouch(e.touches[0]);
    e.preventDefault();
    e.stopPropagation();
    gesture = touchInfo(e);
    return;
  }
  toolTouchActive = true;
  tStartHistory = historyIndex;
}, true);

canvasArea.addEventListener('touchmove', function (e) {
  if (e.target !== canvasEl) return;
  if (gesture) {
    e.preventDefault();
    e.stopPropagation();
    const now = touchInfo(e);
    if (now.d && gesture.d) zoomAtView(now.x, now.y, now.d / gesture.d);
    const move = new paper.Point(now.x - gesture.x, now.y - gesture.y).divide(paper.view.zoom);
    paper.view.center = paper.view.center.subtract(move);
    gesture = now;
    return;
  }
  if (toolTouchActive) e.preventDefault();
}, { capture: true, passive: false });

function endTouch(e) {
  if (gesture) {
    e.stopPropagation();
    gesture = e.touches.length ? touchInfo(e) : null;
    if (!e.touches.length) toolTouchActive = false;
    return;
  }
  if (!e.touches.length) toolTouchActive = false;
}
canvasArea.addEventListener('touchend', endTouch, true);
canvasArea.addEventListener('touchcancel', endTouch, true);

// ----- Touch bar buttons -----
function flagBtn(id, setter) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', function () {
    const on = !el.classList.contains('active');
    el.classList.toggle('active', on);
    setter(on);
  });
}
flagBtn('tb-hand', function (on) {
  handOn = on;
  canvasEl.style.cursor = on ? 'grab' : '';
});
flagBtn('tb-shift', function (on) {
  shiftOn = on;
  paper.Key.modifiers.shift = on;     // acts like holding Shift
});
flagBtn('tb-rot', function (on) {
  handleMode = on ? 'rotate' : 'scale';
});
wire('tb-done', finishPen);
wire('tb-del', deleteObject);

// ======================================================
// KEYBOARD
// ======================================================
document.addEventListener('keydown', function (e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

  if (e.code === 'Space') {
    e.preventDefault();
    spaceDown = true;
    if (!panning) canvasArea.style.cursor = 'grab';
    return;
  }

  const key = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl) {
    if (key === 'v' && e.shiftKey) {
      e.preventDefault();
      pasteToNewPage();
      return;
    }
    if (e.key === 'PageUp')   { e.preventDefault(); switchToPage(currentPageIndex - 1); return; }
    if (e.key === 'PageDown') { e.preventDefault(); switchToPage(currentPageIndex + 1); return; }

    if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    else if (key === 'g') {
      e.preventDefault();
      if (e.shiftKey) ungroupSelection(); else groupSelection();
    }
    else if (key === 'd') { e.preventDefault(); duplicateSelection(); }
    else if (key === 'a') { e.preventDefault(); selectAllInLayer(); }
    return;
  }

  if (key === 'v') setTool('select');
  if (key === 'r') setTool('rect');
  if (key === 'c') setTool('circle');
  if (key === 'b') setTool('brush');
  if (key === 'p') setTool('pen');
  if (key === 'n') setTool('node');
  if (key === 's') setTool('star');
  if (key === 'l') setTool('line');
  if (key === 'a') setTool('spray');
  if (key === 't') setTool('text');
  if (key === 'e') setTool('eraser');
  if (key === 'g') setTool('bucket');
  if (key === 'i') setTool('picker');
  if (key === 'w') setTool('wand');
  if (key === 'k') setTool('lasso');
  if (key === '0') resetView();

  if (e.key === 'Enter' || e.key === 'Escape') finishPen();
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (currentToolName === 'node' && nodeSel && nodeSel.path) {
      removeNode(nodeSel);
    } else {
      deleteObject();
    }
  }
});

document.addEventListener('keyup', function (e) {
  if (e.code === 'Space') {
    spaceDown = false;
    if (!panning) canvasArea.style.cursor = '';
  }
});

// ======================================================
// PATH OPERATIONS
// ======================================================
function getPathItems() {
  return selection.filter(function (i) {
    return i.className === 'Path' || i.className === 'CompoundPath';
  });
}

function sameParent(items) {
  return items.every(function (i) { return i.parent === items[0].parent; });
}

function runBoolean(opName, label, icon) {
  const items = getPathItems();
  if (items.length < 2) {
    alert('Select 2 or more shapes first (hold Shift and click). Groups must be ungrouped.');
    return;
  }
  if (!sameParent(items)) {
    alert('The shapes must be in the same layer.');
    return;
  }

  items.sort(function (a, b) { return a.index - b.index; });

  let result = items[0];
  for (let i = 1; i < items.length; i++) {
    const next = result[opName](items[i]);
    result.remove();
    items[i].remove();
    result = next;
  }

  registerItem(result, label, icon);
  setSelection([result]);
  saveState();
}

function combineSelection() {
  const items = getPathItems();
  if (items.length < 2) {
    alert('Select 2 or more shapes first.');
    return;
  }
  if (!sameParent(items)) {
    alert('The shapes must be in the same layer.');
    return;
  }
  items.sort(function (a, b) { return a.index - b.index; });

  const first = items[0];
  const compound = new paper.CompoundPath({
    children: items,
    fillColor: first.fillColor,
    strokeColor: first.strokeColor,
    strokeWidth: first.strokeWidth
  });
  registerItem(compound, 'Combined', '⧉');
  setSelection([compound]);
  saveState();
}

function breakApartSelection() {
  const compounds = selection.filter(function (i) { return i.className === 'CompoundPath'; });
  if (!compounds.length) {
    alert('Select a combined path first.');
    return;
  }
  const freed = [];
  compounds.forEach(function (c) {
    let ref = c;
    c.children.slice().forEach(function (child) {
      child.insertAbove(ref);
      child.fillColor = c.fillColor;
      child.strokeColor = c.strokeColor;
      child.strokeWidth = c.strokeWidth;
      registerItem(child, 'Path', '✒');
      ref = child;
      freed.push(child);
    });
    c.remove();
  });
  setSelection(freed);
  saveState();
}

function reverseSelection() {
  const items = getPathItems();
  if (!items.length) return;
  items.forEach(function (i) { i.reverse(); });
  saveState();
}

function simplifySelection() {
  const items = getPathItems();
  if (!items.length) return;
  items.forEach(function (i) {
    if (i.className === 'Path') {
      i.simplify(2.5);
    } else {
      i.children.forEach(function (c) { c.simplify(2.5); });
    }
  });
  saveState();
}

wire('op-unite',     function () { runBoolean('unite', 'Union', '⊔'); });
wire('op-subtract',  function () { runBoolean('subtract', 'Difference', '⊖'); });
wire('op-intersect', function () { runBoolean('intersect', 'Intersection', '⊓'); });
wire('op-exclude',   function () { runBoolean('exclude', 'Exclusion', '⊕'); });
wire('op-divide',    function () { runBoolean('divide', 'Division', '⧈'); });
wire('op-combine',   combineSelection);
wire('op-break',     breakApartSelection);
wire('op-reverse',   reverseSelection);
wire('op-simplify',  simplifySelection);

// ======================================================
// NEW TOOLS: Node, Line, Star, Spray
// ======================================================
const starPointsInput = document.getElementById('star-points');
const starRatioInput = document.getElementById('star-ratio');
const spraySizeInput = document.getElementById('spray-size');

let nodeHit = null;
let nodeMoved = false;
let nodeSel = null;

function removeNode(seg) {
  const path = seg && seg.path;
  if (!path) return false;
  if (path.segments.length <= 2) {
    alert('A path needs at least 2 points. Use Delete in the Select tool to remove the whole shape.');
    return false;
  }
  
  clearRound(path);
  seg.remove();
  nodeSel = null;
  path.fullySelected = true;
  saveState();
  return true;
}

function addNodeAt(path, point) {
  if (!path || path.className !== 'Path') return null;
  const loc = path.getNearestLocation(point);
  if (!loc || loc.distance > 12) return null;
  clearRound(path);
  const seg = path.divideAt(loc);
  if (!seg) return null;
  nodeSel = seg;
  path.fullySelected = true;
  saveState();
  return seg;
}

tools.node.onMouseDown = function (event) {
  nodeHit = null;
  nodeMoved = false;
  const hit = paper.project.hitTest(event.point, {
    segments: true, handles: true, fill: true, stroke: true, tolerance: 6
  });
  if (!hit) { nodeSel = null; clearSelection(); return; }

  const isDouble = event.event && event.event.detail >= 2;

  if (selection.indexOf(hit.item) < 0) {
    setSelection([hit.item]);
    hit.item.fullySelected = true;
  }

  if (hit.type === 'segment' || hit.type === 'handle-in' || hit.type === 'handle-out') {
    nodeHit = hit;
    nodeSel = hit.segment;
    if (isDouble && hit.type === 'segment') {
      nodeHit = null;
      removeNode(hit.segment);
    }
    return;
  }

  if (isDouble) {
    addNodeAt(hit.item, event.point);
  } else {
    nodeSel = null;
  }
};

tools.node.onMouseDrag = function (event) {
  if (!nodeHit || !nodeHit.segment || !nodeHit.segment.path) return;
  const seg = nodeHit.segment;
  if (nodeHit.type === 'segment') seg.point = seg.point.add(event.delta);
  else if (nodeHit.type === 'handle-in') seg.handleIn = seg.handleIn.add(event.delta);
  else seg.handleOut = seg.handleOut.add(event.delta);
  nodeMoved = true;
};

tools.node.onMouseUp = function () {
  if (nodeMoved) {
    if (nodeHit && nodeHit.segment) clearRound(nodeHit.segment.path);
    saveState();
  }
  nodeHit = null;
  nodeMoved = false;
};

tools.line.onMouseDown = function (event) { startPoint = event.point; };

tools.line.onMouseDrag = function (event) {
  if (currentShape) currentShape.remove();
  let end = event.point;
  if (event.modifiers.shift) {
    const v = end.subtract(startPoint);
    const snapped = Math.round(v.angle / 45) * 45;
    end = startPoint.add(new paper.Point({ length: v.length, angle: snapped }));
  }
  currentShape = new paper.Path.Line({
    from: startPoint,
    to: end,
    strokeColor: style.stroke,
    strokeWidth: Math.max(style.strokeWidth, 1),
    strokeCap: 'round'
  });
};

tools.line.onMouseUp = function () {
  if (currentShape) {
    registerItem(currentShape, 'Line', '╱');
    saveState();
  }
  currentShape = null;
  renderLayers();
};

tools.star.onMouseDown = function (event) { startPoint = event.point; };

tools.star.onMouseDrag = function (event) {
  if (currentShape) currentShape.remove();
  const outer = Math.max(event.point.getDistance(startPoint), 2);
  const points = Math.min(20, Math.max(3, Number(starPointsInput.value) || 5));
  const ratio = Math.min(0.9, Math.max(0.1, (Number(starRatioInput.value) || 45) / 100));
  currentShape = new paper.Path.Star({
    center: startPoint,
    points: points,
    radius1: outer,
    radius2: outer * ratio,
    fillColor: style.fill,
    strokeColor: style.stroke,
    strokeWidth: style.strokeWidth
  });
};

tools.star.onMouseUp = function () {
  if (currentShape) {
    registerItem(currentShape, 'Star', '★');
    saveState();
  }
  currentShape = null;
  renderLayers();
};

let sprayGroup = null;
let sprayTimer = null;
let sprayPoint = null;

function sprayDots(point) {
  const size = Math.max(5, Number(spraySizeInput.value) || 30);
  for (let i = 0; i < 4; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = size * Math.sqrt(Math.random());
    const center = point.add(new paper.Point(Math.cos(angle) * dist, Math.sin(angle) * dist));
    sprayGroup.addChild(new paper.Path.Circle({
      center: center,
      radius: 1 + Math.random() * 2.5,
      fillColor: style.fill
    }));
  }
}

tools.spray.onMouseDown = function (event) {
  sprayGroup = new paper.Group();
  sprayPoint = event.point;
  sprayDots(sprayPoint);
  sprayTimer = setInterval(function () { sprayDots(sprayPoint); }, 50);
};

tools.spray.onMouseDrag = function (event) { sprayPoint = event.point; };

tools.spray.onMouseUp = function () {
  clearInterval(sprayTimer);
  if (sprayGroup) {
    registerItem(sprayGroup, 'Spray', '∴');
    saveState();
  }
  sprayGroup = null;
  renderLayers();
};

// ======================================================
// TO PATH
// ======================================================
function toPathSelection() {
  if (!selection.length) {
    alert('Select a shape first.');
    return;
  }
  ungroupSelection();
  const items = selection.slice();
  setTool('node');
  setSelection(items);
  items.forEach(function (i) { i.fullySelected = true; });
}
wire('btn-topath', toPathSelection);

// ======================================================
// X / Y / W / H FIELDS
// ======================================================
const boxInputs = {
  x: document.getElementById('box-x'),
  y: document.getElementById('box-y'),
  w: document.getElementById('box-w'),
  h: document.getElementById('box-h')
};
const lockInput = document.getElementById('box-lock');

function selectionBounds() {
  if (!selection.length) return null;
  let b = selection[0].bounds;
  for (let i = 1; i < selection.length; i++) b = b.unite(selection[i].bounds);
  return b;
}

function onBoxEdit(which) {
  const b = selectionBounds();
  if (!b) return;
  const val = Number(boxInputs[which].value);
  if (isNaN(val)) return;

  if (which === 'x' || which === 'y') {
    const move = which === 'x'
      ? new paper.Point(val - b.x, 0)
      : new paper.Point(0, val - b.y);
    selection.forEach(function (i) { i.position = i.position.add(move); });
  } else {
    if (b.width < 0.01 || b.height < 0.01) return;
    let sx = which === 'w' ? Math.max(val, 1) / b.width : 1;
    let sy = which === 'h' ? Math.max(val, 1) / b.height : 1;
    if (lockInput.checked) {
      if (which === 'w') sy = sx; else sx = sy;
    }
    selection.forEach(function (i) { i.scale(sx, sy, b.topLeft); });
  }
  saveState();
}

Object.keys(boxInputs).forEach(function (k) {
  boxInputs[k].addEventListener('change', function () { onBoxEdit(k); });
});

// ======================================================
// RESIZE / ROTATE HANDLES  ← pointer events
// ======================================================
const selBox = document.createElement('div');
selBox.id = 'sel-box';
canvasArea.appendChild(selBox);

const HANDLE_DEFS = [
  { id: 'nw', x: 0,   y: 0 },   { id: 'n', x: 0.5, y: 0 },
  { id: 'ne', x: 1,   y: 0 },   { id: 'e', x: 1,   y: 0.5 },
  { id: 'se', x: 1,   y: 1 },   { id: 's', x: 0.5, y: 1 },
  { id: 'sw', x: 0,   y: 1 },   { id: 'w', x: 0,   y: 0.5 }
];

HANDLE_DEFS.forEach(function (h) {
  h.el = document.createElement('div');
  h.el.className = 'handle';
  h.el.dataset.id = h.id;
  h.corner = (h.x !== 0.5 && h.y !== 0.5);
  canvasArea.appendChild(h.el);
});

function mouseToProject(e) {
  const r = canvasEl.getBoundingClientRect();
  return paper.view.viewToProject(new paper.Point(e.clientX - r.left, e.clientY - r.top));
}

let hDrag = null;

HANDLE_DEFS.forEach(function (h) {
  h.el.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (h.el.setPointerCapture) h.el.setPointerCapture(e.pointerId);
    const b = selectionBounds();
    if (!b) return;
    const p = mouseToProject(e);
    const pc = (handleMode === 'rotate' && selection.length === 1)
      ? getPivot(selection[0])
      : b.center;
    hDrag = {
      def: h,
      mode: handleMode,
      center: pc,
      anchor: new paper.Point(
        h.x === 0 ? b.right : (h.x === 1 ? b.left : b.center.x),
        h.y === 0 ? b.bottom : (h.y === 1 ? b.top : b.center.y)
      ),
      lastAngle: p.subtract(pc).angle,
      moved: false
    };
  });
});

window.addEventListener('pointermove', function (e) {
  if (!hDrag) return;
  const p = mouseToProject(e);
  const b = selectionBounds();
  if (!b) return;
  hDrag.moved = true;

  if (hDrag.mode === 'rotate') {
    const a = p.subtract(hDrag.center).angle;
    let delta = a - hDrag.lastAngle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    hDrag.lastAngle = a;
    selection.forEach(function (i) { i.rotate(delta, hDrag.center); });
    return;
  }

  const h = hDrag.def;
  let sx = 1, sy = 1;
  if (h.x !== 0.5 && b.width > 0.01) {
    const dx = h.x === 0 ? hDrag.anchor.x - p.x : p.x - hDrag.anchor.x;
    sx = Math.max(dx, 1) / b.width;
  }
  if (h.y !== 0.5 && b.height > 0.01) {
    const dy = h.y === 0 ? hDrag.anchor.y - p.y : p.y - hDrag.anchor.y;
    sy = Math.max(dy, 1) / b.height;
  }
  if (h.corner && !e.shiftKey) {
    const s = Math.max(sx, sy);
    sx = s; sy = s;
  }
  selection.forEach(function (i) { i.scale(sx, sy, hDrag.anchor); });
});

window.addEventListener('pointerup', function () {
  if (hDrag && hDrag.moved) saveState();
  hDrag = null;
});

function updateHandles(e) {
  const b = selectionBounds();
  const show = b && currentToolName === 'select';

  if (!show) {
    selBox.style.display = 'none';
    HANDLE_DEFS.forEach(function (h) { h.el.style.display = 'none'; });
  } else {
    const tl = paper.view.projectToView(b.topLeft);
    const br = paper.view.projectToView(b.bottomRight);
    selBox.style.display = 'block';
    selBox.style.left = tl.x + 'px';
    selBox.style.top = tl.y + 'px';
    selBox.style.width = (br.x - tl.x) + 'px';
    selBox.style.height = (br.y - tl.y) + 'px';

    HANDLE_DEFS.forEach(function (h) {
      const rotate = handleMode === 'rotate';
      h.el.style.display = (rotate && !h.corner) ? 'none' : 'block';
      h.el.classList.toggle('round', rotate);
      h.el.style.left = (tl.x + (br.x - tl.x) * h.x) + 'px';
      h.el.style.top = (tl.y + (br.y - tl.y) * h.y) + 'px';
    });
  }

  const values = b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
  Object.keys(boxInputs).forEach(function (k) {
    const el = boxInputs[k];
    if (document.activeElement === el) return;
    const v = values ? String(Math.round(values[k] * 100) / 100) : '';
    if (el.value !== v) el.value = v;
  });

  // Single frame tick — drives every overlay + the timeline.
  if (typeof updatePivotDot === 'function') updatePivotDot();
  if (typeof updateFrameBox === 'function') updateFrameBox();
  if (typeof updateRigLines === 'function') updateRigLines();
  if (typeof tickTimeline === 'function') tickTimeline(e);
}
paper.view.onFrame = updateHandles;

// ======================================================
// TEXT TOOL
// ======================================================
const textSizeInput = document.getElementById('text-size');
const textFontSel = document.getElementById('text-font');

tools.text.onMouseDown = function (event) {
  const hit = paper.project.hitTest(event.point, { fill: true, tolerance: 5 });

  if (hit && hit.item.className === 'PointText') {
    const edited = prompt('Edit text:', hit.item.content);
    if (edited !== null && edited !== '') {
      hit.item.content = edited;
      saveState();
    }
    return;
  }

  const typed = prompt('Type your text:');
  if (!typed) return;

  const text = new paper.PointText({
    point: event.point,
    content: typed,
    fontSize: Number(textSizeInput.value) || 32,
    fontFamily: textFontSel.value,
    fillColor: style.fill || '#000000'
  });
  registerItem(text, 'Text', 'T');
  saveState();
  renderLayers();
};

function updateSelectedText() {
  let changed = false;
  selection.forEach(function (i) {
    if (i.className === 'PointText') {
      i.fontSize = Number(textSizeInput.value) || 32;
      i.fontFamily = textFontSel.value;
      changed = true;
    }
  });
  if (changed) saveState();
}
textSizeInput.addEventListener('change', updateSelectedText);
textFontSel.addEventListener('change', updateSelectedText);

// ======================================================
// IMPORT IMAGE
// ======================================================
const fileImport = document.getElementById('file-import');
wire('btn-import', function () { fileImport.click(); });

fileImport.addEventListener('change', function () {
  const file = fileImport.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function () {
    const img = new Image();
    img.onload = function () {
      const maxSide = 800;
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);

      const raster = new paper.Raster({ source: c.toDataURL('image/png') });
      raster.onLoad = function () {
        raster.position = paper.view.center;
        const fit = Math.min(1, 400 / raster.bounds.width, 300 / raster.bounds.height);
        raster.scale(fit);
        raster.sendToBack();
        registerItem(raster, 'Image', '🖼');
        saveState();
        renderLayers();
      };
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
  fileImport.value = '';
});

// ======================================================
// ALIGN AND DISTRIBUTE
// ======================================================
function alignSelection(mode) {
  if (!selection.length) return;
  const area = selection.length > 1 ? selectionBounds() : paper.view.bounds;

  selection.forEach(function (i) {
    const b = i.bounds;
    let move = new paper.Point(0, 0);
    if (mode === 'left')    move.x = area.left - b.left;
    if (mode === 'right')   move.x = area.right - b.right;
    if (mode === 'hcenter') move.x = area.center.x - b.center.x;
    if (mode === 'top')     move.y = area.top - b.top;
    if (mode === 'bottom')  move.y = area.bottom - b.bottom;
    if (mode === 'vcenter') move.y = area.center.y - b.center.y;
    i.position = i.position.add(move);
  });
  saveState();
}

function distributeSelection(horizontal) {
  if (selection.length < 3) {
    alert('Select 3 or more shapes to space them evenly.');
    return;
  }
  const items = selection.slice().sort(function (a, b) {
    return horizontal
      ? a.bounds.center.x - b.bounds.center.x
      : a.bounds.center.y - b.bounds.center.y;
  });
  const first = items[0].bounds.center;
  const last = items[items.length - 1].bounds.center;
  const step = horizontal
    ? (last.x - first.x) / (items.length - 1)
    : (last.y - first.y) / (items.length - 1);

  items.forEach(function (item, idx) {
    const c = item.bounds.center;
    const move = horizontal
      ? new paper.Point(first.x + step * idx - c.x, 0)
      : new paper.Point(0, first.y + step * idx - c.y);
    item.position = item.position.add(move);
  });
  saveState();
}

wire('al-left',    function () { alignSelection('left'); });
wire('al-hcenter', function () { alignSelection('hcenter'); });
wire('al-right',   function () { alignSelection('right'); });
wire('al-top',     function () { alignSelection('top'); });
wire('al-vcenter', function () { alignSelection('vcenter'); });
wire('al-bottom',  function () { alignSelection('bottom'); });
wire('dist-h', function () { distributeSelection(true); });
wire('dist-v', function () { distributeSelection(false); });

// ======================================================
// HELPER: every shape on the canvas, top one first
// ======================================================
function leafItemsTopDown() {
  const out = [];
  function walk(item) {
    if (!item.visible) return;
    if (item.className === 'Group') {
      for (let i = item.children.length - 1; i >= 0; i--) walk(item.children[i]);
    } else {
      out.push(item);
    }
  }
  const layers = paper.project.layers;
  for (let i = layers.length - 1; i >= 0; i--) {
    if (!layers[i].visible) continue;
    for (let j = layers[i].children.length - 1; j >= 0; j--) walk(layers[i].children[j]);
  }
  return out;
}

// ======================================================
// ERASER  (every visible layer, every leaf type)
// ======================================================
const eraserSizeInput = document.getElementById('eraser-size');
const eraserModeSel = document.getElementById('eraser-mode');
let erased = false;
let lastErase = null;

function collectErasable(item, out) {
  if (!item.visible) return;
  if (item.className === 'Group') {
    item.children.forEach(function (c) { collectErasable(c, out); });
  } else if (item.className === 'Layer') {
    item.children.forEach(function (c) { collectErasable(c, out); });
  } else {
    out.push(item);
  }
}

function touchesCircle(item, circle, point, asStroke) {
  if (item.getIntersections(circle).length) return true;
  if (!asStroke && item.contains(point)) return true;
  const probe = item.className === 'CompoundPath' ? item.children[0] : item;
  return !!(probe && probe.firstSegment && circle.contains(probe.firstSegment.point));
}

function dropFromSelection(item) {
  const idx = selection.indexOf(item);
  if (idx < 0) return;
  selection.splice(idx, 1);
  if (selectedItem === item) selectedItem = selection[selection.length - 1] || null;
}

function eraseAt(point) {
  const radius = (Number(eraserSizeInput.value) || 30) / 2;
  const mode = eraserModeSel.value;
  const box = new paper.Rectangle(
    point.subtract(new paper.Point(radius, radius)),
    new paper.Size(radius * 2, radius * 2)
  );

  const leaves = [];
  paper.project.layers.forEach(function (layer) {
    if (!layer.visible) return;
    layer.children.forEach(function (c) { collectErasable(c, leaves); });
  });

  let changed = false;

  leaves.forEach(function (item) {
    if (!item.parent) return;
    if (!item.strokeBounds.intersects(box)) return;

    if (mode === 'object') {
      if (item.hitTest(point, { fill: true, stroke: true, tolerance: radius })) {
        dropFromSelection(item);
        topLevelItem(item).remove();
        changed = true;
      }
      return;
    }

    if (item.className === 'PointText') return;
    if (item.className === 'Raster') return;

    const openPath = (item.className === 'Path' && !item.closed && !item.fillColor);
    if (openPath) {
      if (item.hitTest(point, { stroke: true, tolerance: radius })) {
        dropFromSelection(item);
        topLevelItem(item).remove();
        changed = true;
      }
      return;
    }

    const circle = new paper.Path.Circle({ center: point, radius: radius, insert: false });
    const isCompound = item.className === 'CompoundPath';
    const asStroke = isCompound ? !item.fillColor : false;
    if (!touchesCircle(item, circle, point, asStroke)) return;

    let result = null;
    try {
      result = item.subtract(circle, { insert: false });
    } catch (err) {
      return;
    }
    if (!result) return;

    if (result.isEmpty()) {
      result.remove();
      const bb = item.bounds;
      if (bb.width < radius * 2 && bb.height < radius * 2) {
        dropFromSelection(item);
        topLevelItem(item).remove();
      }
      changed = true;
      return;
    }

    result.insertAbove(item);
    result.name = item.name;
    result.data = item.data;
    delete result.data.origSegs; delete result.data.cornerR;
    const idx = selection.indexOf(item);
    if (idx >= 0) selection[idx] = result;
    if (selectedItem === item) selectedItem = result;
    item.remove();
    changed = true;
  });
  return changed;
}

function eraseAlong(from, to) {
  const radius = (Number(eraserSizeInput.value) || 30) / 2;
  const steps = Math.max(1, Math.ceil(from.getDistance(to) / (radius * 0.5)));
  let any = false;
  for (let i = 1; i <= steps; i++) {
    const p = from.add(to.subtract(from).multiply(i / steps));
    if (eraseAt(p)) any = true;
  }
  return any;
}

tools.eraser.onMouseDown = function (event) {
  erased = eraseAt(event.point);
  lastErase = event.point;
};

tools.eraser.onMouseDrag = function (event) {
  if (eraseAlong(lastErase, event.point)) erased = true;
  lastErase = event.point;
};

tools.eraser.onMouseUp = function () {
  if (erased) {
    saveState();
    renderLayers();
  }
  erased = false;
};

// ======================================================
// PAINT BUCKET
// ======================================================
function bucketTarget(point, strokeMode) {
  const leaves = leafItemsTopDown();
  for (let i = 0; i < leaves.length; i++) {
    const item = leaves[i];
    if (item.className === 'Raster') continue;

    if (strokeMode) {
      if (item.className !== 'PointText' &&
          item.hitTest(point, { stroke: true, tolerance: 6 })) return item;
      continue;
    }

    if (item.className === 'PointText') {
      if (item.bounds.contains(point)) return item;
      continue;
    }

    if (item.closed && item.contains(point)) return item;

    if (item.hitTest(point, { stroke: true, tolerance: 6 })) return item;
  }
  return null;
}

tools.bucket.onMouseDown = function (event) {
  const strokeMode = event.modifiers.shift;
  const item = bucketTarget(event.point, strokeMode);
  if (!item) return;

  if (strokeMode) {
    item.strokeColor = colorWithAlpha(strokeInput.value, Number(strokeOpInput.value));
    if (!item.strokeWidth) item.strokeWidth = Math.max(style.strokeWidth, 1);
  } else {
    if (item.className === 'Path' && !item.closed) item.closed = true;
    paintFill(item);
  }
  saveState();
};

// ======================================================
// EYEDROPPER
// ======================================================
function rasterPixel(raster, point) {
  if (!raster.bounds.contains(point)) return null;
  try {
    const local = raster.globalToLocal(point);
    const px = raster.getPixel(new paper.Point(
      local.x + raster.size.width / 2,
      local.y + raster.size.height / 2
    ));
    return px && px.alpha > 0 ? px : null;
  } catch (err) {
    return null;
  }
}

function colorAtPoint(point) {
  const leaves = leafItemsTopDown();
  for (let i = 0; i < leaves.length; i++) {
    const item = leaves[i];
    let c = null;

    if (item.className === 'Raster') {
      c = rasterPixel(item, point);
    } else if (item.className === 'PointText') {
      if (item.bounds.contains(point)) c = item.fillColor;
    } else if (item.fillColor && item.contains(point)) {
      c = item.fillColor;
    } else if (item.strokeColor && item.hitTest(point, { stroke: true, tolerance: 3 })) {
      c = item.strokeColor;
    }

    if (c) {
      if (c.type === 'gradient') c = c.gradient.stops[0].color;
      return c;
    }
  }
  return null;
}

tools.picker.onMouseDown = function (event) {
  const color = colorAtPoint(event.point);
  if (!color) return;
  const hex = color.toCSS(true);
  const alpha = Math.round((color.alpha === undefined ? 1 : color.alpha) * 100);

  if (event.modifiers.shift) {
    strokeInput.value = hex;
    strokeOpInput.value = alpha;
    strokeOpLabel.textContent = alpha + '%';
    style.stroke = colorWithAlpha(hex, alpha);
  } else {
    fillInput.value = hex;
    fillTypeSel.value = 'solid';
    fillOpInput.value = alpha;
    fillOpLabel.textContent = alpha + '%';
    style.fill = colorWithAlpha(hex, alpha);
  }
};

// ======================================================
// BRUSH PREVIEW RING + CURSOR
// ======================================================
const brushRing = document.getElementById('brush-ring');
let ringTool = null;

function updateToolExtras(name) {
  ringTool = (name === 'brush' || name === 'eraser') ? name : null;
  brushRing.style.display = 'none';
  document.getElementById('canvas').style.cursor = ringTool ? 'crosshair' : '';
}

function moveRing(e) {
  if (!ringTool) return;
  const input = ringTool === 'brush' ? brushSizeInput : eraserSizeInput;
  const size = (Number(input.value) || 8) * paper.view.zoom;
  const r = canvasArea.getBoundingClientRect();
  brushRing.style.display = 'block';
  brushRing.style.width = size + 'px';
  brushRing.style.height = size + 'px';
  brushRing.style.left = (e.clientX - r.left) + 'px';
  brushRing.style.top = (e.clientY - r.top) + 'px';
}
document.getElementById('canvas').addEventListener('pointermove', moveRing);
document.getElementById('canvas').addEventListener('pointerleave', function () {
  brushRing.style.display = 'none';
});

document.addEventListener('keydown', function (e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key !== '[' && e.key !== ']') return;
  const input = currentToolName === 'eraser' ? eraserSizeInput : brushSizeInput;
  const next = Number(input.value) + (e.key === ']' ? 2 : -2);
  input.value = Math.min(Number(input.max), Math.max(Number(input.min), next));
  input.dispatchEvent(new Event('input'));
});

document.addEventListener('change', function (e) {
  if (e.target && e.target.blur) e.target.blur();
});

function bindLabel(inputId, labelId, suffix) {
  const input = document.getElementById(inputId);
  const label = document.getElementById(labelId);
  if (!input || !label) return;
  const update = function () { label.textContent = input.value + suffix; };
  input.addEventListener('input', update);
  update();
}
bindLabel('brush-size', 'brush-size-label', ' px');
bindLabel('brush-opacity', 'brush-opacity-label', '%');
bindLabel('brush-smooth', 'brush-smooth-label', '%');
bindLabel('eraser-size', 'eraser-size-label', ' px');

// ======================================================
// IMAGE TOOLS — Magic wand, Remove BG, Split parts, Cut out
// ======================================================
const wandTolInput = document.getElementById('wand-tolerance');
const wandTolLabel = document.getElementById('wand-tol-label');
const wandContigInput = document.getElementById('wand-contiguous');
const splitGapInput = document.getElementById('split-gap');

wandTolInput.addEventListener('input', function () {
  wandTolLabel.textContent = wandTolInput.value + '%';
});

function topRasterAt(point) {
  const leaves = leafItemsTopDown();
  for (let i = 0; i < leaves.length; i++) {
    if (leaves[i].className === 'Raster' && rasterPixel(leaves[i], point)) return leaves[i];
  }
  return null;
}

function selectedRaster() {
  for (let i = 0; i < selection.length; i++) {
    if (selection[i].className === 'Raster') return selection[i];
  }
  return null;
}

function floodRemove(raster, seeds, tolPercent, contiguous) {
  const w = Math.round(raster.size.width);
  const h = Math.round(raster.size.height);
  const ctx = raster.getContext(true);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const tol = tolPercent * 2.55;
  const visited = new Uint8Array(w * h);
  let removed = 0;

  seeds.forEach(function (s) {
    const sx = s[0], sy = s[1];
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
    const si = (sy * w + sx) * 4;
    if (d[si + 3] === 0) return;
    const r = d[si], g = d[si + 1], b = d[si + 2];

    function matches(i) {
      return d[i + 3] > 0 &&
        Math.abs(d[i] - r) <= tol &&
        Math.abs(d[i + 1] - g) <= tol &&
        Math.abs(d[i + 2] - b) <= tol;
    }

    if (!contiguous) {
      for (let p = 0; p < w * h; p++) {
        const i = p * 4;
        if (matches(i)) { d[i + 3] = 0; removed++; }
      }
      return;
    }

    const stack = [sy * w + sx];
    visited[sy * w + sx] = 1;
    while (stack.length) {
      const p = stack.pop();
      const i = p * 4;
      if (!matches(i)) continue;
      d[i + 3] = 0;
      removed++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0     && !visited[p - 1]) { visited[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && !visited[p + 1]) { visited[p + 1] = 1; stack.push(p + 1); }
      if (y > 0     && !visited[p - w]) { visited[p - w] = 1; stack.push(p - w); }
      if (y < h - 1 && !visited[p + w]) { visited[p + w] = 1; stack.push(p + w); }
    }
  });

  ctx.putImageData(img, 0, 0);
  return removed;
}

tools.wand.onMouseDown = function (event) {
  const raster = topRasterAt(event.point);
  if (!raster) return;
  const local = raster.globalToLocal(event.point);
  const x = Math.floor(local.x + raster.size.width / 2);
  const y = Math.floor(local.y + raster.size.height / 2);
  const n = floodRemove(raster, [[x, y]],
    Number(wandTolInput.value) || 0, wandContigInput.checked);
  if (n) saveState();
};

function removeBackgroundSelected() {
  const raster = selectedRaster();
  if (!raster) {
    alert('Select an image first (Select tool, click the image).');
    return;
  }
  const w = Math.round(raster.size.width);
  const h = Math.round(raster.size.height);
  const n = floodRemove(raster,
    [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]],
    Number(wandTolInput.value) || 0, true);
  if (!n) {
    alert('Nothing was removed. Try a higher Tolerance, or use the Magic wand (W).');
    return;
  }
  saveState();
}

function makePartRaster(source, canvas, x0, y0) {
  const w = source.size.width, h = source.size.height;
  const r = new paper.Raster(canvas);
  const m = source.matrix.clone();
  m.translate(x0 + canvas.width / 2 - w / 2, y0 + canvas.height / 2 - h / 2);
  r.matrix = m;
  r.insertAbove(source);
  registerItem(r, 'Part', '🖼');
  return r;
}

function dilateMask(mask, w, h, r) {
  if (r <= 0) return mask;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const pre = new Int32Array(Math.max(w, h) + 1);
  let x, y, a, b;
  for (y = 0; y < h; y++) {
    pre[0] = 0;
    for (x = 0; x < w; x++) pre[x + 1] = pre[x] + mask[y * w + x];
    for (x = 0; x < w; x++) {
      a = Math.max(0, x - r); b = Math.min(w, x + r + 1);
      tmp[y * w + x] = pre[b] - pre[a] > 0 ? 1 : 0;
    }
  }
  for (x = 0; x < w; x++) {
    pre[0] = 0;
    for (y = 0; y < h; y++) pre[y + 1] = pre[y] + tmp[y * w + x];
    for (y = 0; y < h; y++) {
      a = Math.max(0, y - r); b = Math.min(h, y + r + 1);
      out[y * w + x] = pre[b] - pre[a] > 0 ? 1 : 0;
    }
  }
  return out;
}

function splitSelectedImage() {
  const raster = selectedRaster();
  if (!raster) {
    alert('Select an image first (Select tool, click the image).');
    return;
  }
  const w = Math.round(raster.size.width);
  const h = Math.round(raster.size.height);
  const d = raster.getContext().getImageData(0, 0, w, h).data;

  const mask = new Uint8Array(w * h);
  let opaque = 0;
  for (let p = 0; p < w * h; p++) {
    if (d[p * 4 + 3] > 16) { mask[p] = 1; opaque++; }
  }
  if (opaque > w * h * 0.97) {
    alert('This image has no transparent background yet.\nUse "Remove BG" or the Magic wand (W) first.');
    return;
  }

  const gap = Math.max(0, Number(splitGapInput.value) || 0);
  const dil = dilateMask(mask, w, h, gap);

  const labels = new Int32Array(w * h);
  let labelCount = 0;
  for (let p0 = 0; p0 < w * h; p0++) {
    if (!dil[p0] || labels[p0]) continue;
    labelCount++;
    const stack = [p0];
    labels[p0] = labelCount;
    while (stack.length) {
      const p = stack.pop();
      const x = p % w, y = (p / w) | 0;
      if (x > 0     && dil[p - 1] && !labels[p - 1]) { labels[p - 1] = labelCount; stack.push(p - 1); }
      if (x < w - 1 && dil[p + 1] && !labels[p + 1]) { labels[p + 1] = labelCount; stack.push(p + 1); }
      if (y > 0     && dil[p - w] && !labels[p - w]) { labels[p - w] = labelCount; stack.push(p - w); }
      if (y < h - 1 && dil[p + w] && !labels[p + w]) { labels[p + w] = labelCount; stack.push(p + w); }
    }
  }

  const comps = [];
  for (let l = 0; l <= labelCount; l++) {
    comps.push({ minX: w, minY: h, maxX: -1, maxY: -1, count: 0 });
  }
  for (let p = 0; p < w * h; p++) {
    if (!mask[p]) continue;
    const c = comps[labels[p]];
    const x = p % w, y = (p / w) | 0;
    if (x < c.minX) c.minX = x;
    if (x > c.maxX) c.maxX = x;
    if (y < c.minY) c.minY = y;
    if (y > c.maxY) c.maxY = y;
    c.count++;
  }

  const minPixels = Math.max(30, Math.round(opaque * 0.0005));
  const keep = [];
  for (let l = 1; l <= labelCount; l++) {
    if (comps[l].count >= minPixels) keep.push(l);
  }
  if (!keep.length) {
    alert('No parts found.');
    return;
  }
  keep.sort(function (a, b) {
    const ca = comps[a], cb = comps[b];
    return (ca.minY - cb.minY) || (ca.minX - cb.minX);
  });

  const parts = keep.map(function (l) {
    const c = comps[l];
    const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
    const canvas = document.createElement('canvas');
    canvas.width = bw;
    canvas.height = bh;
    const cctx = canvas.getContext('2d');
    const out = cctx.createImageData(bw, bh);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const p = (c.minY + y) * w + (c.minX + x);
        if (mask[p] && labels[p] === l) {
          const si = p * 4, di = (y * bw + x) * 4;
          out.data[di] = d[si];
          out.data[di + 1] = d[si + 1];
          out.data[di + 2] = d[si + 2];
          out.data[di + 3] = d[si + 3];
        }
      }
    }
    cctx.putImageData(out, 0, 0);
    return makePartRaster(raster, canvas, c.minX, c.minY);
  });

  raster.visible = false;
  raster.name = (raster.name || 'Image') + ' (original)';
  setSelection(parts);
  saveState();
}

function tracePixelPath(ctx, path, raster) {
  const w = raster.size.width, h = raster.size.height;
  const P = function (pt) {
    const l = raster.globalToLocal(pt);
    return [l.x + w / 2, l.y + h / 2];
  };
  const segs = path.segments;
  const n = segs.length;
  const s = P(segs[0].point);
  ctx.beginPath();
  ctx.moveTo(s[0], s[1]);
  const count = path.closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = segs[i], b = segs[(i + 1) % n];
    const c1 = P(a.point.add(a.handleOut));
    const c2 = P(b.point.add(b.handleIn));
    const e = P(b.point);
    ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], e[0], e[1]);
  }
  ctx.closePath();
}

function cutOutSelection() {
  const path = selection.filter(function (i) {
    return i.className === 'Path' && i.segments.length >= 3;
  })[0];
  if (!path) {
    alert('Draw a closed outline around the part with the Pen tool, select it, then press Cut out.');
    return;
  }

  let raster = selectedRaster();
  if (!raster) {
    const leaves = leafItemsTopDown();
    for (let i = 0; i < leaves.length; i++) {
      if (leaves[i].className === 'Raster' && leaves[i].bounds.intersects(path.bounds)) {
        raster = leaves[i];
        break;
      }
    }
  }
  if (!raster) {
    alert('No image found under the outline.');
    return;
  }

  const w = Math.round(raster.size.width);
  const h = Math.round(raster.size.height);

  const mask = document.createElement('canvas');
  mask.width = w;
  mask.height = h;
  const mctx = mask.getContext('2d');
  tracePixelPath(mctx, path, raster);
  mctx.fillStyle = '#000';
  mctx.fill();
  mctx.globalCompositeOperation = 'source-in';
  mctx.drawImage(raster.canvas, 0, 0);

  const md = mctx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let p = 0; p < w * h; p++) {
    if (md[p * 4 + 3] > 0) {
      const x = p % w, y = (p / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) {
    alert('The outline does not cover any part of the image.');
    return;
  }

  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const crop = document.createElement('canvas');
  crop.width = bw;
  crop.height = bh;
  crop.getContext('2d').drawImage(mask, minX, minY, bw, bh, 0, 0, bw, bh);

  const rctx = raster.getContext(true);
  rctx.save();
  rctx.globalCompositeOperation = 'destination-out';
  tracePixelPath(rctx, path, raster);
  rctx.fillStyle = '#000';
  rctx.fill();
  rctx.restore();

  const part = makePartRaster(raster, crop, minX, minY);
  path.remove();
  setSelection([part]);
  saveState();
}

wire('img-removebg', removeBackgroundSelected);
wire('img-split', splitSelectedImage);
wire('img-cut', cutOutSelection);

// ======================================================
// TABS + RESIZABLE PANELS
// ======================================================
function saveSetting(key, value) {
  try { localStorage.setItem('vs-' + key, value); } catch (err) {}
}
function loadSetting(key, fallback) {
  try { return localStorage.getItem('vs-' + key) || fallback; } catch (err) { return fallback; }
}

const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

function showTab(name) {
  tabButtons.forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
  tabPanes.forEach(function (p) { p.classList.toggle('active', p.dataset.pane === name); });
  saveSetting('tab', name);
}
tabButtons.forEach(function (b) {
  b.addEventListener('click', function () { showTab(b.dataset.tab); });
});

const appEl = document.getElementById('app');
const PANEL_LIMITS = {
  '--toolbar-w': [56, 200],
  '--props-w': [200, 560],
  '--timeline-h': [70, 460]
};

function setPanel(name, value) {
  const lim = PANEL_LIMITS[name];
  value = Math.round(Math.min(lim[1], Math.max(lim[0], value)));
  appEl.style.setProperty(name, value + 'px');
  saveSetting(name, value);
}

function makeSplitter(id, varName, axis, sign) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    document.body.classList.add('resizing');
    const start = axis === 'x' ? e.clientX : e.clientY;
    const startValue = parseFloat(getComputedStyle(appEl).getPropertyValue(varName));

    function onMove(ev) {
      const now = axis === 'x' ? ev.clientX : ev.clientY;
      setPanel(varName, startValue + sign * (now - start));
    }
    function onUp() {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.classList.remove('dragging');
      document.body.classList.remove('resizing');
    }
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  });
}
makeSplitter('split-l', '--toolbar-w', 'x', 1);
makeSplitter('split-r', '--props-w', 'x', -1);
makeSplitter('split-b', '--timeline-h', 'y', -1);

function fitCanvas() {
  const w = canvasArea.clientWidth;
  const h = canvasArea.clientHeight;
  if (w > 0 && h > 0) paper.view.viewSize = new paper.Size(w, h);
}
new ResizeObserver(fitCanvas).observe(canvasArea);

['--toolbar-w', '--props-w', '--timeline-h'].forEach(function (name) {
  const saved = Number(loadSetting(name, 0));
  if (saved) setPanel(name, saved);
});
showTab(loadSetting('tab', 'style'));
fitCanvas();

// ======================================================
// SAVE / OPEN / AUTOSAVE
// ======================================================
function projectData() {
  saveCurrentPage();
  return { app: 'vector-studio', version: 1, current: currentPageIndex,
           pages: pages, layerCounter: layerCounter, objCounter: objCounter };
}

function saveProject() {
  const blob = new Blob([JSON.stringify(projectData())], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'vector-studio-project.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}

function loadProjectData(data) {
  if (!data || !Array.isArray(data.pages) || !data.pages.length) throw new Error('bad file');
  pages = data.pages;
  currentPageIndex = Math.min(Math.max(0, data.current || 0), pages.length - 1);
  layerCounter = data.layerCounter || layerCounter;
  objCounter = data.objCounter || objCounter;
  loadProjectSnapshot(pages[currentPageIndex]);
  refreshPageBar();
}

wire('btn-save', saveProject);
const fileOpen = document.getElementById('file-open');
wire('btn-open', function () { fileOpen.click(); });
fileOpen.addEventListener('change', function () {
  const f = fileOpen.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = function () {
    try { loadProjectData(JSON.parse(rd.result)); }
    catch (err) { alert('This file is not a Vector Studio project.'); }
  };
  rd.readAsText(f);
  fileOpen.value = '';
});

function idb() {
  return new Promise(function (res, rej) {
    const r = indexedDB.open('vector-studio', 1);
    r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
    r.onsuccess = function () { res(r.result); };
    r.onerror = function () { rej(r.error); };
  });
}
function idbSet(key, val) {
  return idb().then(function (db) {
    return new Promise(function (res, rej) {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = res;
      tx.onerror = function () { rej(tx.error); };
    });
  });
}
function idbGet(key) {
  return idb().then(function (db) {
    return new Promise(function (res, rej) {
      const req = db.transaction('kv').objectStore('kv').get(key);
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  });
}
var autosaveTimer = null;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(function () {
    try { idbSet('autosave', JSON.stringify(projectData())).catch(function () {}); }
    catch (err) {}
  }, 1500);
}

// ======================================================
// RIG: pivot points + parenting + pose tracking
// ======================================================
function newUid() { return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function allTopItems() {
  const out = [];
  paper.project.layers.forEach(function (l) { l.children.forEach(function (c) { out.push(c); }); });
  return out;
}
function findByUid(uid) {
  return allTopItems().filter(function (i) { return i.data && i.data.uid === uid; })[0] || null;
}
function childrenOf(item) {
  const uid = item.data && item.data.uid;
  if (!uid) return [];
  return allTopItems().filter(function (i) { return i.data && i.data.parent === uid; });
}
function isDescendant(item, ancestor) {
  let cur = item;
  for (let n = 0; cur && n < 100; n++) {
    const pu = cur.data && cur.data.parent;
    if (!pu) return false;
    cur = findByUid(pu);
    if (cur === ancestor) return true;
  }
  return false;
}
function getPivot(item) {
  const p = item.data && item.data.pivot;
  return p ? new paper.Point(p[0], p[1]) : item.bounds.center;
}

// Every move / rotate / scale also moves the pivot, remembers the pose
// (needed for animation) and carries the linked children
let animating = false;   // true while the timeline moves things itself

function mxFrom(a) {
  return a ? new paper.Matrix(a[0], a[1], a[2], a[3], a[4], a[5]) : new paper.Matrix();
}
function mxArr(m) { return [m.a, m.b, m.c, m.d, m.tx, m.ty]; }

(function patchTransformForRig() {
  const original = paper.Item.prototype.transform;
  paper.Item.prototype.transform = function (matrix) {
    const d = this.data;
    if (d && matrix && !matrix.isIdentity()) {
      if (!d.pivot && !d.pose) {
        const c = this.bounds.center;
        d.pivot = [c.x, c.y];
      }
      d.pose = mxArr(matrix.clone().append(mxFrom(d.pose)));
        if (d.origSegs) {
        const m0 = new paper.Matrix(matrix.a, matrix.b, matrix.c, matrix.d, 0, 0);
        d.origSegs = d.origSegs.map(function (s) {
          const p = matrix.transform(new paper.Point(s[0], s[1]));
          const hi = m0.transform(new paper.Point(s[2], s[3]));
          const ho = m0.transform(new paper.Point(s[4], s[5]));
          return [p.x, p.y, hi.x, hi.y, ho.x, ho.y];
        });
      }
      if (d.pivot) {
        const p = matrix.transform(new paper.Point(d.pivot[0], d.pivot[1]));
        d.pivot = [p.x, p.y];
      }
    }
    const result = original.apply(this, arguments);
    if (!animating && d && d.uid && matrix) {
      childrenOf(this).forEach(function (c) {
        if (selection.indexOf(c) < 0) c.transform(matrix);
      });
    }
    return result;
  };
})();

// ----- Pivot dot (drag it to move the pivot) ← pointer events -----
const pivotDot = document.createElement('div');
pivotDot.id = 'pivot-dot';
pivotDot.title = 'Pivot point. Drag to move it';
canvasArea.appendChild(pivotDot);
let pivotDrag = false, pivotMoved = false;

pivotDot.addEventListener('pointerdown', function (e) {
  e.preventDefault();
  e.stopPropagation();
  if (pivotDot.setPointerCapture) pivotDot.setPointerCapture(e.pointerId);
  pivotDrag = true;
  pivotMoved = false;
});
window.addEventListener('pointermove', function (e) {
  if (!pivotDrag || !selectedItem) return;
  const p = mouseToProject(e);
  selectedItem.data.pivot = [p.x, p.y];
  pivotMoved = true;
});
window.addEventListener('pointerup', function () {
  if (pivotDrag && pivotMoved) saveState();
  pivotDrag = false;
  pivotMoved = false;
});

function updatePivotDot() {
  if (currentToolName === 'select' && selection.length === 1) {
    const v = paper.view.projectToView(getPivot(selection[0]));
    pivotDot.style.display = 'block';
    pivotDot.style.left = v.x + 'px';
    pivotDot.style.top = v.y + 'px';
  } else {
    pivotDot.style.display = 'none';
  }
}

wire('rig-pivot', function () {
  selection.forEach(function (i) { if (i.data) delete i.data.pivot; });
  if (selection.length) saveState();
});

// ----- Parenting -----
let pickingParent = false, pendingKids = [], ignoreDrag = false;
const parentBtn = document.getElementById('rig-parent');

function cancelPick() {
  if (!pickingParent) return;
  pickingParent = false;
  pendingKids = [];
  parentBtn.textContent = 'Set parent';
  canvasEl.style.cursor = '';
}

function startPickParent() {
  if (!selection.length) {
    alert('First select the part(s) that should follow (the children). Then press Set parent and click the parent.');
    return;
  }
  const kids = selection.slice();
  if (currentToolName !== 'select') { setTool('select'); setSelection(kids); }
  pendingKids = kids;
  pickingParent = true;
  parentBtn.textContent = 'Click parent…';
  canvasEl.style.cursor = 'crosshair';
}

function finishPickParent(point) {
  const kids0 = pendingKids;
  cancelPick();
  const hit = paper.project.hitTest(point, {
    fill: true, stroke: true, tolerance: 5,
    match: function (h) {
      if (h.item.className === 'Raster') return !!rasterPixel(h.item, point);
      return true;
    }
  });
  if (!hit) return;
  const parent = topLevelItem(hit.item);
  const kids = kids0.filter(function (k) { return k !== parent; });
  if (!kids.length) return;
  if (kids.some(function (k) { return isDescendant(parent, k); })) {
    alert("A part can't be a child of its own child.");
    return;
  }
  if (!parent.data.uid) parent.data.uid = newUid();
  kids.forEach(function (k) {
    if (!k.data.uid) k.data.uid = newUid();
    k.data.parent = parent.data.uid;
  });
  setSelection(kids);
  saveState();
  renderLayers();
}

wire('rig-parent', startPickParent);
wire('rig-unlink', function () {
  selection.forEach(function (i) { if (i.data) delete i.data.parent; });
  if (selection.length) { renderLayers(); saveState(); }
});

// ======================================================
// LASSO CUT-OUT
// ======================================================
let lassoPath = null, lassoStart = null, lassoRect = false, lassoPts = [];

tools.lasso.onMouseDown = function (event) {
  lassoStart = event.point;
  lassoRect = !!event.modifiers.shift;
  lassoPts = [event.point];
  lassoPath = null;
};

tools.lasso.onMouseDrag = function (event) {
  if (lassoPath) lassoPath.remove();
  const look = {
    strokeColor: '#2f6fed', strokeWidth: 1.5, dashArray: [5, 4],
    fillColor: new paper.Color(0.18, 0.44, 0.93, 0.12)
  };
  if (lassoRect) {
    lassoPath = new paper.Path.Rectangle(Object.assign({ from: lassoStart, to: event.point }, look));
  } else {
    lassoPts.push(event.point);
    lassoPath = new paper.Path(Object.assign({ segments: lassoPts.slice(), closed: true }, look));
  }
};

tools.lasso.onMouseUp = function () {
  if (!lassoPath) return;
  const path = lassoPath;
  lassoPath = null;
  if (path.segments.length < 3 || path.bounds.width < 3 || path.bounds.height < 3) {
    path.remove();
    return;
  }
  let raster = topRasterAt(path.bounds.center);
  for (let i = 0; i < lassoPts.length && !raster; i++) raster = topRasterAt(lassoPts[i]);
  if (!raster) {
    path.remove();
    alert('Draw the outline over an image.');
    return;
  }
  setSelection([path, raster]);
  cutOutSelection();
  if (path.parent) { path.remove(); clearSelection(); }
};

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') cancelPick();
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === 's') { e.preventDefault(); saveProject(); return; }
  if (!e.ctrlKey && !e.metaKey && key === 'k') setTool('lasso');
});

idbGet('autosave').then(function (txt) {
  if (!txt) return;
  let data;
  try { data = JSON.parse(txt); } catch (err) { return; }
  const hasWork = data.pages && data.pages.some(function (p) {
    return /\["(Path|CompoundPath|Group|Raster|PointText|Shape)"/.test(p.json || '');
  });
  if (hasWork && confirm('Restore your last session?')) {
    try { loadProjectData(data); } catch (err) {}
  }
}).catch(function () {});

// ======================================================
// FRAME (artboard) + EXPORT
// ======================================================
const frameBox = document.createElement('div');
frameBox.id = 'frame-box';
canvasArea.appendChild(frameBox);

const frameWInput = document.getElementById('frame-w');
const frameHInput = document.getElementById('frame-h');
const framePreset = document.getElementById('frame-preset');
const frameShow = document.getElementById('frame-show');
const expWhat = document.getElementById('exp-what');
const expFormat = document.getElementById('exp-format');
const expW = document.getElementById('exp-w');
const expH = document.getElementById('exp-h');
const expLock = document.getElementById('exp-lock');
const expBg = document.getElementById('exp-bg');
const expBgColor = document.getElementById('exp-bgcolor');
const expQuality = document.getElementById('exp-quality');
bindLabel('exp-quality', 'exp-q-label', '%');

function clampPx(v, max) {
  return Math.min(max, Math.max(1, Math.round(Number(v) || 1)));
}

let frame = (function () {
  try {
    const f = JSON.parse(loadSetting('frame', ''));
    if (f && f.w > 0 && f.h > 0) return f;
  } catch (err) {}
  const c = paper.view.center;
  return { x: Math.round(c.x - 256), y: Math.round(c.y - 256), w: 512, h: 512 };
})();

function saveFrame() {
  saveSetting('frame', JSON.stringify(frame));
  frameWInput.value = frame.w;
  frameHInput.value = frame.h;
}

function setFrameSize(w, h) {
  w = clampPx(w, 8192);
  h = clampPx(h, 8192);
  const cx = frame.x + frame.w / 2, cy = frame.y + frame.h / 2;
  frame = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w: w, h: h };
  saveFrame();
}

function fitFrame() {
  const v = paper.view.viewSize;
  const z = Math.min(20, Math.max(0.1,
    Math.min(v.width / frame.w, v.height / frame.h) * 0.85));
  paper.view.zoom = z;
  paper.view.center = new paper.Point(frame.x + frame.w / 2, frame.y + frame.h / 2);
  updateZoomLabel();
}

function selectionStrokeBounds() {
  if (!selection.length) return null;
  let b = selection[0].strokeBounds;
  for (let i = 1; i < selection.length; i++) b = b.unite(selection[i].strokeBounds);
  return b;
}

function exportArea() {
  if (expWhat.value === 'selection') return selectionStrokeBounds();
  return new paper.Rectangle(frame.x, frame.y, frame.w, frame.h);
}

let lastAreaKey = '';
function syncExportSize(force) {
  const a = exportArea();
  if (!a) return;
  const key = expWhat.value + '|' + Math.round(a.width) + '|' + Math.round(a.height);
  if (!force && key === lastAreaKey) return;
  lastAreaKey = key;
  expW.value = clampPx(a.width, 4096);
  expH.value = clampPx(a.height, 4096);
}

function updateFrameBox() {
  if (!frameShow.checked) {
    frameBox.style.display = 'none';
  } else {
    const tl = paper.view.projectToView(new paper.Point(frame.x, frame.y));
    const br = paper.view.projectToView(new paper.Point(frame.x + frame.w, frame.y + frame.h));
    frameBox.style.display = 'block';
    frameBox.style.left = tl.x + 'px';
    frameBox.style.top = tl.y + 'px';
    frameBox.style.width = (br.x - tl.x) + 'px';
    frameBox.style.height = (br.y - tl.y) + 'px';
  }
  syncExportSize(false);
}

frameWInput.addEventListener('change', function () {
  setFrameSize(frameWInput.value, frame.h);
  framePreset.value = '';
});
frameHInput.addEventListener('change', function () {
  setFrameSize(frame.w, frameHInput.value);
  framePreset.value = '';
});
framePreset.addEventListener('change', function () {
  if (!framePreset.value) return;
  const p = framePreset.value.split(',');
  setFrameSize(Number(p[0]), Number(p[1]));
  fitFrame();
});
wire('frame-fit', fitFrame);
wire('frame-sel', function () {
  const b = selectionStrokeBounds();
  if (!b) { alert('Select something first.'); return; }
  frame = { x: Math.round(b.x), y: Math.round(b.y),
            w: Math.max(1, Math.round(b.width)), h: Math.max(1, Math.round(b.height)) };
  saveFrame();
  framePreset.value = '';
});
expWhat.addEventListener('change', function () { syncExportSize(true); });

expW.addEventListener('change', function () {
  const a = exportArea();
  expW.value = clampPx(expW.value, 4096);
  if (a && expLock.checked) expH.value = clampPx(Number(expW.value) * a.height / a.width, 4096);
});
expH.addEventListener('change', function () {
  const a = exportArea();
  expH.value = clampPx(expH.value, 4096);
  if (a && expLock.checked) expW.value = clampPx(Number(expH.value) * a.width / a.height, 4096);
});

function renderArea(area, outW, outH, onlySelected, bg) {
  const view = paper.view;
  const pr = view.pixelRatio || 1;
  const old = { size: view.viewSize.clone(), zoom: view.zoom, center: view.center.clone() };
  const sel = selection.slice();
  const hidden = [];
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;

  try {
    paper.project.deselectAll();
    if (onlySelected) {
      allTopItems().forEach(function (i) {
        if (sel.indexOf(i) < 0 && i.visible) { i.visible = false; hidden.push(i); }
      });
    }
    const z = outW / area.width;
    view.viewSize = new paper.Size(outW / pr, Math.max(1, Math.round(area.height * z)) / pr);
    view.zoom = z / pr;
    view.center = area.center;
    paper.project._needsUpdate = true;
    view.update();

    const c = out.getContext('2d');
    if (bg) { c.fillStyle = bg; c.fillRect(0, 0, outW, outH); }
    c.imageSmoothingQuality = 'high';
    c.drawImage(view.element, 0, 0, view.element.width, view.element.height, 0, 0, outW, outH);
  } finally {
    view.viewSize = old.size;
    view.zoom = old.zoom;
    view.center = old.center;
    hidden.forEach(function (i) { i.visible = true; });
    sel.forEach(function (i) { i.selected = true; });
  }
  return out;
}

function buildSVG(area, W, H, onlySelected, bg) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', [area.x, area.y, area.width, area.height].join(' '));
  svg.setAttribute('preserveAspectRatio', 'none');

  if (bg) {
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', area.x);
    r.setAttribute('y', area.y);
    r.setAttribute('width', area.width);
    r.setAttribute('height', area.height);
    r.setAttribute('fill', bg);
    svg.appendChild(r);
  }

  const opts = { asString: false };
  if (onlySelected) {
    selection.slice().sort(function (a, b) {
      return (a.layer.index - b.layer.index) || (a.index - b.index);
    }).forEach(function (i) { svg.appendChild(i.exportSVG(opts)); });
  } else {
    paper.project.layers.forEach(function (l) {
      if (l.visible) svg.appendChild(l.exportSVG(opts));
    });
  }
  svg.querySelectorAll('[data-paper-data]').forEach(function (n) {
    n.removeAttribute('data-paper-data');
  });
  return new XMLSerializer().serializeToString(svg);
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}

function doExport() {
  const onlySel = expWhat.value === 'selection';
  const fmt = expFormat.value;
  if (onlySel && !selection.length) {
    alert('Select something first (Select tool), or choose "Whole frame".');
    return;
  }
  const area = exportArea();
  if (!area || area.width < 1 || area.height < 1) {
    alert('Nothing to export.');
    return;
  }
  const W = clampPx(expW.value, 4096);
  const H = clampPx(expH.value, 4096);
  let bg = expBg.value === 'color' ? expBgColor.value : null;
  if (fmt === 'jpg' && !bg) bg = '#ffffff';

  const base = 'vector-studio-' + (onlySel ? 'selection' : 'frame');

  if (fmt === 'svg') {
    const text = buildSVG(area, W, H, onlySel, bg);
    downloadBlob(new Blob([text], { type: 'image/svg+xml' }), base + '.svg');
    return;
  }

  const canvas = renderArea(area, W, H, onlySel, bg);
  const mime = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
  canvas.toBlob(function (blob) {
    if (!blob) { alert('Export failed. Try a smaller size.'); return; }
    downloadBlob(blob, base + (fmt === 'jpg' ? '.jpg' : '.png'));
  }, mime, (Number(expQuality.value) || 92) / 100);
}
wire('exp-download', doExport);

saveFrame();
syncExportSize(true);

// ======================================================
// COLOR PICKER (Inkscape style)
// ======================================================
const ColorPicker = (function () {
  const st = { h: 210, s: 0.8, v: 0.9, a: 1 };
  let anchor = null, cb = null, mode = 'RGB', opts = {}, startHex = '#000000', startA = 1;
  const PALETTE = ['#000000','#434343','#666666','#999999','#cccccc','#ffffff','#ff0000','#ff6600',
    '#ffcc00','#ffff00','#99cc00','#00aa00','#00cc99','#00ccff','#0066ff','#0000cc','#6600cc',
    '#cc00cc','#ff0099','#990000','#cc6600','#996633','#663300','#336600','#003366','#330066',
    '#ffcccc','#ffe5cc','#ffffcc','#ccffcc','#ccf2ff','#e5ccff'];

  const pop = document.createElement('div');
  pop.id = 'cp';
  pop.innerHTML =
    '<div id="cp-sv"><div id="cp-sv-dot"></div></div>' +
    '<div class="cp-bar" id="cp-hue"><div class="cp-knob"></div></div>' +
    '<div class="cp-bar" id="cp-alpha"><div id="cp-alpha-fill"></div><div class="cp-knob"></div></div>' +
    '<div class="cp-top"><div id="cp-prev"><div id="cp-old"></div><div id="cp-new"></div></div>' +
    '<input type="text" id="cp-hex" maxlength="9" spellcheck="false">' +
    '<button id="cp-eye" title="Pick a color from the screen">💧</button>' +
    '<button id="cp-none" title="None (transparent)">∅</button></div>' +
    '<div class="cp-modes"></div><div id="cp-fields"></div>' +
    '<div class="cp-lbl">Palette</div><div class="cp-sw" id="cp-pal"></div>' +
    '<div class="cp-lbl">Recent</div><div class="cp-sw" id="cp-recent"></div>';
  document.body.appendChild(pop);
    pop.insertAdjacentHTML('afterbegin',
    '<div id="cp-head"><span>Color ⠿ drag to move</span><button id="cp-x" title="Close">✕</button></div>');
  pop.insertAdjacentHTML('beforeend', '<div id="cp-grip" title="Drag to resize"></div>');

  const $ = function (s) { return pop.querySelector(s); };
  const sv = $('#cp-sv'), svDot = $('#cp-sv-dot'), hueBar = $('#cp-hue'), alphaBar = $('#cp-alpha');
  const hexEl = $('#cp-hex'), fieldsEl = $('#cp-fields');

  // ---- color math ----
  const clamp = function (x, a, b) { return Math.min(b, Math.max(a, x)); };
  function hsv2rgb(h, s, v) {
    const f = function (n) { const k = (n + h / 60) % 6; return v - v * s * Math.max(Math.min(k, 4 - k, 1), 0); };
    return [f(5), f(3), f(1)].map(function (x) { return Math.round(x * 255); });
  }
  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h: h, s: mx ? d / mx : 0, v: mx, gray: d === 0 };
  }
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
    return { s: d ? d / (1 - Math.abs(2 * l - 1)) : 0, l: l };
  }
  function hsl2rgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [r + m, g + m, b + m].map(function (t) { return Math.round(t * 255); });
  }
  const rgb = function () { return hsv2rgb(st.h, st.s, st.v); };
  const hex2 = function (n) { return ('0' + n.toString(16)).slice(-2); };
  const toHex = function () { return '#' + rgb().map(hex2).join(''); };
  function setRGB(r, g, b, hueHint) {
    const x = rgb2hsv(r, g, b);
    st.h = x.gray ? (hueHint != null ? hueHint : st.h) : x.h;
    st.s = x.s; st.v = x.v;
  }
  function parseHex(t) {
    t = String(t).trim().replace('#', '');
    if (t.length === 3 || t.length === 4) t = t.split('').map(function (c) { return c + c; }).join('');
    if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(t)) return null;
    return { r: parseInt(t.substr(0, 2), 16), g: parseInt(t.substr(2, 2), 16),
             b: parseInt(t.substr(4, 2), 16), a: t.length === 8 ? parseInt(t.substr(6, 2), 16) / 255 : null };
  }

  // ---- numeric modes ----
  const MODES = {
    RGB:  { l: ['R', 'G', 'B'], max: [255, 255, 255],
            to: function () { return rgb(); },
            from: function (a) { setRGB(a[0], a[1], a[2]); } },
    HSL:  { l: ['H', 'S', 'L'], max: [360, 100, 100],
            to: function () { const x = rgb2hsl.apply(null, rgb()); return [Math.round(st.h), Math.round(x.s * 100), Math.round(x.l * 100)]; },
            from: function (a) { const c = hsl2rgb(a[0], a[1] / 100, a[2] / 100); setRGB(c[0], c[1], c[2], a[0]); } },
    HSV:  { l: ['H', 'S', 'V'], max: [360, 100, 100],
            to: function () { return [Math.round(st.h), Math.round(st.s * 100), Math.round(st.v * 100)]; },
            from: function (a) { st.h = a[0]; st.s = a[1] / 100; st.v = a[2] / 100; } },
    CMYK: { l: ['C', 'M', 'Y', 'K'], max: [100, 100, 100, 100],
            to: function () {
              const c = rgb().map(function (x) { return x / 255; }), k = 1 - Math.max(c[0], c[1], c[2]);
              if (k >= 1) return [0, 0, 0, 100];
              return [(1 - c[0] - k) / (1 - k), (1 - c[1] - k) / (1 - k), (1 - c[2] - k) / (1 - k), k]
                .map(function (x) { return Math.round(x * 100); });
            },
            from: function (a) {
              const k = a[3] / 100;
              setRGB(Math.round(255 * (1 - a[0] / 100) * (1 - k)),
                     Math.round(255 * (1 - a[1] / 100) * (1 - k)),
                     Math.round(255 * (1 - a[2] / 100) * (1 - k)));
            } }
  };

  const modesEl = $('.cp-modes');
  Object.keys(MODES).forEach(function (m) {
    const b = document.createElement('button');
    b.textContent = m; b.dataset.m = m;
    b.addEventListener('click', function () { mode = m; buildFields(); update(); });
    modesEl.appendChild(b);
  });

  function buildFields() {
    const M = MODES[mode];
    fieldsEl.innerHTML = '';
    M.l.forEach(function (lab, i) {
      const row = document.createElement('div');
      row.className = 'cp-f';
      row.innerHTML = '<b>' + lab + '</b><input type="range" min="0" max="' + M.max[i] + '"><input type="number" min="0" max="' + M.max[i] + '">';
      const rng = row.children[1], num = row.children[2];
      const apply = function (v) {
        const vals = MODES[mode].to();
        vals[i] = clamp(Number(v) || 0, 0, M.max[i]);
        MODES[mode].from(vals);
        update(); emit(false);
      };
      rng.addEventListener('input', function () { apply(rng.value); });
      rng.addEventListener('change', function () { emit(true); });
      num.addEventListener('input', function () { apply(num.value); });
      num.addEventListener('change', function () { emit(true); });
      fieldsEl.appendChild(row);
    });
    if (opts.alpha) {
      const row = document.createElement('div');
      row.className = 'cp-f';
      row.innerHTML = '<b>A</b><input type="range" min="0" max="100"><input type="number" min="0" max="100">';
      const rng = row.children[1], num = row.children[2];
      const apply = function (v) { st.a = clamp(Number(v) || 0, 0, 100) / 100; update(); emit(false); };
      rng.addEventListener('input', function () { apply(rng.value); });
      rng.addEventListener('change', function () { emit(true); });
      num.addEventListener('input', function () { apply(num.value); });
      num.addEventListener('change', function () { emit(true); });
      row.dataset.alpha = '1';
      fieldsEl.appendChild(row);
    }
  }

  // ---- redraw popup ----
  function update() {
    const r = rgb(), css = 'rgb(' + r.join(',') + ')';
    sv.style.background = 'linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(' + st.h + ',100%,50%))';
    svDot.style.left = (st.s * 100) + '%';
    svDot.style.top = ((1 - st.v) * 100) + '%';
    hueBar.querySelector('.cp-knob').style.left = (st.h / 360 * 100) + '%';
    $('#cp-alpha-fill').style.background = 'linear-gradient(to right,rgba(' + r.join(',') + ',0),' + css + ')';
    alphaBar.querySelector('.cp-knob').style.left = (st.a * 100) + '%';
    alphaBar.style.display = opts.alpha ? 'block' : 'none';
    $('#cp-new').style.background = 'rgba(' + r.join(',') + ',' + st.a + ')';
    $('#cp-none').style.display = opts.onNone ? '' : 'none';
    if (document.activeElement !== hexEl) {
      hexEl.value = toHex() + (opts.alpha && st.a < 1 ? hex2(Math.round(st.a * 255)) : '');
    }
    const vals = MODES[mode].to();
    const rows = fieldsEl.children;
    for (let i = 0; i < vals.length; i++) {
      if (document.activeElement !== rows[i].children[1]) rows[i].children[1].value = vals[i];
      if (document.activeElement !== rows[i].children[2]) rows[i].children[2].value = vals[i];
    }
    if (opts.alpha && rows.length > vals.length) {
      const ar = rows[vals.length], av = Math.round(st.a * 100);
      if (document.activeElement !== ar.children[2]) ar.children[2].value = av;
      ar.children[1].value = av;
    }
    modesEl.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.m === mode); });
  }

  // ---- recent colors ----
  function loadRecent() { try { return JSON.parse(localStorage.getItem('vs-recent') || '[]'); } catch (e) { return []; } }
  function pushRecent(h) {
    const list = loadRecent().filter(function (x) { return x !== h; });
    list.unshift(h);
    try { localStorage.setItem('vs-recent', JSON.stringify(list.slice(0, 16))); } catch (e) {}
  }
  function swatches(el, list) {
    el.innerHTML = '';
    list.forEach(function (c) {
      const i = document.createElement('i');
      i.style.background = c; i.title = c;
      i.addEventListener('click', function () {
        const p = parseHex(c);
        setRGB(p.r, p.g, p.b); update(); emit(true);
      });
      el.appendChild(i);
    });
  }

  // ---- send the color back ----
  function emit(final) {
    if (!cb) return;
    const h = toHex();
    cb(h, Math.round(st.a * 100), !!final);
    if (final) { pushRecent(h); swatches($('#cp-recent'), loadRecent()); }
  }

  // ---- dragging (mouse, touch and pen) ----
  function drag(el, fn) {
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      fn(e);
      const up = function () {
        el.removeEventListener('pointermove', fn);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        emit(true);
      };
      el.addEventListener('pointermove', fn);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }
  const frac = function (e, el, axis) {
    const r = el.getBoundingClientRect();
    return axis === 'x' ? clamp((e.clientX - r.left) / r.width, 0, 1) : clamp((e.clientY - r.top) / r.height, 0, 1);
  };
  drag(sv, function (e) { st.s = frac(e, sv, 'x'); st.v = 1 - frac(e, sv, 'y'); update(); emit(false); });
  drag(hueBar, function (e) { st.h = frac(e, hueBar, 'x') * 360; update(); emit(false); });
  drag(alphaBar, function (e) { st.a = frac(e, alphaBar, 'x'); update(); emit(false); });

  // ---- resize + move ----
  const head = $('#cp-head'), grip = $('#cp-grip');

  function setSize(w, h) {
    w = clamp(w, 230, Math.min(560, window.innerWidth - 16));
    h = clamp(h, 100, 360);
    pop.style.setProperty('--cp-w', w + 'px');
    pop.style.setProperty('--cp-svh', h + 'px');
    try { localStorage.setItem('vs-cp-size', JSON.stringify([w, h])); } catch (e) {}
  }
  function keepOnScreen() {
    const r = pop.getBoundingClientRect();
    pop.style.left = clamp(r.left, 0, Math.max(0, window.innerWidth - r.width)) + 'px';
    pop.style.top = clamp(r.top, 0, Math.max(0, window.innerHeight - r.height)) + 'px';
  }
  (function () {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('vs-cp-size') || 'null'); } catch (e) {}
    const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    const s = saved || (coarse ? [300, 180] : [264, 150]);
    setSize(s[0], s[1]);
  })();

  grip.addEventListener('pointerdown', function (e) {
    e.preventDefault(); e.stopPropagation();
    grip.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY, w0 = pop.offsetWidth, h0 = sv.offsetHeight;
    const mv = function (ev) { setSize(w0 + (ev.clientX - sx), h0 + (ev.clientY - sy)); };
    const up = function () {
      grip.removeEventListener('pointermove', mv);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      keepOnScreen();
    };
    grip.addEventListener('pointermove', mv);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });

  head.addEventListener('pointerdown', function (e) {
    if (e.target.id === 'cp-x') return;
    e.preventDefault();
    head.setPointerCapture(e.pointerId);
    const r = pop.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
    const mv = function (ev) {
      pop.style.left = clamp(ev.clientX - ox, 0, window.innerWidth - 60) + 'px';
      pop.style.top = clamp(ev.clientY - oy, 0, window.innerHeight - 40) + 'px';
    };
    const up = function () {
      head.removeEventListener('pointermove', mv);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
    };
    head.addEventListener('pointermove', mv);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  });
  $('#cp-x').addEventListener('click', function () { close(); });

  hexEl.addEventListener('input', function () {
    const p = parseHex(hexEl.value);
    if (!p) return;
    setRGB(p.r, p.g, p.b);
    if (p.a != null && opts.alpha) st.a = p.a;
    update(); emit(false);
  });
  hexEl.addEventListener('change', function () { hexEl.blur(); update(); emit(true); });

  $('#cp-eye').addEventListener('click', function () {
    if (!window.EyeDropper) {
      if (window.toast) toast('Screen eyedropper not supported here. Use the 💧 tool on the canvas (I)');
      return;
    }
    new EyeDropper().open().then(function (res) {
      const p = parseHex(res.sRGBHex);
      if (p) { setRGB(p.r, p.g, p.b); update(); emit(true); }
    }).catch(function () {});
  });
  $('#cp-none').addEventListener('click', function () {
    if (opts.onNone) opts.onNone();
    close();
  });

  // ---- open / close ----
  function open(el, hex, alphaPct, callback, options) {
    anchor = el; cb = callback; opts = options || {};
    const p = parseHex(hex) || { r: 0, g: 0, b: 0 };
    setRGB(p.r, p.g, p.b);
    st.a = clamp((alphaPct == null ? 100 : alphaPct) / 100, 0, 1);
    startHex = toHex(); startA = st.a;
    $('#cp-old').style.background = 'rgba(' + rgb().join(',') + ',' + st.a + ')';
    swatches($('#cp-pal'), PALETTE);
    swatches($('#cp-recent'), loadRecent());
    buildFields();
    pop.style.display = 'block';
    update();
    const r = el.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    let left = r.left - w - 12;
    if (left < 8) left = Math.min(window.innerWidth - w - 8, r.right + 12);
    if (window.innerWidth < 520) left = (window.innerWidth - w) / 2;
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = clamp(r.top - 20, 8, Math.max(8, window.innerHeight - h - 8)) + 'px';
  }
  function close() { pop.style.display = 'none'; anchor = null; cb = null; }

  document.addEventListener('pointerdown', function (e) {
    if (pop.style.display !== 'block') return;
    if (pop.contains(e.target) || e.target === anchor) return;
    close();
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && pop.style.display === 'block') close();
  });

  return { open: open, close: close };
})();

// ---- connect the picker to the panel swatches ----
function hookColor(input, alphaInput, onNone) {
  input.addEventListener('click', function (e) {
    e.preventDefault();
    ColorPicker.open(input, input.value, alphaInput ? Number(alphaInput.value) : 100,
      function (hex, a, final) {
        if (input === fillInput && fillTypeSel.value === 'none') fillTypeSel.value = 'solid';
        input.value = hex;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (alphaInput) {
          alphaInput.value = a;
          alphaInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (final) input.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { alpha: !!alphaInput, onNone: onNone });
  });
}
hookColor(fillInput, fillOpInput, function () {
  fillTypeSel.value = 'none';
  fillTypeSel.dispatchEvent(new Event('change', { bubbles: true }));
});
hookColor(strokeInput, strokeOpInput, function () {
  strokeOpInput.value = 0;
  strokeOpInput.dispatchEvent(new Event('input', { bubbles: true }));
  strokeOpInput.dispatchEvent(new Event('change', { bubbles: true }));
});
hookColor(fill2Input, null, null);

// ---- swap fill and stroke ----
wire('swap-colors', function () {
  const f = fillInput.value, fo = fillOpInput.value;
  const s = strokeInput.value, so = strokeOpInput.value;
  fillTypeSel.value = 'solid';
  fillInput.value = s; fillOpInput.value = so;
  strokeInput.value = f; strokeOpInput.value = fo;
  [fillInput, fillOpInput, strokeInput, strokeOpInput].forEach(function (el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  if (selection.length) saveState();
});

window.toast = function (msg) {
  let t = document.getElementById('vs-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'vs-toast';
    t.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);' +
      'background:#000c;color:#fff;padding:8px 14px;border-radius:8px;font:14px sans-serif;' +
      'z-index:99999;pointer-events:none;max-width:80vw;text-align:center';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._tm);
  t._tm = setTimeout(function () { t.style.display = 'none'; }, 1800);
};

// ======================================================
// DAY 3: add points, point tools, clipboard, nudge
// ======================================================
function say(msg) { if (window.toast) toast(msg); }

function allPathsFrom(items, out) {
  items.forEach(function (i) {
    if (i.className === 'Path') out.push(i);
    else if (i.children && i.className !== 'Layer') allPathsFrom(i.children, out);
  });
  return out;
}

function nearestOnPaths(paths, point, tol) {
  let best = null;
  paths.forEach(function (p) {
    const loc = p.getNearestLocation(point);
    if (loc && loc.distance <= tol && (!best || loc.distance < best.loc.distance)) {
      best = { path: p, loc: loc };
    }
  });
  return best;
}

// ----- Add point mode (tap a line, drag the new point) -----
let addPointMode = false;
const _nodeDown = tools.node.onMouseDown;

tools.node.onMouseDown = function (event) {
  if (addPointMode) {
    // existing points and handles are still dragged normally
    const onNode = paper.project.hitTest(event.point, {
      segments: true, handles: true, tolerance: 12 / paper.view.zoom
    });
    if (!onNode) {
      const tol = 16 / paper.view.zoom;
      let found = nearestOnPaths(allPathsFrom(selection, []), event.point, tol);
      if (!found) found = nearestOnPaths(allPathsFrom(leafItemsTopDown(), []), event.point, tol);
      if (found) {
        const path = found.path;
        const top = topLevelItem(path);
        if (selection.indexOf(top) < 0) setSelection([top]);
        path.fullySelected = true;
        clearRound(path);
        const seg = path.divideAt(found.loc);
        if (seg) {
          nodeHit = { type: 'segment', segment: seg, item: path };
          nodeSel = seg;
          nodeMoved = true;          // makes mouse-up save the change
          return;
        }
      }
    }
  }
  _nodeDown(event);
};

wire('node-add', function () {
  const btn = document.getElementById('node-add');
  addPointMode = !addPointMode;
  btn.classList.toggle('active', addPointMode);
  if (addPointMode && currentToolName !== 'node') {
    const keep = selection.slice();
    setTool('node');
    setSelection(keep);
    keep.forEach(function (i) { i.fullySelected = true; });
  }
  say(addPointMode ? 'Add point mode ON: tap a line' : 'Add point mode off');
});

// ----- Insert a point in the middle of every segment -----
wire('node-insert', function () {
  const paths = allPathsFrom(selection, []);
  if (!paths.length) { say('Select a path first'); return; }
  paths.forEach(function (p) {
    clearRound(p);
    p.curves.slice().forEach(function (c) { c.divideAtTime(0.5); });
    if (currentToolName === 'node') p.fullySelected = true;
  });
  saveState();
});

// ----- Delete point / smooth <-> corner -----
wire('node-del', function () {
  if (nodeSel && nodeSel.path) removeNode(nodeSel);
  else say('Tap a point with the Node tool first');
});

wire('node-type', function () {
  if (!(nodeSel && nodeSel.path)) { say('Tap a point with the Node tool first'); return; }
  const seg = nodeSel;
  clearRound(seg.path);
  if (seg.handleIn.isZero() && seg.handleOut.isZero()) {
    seg.smooth();
  } else {
    seg.handleIn = new paper.Point(0, 0);
    seg.handleOut = new paper.Point(0, 0);
  }
  saveState();
});

// ----- Copy / Cut / Paste -----
let clipboard = [], pasteCount = 0;

function copySelection() {
  if (!selection.length) { say('Select something first'); return false; }
  clipboard = selection.map(function (i) { return i.clone({ insert: false }); });
  pasteCount = 0;
  say('Copied ' + clipboard.length + ' object(s)');
  return true;
}

function cutSelection() {
  if (copySelection()) deleteObject();
}

function pasteClipboard() {
  if (!clipboard.length) { say('Nothing copied yet'); return; }
  pasteCount++;
  const off = new paper.Point(20 * pasteCount, 20 * pasteCount);
  const layer = paper.project.activeLayer;
  const map = {};
  const pasted = clipboard.map(function (src) {
    const c = src.clone({ insert: false });
    layer.addChild(c);
    if (c.data.uid) {
      const old = c.data.uid;
      c.data.uid = newUid();
      map[old] = c.data.uid;
    }
    c.position = c.position.add(off);
    c.name = (src.name || 'Object') + ' copy';
    return c;
  });
  pasted.forEach(function (c) {
    const p = c.data.parent;
    if (!p) return;
    if (map[p]) c.data.parent = map[p];
    else delete c.data.parent;        // parent was not copied
  });
  setSelection(pasted);
  saveState();
}

wire('cb-copy', copySelection);
wire('cb-cut', cutSelection);
wire('cb-paste', pasteClipboard);

// ----- Nudge (arrow keys + buttons) -----
let nudgeTimer = null;
function nudge(dx, dy) {
  if (!selection.length) return;
  selection.forEach(function (i) { i.position = i.position.add(new paper.Point(dx, dy)); });
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(saveState, 400);   // one undo step per burst
}
function nudgeStep() {
  return Number(document.getElementById('nudge-step').value) || 1;
}
wire('nd-left',  function () { nudge(-nudgeStep(), 0); });
wire('nd-right', function () { nudge(nudgeStep(), 0); });
wire('nd-up',    function () { nudge(0, -nudgeStep()); });
wire('nd-down',  function () { nudge(0, nudgeStep()); });

document.addEventListener('keydown', function (e) {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const key = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && !e.shiftKey && !e.altKey) {
    if (key === 'c') { e.preventDefault(); copySelection(); }
    else if (key === 'x') { e.preventDefault(); cutSelection(); }
    else if (key === 'v') { e.preventDefault(); pasteClipboard(); }
    return;
  }
  if (!ctrl && key.indexOf('arrow') === 0 && selection.length) {
    e.preventDefault();
    const s = nudgeStep() * (e.shiftKey ? 10 : 1);
    nudge(key === 'arrowleft' ? -s : key === 'arrowright' ? s : 0,
          key === 'arrowup' ? -s : key === 'arrowdown' ? s : 0);
  }
});

// ======================================================
// DAY 4: ANIMATION SYSTEM
// ======================================================
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var say = function (m) { if (window.toast) window.toast(m); };
  var tlScroll = $('tl-scroll'), tlCanvas = $('tl-canvas'), tlBar = $('tl-bar');
  if (!tlScroll || !tlCanvas || !tlBar) return;

  var anim = { length: 24, fps: 12, loop: true, onion: false, onB: 2, onA: 2, ease: 'smooth', auto: false };
  var curFrame = 0, playing = false, playAcc = 0, applying = false;
  var keyClip = null, tlDirty = true, tlRows = [], tlDrag = null, tlMode = null;
  var TL = { labelW: 150, ruler: 26, row: 26, cell: 16 };

  var tlFrame = $('tl-frame'), tlLength = $('tl-length'), tlFps = $('tl-fps'), tlEase = $('tl-ease');
  var tlLoop = $('tl-loop'), tlOnion = $('tl-onion'), tlOnb = $('tl-onb'), tlOna = $('tl-ona');

  // ---------- extra UI ----------
  ['in:Ease in', 'out:Ease out', 'bounce:Bounce'].forEach(function (s) {
    var p = s.split(':');
    if (!tlEase.querySelector('option[value="' + p[0] + '"]')) {
      var o = document.createElement('option'); o.value = p[0]; o.textContent = p[1]; tlEase.appendChild(o);
    }
  });
  function addBtn(id, text, title) {
    var b = document.createElement('button'); b.id = id; b.textContent = text; b.title = title;
    tlBar.appendChild(b); return b;
  }
  var autoBtn = addBtn('tl-auto', '● Auto key', 'When on, every change to the selected objects is keyed at this frame');
  addBtn('tl-zoom-out', '🔍−', 'Zoom the timeline out');
  addBtn('tl-zoom-in', '🔍＋', 'Zoom the timeline in');
  var statusEl = document.createElement('span'); statusEl.id = 'tl-status'; tlBar.appendChild(statusEl);
  var tlSpace = document.createElement('div'); tlSpace.id = 'tl-space'; tlScroll.appendChild(tlSpace);

  var onionCv = document.createElement('canvas');
  onionCv.id = 'onion-canvas';
  canvasArea.appendChild(onionCv);

   // ---------- maths ----------
  function bezEase(t, kind) {
    var q = kind.slice(4).split(',').map(Number);
    var x1 = q[0], y1 = q[1], x2 = q[2], y2 = q[3];
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    var lo = 0, hi = 1, s = t, x;
    for (var i = 0; i < 24; i++) {
      s = (lo + hi) / 2;
      x = 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
      if (x < t) lo = s; else hi = s;
    }
    return 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
  }
  function easeT(t, kind) {
    if (typeof kind === 'string' && kind.indexOf('bez:') === 0) return bezEase(t, kind);
    switch (kind) {
      case 'linear': return t;
      case 'step': return 0;
      case 'in': return t * t;
      case 'out': return 1 - (1 - t) * (1 - t);
      case 'bounce':
        var n = 7.5625, d = 2.75;
        if (t < 1 / d) return n * t * t;
        if (t < 2 / d) { t -= 1.5 / d; return n * t * t + 0.75; }
        if (t < 2.5 / d) { t -= 2.25 / d; return n * t * t + 0.9375; }
        t -= 2.625 / d; return n * t * t + 0.984375;
      default: return t * t * (3 - 2 * t);
    }
  }
  function poseOf(item) { return mxFrom(item.data && item.data.pose); }

  // ----- what can be animated -----
  function hasLook(item) {
    return item.className === 'Path' || item.className === 'CompoundPath' ||
           item.className === 'PointText' || item.className === 'Shape';
  }
  function morphable(item) { return item.className === 'Path' || item.className === 'CompoundPath'; }
  function pathsOf(item) { return item.className === 'CompoundPath' ? item.children.slice() : [item]; }

  // ----- colors -----
  function colArr(c) {
    if (!c || c.type === 'gradient') return null;
    var r = c.type === 'rgb' ? c : c.convert('rgb');
    return [r.red, r.green, r.blue, r.alpha == null ? 1 : r.alpha];
  }
  function readLook(item) {
    if (!hasLook(item)) return null;
    var f = item.fillColor, sc = item.strokeColor;
    var o = { look: 1, fc: null, fg: null, sc: colArr(sc), sg: !!(sc && sc.type === 'gradient'), lw: item.strokeWidth || 0 };
    if (f && f.type === 'gradient') {
      var n = f.gradient.stops.length;
      o.fg = f.gradient.stops.map(function (s) { return colArr(s.color); });
      o.fo = f.gradient.stops.map(function (s, i) { return s.offset == null ? i / Math.max(1, n - 1) : s.offset; });
      o.fr = !!f.gradient.radial;
      var inv = poseOf(item).inverted();
      if (inv && f.origin && f.destination) {
        var a0 = inv.transform(f.origin), a1 = inv.transform(f.destination);
        o.go = [a0.x, a0.y]; o.gd = [a1.x, a1.y];
      }
    } else if (f) {
      o.fc = colArr(f);
    }
    return o;
  }
  function lerpCol(a, b, t) {
    if (!a && !b) return null;
    var A = a || [b[0], b[1], b[2], 0], B = b || [a[0], a[1], a[2], 0];
    return [0, 1, 2, 3].map(function (n) { return A[n] + (B[n] - A[n]) * t; });
  }
  function lerpStops(a, b, t) {
    if (!a || !b || a.length !== b.length) return a;
    return a.map(function (c, i) { return lerpCol(c, b[i], t); });
  }
  function applyLook(item, k) {
    if (!k.look || !hasLook(item)) return;
    var cc = function (a) { return new paper.Color(a[0], a[1], a[2], a[3]); };
    var f = item.fillColor;
    if (k.fg) {
      var hasGeo = k.go && k.gd;
      var same = f && f.type === 'gradient' && f.gradient.stops.length === k.fg.length;
      if (hasGeo || same) {
        var M = poseOf(item);
        var og = hasGeo ? M.transform(new paper.Point(k.go[0], k.go[1])) : f.origin;
        var de = hasGeo ? M.transform(new paper.Point(k.gd[0], k.gd[1])) : f.destination;
        var rad = (k.fr != null) ? k.fr : (f && f.type === 'gradient' ? f.gradient.radial : false);
        item.fillColor = {
          gradient: {
            stops: k.fg.map(function (a, i) {
              var off = k.fo ? Math.min(1, Math.max(i === 0 ? 0 : 0.001, k.fo[i])) : null;
              return off == null ? cc(a) : [cc(a), off];
            }),
            radial: !!rad
          },
          origin: og, destination: de
        };
      }
    } else if (k.fc) {
      item.fillColor = cc(k.fc);
    } else if (f) {
      item.fillColor = null;
    }
    if (!k.sg) item.strokeColor = k.sc ? cc(k.sc) : null;   // gradient strokes are left alone
    item.strokeWidth = k.lw || 0;
  }

  // ----- shape (point positions) -----
  function readShape(item) {
    var inv = poseOf(item).inverted();
    if (!inv) return null;
    var m0 = new paper.Matrix(inv.a, inv.b, inv.c, inv.d, 0, 0);
    return pathsOf(item).map(function (p) {
      return p.segments.map(function (s) {
        var pt = inv.transform(s.point), hi = m0.transform(s.handleIn), ho = m0.transform(s.handleOut);
        return [pt.x, pt.y, hi.x, hi.y, ho.x, ho.y];
      });
    });
  }
  function sameShape(a, b, eps) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].length !== b[i].length) return false;
      for (var j = 0; j < a[i].length; j++)
        for (var n = 0; n < 6; n++)
          if (Math.abs(a[i][j][n] - b[i][j][n]) > eps) return false;
    }
    return true;
  }
  function lerpShape(a, b, t) {
    if (!a || !b) return a || b;
    if (a.length !== b.length) return a;
    for (var i = 0; i < a.length; i++) if (a[i].length !== b[i].length) return a;
    return a.map(function (pa, i) {
      return pa.map(function (sa, j) {
        var sb = b[i][j];
        return sa.map(function (v, n) { return v + (sb[n] - v) * t; });
      });
    });
  }
  function shapeOf(item, k) { return (k && k.shape) || (item.data && item.data.rest) || null; }
  function writeShape(item, shape, M) {
    var ps = pathsOf(item);
    if (!shape || ps.length !== shape.length) return false;
    var m0 = new paper.Matrix(M.a, M.b, M.c, M.d, 0, 0);
    var P = function (s) { return M.transform(new paper.Point(s[0], s[1])); };
    var HI = function (s) { return m0.transform(new paper.Point(s[2], s[3])); };
    var HO = function (s) { return m0.transform(new paper.Point(s[4], s[5])); };
    ps.forEach(function (p, i) {
      var S = shape[i], segs = p.segments;
      if (segs.length === S.length) {
        for (var j = 0; j < S.length; j++) {
          segs[j].point = P(S[j]);
          segs[j].handleIn = HI(S[j]);
          segs[j].handleOut = HO(S[j]);
        }
      } else {
        p.segments = S.map(function (s) { return new paper.Segment(P(s), HI(s), HO(s)); });
      }
    });
    return true;
  }

  // ----- keys -----
  function captureKey(item) {
    var M = poseOf(item), inv = M.inverted();
    var pv = getPivot(item);
    var q = inv ? inv.transform(pv) : pv;
    var sx = Math.hypot(M.a, M.b) || 1e-6;
    var k = {
      x: pv.x, y: pv.y, qx: q.x, qy: q.y,
      r: Math.atan2(M.b, M.a) * 180 / Math.PI,
      sx: sx,
      sy: (M.a * M.d - M.b * M.c) / sx,
      sh: (M.a * M.c + M.b * M.d) / sx,          // skew
      o: item.opacity, e: anim.ease,
      sw: item.data.swGroup ? item.data.swActive : null
    };
    var look = readLook(item);
    if (look) Object.assign(k, look);
    if (morphable(item)) k.shape = readShape(item);
    return k;
  }
  function buildPose(k) {
    var rad = k.r * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad), sh = k.sh || 0;
    var a = c * k.sx, b = s * k.sx, cc = c * sh - s * k.sy, d = s * sh + c * k.sy;
    return new paper.Matrix(a, b, cc, d, k.x - (a * k.qx + cc * k.qy), k.y - (b * k.qx + d * k.qy));
  }
  function framesOf(item) {
    var ks = item.data && item.data.keys;
    return ks ? Object.keys(ks).map(Number).sort(function (a, b) { return a - b; }) : [];
  }
  function evalItem(item, f) {
    var fr = framesOf(item);
    if (!fr.length) return null;
    var ks = item.data.keys;
    if (f <= fr[0]) return ks[fr[0]];
    if (f >= fr[fr.length - 1]) return ks[fr[fr.length - 1]];
    var i = 0;
    while (i < fr.length - 1 && fr[i + 1] <= f) i++;
    var a = fr[i], b = fr[i + 1], A = ks[a], B = ks[b];
    var t = easeT((f - a) / (b - a), A.e);
    var L = function (p, q) { return p + (q - p) * t; };
    var out = {
      x: L(A.x, B.x), y: L(A.y, B.y), r: L(A.r, B.r),
      sx: L(A.sx, B.sx), sy: L(A.sy, B.sy), sh: L(A.sh || 0, B.sh || 0),
      qx: L(A.qx, B.qx), qy: L(A.qy, B.qy),
      o: (A.o == null || B.o == null) ? A.o : L(A.o, B.o), sw: A.sw, e: A.e
    };
    if (item.data.morph) out.shape = lerpShape(shapeOf(item, A), shapeOf(item, B), t);
     if (A.look && B.look) {
      out.look = 1;
      out.lw = L(A.lw || 0, B.lw || 0);
      out.sc = lerpCol(A.sc, B.sc, t);
      out.sg = A.sg;
      if ((A.fg && !B.fg) || (!A.fg && B.fg)) {                 // gradient <-> solid: hold
        out.fc = A.fc; out.fg = A.fg; out.fo = A.fo; out.fr = A.fr; out.go = A.go; out.gd = A.gd;
      } else {
        out.fc = lerpCol(A.fc, B.fc, t);
        out.fg = lerpStops(A.fg, B.fg, t);
        if (out.fg) {
          out.fr = A.fr;
          out.fo = (A.fo && B.fo && A.fo.length === B.fo.length) ? A.fo.map(function (v, i) { return L(v, B.fo[i]); }) : A.fo;
          out.go = (A.go && B.go) ? [L(A.go[0], B.go[0]), L(A.go[1], B.go[1])] : A.go;
          out.gd = (A.gd && B.gd) ? [L(A.gd[0], B.gd[0]), L(A.gd[1], B.gd[1])] : A.gd;
        }
      }
    } else if (A.look) {
      out.look = 1; out.fc = A.fc; out.fg = A.fg; out.fo = A.fo; out.fr = A.fr; out.go = A.go; out.gd = A.gd;
      out.sc = A.sc; out.sg = A.sg; out.lw = A.lw;
    }
  }
  function applyState(item, k) {
    var M = buildPose(k), done = false;
    var sh = k.shape || (item.data.morph ? item.data.rest : null);
    if (sh && morphable(item)) {
      done = writeShape(item, sh, M);
      if (done && item.data.origSegs) { delete item.data.origSegs; delete item.data.cornerR; }
    }
    if (!done) {
      var Pinv = poseOf(item).inverted();
      if (Pinv) {
        var D = M.clone().append(Pinv);
        animating = true;
        try { item.transform(D); } finally { animating = false; }
      }
    }
    item.data.pose = mxArr(M);
    item.data.pivot = [k.x, k.y];
    if (k.o != null) item.opacity = k.o;
    if (k.sw != null && item.data.swGroup) {
      item.data.swActive = k.sw;
      item.visible = (item.data.swIdx === k.sw);
    }
    applyLook(item, k);
  }
  function applyFrame(f) {
    allTopItems().forEach(function (it) {
      if (it.data && it.data.keys) {
        var k = evalItem(it, f);
        if (k) applyState(it, k);
      }
    });
    paper.project._needsUpdate = true;
  }

  // ---------- keys ----------
  function keyTargets() {
    var out = [];
    function add(i) { if (i && out.indexOf(i) < 0) out.push(i); }
    function kids(i) {
      childrenOf(i).forEach(function (c) { if (out.indexOf(c) < 0) { out.push(c); kids(c); } });
    }
    selection.forEach(function (s) {
      var t = topLevelItem(s);
      add(t); kids(t);
      var g = t.data && t.data.swGroup;
      if (g) allTopItems().forEach(function (i) { if (i.data && i.data.swGroup === g) add(i); });
    });
    return out;
  }
  function setKeys(items, f) {
    items.forEach(function (it) {
      if (!it.data) return;
      var ks = it.data.keys || (it.data.keys = {});
      var k = captureKey(it);
      if (k.shape) {
        if (!it.data.rest) it.data.rest = k.shape;                 // the first key defines the rest shape
        if (sameShape(k.shape, it.data.rest, 0.05)) delete k.shape; // unchanged shape is not stored
        else it.data.morph = true;
      }
      if (ks[f] && ks[f].e) k.e = ks[f].e;
      var fr = framesOf(it).filter(function (x) { return x !== f; }), ref = null;
      fr.forEach(function (x) { if (x < f && (ref === null || x > ref)) ref = x; });
      if (ref === null) fr.forEach(function (x) { if (x > f && (ref === null || x < ref)) ref = x; });
      if (ref !== null) k.r += 360 * Math.round((ks[ref].r - k.r) / 360);   // keep spins continuous
      ks[f] = k;
    });
  }
  function commit() { applying = true; saveState(); applying = false; }

  function doKey() {
    if (!selection.length) { say('Select an object first'); return; }
    setKeys(keyTargets(), curFrame);
    commit(); tlDirty = true; renderOnion();
    say('Key set at frame ' + curFrame);
  }
  function doKeyAll() {
    setKeys(allTopItems(), curFrame);
    commit(); tlDirty = true; renderOnion();
    say('Keyed every object at frame ' + curFrame);
  }
  function forgetIfEmpty(it) {
    if (it.data.keys && !Object.keys(it.data.keys).length) delete it.data.keys;
    if (!it.data.keys) { delete it.data.rest; delete it.data.morph; }
  }
  function doDelKey() {
    var any = false;
    keyTargets().forEach(function (it) {
      var ks = it.data.keys;
      if (ks && ks[curFrame]) { delete ks[curFrame]; any = true; forgetIfEmpty(it); }
    });
    if (any) { applyFrame(curFrame); commit(); tlDirty = true; renderOnion(); }
  }
  function doClear() {
    var targets = keyTargets();
    targets.forEach(function (it) { delete it.data.keys; forgetIfEmpty(it); });
    if (targets.length) { commit(); tlDirty = true; renderOnion(); say('Keys cleared'); }
  }
  function copyKeys() {
    var clip = selection.map(function (it) {
      var k = it.data.keys && it.data.keys[curFrame];
      return k ? { k: JSON.parse(JSON.stringify(k)), src: it } : null;
    });
    if (!clip.some(function (c) { return c; })) { say('No key at this frame to copy'); return; }
    keyClip = clip; say('Key copied');
  }
  function pasteKeys() {
    if (!keyClip || !selection.length) { say('Copy a key first, then select objects'); return; }
    selection.forEach(function (it, i) {
      var c = keyClip[i % keyClip.length];
      if (!c) return;
      var k = JSON.parse(JSON.stringify(c.k));
      if (k.shape && (c.src !== it || !it.data.rest)) delete k.shape;   // shapes only paste onto the same object
      else if (k.shape) it.data.morph = true;
      (it.data.keys || (it.data.keys = {}))[curFrame] = k;
    });
    applyFrame(curFrame); commit(); tlDirty = true; renderOnion();
  }

  // ---------- frame control + playback ----------
  function clampF(f) { return Math.max(0, Math.min(anim.length - 1, Math.round(Number(f) || 0))); }
  function setFrame(f, noOnion) {
    curFrame = clampF(f);
    tlFrame.value = curFrame;
    applyFrame(curFrame);
    tlDirty = true;
    if (!noOnion) renderOnion();
  }
  function setPlaying(on) {
    playing = on; playAcc = 0;
    $('tl-play').textContent = on ? '⏸ Pause' : '▶ Play';
    if (on) {
      if (!anim.loop && curFrame >= anim.length - 1) setFrame(0, true);
      onionCv.getContext('2d').clearRect(0, 0, onionCv.width, onionCv.height);
    } else renderOnion();
  }

  // ---------- onion skin ----------
  function renderOnion() {
    var vw = paper.view.element.width, vh = paper.view.element.height;
    if (onionCv.width !== vw || onionCv.height !== vh) { onionCv.width = vw; onionCv.height = vh; }
    onionCv.style.width = canvasEl.clientWidth + 'px';
    onionCv.style.height = canvasEl.clientHeight + 'px';
    var ctx = onionCv.getContext('2d');
    ctx.clearRect(0, 0, vw, vh);
    if (!anim.onion || playing) return;
    var items = allTopItems();
    if (!items.some(function (i) { return i.data && i.data.keys; })) return;

    var targets = [], d;
    for (d = 1; d <= anim.onB; d++) targets.push([curFrame - d, 0.3 / d]);
    for (d = 1; d <= anim.onA; d++) targets.push([curFrame + d, 0.3 / d]);

    var sel = selection.slice(), hidden = [];
    items.forEach(function (i) {
      if (!(i.data && i.data.keys) && i.visible) { i.visible = false; hidden.push(i); }
    });
    paper.project.deselectAll();
    targets.forEach(function (t) {
      if (t[0] < 0 || t[0] >= anim.length) return;
      applyFrame(t[0]);
      paper.view.update();
      ctx.globalAlpha = t[1];
      ctx.drawImage(paper.view.element, 0, 0);
    });
    ctx.globalAlpha = 1;
    hidden.forEach(function (i) { i.visible = true; });
    applyFrame(curFrame);
    sel.forEach(function (i) { i.selected = true; });
    paper.view.update();
  }

  // ---------- switch groups (change faces) ----------
  function swMembers(item) {
    var g = item && item.data && item.data.swGroup;
    if (!g) return [];
    return allTopItems().filter(function (i) { return i.data && i.data.swGroup === g; })
      .sort(function (a, b) { return a.data.swIdx - b.data.swIdx; });
  }
  function swShow(item, idx) {
    swMembers(item).forEach(function (i) { i.data.swActive = idx; i.visible = (i.data.swIdx === idx); });
    renderLayers();
  }
  wire('sw-make', function () {
    if (selection.length < 2) { say('Select 2 or more objects first'); return; }
    var gid = newUid();
    var items = selection.slice().sort(function (a, b) { return (a.layer.index - b.layer.index) || (a.index - b.index); });
    items.forEach(function (it, i) {
      it.data.swGroup = gid; it.data.swIdx = i; it.data.swActive = 0; it.visible = (i === 0);
    });
    renderLayers(); saveState(); say('Switch made with ' + items.length + ' parts');
  });
  wire('sw-undo', function () {
    selection.forEach(function (it) {
      swMembers(it).forEach(function (m) {
        delete m.data.swGroup; delete m.data.swIdx; delete m.data.swActive; m.visible = true;
      });
    });
    renderLayers(); saveState();
  });
  function swStep(dir) {
    var it = selectedItem && topLevelItem(selectedItem), m = swMembers(it);
    if (!m.length) { say('Select a switch part first'); return; }
    swShow(it, (it.data.swActive + dir + m.length) % m.length);
    saveState(); tlDirty = true;
  }
  wire('sw-prev', function () { swStep(-1); });
  wire('sw-next', function () { swStep(1); });

  // ---------- timeline drawing ----------
  function depthOf(item) {
    var d = 0, p = item.data && item.data.parent ? findByUid(item.data.parent) : null;
    while (p && d < 10) { d++; p = p.data && p.data.parent ? findByUid(p.data.parent) : null; }
    return d;
  }
  function buildRows() {
    var rows = [], layers = paper.project.layers;
    for (var i = layers.length - 1; i >= 0; i--) {
      for (var j = layers[i].children.length - 1; j >= 0; j--) rows.push({ item: layers[i].children[j] });
    }
    return rows;
  }
  function drawTimeline() {
    tlDirty = false;
    var W = tlScroll.clientWidth, H = tlScroll.clientHeight;
    if (W < 40 || H < 30) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var bw = Math.round(W * dpr), bh = Math.round(H * dpr);
    if (tlCanvas.width !== bw || tlCanvas.height !== bh) {
      tlCanvas.width = bw; tlCanvas.height = bh;
      tlCanvas.style.width = W + 'px'; tlCanvas.style.height = H + 'px';
    }
    tlRows = buildRows();
    var cell = TL.cell, LW = TL.labelW, RH = TL.ruler, ROW = TL.row;
    tlSpace.style.width = (LW + anim.length * cell + 60) + 'px';
    tlSpace.style.height = (RH + tlRows.length * ROW + 10) + 'px';
    tlSpace.style.marginTop = (-H) + 'px';
    var sx = tlScroll.scrollLeft, sy = tlScroll.scrollTop;
    var c = tlCanvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#252525'; c.fillRect(0, 0, W, H);
    c.font = '11px system-ui, sans-serif'; c.textBaseline = 'middle';
    var fx = function (f) { return LW + f * cell - sx; };

    // rows
    tlRows.forEach(function (r, i) {
      var y = RH + i * ROW - sy;
      if (y > H || y + ROW < RH) return;
      c.fillStyle = selection.indexOf(r.item) >= 0 ? '#1f3a6e' : (i % 2 ? '#2a2a2a' : '#262626');
      c.fillRect(LW, y, W - LW, ROW);
    });
    // area after the last frame
    c.fillStyle = 'rgba(0,0,0,.35)';
    if (fx(anim.length) < W) c.fillRect(fx(anim.length), RH, W - fx(anim.length), H - RH);
    // grid
    var f0 = Math.max(0, Math.floor(sx / cell)), f1 = Math.min(anim.length, Math.ceil((sx + W - LW) / cell));
    for (var f = f0; f <= f1; f++) {
      c.strokeStyle = (f % anim.fps === 0) ? '#555' : '#333';
      c.beginPath(); c.moveTo(Math.round(fx(f)) + .5, RH); c.lineTo(Math.round(fx(f)) + .5, H); c.stroke();
    }
    // playhead column
    c.fillStyle = 'rgba(255,59,59,.18)';
    c.fillRect(fx(curFrame), RH, cell, H - RH);
    // keys
    tlRows.forEach(function (r, i) {
      var y = RH + i * ROW - sy;
      if (y > H || y + ROW < RH) return;
      var ks = r.item.data && r.item.data.keys;
      if (!ks) return;
      var fr = framesOf(r.item), sel = selection.indexOf(r.item) >= 0, cy = y + ROW / 2;
      var pos = fr.map(function (k) {
        return (tlDrag && tlDrag.item === r.item && k === tlDrag.from) ? tlDrag.to : k;
      });
      c.fillStyle = '#666';
      for (var n = 0; n < pos.length - 1; n++) {
        c.fillRect(fx(pos[n]) + cell / 2, cy - 2, (pos[n + 1] - pos[n]) * cell, 4);
      }
      pos.forEach(function (k) {
        var cx = fx(k) + cell / 2;
        if (cx < LW - 8 || cx > W + 8) return;
        c.beginPath();
        c.moveTo(cx, cy - 6); c.lineTo(cx + 6, cy); c.lineTo(cx, cy + 6); c.lineTo(cx - 6, cy); c.closePath();
        c.fillStyle = sel ? '#ffd27a' : '#ff9f1c'; c.fill();
        c.strokeStyle = '#000'; c.stroke();
      });
    });
    // ruler
    c.fillStyle = '#1e1e1e'; c.fillRect(LW, 0, W - LW, RH);
    var stepN = [1, 2, 5, 10, 20, 50, 100].filter(function (s) { return s * cell >= 30; })[0] || 100;
    c.fillStyle = '#aaa'; c.textAlign = 'center';
    for (var g = f0; g < f1; g++) {
      if (g % stepN === 0) c.fillText(String(g), fx(g) + cell / 2, 9);
      c.fillStyle = '#777'; c.fillRect(Math.round(fx(g) + cell / 2), RH - 6, 1, 6); c.fillStyle = '#aaa';
    }
    // playhead
    c.fillStyle = '#ff3b3b';
    c.fillRect(fx(curFrame), RH - 12, cell, 12);
    c.fillStyle = '#fff'; c.fillText(String(curFrame), fx(curFrame) + cell / 2, RH - 6);
    c.fillStyle = '#ff3b3b'; c.fillRect(Math.round(fx(curFrame) + cell / 2), RH, 1, H - RH);
    // labels (sticky)
    c.textAlign = 'left';
    c.fillStyle = '#2b2b2b'; c.fillRect(0, 0, LW, H);
    tlRows.forEach(function (r, i) {
      var y = RH + i * ROW - sy;
      if (y > H || y + ROW < RH) return;
      var sel = selection.indexOf(r.item) >= 0;
      c.fillStyle = sel ? '#1f4fa8' : (i % 2 ? '#2f2f2f' : '#2b2b2b');
      c.fillRect(0, y, LW, ROW);
      c.save(); c.beginPath(); c.rect(0, y, LW - 4, ROW); c.clip();
      c.fillStyle = r.item.visible ? '#ddd' : '#777';
      var dep = depthOf(r.item) * 10;
      c.fillText((r.item.data.icon || '◆') + ' ' + (r.item.name || 'Object'), 8 + dep, y + ROW / 2);
      c.restore();
    });
    c.fillStyle = '#1e1e1e'; c.fillRect(0, 0, LW, RH);
    c.fillStyle = '#888'; c.fillText('Objects', 8, RH / 2);
    c.fillStyle = '#111'; c.fillRect(LW - 1, 0, 1, H);
  }

  // ---------- timeline touch / mouse ----------
  var tlPtrs = {};
  function centroid() {
    var ids = Object.keys(tlPtrs), x = 0, y = 0;
    ids.forEach(function (k) { x += tlPtrs[k].x; y += tlPtrs[k].y; });
    return { x: x / ids.length, y: y / ids.length };
  }
  function frameAt(e) {
    var r = tlCanvas.getBoundingClientRect();
    return Math.floor((e.clientX - r.left - TL.labelW + tlScroll.scrollLeft) / TL.cell);
  }
  tlCanvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    tlCanvas.setPointerCapture(e.pointerId);
    tlPtrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (Object.keys(tlPtrs).length >= 2) { tlMode = 'scroll'; tlDrag = null; return; }
    var r = tlCanvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    var f = frameAt(e);
    if (py < TL.ruler) {
      if (px >= TL.labelW) { tlMode = 'scrub'; setFrame(f); }
      return;
    }
    var row = tlRows[Math.floor((py - TL.ruler + tlScroll.scrollTop) / TL.row)];
    if (!row) return;
    if (selection.indexOf(row.item) < 0 || currentToolName !== 'select') selectItem(row.item);
    if (px < TL.labelW) return;
    if (f < 0 || f >= anim.length) return;
    var ks = row.item.data.keys;
    if (ks && ks[f]) { tlMode = 'keydrag'; tlDrag = { item: row.item, from: f, to: f }; }
    else tlMode = 'scrub';
    setFrame(f);
  });
  tlCanvas.addEventListener('pointermove', function (e) {
    var p = tlPtrs[e.pointerId];
    if (!p) return;
    if (Object.keys(tlPtrs).length >= 2) {
      var before = centroid();
      p.x = e.clientX; p.y = e.clientY;
      var after = centroid();
      tlScroll.scrollLeft -= after.x - before.x;
      tlScroll.scrollTop -= after.y - before.y;
      tlDirty = true;
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    var f = clampF(frameAt(e));
    if (tlMode === 'scrub') setFrame(f);
    else if (tlMode === 'keydrag' && tlDrag) { tlDrag.to = f; setFrame(f, true); }
  });
  function tlEnd(e) {
    delete tlPtrs[e.pointerId];
    if (Object.keys(tlPtrs).length) return;
    if (tlMode === 'keydrag' && tlDrag && tlDrag.to !== tlDrag.from) {
      var ks = tlDrag.item.data.keys;
      if (ks && ks[tlDrag.from]) {
        ks[tlDrag.to] = ks[tlDrag.from];
        delete ks[tlDrag.from];
        applyFrame(curFrame);
        commit();
      }
    }
    tlDrag = null; tlMode = null; tlDirty = true; renderOnion();
  }
  tlCanvas.addEventListener('pointerup', tlEnd);
  tlCanvas.addEventListener('pointercancel', tlEnd);

  tlScroll.addEventListener('scroll', function () { tlDirty = true; });
  tlScroll.addEventListener('wheel', function (e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    TL.cell = Math.max(5, Math.min(60, TL.cell * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    tlDirty = true;
  }, { passive: false });
  new ResizeObserver(function () { tlDirty = true; }).observe(tlScroll);

  // ---------- controls ----------
  function syncInputs() {
    tlLength.value = anim.length; tlFps.value = anim.fps; tlLoop.checked = !!anim.loop;
    tlOnion.checked = !!anim.onion; tlOnb.value = anim.onB; tlOna.value = anim.onA;
    tlEase.value = anim.ease; autoBtn.classList.toggle('active', !!anim.auto);
    var to = $('ss-to'); if (to && Number(to.value) > anim.length - 1) to.value = anim.length - 1;
  }
  wire('tl-first', function () { setFrame(0); });
  wire('tl-prev', function () { setFrame(curFrame - 1); });
  wire('tl-next', function () { setFrame(curFrame + 1); });
  wire('tl-play', function () { setPlaying(!playing); });
  tlFrame.addEventListener('change', function () { setFrame(tlFrame.value); });
  tlLength.addEventListener('change', function () {
    anim.length = Math.max(1, Math.min(600, Math.round(Number(tlLength.value) || 24)));
    syncInputs();
    if (curFrame >= anim.length) setFrame(anim.length - 1);
    tlDirty = true;
  });
  tlFps.addEventListener('change', function () {
    anim.fps = Math.max(1, Math.min(60, Math.round(Number(tlFps.value) || 12)));
    syncInputs();
  });
  tlLoop.addEventListener('change', function () { anim.loop = tlLoop.checked; });
  tlOnion.addEventListener('change', function () { anim.onion = tlOnion.checked; renderOnion(); });
  tlOnb.addEventListener('change', function () { anim.onB = Math.max(0, Math.min(6, Number(tlOnb.value) || 0)); renderOnion(); });
  tlOna.addEventListener('change', function () { anim.onA = Math.max(0, Math.min(6, Number(tlOna.value) || 0)); renderOnion(); });
  tlEase.addEventListener('change', function () {
    anim.ease = tlEase.value;
    var changed = false;
    keyTargets().forEach(function (it) {
      var k = it.data.keys && it.data.keys[curFrame];
      if (k) { k.e = anim.ease; changed = true; }
    });
    if (changed) { applyFrame(curFrame); commit(); tlDirty = true; say('Motion changed for this key'); }
  });
  wire('tl-key', doKey);
  wire('tl-keyall', doKeyAll);
  wire('tl-delkey', doDelKey);
  wire('tl-clear', doClear);
  wire('tl-copykey', copyKeys);
  wire('tl-pastekey', pasteKeys);
  wire('tl-auto', function () {
    anim.auto = !anim.auto; autoBtn.classList.toggle('active', anim.auto);
    say(anim.auto ? 'Auto key ON: every change is keyed' : 'Auto key off');
  });
  wire('tl-zoom-in', function () { TL.cell = Math.min(60, TL.cell * 1.3); tlDirty = true; });
  wire('tl-zoom-out', function () { TL.cell = Math.max(5, TL.cell / 1.3); tlDirty = true; });

  document.addEventListener('keydown', function (e) {
    var tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.code === 'Space' && e.shiftKey) {
      e.preventDefault(); e.stopImmediatePropagation(); setPlaying(!playing); return;
    }
    if (e.altKey && e.code === 'KeyC') { e.preventDefault(); copyKeys(); return; }
    if (e.altKey && e.code === 'KeyV') { e.preventDefault(); pasteKeys(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key.toLowerCase();
    if (k === 'j') doKey();
    else if (e.key === ',') setFrame(curFrame - 1);
    else if (e.key === '.') setFrame(curFrame + 1);
  }, true);

  // ---------- status text ----------
  function currentDiffers(it) {
    var ev = evalItem(it, curFrame), cu = captureKey(it);
    if (!ev) return false;
    var rd = Math.abs((((ev.r - cu.r) % 360) + 540) % 360 - 180);
    if (Math.abs(ev.x - cu.x) > 0.5 || Math.abs(ev.y - cu.y) > 0.5 ||
        Math.abs(ev.sx - cu.sx) > 0.01 || Math.abs(ev.sy - cu.sy) > 0.01 ||
        Math.abs((ev.sh || 0) - (cu.sh || 0)) > 0.01 || rd > 0.5) return true;
    if (ev.look && cu.look) {
      var cd = function (a, b) {
        if (!a && !b) return false;
        if (!a || !b) return true;
        for (var n = 0; n < 4; n++) if (Math.abs(a[n] - b[n]) > 0.01) return true;
        return false;
      };
      if (cd(ev.fc, cu.fc) || cd(ev.sc, cu.sc) || Math.abs((ev.lw || 0) - (cu.lw || 0)) > 0.05) return true;
      if (ev.fg && cu.fg && ev.fg.some(function (c, i) { return cd(c, cu.fg[i]); })) return true;
    }
    if (ev.look && cu.look && ev.go && cu.go && ev.gd && cu.gd) {
      var gdiff = function (a, b) { return Math.abs(a[0] - b[0]) > 0.5 || Math.abs(a[1] - b[1]) > 0.5; };
      if (gdiff(ev.go, cu.go) || gdiff(ev.gd, cu.gd)) return true;
      if (ev.fo && cu.fo && ev.fo.length === cu.fo.length &&
          ev.fo.some(function (v, i) { return Math.abs(v - cu.fo[i]) > 0.005; })) return true;
    }

    if (cu.shape) {
      var es = ev.shape || shapeOf(it, ev);
      if (es && !sameShape(es, cu.shape, 0.5)) return true;
    }
    return false;
  }

  function updateStatus() {
    var msg = 'Frame ' + curFrame + ' / ' + (anim.length - 1);
    var it = selection.length ? topLevelItem(selection[0]) : null;
    if (it) {
      var ks = it.data.keys;
      if (!ks || !Object.keys(ks).length) msg += ' · no keys yet. Press ◆ Key (J)';
      else {
        var diff = currentDiffers(it);
        if (ks[curFrame]) msg += diff ? ' · KEY (edited, press ◆ Key to update)' : ' · KEY';
        else msg += diff ? ' · unkeyed change! Press ◆ Key (J) or it is lost' : ' · between keys';
      }
    }
    statusEl.textContent = msg;
    var swl = $('sw-label');
    if (swl) {
      var s = selectedItem && topLevelItem(selectedItem), m = swMembers(s);
      swl.textContent = m.length
        ? 'Showing part ' + (s.data.swActive + 1) + ' of ' + m.length
        : 'Select a switch group to change its shown part.';
    }
  }

  // ---------- frame tick (called by paper.view.onFrame) ----------
  var lastSig = '', lastView = '', tickCount = 0, onionTimer = null;
  window.tickTimeline = function (e) {
    if (playing) {
      playAcc += (e && e.delta) || 0.016;
      var step = 1 / anim.fps, adv = 0;
      while (playAcc >= step) { playAcc -= step; adv++; }
      if (adv) {
        var f = curFrame + adv;
        if (f >= anim.length) {
          if (anim.loop) f = f % anim.length;
          else { setFrame(anim.length - 1, true); setPlaying(false); f = -1; }
        }
        if (f >= 0) setFrame(f, true);
      }
    }
    var sig = curFrame + '|' + selection.map(function (i) { return i.id; }).join(',') +
      '|' + allTopItems().length + '|' + TL.cell + '|' + anim.length;
    if (sig !== lastSig) { lastSig = sig; tlDirty = true; }
    if (tlDirty) drawTimeline();

    if (anim.onion && !playing) {
      var vs = paper.view.zoom + '|' + paper.view.center.x + '|' + paper.view.center.y;
      if (vs !== lastView) {
        lastView = vs;
        onionCv.getContext('2d').clearRect(0, 0, onionCv.width, onionCv.height);
        clearTimeout(onionTimer);
        onionTimer = setTimeout(renderOnion, 120);
      }
    }
    if (!playing && (++tickCount % 12 === 0)) updateStatus();
  };

  // ---------- hooks into the existing app ----------
  var _saveState = saveState;
  saveState = function () {
    if (anim.auto && !applying && !playing && selection.length) { setKeys(keyTargets(), curFrame); tlDirty = true; }
    return _saveState.apply(this, arguments);
  };
  var _restoreState = restoreState;
  restoreState = function () {
    var r = _restoreState.apply(this, arguments);
    applyFrame(curFrame); tlDirty = true;
    return r;
  };
  var _loadSnap = loadProjectSnapshot;
  loadProjectSnapshot = function () {
    var r = _loadSnap.apply(this, arguments);
    applyFrame(curFrame); tlDirty = true; renderOnion();
    return r;
  };
  var _projectData = projectData;
  projectData = function () {
    var d = _projectData();
    d.anim = { length: anim.length, fps: anim.fps, loop: anim.loop, ease: anim.ease };
    return d;
  };
  var _loadData = loadProjectData;
  loadProjectData = function (data) {
    if (data && data.anim) { Object.assign(anim, data.anim); syncInputs(); }
    return _loadData(data);
  };

  // ---------- sprite sheet ----------
  function exportSprites() {
    var from = Math.max(0, Math.min(anim.length - 1, Math.round(Number($('ss-from').value) || 0)));
    var to = Math.max(from, Math.min(anim.length - 1, Math.round(Number($('ss-to').value) || 0)));
    var cols = Math.max(1, Math.min(64, Math.round(Number($('ss-cols').value) || 1)));
    var pad = Math.max(0, Math.min(64, Math.round(Number($('ss-pad').value) || 0)));
    var sc = Math.max(10, Math.min(800, Number($('ss-scale').value) || 100)) / 100;
    var name = ($('ss-name').value || 'sprites').replace(/[^\w\-]+/g, '_');
    var cw = Math.max(1, Math.round(frame.w * sc)), ch = Math.max(1, Math.round(frame.h * sc));
    var count = to - from + 1, rows = Math.ceil(count / cols);
    var W = cols * cw + (cols + 1) * pad, H = rows * ch + (rows + 1) * pad;
    if (W > 8192 || H > 8192 || W * H > 16000000) {
      alert('The sheet would be ' + W + ' x ' + H + ' px. Too big. Lower the scale, columns or frame range.');
      return;
    }
    var sheet = document.createElement('canvas');
    sheet.width = W; sheet.height = H;
    var sctx = sheet.getContext('2d');
    var bg = expBg.value === 'color' ? expBgColor.value : null;
    if (bg) { sctx.fillStyle = bg; sctx.fillRect(0, 0, W, H); }

    var keep = curFrame;
    setPlaying(false);
    var area = new paper.Rectangle(frame.x, frame.y, frame.w, frame.h), metaFrames = [];
    for (var i = 0; i < count; i++) {
      applyFrame(from + i);
      var cv = renderArea(area, cw, ch, false, bg);
      var x = pad + (i % cols) * (cw + pad), y = pad + Math.floor(i / cols) * (ch + pad);
      sctx.drawImage(cv, x, y);
      metaFrames.push({ index: from + i, x: x, y: y, w: cw, h: ch });
    }
    applyFrame(keep);
    paper.view.update();

    var json = { image: name + '.png', cellWidth: cw, cellHeight: ch, columns: cols, rows: rows,
                 fps: anim.fps, frameCount: count, frames: metaFrames };
    sheet.toBlob(function (blob) {
      if (!blob) { alert('Export failed. Try a smaller size.'); return; }
      downloadBlob(blob, name + '.png');
      setTimeout(function () {
        downloadBlob(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }), name + '.json');
      }, 500);
    }, 'image/png');
  }
  wire('ss-download', exportSprites);
  ['ss-cols', 'ss-pad', 'ss-scale', 'ss-from', 'ss-to'].forEach(function (id) {
    var el = $(id);
    if (el) el.addEventListener('change', function () {
      var info = $('ss-info');
      if (!info) return;
      var n = Math.max(1, (Number($('ss-to').value) || 0) - (Number($('ss-from').value) || 0) + 1);
      var cols = Math.max(1, Number($('ss-cols').value) || 1), sc = (Number($('ss-scale').value) || 100) / 100;
      var pad = Number($('ss-pad').value) || 0;
      info.textContent = n + ' frames, sheet about ' +
        Math.round(cols * frame.w * sc + (cols + 1) * pad) + ' x ' +
        Math.round(Math.ceil(n / cols) * frame.h * sc + (Math.ceil(n / cols) + 1) * pad) + ' px';
    });
  });

  window.animApi = {
    anim: anim,
    frame: function () { return curFrame; },
    applyFrame: applyFrame,
    stop: function () { setPlaying(false); },
    refresh: function () { applyFrame(curFrame); tlDirty = true; renderOnion(); },
    commit: commit,
    keyAt: function (f) { if (!selection.length) return; setKeys(keyTargets(), f); commit(); tlDirty = true; },
    goto: function (f) { setFrame(f); }
  };

  syncInputs();
  setFrame(0, true);
})();

// ======================================================
// SELECTED POINT MARKER (green)
// ======================================================
(function () {
  var mark = document.createElement('div');
  mark.id = 'node-mark';
  canvasArea.appendChild(mark);

  function refreshMark() {
    var seg = (typeof nodeSel !== 'undefined') ? nodeSel : null;
    if (currentToolName !== 'node' || !seg || !seg.path || !seg.path.parent) {
      mark.style.display = 'none';
      return;
    }
    var gp = seg.path.localToGlobal ? seg.path.localToGlobal(seg.point) : seg.point;
    var v = paper.view.projectToView(gp);
    mark.style.display = 'block';
    mark.style.left = v.x + 'px';
    mark.style.top = v.y + 'px';
  }

  // runs every frame, next to the existing onFrame handler
  paper.view.on('frame', refreshMark);
})();

// ======================================================
// DAY 5: STROKE + / - BUTTONS
// ======================================================
(function () {
  widthInput.max = 200;
  var stepEl = document.getElementById('stroke-step');
  function step() { return Number(stepEl.value) || 1; }
  function bump(d) {
    var v = Math.max(0, Math.min(200, Math.round(((Number(widthInput.value) || 0) + d) * 10) / 10));
    widthInput.value = v;
    widthInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function hold(id, sign) {
    var el = document.getElementById(id), timer = null, rep = null, active = false;
    if (!el) return;
    function stop() {
      clearTimeout(timer); clearInterval(rep);
      if (active) { active = false; widthInput.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      active = true;
      bump(sign * step());
      timer = setTimeout(function () {
        rep = setInterval(function () { bump(sign * step()); }, 70);
      }, 420);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { el.addEventListener(ev, stop); });
  }
  hold('stroke-minus', -1);
  hold('stroke-plus', 1);

  document.addEventListener('keydown', function (e) {
    var tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '-') { bump(-step()); widthInput.dispatchEvent(new Event('change', { bubbles: true })); }
    if (e.key === '=' || e.key === '+') { bump(step()); widthInput.dispatchEvent(new Event('change', { bubbles: true })); }
  });
})();
// ======================================================
// DAY 5: ELLIPSE / ARC TOOL
// ======================================================
(function () {
  tools.ellipse = new paper.Tool();
  var $ = function (id) { return document.getElementById(id); };
  var ellType = $('ell-type'), ellStart = $('ell-start'), ellEnd = $('ell-end');
  var ellRx = $('ell-rx'), ellRy = $('ell-ry'), ellCircle = $('ell-circle'), ellCenter = $('ell-center');
  var DEG = Math.PI / 180;
  var r2 = function (v) { return Math.round(v * 100) / 100; };

  // unit-circle arc from angle a0 to a1 (radians, a1 > a0), split in quarter turns
  function arcSegments(a0, a1) {
    var span = a1 - a0;
    var n = Math.max(1, Math.ceil(span / (Math.PI / 2) - 1e-9));
    var d = span / n, k = 4 / 3 * Math.tan(d / 4), out = [];
    for (var i = 0; i <= n; i++) {
      var a = a0 + d * i, c = Math.cos(a), s = Math.sin(a);
      var tan = new paper.Point(-s, c);
      out.push(new paper.Segment(
        new paper.Point(c, s),
        i === 0 ? null : tan.multiply(-k),
        i === n ? null : tan.multiply(k)
      ));
    }
    return out;
  }

  // build the real path segments from the saved ellipse settings
  function ellBuild(e) {
    var M = mxFrom(e.M), L = new paper.Matrix(M.a, M.b, M.c, M.d, 0, 0);
    var P = function (p) { return M.transform(p); };
    var V = function (p) { return L.transform(p); };
    var span = (((e.end - e.start) % 360) + 360) % 360;
    var whole = e.type === 'whole' || span < 0.01;
    var segs = [], closed;
    if (whole) {
      var k = 0.5522847498;
      [[1, 0], [0, 1], [-1, 0], [0, -1]].forEach(function (b) {
        var t = new paper.Point(-b[1], b[0]).multiply(k);
        segs.push(new paper.Segment(P(new paper.Point(b[0], b[1])), V(t.multiply(-1)), V(t)));
      });
      closed = true;
    } else {
      var a0 = e.start * DEG;
      arcSegments(a0, a0 + span * DEG).forEach(function (s) {
        segs.push(new paper.Segment(P(s.point), V(s.handleIn), V(s.handleOut)));
      });
      closed = e.type !== 'arc';
      if (e.type === 'slice') segs.push(new paper.Segment(P(new paper.Point(0, 0))));
    }
    return { segs: segs, closed: closed };
  }

  function makeEllipse(cx, cy, rx, ry) {
    var e = {
      type: ellType.value,
      start: Number(ellStart.value) || 0,
      end: Number(ellEnd.value) || 0,
      M: mxArr(new paper.Matrix(rx, 0, 0, ry, cx, cy))
    };
    var b = ellBuild(e);
    var path = new paper.Path({
      segments: b.segs, closed: b.closed,
      fillColor: style.fill, strokeColor: style.stroke, strokeWidth: style.strokeWidth
    });
    e.n = path.segments.length;
    path.data.ell = e;
    return path;
  }

  function ellOf(item) {
    return (item && item.className === 'Path' && item.data && item.data.ell) ? item : null;
  }

  function rebuildEllipse(path) {
    var e = path.data && path.data.ell;
    if (!e) return false;
    if (path.segments.length !== e.n) { delete path.data.ell; return false; }  // edited by hand: forget
    var b = ellBuild(e);
    path.segments = b.segs;
    path.closed = b.closed;
    e.n = path.segments.length;
    return true;
  }

  // keep the saved ellipse in step when the shape is moved / scaled / rotated
  (function () {
    var prev = paper.Item.prototype.transform;
    paper.Item.prototype.transform = function (matrix) {
      var d = this.data;
      if (d && d.ell && matrix && !matrix.isIdentity()) {
        d.ell.M = mxArr(matrix.clone().append(mxFrom(d.ell.M)));
      }
      return prev.apply(this, arguments);
    };
  })();

  // editing points by hand turns it into an ordinary path
  var _clearRound = clearRound;
  clearRound = function (path) {
    _clearRound(path);
    if (path && path.data) delete path.data.ell;
  };

  // show the selected ellipse's values in the panel
  function syncEllipsePanel(item) {
    var p = ellOf(item);
    if (!p) return;
    var e = p.data.ell, M = mxFrom(e.M);
    ellType.value = e.type;
    ellStart.value = r2(e.start);
    ellEnd.value = r2(e.end);
    ellRx.value = r2(Math.hypot(M.a, M.b));
    ellRy.value = r2(Math.hypot(M.c, M.d));
  }
  var _sync = syncPanelFromItem;
  syncPanelFromItem = function (item) { _sync(item); syncEllipsePanel(item); };

  function applyControls(which) {
    if ((which === 'start' || which === 'end') && ellType.value === 'whole') ellType.value = 'slice';
    var changed = false;
    selection.forEach(function (it) {
      var p = ellOf(it);
      if (!p) return;
      var e = p.data.ell;
      if (which === 'rx' || which === 'ry') {
        var M = mxFrom(e.M);
        var rx0 = Math.hypot(M.a, M.b) || 1, ry0 = Math.hypot(M.c, M.d) || 1;
        if (which === 'rx') {
          var f = Math.max(1, Number(ellRx.value) || 1) / rx0;
          e.M = mxArr(new paper.Matrix(M.a * f, M.b * f, M.c, M.d, M.tx, M.ty));
        } else {
          var g = Math.max(1, Number(ellRy.value) || 1) / ry0;
          e.M = mxArr(new paper.Matrix(M.a, M.b, M.c * g, M.d * g, M.tx, M.ty));
        }
      } else {
        e.type = ellType.value;
        e.start = Number(ellStart.value) || 0;
        e.end = Number(ellEnd.value) || 0;
      }
      if (rebuildEllipse(p)) changed = true;
    });
    return changed;
  }
  function anyEllipseSelected() { return selection.some(ellOf); }

  ellType.addEventListener('change', function () { if (applyControls('type')) saveState(); });
  [['start', ellStart], ['end', ellEnd], ['rx', ellRx], ['ry', ellRy]].forEach(function (p) {
    p[1].addEventListener('input', function () { applyControls(p[0]); });
    p[1].addEventListener('change', function () { if (anyEllipseSelected()) saveState(); });
  });
  wire('ell-whole', function () {
    ellType.value = 'whole';
    if (applyControls('type')) saveState();
  });
  wire('ell-flip', function () {
    var s = ellStart.value; ellStart.value = ellEnd.value; ellEnd.value = s;
    if (applyControls('start')) saveState();
  });

  // ----- the tool -----
  var p0 = null;
  tools.ellipse.onMouseDown = function (event) { p0 = event.point; };
  tools.ellipse.onMouseDrag = function (event) {
    if (!p0) return;
    if (currentShape) currentShape.remove();
    var dx = event.point.x - p0.x, dy = event.point.y - p0.y;
    if (ellCircle.checked || event.modifiers.shift) {
      var m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = dx < 0 ? -m : m;
      dy = dy < 0 ? -m : m;
    }
    var cx, cy, rx, ry;
    if (ellCenter.checked || event.modifiers.option) {
      cx = p0.x; cy = p0.y; rx = Math.abs(dx); ry = Math.abs(dy);
    } else {
      cx = p0.x + dx / 2; cy = p0.y + dy / 2; rx = Math.abs(dx) / 2; ry = Math.abs(dy) / 2;
    }
    if (rx < 0.5 || ry < 0.5) { currentShape = null; return; }
    currentShape = makeEllipse(cx, cy, rx, ry);
  };
  tools.ellipse.onMouseUp = function () {
    if (currentShape) {
      registerItem(currentShape, 'Ellipse', '⬭');
      var shape = currentShape;
      currentShape = null;
      setSelection([shape]);        // stays selected so you can edit the angles
      saveState();
    }
    p0 = null;
    renderLayers();
  };

  document.addEventListener('keydown', function (e) {
    var tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.toLowerCase() === 'o') setTool('ellipse');
  });
  window.ellApi = { ellOf: ellOf, rebuild: rebuildEllipse, sync: syncEllipsePanel };
})();

// ======================================================
// DAY 5: VFX STUDIO
// ======================================================
(function () {
  var say = function (m) { if (window.toast) window.toast(m); };
  var clamp = function (x, a, b) { return Math.min(b, Math.max(a, x)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var SP = 128, KR = 24, TAU = Math.PI * 2;

  // ---------- defaults + presets ----------
  var DEF = {
    mode: 'loop', count: 80, duration: 1, fps: 24, seed: 7, burstSpread: 0.05,
    w: 256, h: 256, ox: 0.5, oy: 0.5,
    shape: 'point', er: 20, radial: false, angle: -90, spread: 30,
    speedMin: 40, speedMax: 120, gravity: 0, drag: 0, lifeMin: 0.5, lifeMax: 1,
    swirl: 0, wob: 0, wobFreq: 1.5,
    sprite: 'soft', sizeStart: 24, sizeEnd: 4, sizeVar: 0.3, rotVar: 0, spin: 0, stretch: 0,
    c0: '#ffffff', c1: '#ffd36b', c2: '#ff4a1a', fadeIn: 0.1, fadeOut: 0.5, opacity: 1,
    blend: 'lighter', tint: false
  };
  var PRE = [
    ['🔥 Fire', { count: 110, duration: 1, oy: 0.82, shape: 'circle', er: 14, angle: -90, spread: 24,
      speedMin: 35, speedMax: 95, gravity: -60, drag: 0.8, lifeMin: 0.5, lifeMax: 1, sprite: 'flame',
      sizeStart: 34, sizeEnd: 6, sizeVar: 0.4, wob: 5, wobFreq: 2, c0: '#fff4b0', c1: '#ff8a1f', c2: '#4a0d00',
      fadeIn: 0.08, fadeOut: 0.55 }],
    ['💨 Smoke', { count: 36, duration: 3, oy: 0.8, shape: 'circle', er: 10, angle: -90, spread: 28,
      speedMin: 14, speedMax: 36, gravity: -8, drag: 0.3, lifeMin: 2, lifeMax: 3, sprite: 'smoke',
      sizeStart: 26, sizeEnd: 88, sizeVar: 0.3, rotVar: 180, spin: 15, wob: 6, wobFreq: 0.5,
      c0: '#9a9a9a', c1: '#6a6a6a', c2: '#2e2e2e', fadeIn: 0.2, fadeOut: 0.65, opacity: 0.55, blend: 'source-over' }],
    ['✨ Sparks', { count: 70, duration: 1, oy: 0.7, angle: -90, spread: 110, speedMin: 90, speedMax: 260,
      gravity: 420, drag: 0.6, lifeMin: 0.35, lifeMax: 0.95, sprite: 'circle', sizeStart: 5, sizeEnd: 1.5,
      sizeVar: 0.4, stretch: 1.6, c0: '#fffbe0', c1: '#ffc23a', c2: '#ff3d00', fadeIn: 0, fadeOut: 0.35 }],
    ['💥 Explosion', { mode: 'burst', count: 170, duration: 1, burstSpread: 0.04, shape: 'circle', er: 8,
      radial: true, angle: 0, spread: 0, speedMin: 40, speedMax: 330, gravity: 80, drag: 3.2,
      lifeMin: 0.25, lifeMax: 0.85, sprite: 'soft', sizeStart: 46, sizeEnd: 8, sizeVar: 0.5,
      c0: '#fff8c8', c1: '#ff8b22', c2: '#2a0d00', fadeIn: 0, fadeOut: 0.6 }],
    ['🔮 Magic', { count: 70, duration: 1.6, shape: 'ring', er: 60, angle: -90, spread: 360, speedMin: 4,
      speedMax: 26, gravity: -10, drag: 0.2, lifeMin: 0.8, lifeMax: 1.6, sprite: 'star', sizeStart: 18,
      sizeEnd: 2, sizeVar: 0.5, rotVar: 180, spin: 140, swirl: 70, c0: '#ffffff', c1: '#9fd4ff', c2: '#7d4dff',
      fadeIn: 0.2, fadeOut: 0.5 }],
    ['🌧 Rain', { count: 130, duration: 1, oy: 0.06, shape: 'line', er: 130, angle: 100, spread: 2,
      speedMin: 420, speedMax: 560, lifeMin: 0.5, lifeMax: 0.62, sprite: 'circle', sizeStart: 3, sizeEnd: 3,
      sizeVar: 0.3, stretch: 2.4, c0: '#cfe6ff', c1: '#9cc4ff', c2: '#7aa8ff', fadeIn: 0, fadeOut: 0.15,
      opacity: 0.8, blend: 'source-over' }],
    ['❄ Snow', { count: 90, duration: 5, oy: 0.04, shape: 'line', er: 135, angle: 90, spread: 24,
      speedMin: 22, speedMax: 50, lifeMin: 3.5, lifeMax: 5, sprite: 'soft', sizeStart: 8, sizeEnd: 7,
      sizeVar: 0.6, wob: 16, wobFreq: 0.5, c0: '#ffffff', c1: '#f0f6ff', c2: '#dce8ff', fadeIn: 0.08,
      fadeOut: 0.12, opacity: 0.95, blend: 'source-over' }],
    ['💚 Heal', { count: 26, duration: 1.8, oy: 0.78, shape: 'circle', er: 42, angle: -90, spread: 10,
      speedMin: 24, speedMax: 50, lifeMin: 1, lifeMax: 1.7, sprite: 'plus', sizeStart: 20, sizeEnd: 10,
      sizeVar: 0.4, wob: 4, wobFreq: 1, c0: '#d4ffc8', c1: '#47e070', c2: '#0b9a3c', fadeIn: 0.2, fadeOut: 0.5 }],
    ['⚡ Hit impact', { mode: 'burst', count: 26, duration: 0.5, burstSpread: 0.01, radial: true,
      speedMin: 160, speedMax: 340, drag: 5.5, lifeMin: 0.15, lifeMax: 0.38, sprite: 'spark', sizeStart: 22,
      sizeEnd: 3, sizeVar: 0.4, stretch: 1, c0: '#ffffff', c1: '#ffd45e', c2: '#ff5a00', fadeIn: 0, fadeOut: 0.4 }],
    ['🟤 Dust', { count: 34, duration: 1.5, oy: 0.85, shape: 'line', er: 40, angle: -90, spread: 160,
      speedMin: 14, speedMax: 50, gravity: -6, drag: 2, lifeMin: 0.8, lifeMax: 1.4, sprite: 'smoke',
      sizeStart: 12, sizeEnd: 38, rotVar: 180, spin: 30, c0: '#d7c6a6', c1: '#b39e7c', c2: '#7d6c52',
      fadeIn: 0.15, fadeOut: 0.6, opacity: 0.55, blend: 'source-over' }],
    ['🌀 Portal', { count: 90, duration: 1.5, shape: 'ring', er: 75, radial: true, angle: 0, spread: 0,
      speedMin: -85, speedMax: -55, lifeMin: 0.9, lifeMax: 1.3, sprite: 'soft', sizeStart: 14, sizeEnd: 3,
      sizeVar: 0.4, swirl: 150, c0: '#d6f1ff', c1: '#45a8ff', c2: '#6a2dff', fadeIn: 0.2, fadeOut: 0.6 }]
  ];

  var UI = [
    ['Effect'],
    ['mode', 'Mode', 'sel', [['loop', 'Loop (seamless)'], ['burst', 'Burst (one shot)']]],
    ['count', 'Particles', 'num', 1, 600, 1],
    ['duration', 'Duration (s)', 'num', 0.2, 10, 0.1],
    ['fps', 'FPS', 'num', 1, 60, 1],
    ['seed', 'Random seed', 'num', 1, 9999, 1],
    ['burstSpread', 'Burst spread (s)', 'num', 0, 1, 0.01],
    ['Emitter'],
    ['shape', 'Emitter shape', 'sel', [['point', 'Point'], ['circle', 'Disc'], ['ring', 'Ring'], ['line', 'Line'], ['rect', 'Square']]],
    ['er', 'Emitter size', 'num', 0, 200, 1],
    ['radial', 'Emit outward', 'chk'],
    ['angle', 'Direction °', 'num', -360, 360, 1],
    ['spread', 'Spread °', 'num', 0, 360, 1],
    ['Motion'],
    ['speedMin', 'Speed min', 'num', -500, 800, 1],
    ['speedMax', 'Speed max', 'num', -500, 800, 1],
    ['gravity', 'Gravity (+ down)', 'num', -800, 800, 1],
    ['drag', 'Drag', 'num', 0, 10, 0.1],
    ['lifeMin', 'Life min (s)', 'num', 0.05, 8, 0.05],
    ['lifeMax', 'Life max (s)', 'num', 0.05, 8, 0.05],
    ['swirl', 'Swirl °/s', 'num', -720, 720, 1],
    ['wob', 'Wobble px', 'num', 0, 60, 1],
    ['wobFreq', 'Wobble speed', 'num', 0, 10, 0.1],
    ['Look'],
    ['sprite', 'Sprite', 'sel', [['soft', 'Soft glow'], ['circle', 'Circle'], ['ring', 'Ring'], ['spark', 'Glint'],
      ['star', 'Star'], ['smoke', 'Smoke puff'], ['square', 'Square'], ['flame', 'Flame'], ['plus', 'Plus'], ['custom', 'My sprite']]],
    ['sizeStart', 'Size start', 'num', 1, 300, 1],
    ['sizeEnd', 'Size end', 'num', 0, 300, 1],
    ['sizeVar', 'Size random', 'num', 0, 1, 0.05],
    ['rotVar', 'Start rotation ±°', 'num', 0, 180, 1],
    ['spin', 'Spin °/s', 'num', 0, 720, 1],
    ['stretch', 'Stretch to speed', 'num', 0, 10, 0.1],
    ['c0', 'Color start', 'col'],
    ['c1', 'Color middle', 'col'],
    ['c2', 'Color end', 'col'],
    ['fadeIn', 'Fade in', 'num', 0, 0.9, 0.05],
    ['fadeOut', 'Fade out', 'num', 0, 1, 0.05],
    ['opacity', 'Opacity', 'num', 0, 1, 0.05],
    ['blend', 'Blend', 'sel', [['source-over', 'Normal'], ['lighter', 'Additive (glow)'], ['screen', 'Screen']]],
    ['tint', 'Tint my sprite', 'chk']
  ];

  // ---- Day 6: water + liquid ----
  Object.assign(DEF, { floor: false, floorY: 0.9, splash: 3, splashSize: 0.6, splashPower: 0.35,
    liquid: false, gooT: 0.45, gooS: 0.22 });

  var WATER = { blend: 'source-over', liquid: true, fadeIn: 0, fadeOut: 0, sprite: 'soft',
    c0: '#e4f9ff', c1: '#58c4ff', c2: '#1b6fd6', opacity: 0.95, floor: true };

  PRE.push(
    ['🚰 Pipe flow', Object.assign({}, WATER, { count: 160, duration: 1.2, ox: 0.16, oy: 0.26,
      shape: 'circle', er: 3, angle: 6, spread: 3, speedMin: 200, speedMax: 225, gravity: 720,
      lifeMin: 1.2, lifeMax: 1.2, sizeStart: 30, sizeEnd: 26, sizeVar: 0.12,
      floorY: 0.9, splash: 3, splashSize: 0.75, splashPower: 0.3 })],
    ['💦 Water blast', Object.assign({}, WATER, { mode: 'burst', count: 240, duration: 1.8, burstSpread: 0.06,
      ox: 0.5, oy: 0.86, shape: 'point', angle: -90, spread: 70, speedMin: 220, speedMax: 520,
      gravity: 800, drag: 0.25, lifeMin: 1.2, lifeMax: 1.7, sizeStart: 26, sizeEnd: 18, sizeVar: 0.35,
      floorY: 0.9, splash: 2, splashSize: 0.6, splashPower: 0.3 })],
    ['⛲ Fountain', Object.assign({}, WATER, { count: 170, duration: 1.4, ox: 0.5, oy: 0.8,
      shape: 'point', angle: -90, spread: 16, speedMin: 300, speedMax: 380, gravity: 640,
      lifeMin: 1.4, lifeMax: 1.4, sizeStart: 22, sizeEnd: 20, sizeVar: 0.25,
      floorY: 0.84, splash: 3, splashSize: 0.7, splashPower: 0.28 })],
    ['🌊 Waterfall', Object.assign({}, WATER, { count: 260, duration: 1.2, ox: 0.5, oy: 0.06,
      shape: 'line', er: 50, angle: 90, spread: 5, speedMin: 30, speedMax: 60, gravity: 650,
      lifeMin: 1.2, lifeMax: 1.2, sizeStart: 26, sizeEnd: 24, sizeVar: 0.2,
      floorY: 0.9, splash: 4, splashSize: 0.6, splashPower: 0.22 })],
    ['💧 Water drip', Object.assign({}, WATER, { count: 3, duration: 1.2, ox: 0.5, oy: 0.15,
      shape: 'point', angle: 90, spread: 0, speedMin: 0, speedMax: 8, gravity: 700,
      lifeMin: 1.2, lifeMax: 1.2, sizeStart: 20, sizeEnd: 18, sizeVar: 0.1, stretch: 0.7,
      floorY: 0.9, splash: 6, splashSize: 0.5, splashPower: 0.5 })]
  );

  UI.push(
    ['Water & liquid'],
    ['liquid', 'Liquid (goo) look', 'chk'],
    ['gooT', 'Goo threshold', 'num', 0.05, 0.95, 0.01],
    ['gooS', 'Goo softness', 'num', 0.02, 0.6, 0.01],
    ['floor', 'Floor + splash', 'chk'],
    ['floorY', 'Floor height', 'num', 0, 1, 0.01],
    ['splash', 'Splash drops', 'num', 0, 8, 1],
    ['splashSize', 'Splash size', 'num', 0.1, 2, 0.05],
    ['splashPower', 'Splash power', 'num', 0, 1.5, 0.05]
  );

  // ---- Day 7: river path + lightning / shockwave / slash ----
  Object.assign(DEF, {
    kind: 'particles',
    pathOn: false, pathRev: false, path: null, rw: 30, pathWob: 4,
    blen: 190, bseg: 16, bjit: 0.3, bbr: 3, bw: 3, bfl: 14,
    rings: 2, r0: 6, r1: 105, tw0: 18, tw1: 2, squash: 1,
    sr: 90, sspan: 150, sth: 40, stail: 0.75
  });
  function riverPath() {
    var a = [];
    for (var i = 0; i <= 40; i++) { var t = i / 40; a.push([0.08 + 0.84 * t, 0.5 + 0.22 * Math.sin(t * Math.PI * 2)]); }
    return a;
  }
  PRE.push(
    ['🏞 River', Object.assign({}, WATER, { count: 300, duration: 3, shape: 'point', floor: false, pathOn: true,
      path: riverPath(), rw: 34, pathWob: 5, wobFreq: 0.8, speedMin: 0, speedMax: 0, gravity: 0,
      lifeMin: 3, lifeMax: 3, sizeStart: 30, sizeEnd: 30, sizeVar: 0.2 })],
    ['⚡ Lightning', { kind: 'lightning', mode: 'loop', duration: 0.6, ox: 0.5, oy: 0.1, angle: 90, blen: 190, bw: 3,
      bseg: 16, bjit: 0.3, bbr: 3, bfl: 14, fadeIn: 0, fadeOut: 0.5, c0: '#ffffff', c1: '#7fb8ff', c2: '#3b5bff' }],
    ['🌀 Shockwave', { kind: 'shockwave', mode: 'burst', duration: 0.8, rings: 2, r0: 6, r1: 105, tw0: 18, tw1: 2,
      squash: 1, fadeIn: 0, fadeOut: 0.6, c0: '#ffffff', c1: '#ffd36b', c2: '#ff5a1a' }],
    ['🗡 Slash', { kind: 'slash', mode: 'burst', duration: 0.5, ox: 0.5, oy: 0.55, angle: -20, sr: 90, sspan: 150,
      sth: 40, stail: 0.75, c0: '#ffffff', c1: '#9fe8ff', c2: '#3a7bff' }]
  );
  UI.splice(1, 0, ['kind', 'Effect type', 'sel', [['particles', 'Particles'], ['lightning', 'Lightning'],
    ['shockwave', 'Shockwave rings'], ['slash', 'Slash trail']]]);
  UI.push(
    ['Flow along a path (river / pipe)'],
    ['pathOn', 'Flow along path', 'chk'], ['pathRev', 'Reverse direction', 'chk'],
    ['rw', 'River width', 'num', 0, 300, 1], ['pathWob', 'Surface wobble', 'num', 0, 40, 1],
    ['Lightning (type: Lightning)'],
    ['blen', 'Bolt length', 'num', 20, 500, 1], ['bw', 'Thickness', 'num', 0.5, 20, 0.5],
    ['bseg', 'Detail', 'num', 4, 40, 1], ['bjit', 'Jaggedness', 'num', 0, 1, 0.01],
    ['bbr', 'Branches', 'num', 0, 8, 1], ['bfl', 'Flicker / sec', 'num', 1, 60, 1],
    ['Shockwave (type: Shockwave)'],
    ['rings', 'Rings', 'num', 1, 6, 1], ['r0', 'Start radius', 'num', 0, 200, 1], ['r1', 'End radius', 'num', 10, 400, 1],
    ['tw0', 'Thickness start', 'num', 1, 80, 1], ['tw1', 'Thickness end', 'num', 0.5, 80, 0.5],
    ['squash', 'Squash (ground view)', 'num', 0.2, 1, 0.05],
    ['Slash (type: Slash)'],
    ['sr', 'Radius', 'num', 10, 300, 1], ['sspan', 'Arc span °', 'num', 20, 340, 1],
    ['sth', 'Thickness', 'num', 4, 140, 1], ['stail', 'Tail length', 'num', 0.1, 1, 0.05]
  );

  function drawSpecial(c, t, w, h, o) {
    var D = fx.duration, loop = fx.mode === 'loop';
    var u0 = loop ? (((t % D) + D) % D) / D : t / D;
    var ox = fx.ox * w, oy = fx.oy * h;
    var env = function (u) {
      var a = fx.opacity;
      if (fx.fadeIn > 0) a *= Math.min(1, u / fx.fadeIn);
      if (fx.fadeOut > 0) a *= Math.min(1, (1 - u) / fx.fadeOut);
      return Math.max(0, a);
    };
    function boltPts(r, x0, y0, x1, y1, jit, seg) {
      var pts = [[x0, y0], [x1, y1]], off = Math.hypot(x1 - x0, y1 - y0) * jit;
      var iters = Math.max(1, Math.round(Math.log(seg) / Math.LN2));
      for (var k = 0; k < iters; k++) {
        var np = [pts[0]];
        for (var i = 0; i < pts.length - 1; i++) {
          var a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
          var of = (r() * 2 - 1) * off;
          np.push([(a[0] + b[0]) / 2 - dy / len * of, (a[1] + b[1]) / 2 + dx / len * of]);
          np.push(b);
        }
        pts = np; off *= 0.55;
      }
      return pts;
    }
    c.globalCompositeOperation = fx.blend;
    if (fx.kind === 'lightning' && u0 <= 1) {
      var r = rng(fx.seed * 7919 + Math.floor(t * fx.bfl)), a = env(u0), ang = fx.angle * Math.PI / 180;
      var main = boltPts(r, ox, oy, ox + Math.cos(ang) * fx.blen, oy + Math.sin(ang) * fx.blen, fx.bjit, fx.bseg);
      var bolts = [[main, 1]];
      for (var b = 0; b < fx.bbr; b++) {
        var s = main[Math.floor(0.15 * main.length + r() * 0.7 * main.length)];
        var ba = ang + (r() < 0.5 ? -1 : 1) * (0.35 + r() * 0.6), bl = fx.blen * (0.18 + r() * 0.25);
        bolts.push([boltPts(r, s[0], s[1], s[0] + Math.cos(ba) * bl, s[1] + Math.sin(ba) * bl, fx.bjit, 8), 0.55]);
      }
      c.lineJoin = 'round'; c.lineCap = 'round';
      [[7, 0.14, fx.c1], [3.2, 0.35, fx.c1], [1, 1, fx.c0]].forEach(function (L) {
        bolts.forEach(function (B) {
          c.beginPath();
          B[0].forEach(function (p, i) { if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); });
          c.lineWidth = Math.max(0.6, fx.bw * L[0] * B[1]);
          c.strokeStyle = L[2]; c.globalAlpha = Math.min(1, a * L[1]);
          c.stroke();
        });
      });
      var gr = c.createRadialGradient(ox, oy, 0, ox, oy, Math.max(8, fx.blen * 0.18));
      gr.addColorStop(0, fx.c0); gr.addColorStop(1, 'rgba(' + hexRgb(fx.c1).join(',') + ',0)');
      c.globalAlpha = Math.min(1, a * 0.6); c.fillStyle = gr; c.fillRect(0, 0, w, h);
    } else if (fx.kind === 'shockwave') {
      var n = Math.max(1, Math.round(fx.rings));
      for (var i = 0; i < n; i++) {
        var ph = loop ? ((((t / D) + i / n) % 1) + 1) % 1 : (t / D - i * 0.12);
        if (ph < 0 || ph > 1) continue;
        var e = 1 - Math.pow(1 - ph, 3), rr = lerp(fx.r0, fx.r1, e), th = Math.max(0.5, lerp(fx.tw0, fx.tw1, ph)), al = env(ph);
        c.save(); c.translate(ox, oy); c.scale(1, fx.squash);
        c.beginPath(); c.arc(0, 0, rr, 0, TAU);
        c.strokeStyle = colAt(ph); c.lineWidth = th * 2.6; c.globalAlpha = Math.min(1, al * 0.3); c.stroke();
        c.strokeStyle = colAt(Math.min(1, ph * 0.5)); c.lineWidth = th; c.globalAlpha = Math.min(1, al); c.stroke();
        c.restore();
      }
    } else if (fx.kind === 'slash' && u0 < 1) {
      var sweep = Math.min(1, u0 / 0.35), p = 1 - Math.pow(1 - sweep, 3), d2r = Math.PI / 180;
      var a0 = fx.angle - fx.sspan / 2, head = a0 + fx.sspan * p, tail = a0 + fx.sspan * Math.max(0, p - fx.stail);
      var fade = (u0 < 0.35 ? 1 : 1 - (u0 - 0.35) / 0.65) * fx.opacity, N = 40, R = fx.sr;
      var P = function (A, rad) { return [ox + Math.cos(A) * rad, oy + Math.sin(A) * rad]; };
      for (var k = 0; k < N; k++) {
        var s0 = k / N, s1 = (k + 1) / N;
        var A0 = (tail + (head - tail) * s0) * d2r, A1 = (tail + (head - tail) * s1 + 0.6) * d2r;
        var t0 = fx.sth / 2 * Math.pow(Math.sin(Math.PI * s0), 0.7), t1 = fx.sth / 2 * Math.pow(Math.sin(Math.PI * s1), 0.7);
        var q1 = P(A0, R + t0), q2 = P(A1, R + t1), q3 = P(A1, R - t1), q4 = P(A0, R - t0);
        c.beginPath(); c.moveTo(q1[0], q1[1]); c.lineTo(q2[0], q2[1]); c.lineTo(q3[0], q3[1]); c.lineTo(q4[0], q4[1]); c.closePath();
        c.fillStyle = colAt(1 - s1); c.globalAlpha = Math.max(0, Math.min(1, fade * (0.2 + 0.8 * s1)));
        c.fill();
      }
    }
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    if (o.guide) {
      c.strokeStyle = 'rgba(0,200,255,0.9)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(ox - 8, oy); c.lineTo(ox + 8, oy); c.moveTo(ox, oy - 8); c.lineTo(ox, oy + 8); c.stroke();
    }
  }

  var fx = Object.assign({}, DEF);
  var parts = [], ramp = [], customBase = null, baseCache = {};
  var isOpen = false, playing = true, time = 0, lastTs = 0, previewBg = 'checker';

  // ---------- styles + screen ----------
  var css = document.createElement('style');
  css.textContent =
    '#vfx{position:fixed;inset:0;z-index:90000;display:none;flex-direction:column;background:#1b1b1b;color:#ddd;font:13px system-ui,sans-serif}' +
    '#vfx *{box-sizing:border-box}' +
    '#vfx-top{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#2a2a2a;border-bottom:1px solid #111;flex-shrink:0}' +
    '#vfx-top b{font-size:15px}#vfx-top .sp{flex:1}' +
    '#vfx button{background:#3a3a3a;color:#ddd;border:1px solid #555;border-radius:6px;padding:7px 10px;cursor:pointer;font-size:12px}' +
    '#vfx button:hover{background:#4a4a4a}#vfx button:active{filter:brightness(1.6)}' +
    '#vfx button.on{background:#2f6fed;border-color:#2f6fed;color:#fff}' +
    '#vfx-main{flex:1;min-height:0;display:flex}' +
    '#vfx-left{width:150px;overflow-y:auto;padding:8px;background:#242424;border-right:1px solid #111;display:flex;flex-direction:column;gap:6px;flex-shrink:0}' +
    '#vfx-center{flex:1;min-width:0;display:flex;flex-direction:column}' +
    '#vfx-stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:#151515;overflow:hidden}' +
    '#vfx-cv{display:block;touch-action:none;cursor:crosshair;background-color:#fff;' +
    'background-image:linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%),linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%);' +
    'background-size:20px 20px;background-position:0 0,10px 10px}' +
    '#vfx-bar{display:flex;align-items:center;gap:8px;padding:8px;background:#242424;border-top:1px solid #111;flex-wrap:wrap}' +
    '#vfx-bar input[type=range]{flex:1;min-width:100px}' +
    '#vfx-right{width:310px;overflow-y:auto;padding:8px 10px 30px;background:#242424;border-left:1px solid #111;flex-shrink:0}' +
    '.vsec{margin:14px 0 6px;color:#9ab;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:1px}' +
    '.vr{display:flex;align-items:center;gap:6px;margin-bottom:7px}' +
    '.vr label{width:108px;flex-shrink:0;color:#bbb;font-size:12px}' +
    '.vr input[type=range]{flex:1;min-width:0}' +
    '.vr input[type=number],.vr input[type=text],.vr select{padding:4px;background:#3a3a3a;color:#ddd;border:1px solid #555;border-radius:4px}' +
    '.vr input[type=number]{width:62px}.vr select{flex:1;min-width:0}.vr input[type=text]{flex:1;min-width:0}' +
    '.vr input[type=color]{width:60px;height:28px;border:1px solid #555;background:none;cursor:pointer}' +
    '.vbtns{display:flex;flex-direction:column;gap:6px;margin-top:8px}' +
    '.vhint{color:#777;font-size:11px;margin-top:6px;line-height:1.4}' +
    '@media (max-width:900px){#vfx-main{flex-direction:column}' +
    '#vfx-left{width:auto;flex-direction:row;overflow-x:auto;overflow-y:hidden;border-right:0;border-bottom:1px solid #111}' +
    '#vfx-left button{white-space:nowrap;flex-shrink:0}#vfx-center{flex:0 0 42%}' +
    '#vfx-right{width:auto;flex:1;border-left:0;border-top:1px solid #111}}' +
    '@media (pointer:coarse){#vfx button{padding:11px 14px;font-size:14px}.vr label{font-size:13px}.vr input[type=number]{height:36px}.vr select{height:36px}}';
  document.head.appendChild(css);

  var root = document.createElement('div');
  root.id = 'vfx';
  root.innerHTML =
    '<div id="vfx-top"><b>✨ VFX Studio</b><span id="vfx-info" style="color:#888"></span><span class="sp"></span>' +
    '<button id="vfx-close">✕ Close</button></div>' +
    '<div id="vfx-main"><div id="vfx-left"></div>' +
    '<div id="vfx-center"><div id="vfx-stage"><canvas id="vfx-cv"></canvas></div>' +
    '<div id="vfx-bar"><button id="vp-first">⏮</button><button id="vp-play" class="on">⏸ Pause</button>' +
    '<input type="range" id="vp-scrub" min="0" max="23" value="0"><span id="vp-flabel" style="min-width:76px"></span>' +
    '<select id="vp-bg"><option value="checker">Checker</option><option value="#000000">Black</option>' +
    '<option value="#444444">Gray</option><option value="#ffffff">White</option><option value="#12301f">Green</option></select>' +
    '<label><input type="checkbox" id="vp-guide" checked> Guides</label><button id="vp-seed">🎲 Reseed</button></div></div>' +
    '<div id="vfx-right"></div></div>';
  document.body.appendChild(root);

  var $ = function (id) { return document.getElementById(id); };
  var left = $('vfx-left'), right = $('vfx-right'), cv = $('vfx-cv'), stage = $('vfx-stage');
  var ctx = cv.getContext('2d');

  var tb = document.createElement('div');
  tb.className = 'tb-group';
  tb.innerHTML = '<button id="btn-vfx" title="VFX Studio: particle effects for game assets">✨ VFX</button>';
  $('topbar').insertBefore(tb, $('topbar').firstChild);

  // ---------- sprites ----------
  var SPR = {
    soft: function (c) {
      var g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    },
    circle: function (c) {
      var g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, '#fff'); g.addColorStop(0.85, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    },
    ring: function (c) { c.strokeStyle = '#fff'; c.lineWidth = 5; c.beginPath(); c.arc(32, 32, 26, 0, TAU); c.stroke(); },
    spark: function (c) {
      c.fillStyle = '#fff'; c.beginPath(); c.moveTo(32, 2);
      c.quadraticCurveTo(34, 30, 62, 32); c.quadraticCurveTo(34, 34, 32, 62);
      c.quadraticCurveTo(30, 34, 2, 32); c.quadraticCurveTo(30, 30, 32, 2); c.fill();
    },
    star: function (c) {
      c.fillStyle = '#fff'; c.shadowColor = '#fff'; c.shadowBlur = 6; c.beginPath();
      for (var i = 0; i < 10; i++) {
        var a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 13 : 28;
        c.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
      }
      c.closePath(); c.fill();
    },
    smoke: function (c) {
      [[0, 0, 26], [-12, 6, 20], [12, 4, 20], [-6, -12, 18], [8, -10, 18], [0, 14, 18], [-16, -4, 14]].forEach(function (p) {
        var g = c.createRadialGradient(32 + p[0], 32 + p[1], 0, 32 + p[0], 32 + p[1], p[2]);
        g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillRect(0, 0, 64, 64);
      });
    },
    square: function (c) { c.fillStyle = '#fff'; c.fillRect(8, 8, 48, 48); },
    flame: function (c) {
      var g = c.createLinearGradient(0, 0, 0, 64);
      g.addColorStop(0, 'rgba(255,255,255,0.15)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0.9)');
      c.fillStyle = g; c.shadowColor = '#fff'; c.shadowBlur = 8; c.beginPath(); c.moveTo(32, 4);
      c.bezierCurveTo(52, 24, 54, 46, 32, 60); c.bezierCurveTo(10, 46, 12, 24, 32, 4); c.closePath(); c.fill();
    },
    plus: function (c) { c.fillStyle = '#fff'; c.fillRect(24, 6, 16, 52); c.fillRect(6, 24, 52, 16); }
  };
  function spriteBase() {
    if (fx.sprite === 'custom' && customBase) return customBase;
    var n = (fx.sprite === 'custom' || !SPR[fx.sprite]) ? 'soft' : fx.sprite;
    if (!baseCache[n]) {
      var c = document.createElement('canvas');
      c.width = c.height = SP;
      var x = c.getContext('2d');
      x.scale(SP / 64, SP / 64);
      SPR[n](x);
      baseCache[n] = c;
    }
    return baseCache[n];
  }
  function hexRgb(h) { var n = parseInt(String(h).slice(1), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function colAt(u) {
    var a = hexRgb(fx.c0), b = hexRgb(fx.c1), c = hexRgb(fx.c2);
    var f = u < 0.5 ? [a, b, u * 2] : [b, c, (u - 0.5) * 2];
    return 'rgb(' + [0, 1, 2].map(function (i) { return Math.round(lerp(f[0][i], f[1][i], f[2])); }).join(',') + ')';
  }
  function buildRamp() {
    var base = spriteBase();
    ramp = [];
    if (fx.sprite === 'custom' && customBase && !fx.tint) { ramp.push(base); return; }
    for (var i = 0; i < KR; i++) {
      var c = document.createElement('canvas');
      c.width = c.height = SP;
      var x = c.getContext('2d');
      x.drawImage(base, 0, 0);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = colAt(i / (KR - 1));
      x.fillRect(0, 0, SP, SP);
      ramp.push(c);
    }
  }

  // ---------- particles (everything is a pure function of time) ----------
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
    function pathPoint(u) {
    var P = fx.path, n = P.length - 1;
    u = clamp(u, 0, 1);
    var f = u * n, i = Math.min(n - 1, Math.floor(f)), t = f - i, a = P[i], b = P[i + 1];
    var dx = (b[0] - a[0]) * fx.w, dy = (b[1] - a[1]) * fx.h, len = Math.hypot(dx, dy) || 1;
    return { x: lerp(a[0], b[0], t) * fx.w - fx.ox * fx.w, y: lerp(a[1], b[1], t) * fx.h - fx.oy * fx.h, nx: -dy / len, ny: dx / len };
  }
  function flowPos(p, age) {
    var u = age / p.life;
    if (fx.pathRev) u = 1 - u;
    var q = pathPoint(u);
    var off = (p.ph * 2 - 1) * fx.rw / 2 + fx.pathWob * Math.sin(TAU * (fx.wobFreq * age + p.ph * 3));
    return { x: q.x + q.nx * off, y: q.y + q.ny * off };
  }

  function stateAt(p, age) {
    if (fx.pathOn && fx.path && fx.path.length > 1 && !p.plain) {
      var q0 = flowPos(p, age), q1 = flowPos(p, age + 0.02);
      return { x: q0.x, y: q0.y, vx: (q1.x - q0.x) / 0.02, vy: (q1.y - q0.y) / 0.02 };
    }
    var k = p.k != null ? p.k : fx.drag, g = p.g != null ? p.g : fx.gravity, x, y, vx, vy;
    if (k < 1e-4) {
      x = p.px + p.vx * age; y = p.py + p.vy * age + 0.5 * g * age * age;
      vx = p.vx; vy = p.vy + g * age;
    } else {
      var e = Math.exp(-k * age), gk = g / k;
      x = p.px + p.vx * (1 - e) / k;
      y = p.py + gk * age + (p.vy - gk) * (1 - e) / k;
      vx = p.vx * e; vy = gk + (p.vy - gk) * e;
    }
    if (!p.plain) {
      if (fx.wob) {
        var w = TAU * (fx.wobFreq * age + p.ph);
        x += fx.wob * Math.sin(w); y += fx.wob * 0.5 * Math.cos(w * 0.8);
      }
      if (fx.swirl) {
        var sa = fx.swirl * age * Math.PI / 180, c = Math.cos(sa), s = Math.sin(sa);
        var nx = x * c - y * s; y = x * s + y * c; x = nx;
      }
    }
    return { x: x, y: y, vx: vx, vy: vy };
  }

  // when does this particle reach the floor? (null = never)
  function landing(p, floorRel, maxAge) {
    if (fx.pathOn || fx.kind !== 'particles') return null;
    var step = 0.02, prev = 0, t = 0;
    while (t < maxAge) {
      t = Math.min(maxAge, t + step);
      var s = stateAt(p, t);
      if (s.y >= floorRel && s.vy > 0) {
        var lo = prev, hi = t;
        for (var i = 0; i < 14; i++) {
          var mid = (lo + hi) / 2;
          if (stateAt(p, mid).y >= floorRel) hi = mid; else lo = mid;
        }
        return hi;
      }
      prev = t;
    }
    return null;
  }

  function build() {
    var r = rng(fx.seed), P = [], D = fx.duration, loop = fx.mode === 'loop';
    var floorRel = (fx.floorY - fx.oy) * fx.h;
    for (var i = 0; i < fx.count; i++) {
      var life = lerp(fx.lifeMin, Math.max(fx.lifeMin, fx.lifeMax), r());
      if (loop) life = Math.min(life, D);
      var tb0 = loop ? (i + r()) / fx.count * D : r() * fx.burstSpread;
      var px = 0, py = 0, a, d;
      if (fx.shape === 'circle') { a = r() * TAU; d = fx.er * Math.sqrt(r()); px = Math.cos(a) * d; py = Math.sin(a) * d; }
      else if (fx.shape === 'ring') { a = r() * TAU; px = Math.cos(a) * fx.er; py = Math.sin(a) * fx.er; }
      else if (fx.shape === 'line') { px = (r() * 2 - 1) * fx.er; }
      else if (fx.shape === 'rect') { px = (r() * 2 - 1) * fx.er; py = (r() * 2 - 1) * fx.er; }
      var dir = (fx.angle + (r() - 0.5) * fx.spread) * Math.PI / 180;
      if (fx.radial) dir = (px || py) ? Math.atan2(py, px) + (r() - 0.5) * fx.spread * Math.PI / 180 : r() * TAU;
      var sp = lerp(fx.speedMin, fx.speedMax, r());
      P.push({
        tb: tb0, life: Math.max(0.01, life), px: px, py: py,
        vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp,
        sz: 1 + (r() * 2 - 1) * fx.sizeVar,
        rot: (r() * 2 - 1) * fx.rotVar * Math.PI / 180,
        spin: (r() * 2 - 1) * fx.spin * Math.PI / 180, ph: r()
      });
    }

    if (fx.floor) {
      var kids = [], nS = Math.round(clamp(fx.splash, 0, 8)), cap = loop ? D : 10;
      P.forEach(function (p) {
        if (p.py >= floorRel) return;
        var la = landing(p, floorRel, p.life);
        if (la === null) return;
        var st = stateAt(p, la);
        p.life = Math.max(0.02, la);                       // dies when it hits the floor
        for (var j = 0; j < nS; j++) {
          var ang = -Math.PI / 2 + (r() * 2 - 1) * 1.2;
          var spd = Math.hypot(st.vx, st.vy) * fx.splashPower * (0.4 + r() * 0.9) + 25;
          kids.push({
            tb: p.tb + la, life: Math.min(cap, 0.22 + r() * 0.3),
            px: st.x, py: floorRel,
            vx: Math.cos(ang) * spd + st.vx * 0.25, vy: Math.sin(ang) * spd,
            sz: 0.6 + r() * 0.7, rot: 0, spin: 0, ph: r(),
            g: Math.max(fx.gravity, 200), k: 0.4, plain: true,
            ss: [fx.sizeStart * fx.splashSize, fx.sizeStart * fx.splashSize * 0.35]
          });
        }
      });
      P = P.concat(kids);
    }
    return P;
  }

  var liq = document.createElement('canvas');
  var liqX = liq.getContext('2d', { willReadFrequently: true });

  function draw(c, t, w, h, o) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    if (!o.keep) {
      c.clearRect(0, 0, w, h);
      if (o.bg) { c.fillStyle = o.bg; c.fillRect(0, 0, w, h); }
    }
    if (fx.kind && fx.kind !== 'particles') { drawSpecial(c, t, w, h, o); return; }
    var ox = fx.ox * w, oy = fx.oy * h, D = fx.duration, loop = fx.mode === 'loop';
    var g = c;
    if (fx.liquid) {
      if (liq.width !== w || liq.height !== h) { liq.width = w; liq.height = h; }
      g = liqX;
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, w, h);
    } else {
      g.globalCompositeOperation = fx.blend;
    }
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var age = loop ? (((t - p.tb) % D) + D) % D : t - p.tb;
      if (age < 0 || age > p.life) continue;
      var u = age / p.life, st = stateAt(p, age);
      var a = fx.liquid ? 1 : fx.opacity;
      if (fx.fadeIn > 0) a *= Math.min(1, u / fx.fadeIn);
      if (fx.fadeOut > 0) a *= Math.min(1, (1 - u) / fx.fadeOut);
      if (a <= 0.003) continue;
      var size = (p.ss ? lerp(p.ss[0], p.ss[1], u) : lerp(fx.sizeStart, fx.sizeEnd, u)) * p.sz;
      if (size < 0.2) continue;
      var spr = ramp[Math.min(ramp.length - 1, Math.floor(u * ramp.length))];
      var rot, sx = size, sy = size;
      if (fx.stretch > 0) {
        rot = Math.atan2(st.vy, st.vx);
        sx = size * (1 + fx.stretch * Math.hypot(st.vx, st.vy) / 200);
      } else rot = p.rot + p.spin * age;
      var cs = Math.cos(rot), sn = Math.sin(rot);
      g.globalAlpha = Math.min(1, a);
      g.setTransform(cs * sx / SP, sn * sx / SP, -sn * sy / SP, cs * sy / SP, ox + st.x, oy + st.y);
      g.drawImage(spr, -SP / 2, -SP / 2);
    }
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';

    if (fx.liquid) {                       // goo pass: turn soft blobs into solid liquid
      var im = liqX.getImageData(0, 0, w, h), dd = im.data;
      var sf = Math.max(0.02, fx.gooS), lo = fx.gooT - sf / 2, hi = fx.gooT + sf / 2;
      for (var n = 3; n < dd.length; n += 4) {
        var al = dd[n] / 255;
        if (al <= lo) dd[n] = 0;
        else if (al >= hi) dd[n] = 255;
        else { var q = (al - lo) / (hi - lo); dd[n] = Math.round(q * q * (3 - 2 * q) * 255); }
      }
      liqX.putImageData(im, 0, 0);
      c.globalAlpha = fx.opacity; c.globalCompositeOperation = fx.blend;
      c.drawImage(liq, 0, 0);
    }
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';

    if (o.guide) {
      c.strokeStyle = 'rgba(0,200,255,0.9)'; c.lineWidth = 1; c.setLineDash([4, 3]);
      c.beginPath(); c.moveTo(ox - 8, oy); c.lineTo(ox + 8, oy); c.moveTo(ox, oy - 8); c.lineTo(ox, oy + 8); c.stroke();
      if (fx.shape === 'circle' || fx.shape === 'ring') { c.beginPath(); c.arc(ox, oy, fx.er, 0, TAU); c.stroke(); }
      else if (fx.shape === 'line') { c.beginPath(); c.moveTo(ox - fx.er, oy); c.lineTo(ox + fx.er, oy); c.stroke(); }
      else if (fx.shape === 'rect') c.strokeRect(ox - fx.er, oy - fx.er, fx.er * 2, fx.er * 2);
      if (fx.floor) {
        c.strokeStyle = 'rgba(255,170,0,0.95)'; c.setLineDash([6, 4]);
        var fy = fx.floorY * h;
        c.beginPath(); c.moveTo(0, fy); c.lineTo(w, fy); c.stroke();
      }
      c.setLineDash([]);
    }
  }

  // ---------- time + preview ----------
  function nFrames() { return Math.max(1, Math.round(fx.duration * fx.fps)); }
  function curT() { var D = fx.duration; return time % (fx.mode === 'loop' ? D : D + 0.5); }
  function curFrameIdx() { return clamp(Math.floor(curT() / fx.duration * nFrames()), 0, nFrames() - 1); }
  function paintNow() {
    draw(ctx, curT(), fx.w, fx.h, { bg: previewBg === 'checker' ? null : previewBg, guide: $('vp-guide').checked });
    var f = curFrameIdx();
    $('vp-scrub').value = f;
    $('vp-flabel').textContent = 'Frame ' + f + ' / ' + (nFrames() - 1);
  }
  function updateInfo() {
    $('vp-scrub').max = nFrames() - 1;
    $('vfx-info').textContent = nFrames() + ' frames · ' + fx.duration + 's · ' + fx.fps + ' fps · ' + fx.w + '×' + fx.h +
      (fx.mode === 'loop' ? ' · loops (life capped at duration)' : ' · one shot');
  }
  function fit() {
    var r = stage.getBoundingClientRect();
    var s = Math.max(0.25, Math.min((r.width - 16) / fx.w, (r.height - 16) / fx.h));
    cv.style.width = Math.round(fx.w * s) + 'px';
    cv.style.height = Math.round(fx.h * s) + 'px';
  }
  function refresh(k) {
    parts = build();
    if (!k || { c0: 1, c1: 1, c2: 1, sprite: 1, tint: 1 }[k]) buildRamp();
    updateInfo();
    paintNow();
  }
  function tick(ts) {
    if (!isOpen) return;
    requestAnimationFrame(tick);
    var dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    if (playing) { time += dt; paintNow(); }
  }

  // ---------- controls ----------
  var ctrls = {};
  function addRow(d) {
    if (d.length === 1) {
      var h = document.createElement('div'); h.className = 'vsec'; h.textContent = d[0]; right.appendChild(h); return;
    }
    var k = d[0], type = d[2];
    var row = document.createElement('div'); row.className = 'vr';
    var lab = document.createElement('label'); lab.textContent = d[1]; row.appendChild(lab);
    if (type === 'num') {
      var rg = document.createElement('input'), nm = document.createElement('input');
      rg.type = 'range'; nm.type = 'number';
      [rg, nm].forEach(function (e) { e.min = d[3]; e.max = d[4]; e.step = d[5]; });
      var on = function (src) {
        var v = Number(src.value);
        if (isNaN(v)) return;
        v = clamp(v, d[3], d[4]);
        fx[k] = v;
        if (src !== rg) rg.value = v;
        if (src !== nm) nm.value = v;
        refresh(k);
      };
      rg.addEventListener('input', function () { on(rg); });
      nm.addEventListener('input', function () { on(nm); });
      row.appendChild(rg); row.appendChild(nm);
      ctrls[k] = function () { rg.value = fx[k]; nm.value = fx[k]; };
    } else if (type === 'sel') {
      var s = document.createElement('select');
      d[3].forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; s.appendChild(op); });
      s.addEventListener('change', function () { fx[k] = s.value; refresh(k); });
      row.appendChild(s);
      ctrls[k] = function () { s.value = fx[k]; };
    } else if (type === 'chk') {
      var ch = document.createElement('input'); ch.type = 'checkbox';
      ch.addEventListener('change', function () { fx[k] = ch.checked; refresh(k); });
      row.appendChild(ch);
      ctrls[k] = function () { ch.checked = !!fx[k]; };
    } else if (type === 'col') {
      var co = document.createElement('input'); co.type = 'color';
      co.addEventListener('click', function (e) {
        e.preventDefault();
        ColorPicker.open(co, co.value, 100, function (hex) { co.value = hex; fx[k] = hex; refresh(k); }, { alpha: false });
      });
      row.appendChild(co);
      ctrls[k] = function () { co.value = fx[k]; };
    }
    right.appendChild(row);
  }
  UI.forEach(addRow);

  right.insertAdjacentHTML('beforeend',
    '<div class="vsec">Export (game assets)</div>' +
    '<div class="vr"><label>Frame size</label><select id="vx-size">' +
    '<option value="64,64">64 × 64</option><option value="128,128">128 × 128</option><option value="192,192">192 × 192</option>' +
    '<option value="256,256">256 × 256</option><option value="384,384">384 × 384</option><option value="512,512">512 × 512</option>' +
    '<option value="256,128">256 × 128</option><option value="512,256">512 × 256</option></select></div>' +
    '<div class="vr"><label>Columns</label><input type="number" id="vx-cols" value="8" min="1" max="64"></div>' +
    '<div class="vr"><label>Padding px</label><input type="number" id="vx-pad" value="0" min="0" max="32"></div>' +
    '<div class="vr"><label>Background</label><select id="vx-bg"><option value="none">Transparent</option>' +
    '<option value="#000000">Black (for additive)</option></select></div>' +
    '<div class="vr"><label>File name</label><input type="text" id="vx-name" value="vfx"></div>' +
    '<div class="vbtns"><button id="vx-sheet">⬇ Sprite sheet + JSON</button><button id="vx-png">⬇ This frame PNG</button>' +
    '<button id="vx-send">→ Send this frame to canvas</button>' +
    '<button id="vx-save">💾 Save effect (.json)</button><button id="vx-open">📂 Open effect</button></div>' +
    '<input type="file" id="vx-openfile" accept=".json,application/json" hidden>' +
    '<p class="vhint">Tap or drag on the preview to move the emitter. Use a Black background for additive (glow) effects if your game does not use additive blending.</p>');

  (function () {
    var vb = right.querySelector('.vbtns');
    [['vx-gif', '⬇ Animated GIF'], ['vx-webm', '⬇ WebM video']].forEach(function (d) {
      var b = document.createElement('button'); b.id = d[0]; b.textContent = d[1]; vb.insertBefore(b, vb.firstChild.nextSibling);
    });
    function guard() {
      if (nFrames() * fx.w * fx.h > 20000000) { alert('Too large. Use a smaller frame size, a shorter duration or a lower FPS.'); return false; }
      return true;
    }
    $('vx-gif').addEventListener('click', async function () {
      if (!guard()) return;
      var bg = exportBg();
      try {
        var blob = await MediaExport.gif(function (i) { return frameCanvas(i, bg); }, nFrames(), fx.w, fx.h, fx.fps, !bg, fx.mode === 'loop', say);
        downloadBlob(blob, fname() + '.gif'); say('GIF saved');
      } catch (err) { alert('GIF export failed: ' + err.message); }
    });
    $('vx-webm').addEventListener('click', async function () {
      if (!guard()) return;
      var bg = exportBg() || '#000000';
      try {
        var blob = await MediaExport.webm(function (i) { return frameCanvas(i, bg); }, nFrames(), fx.w, fx.h, fx.fps, fx.mode === 'loop' ? 3 : 1, bg, say);
        downloadBlob(blob, fname() + '.webm'); say('Video saved');
      } catch (err) { alert('Video export failed: ' + err.message); }
    });
  })();

  // presets + custom sprite buttons (left column)
  var presetBtns = [];
  PRE.forEach(function (p) {
    var b = document.createElement('button');
    b.textContent = p[0];
    b.addEventListener('click', function () {
      fx = Object.assign({}, DEF, p[1], { w: fx.w, h: fx.h });
      presetBtns.forEach(function (x) { x.classList.toggle('on', x === b); });
      time = 0; syncAll();
    });
    left.appendChild(b); presetBtns.push(b);
  });
  var cap = document.createElement('div'); cap.className = 'vsec'; cap.textContent = 'My sprite'; left.appendChild(cap);
  function leftBtn(id, text, title) {
    var b = document.createElement('button'); b.id = id; b.textContent = text; b.title = title; left.appendChild(b);
  }
  leftBtn('vs-sel', 'From selection', 'Use the shape you had selected on the canvas as the particle');
  leftBtn('vs-img', 'Import image', 'Use a PNG/JPG as the particle');
  left.insertAdjacentHTML('beforeend', '<input type="file" id="vs-file" accept="image/*" hidden>');

  leftBtn('vs-path', 'Path from selection', 'Use the path selected on the canvas as the river / pipe path');
  $('vs-path').addEventListener('click', function () {
    var it = selection.length ? selection[0] : null;
    var path = it && (it.className === 'Path' ? it : (it.className === 'CompoundPath' ? it.children[0] : null));
    if (!path || !path.length) { say('Close VFX, select a path (pen or line) on the canvas, then open VFX again'); return; }
    var N = 48, len = path.length, pts = [], i;
    for (i = 0; i <= N; i++) pts.push(path.localToGlobal(path.getPointAt(len * i / N)));
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    pts.forEach(function (p) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    var s = Math.min(0.8 * fx.w / Math.max(x1 - x0, 1), 0.8 * fx.h / Math.max(y1 - y0, 1)), cx0 = (x0 + x1) / 2, cy0 = (y0 + y1) / 2;
    fx.path = pts.map(function (p) { return [((p.x - cx0) * s + fx.w / 2) / fx.w, ((p.y - cy0) * s + fx.h / 2) / fx.h]; });
    fx.pathOn = true; fx.kind = 'particles';
    ctrls.pathOn(); ctrls.kind();
    refresh('path');
    say('Path loaded. Tune River width and Wobble.');
  });

  function syncAll() {
    Object.keys(ctrls).forEach(function (k) { ctrls[k](); });
    $('vx-size').value = fx.w + ',' + fx.h;
    cv.width = fx.w; cv.height = fx.h;
    parts = build(); buildRamp(); updateInfo(); fit(); paintNow();
  }

  function setCustom(src, w, h) {
    var c = document.createElement('canvas');
    c.width = c.height = SP;
    var s = Math.min(SP / w, SP / h), dw = w * s, dh = h * s;
    c.getContext('2d').drawImage(src, (SP - dw) / 2, (SP - dh) / 2, dw, dh);
    customBase = c; fx.sprite = 'custom';
    ctrls.sprite(); buildRamp(); paintNow();
    say('Custom sprite set');
  }
  $('vs-sel').addEventListener('click', function () {
    if (!selection.length) { say('Close VFX, select a shape on the canvas, then open VFX again'); return; }
    var b = selectionStrokeBounds();
    var w = Math.max(8, Math.min(256, Math.round(b.width)));
    var h = Math.max(8, Math.round(w * b.height / b.width));
    var c = renderArea(b, w, h, true, null);
    setCustom(c, c.width, c.height);
  });
  $('vs-img').addEventListener('click', function () { $('vs-file').click(); });
  $('vs-file').addEventListener('change', function () {
    var f = this.files[0]; this.value = '';
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var im = new Image();
      im.onload = function () { setCustom(im, im.width, im.height); };
      im.src = rd.result;
    };
    rd.readAsDataURL(f);
  });

  $('vx-size').addEventListener('change', function () {
    var v = this.value.split(',');
    fx.w = Number(v[0]); fx.h = Number(v[1]);
    cv.width = fx.w; cv.height = fx.h;
    updateInfo(); fit(); paintNow();
  });

  // ---------- preview bar ----------
  function setPlay(on) { playing = on; $('vp-play').textContent = on ? '⏸ Pause' : '▶ Play'; $('vp-play').classList.toggle('on', on); }
  $('vp-play').addEventListener('click', function () { setPlay(!playing); });
  $('vp-first').addEventListener('click', function () { time = 0; paintNow(); });
  $('vp-scrub').addEventListener('input', function () {
    setPlay(false);
    time = Number(this.value) * fx.duration / nFrames();
    paintNow();
  });
  $('vp-bg').addEventListener('change', function () { previewBg = this.value; paintNow(); });
  $('vp-guide').addEventListener('change', paintNow);
  $('vp-seed').addEventListener('click', function () {
    fx.seed = 1 + Math.floor(Math.random() * 9999);
    ctrls.seed(); refresh('seed');
  });

  var dragging = false;
  function setOrigin(e) {
    var r = cv.getBoundingClientRect();
    fx.ox = clamp((e.clientX - r.left) / r.width, 0, 1);
    fx.oy = clamp((e.clientY - r.top) / r.height, 0, 1);
    if (fx.floor) parts = build();
    paintNow();
  }
  cv.addEventListener('pointerdown', function (e) { cv.setPointerCapture(e.pointerId); dragging = true; setOrigin(e); });
  cv.addEventListener('pointermove', function (e) { if (dragging) setOrigin(e); });
  cv.addEventListener('pointerup', function () { dragging = false; });
  cv.addEventListener('pointercancel', function () { dragging = false; });

  // ---------- export ----------
  function frameCanvas(i, bg) {
    var c = document.createElement('canvas');
    c.width = fx.w; c.height = fx.h;
    draw(c.getContext('2d'), i * fx.duration / nFrames(), fx.w, fx.h, { bg: bg, guide: false });
    return c;
  }
  function exportBg() { var v = $('vx-bg').value; return v === 'none' ? null : v; }
  function fname() { return ($('vx-name').value || 'vfx').replace(/[^\w\-]+/g, '_'); }

  $('vx-sheet').addEventListener('click', function () {
    var n = nFrames(), w = fx.w, h = fx.h;
    var cols = Math.min(n, clamp(Math.round(Number($('vx-cols').value) || 1), 1, 64));
    var pad = clamp(Math.round(Number($('vx-pad').value) || 0), 0, 32);
    var rows = Math.ceil(n / cols), W = cols * w + (cols + 1) * pad, H = rows * h + (rows + 1) * pad;
    if (W > 8192 || H > 8192 || W * H > 16000000) {
      alert('The sheet would be ' + W + ' x ' + H + ' px. Too big. Use a smaller frame size, fewer frames or more columns.');
      return;
    }
    var sheet = document.createElement('canvas');
    sheet.width = W; sheet.height = H;
    var sx = sheet.getContext('2d'), bg = exportBg(), meta = [];
    if (bg) { sx.fillStyle = bg; sx.fillRect(0, 0, W, H); }
    for (var i = 0; i < n; i++) {
      var x = pad + (i % cols) * (w + pad), y = pad + Math.floor(i / cols) * (h + pad);
      sx.drawImage(frameCanvas(i, bg), x, y);
      meta.push({ index: i, x: x, y: y, w: w, h: h });
    }
    var name = fname();
    var json = { image: name + '.png', frameWidth: w, frameHeight: h, columns: cols, rows: rows,
                 fps: fx.fps, frameCount: n, durationSeconds: fx.duration, loop: fx.mode === 'loop', frames: meta };
    sheet.toBlob(function (blob) {
      if (!blob) { alert('Export failed. Try a smaller size.'); return; }
      downloadBlob(blob, name + '.png');
      setTimeout(function () {
        downloadBlob(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }), name + '.json');
      }, 500);
    }, 'image/png');
  });
  $('vx-png').addEventListener('click', function () {
    frameCanvas(curFrameIdx(), exportBg()).toBlob(function (blob) {
      if (blob) downloadBlob(blob, fname() + '-frame' + curFrameIdx() + '.png');
    }, 'image/png');
  });
  $('vx-send').addEventListener('click', function () {
    var f = curFrameIdx(), c = frameCanvas(f, exportBg());
    closeVfx();
    var r = new paper.Raster(c);
    r.position = paper.view.center;
    registerItem(r, 'VFX frame', '✨');
    setSelection([r]);
    saveState();
    renderLayers();
    say('VFX frame ' + f + ' added to the canvas');
  });
  $('vx-save').addEventListener('click', function () {
    downloadBlob(new Blob([JSON.stringify(fx, null, 2)], { type: 'application/json' }), fname() + '-effect.json');
  });
  $('vx-open').addEventListener('click', function () { $('vx-openfile').click(); });
  $('vx-openfile').addEventListener('change', function () {
    var f = this.files[0]; this.value = '';
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var d = JSON.parse(rd.result);
        fx = Object.assign({}, DEF, d);
        if (fx.sprite === 'custom' && !customBase) fx.sprite = 'soft';
        time = 0; syncAll();
      } catch (err) { alert('This is not a VFX effect file.'); }
    };
    rd.readAsText(f);
  });

  // ---------- open / close ----------
  function openVfx() {
    if (isOpen) return;
    isOpen = true;
    root.style.display = 'flex';
    lastTs = 0;
    syncAll();
    requestAnimationFrame(tick);
  }
  function closeVfx() {
    isOpen = false;
    root.style.display = 'none';
    ColorPicker.close();
  }
  $('btn-vfx').addEventListener('click', openVfx);
  $('vfx-close').addEventListener('click', closeVfx);
  window.addEventListener('resize', function () { if (isOpen) fit(); });

  // while VFX is open, the drawing app must not react to key presses
  window.addEventListener('keydown', function (e) {
    if (!isOpen) return;
    e.stopImmediatePropagation();
    if (e.key === 'Escape') closeVfx();
    else if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
      e.preventDefault(); setPlay(!playing);
    }
  }, true);
  window.addEventListener('keyup', function (e) { if (isOpen) e.stopImmediatePropagation(); }, true);

  ctrls.sprite = ctrls.sprite || function () {};
  presetBtns[0].classList.add('on');
  fx = Object.assign({}, DEF, PRE[0][1]);

    // ===== Day 8: layer stack =====
  var layers = [fx], act = 0, customVer = 0, cache = new WeakMap();

  css.textContent += '.vlr{display:flex;gap:4px;margin-bottom:5px}.vlr .nm{flex:1;text-align:left;overflow:hidden;' +
    'text-overflow:ellipsis;white-space:nowrap}.vlr button{padding:6px 8px}';

  var _setCustom = setCustom;
  setCustom = function () { customVer++; return _setCustom.apply(this, arguments); };

  function keyOf(L) {
    return JSON.stringify(L, function (k, v) { return (k === 'lname' || k === 'lhide') ? undefined : v; }) + '|' + customVer;
  }
  function prep(L) {
    var key = keyOf(L), e = cache.get(L);
    if (e && e.key === key) return e;
    var sf = fx, sp = parts, sr = ramp;
    fx = L; parts = build(); buildRamp();
    e = { key: key, parts: parts, ramp: ramp };
    fx = sf; parts = sp; ramp = sr;
    cache.set(L, e);
    return e;
  }
  function drawStack(c, t, w, h, o) {
    layers[act] = fx;
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, w, h);
    if (o.bg) { c.fillStyle = o.bg; c.fillRect(0, 0, w, h); }
    var sf = fx, sp = parts, sr = ramp;
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      if (L.lhide) continue;
      var e = prep(L);
      fx = L; parts = e.parts; ramp = e.ramp;
      draw(c, t, w, h, { keep: true, guide: !!o.guide && L === sf });
    }
    fx = sf; parts = sp; ramp = sr;
  }

  // preview + export now render the whole stack
  paintNow = function () {
    drawStack(ctx, curT(), fx.w, fx.h, { bg: previewBg === 'checker' ? null : previewBg, guide: $('vp-guide').checked });
    var f = curFrameIdx();
    $('vp-scrub').value = f;
    $('vp-flabel').textContent = 'Frame ' + f + ' / ' + (nFrames() - 1);
  };
  frameCanvas = function (i, bg) {
    var c = document.createElement('canvas');
    c.width = fx.w; c.height = fx.h;
    drawStack(c.getContext('2d'), i * fx.duration / nFrames(), fx.w, fx.h, { bg: bg, guide: false });
    return c;
  };
  curT = function () {
    layers[act] = fx;
    var D = fx.duration, anyBurst = layers.some(function (l) { return l.mode !== 'loop'; });
    return time % (anyBurst ? D + 0.5 : D);
  };

  // duration / fps / size are shared by every layer
  var _refresh = refresh;
  refresh = function (k) {
    layers[act] = fx;
    if (k === 'duration' || k === 'fps') layers.forEach(function (l) { l.duration = fx.duration; l.fps = fx.fps; });
    _refresh(k);
  };
  $('vx-size').addEventListener('change', function () { layers.forEach(function (l) { l.w = fx.w; l.h = fx.h; }); });

  // loading a preset keeps the stack's duration / fps / size
  presetBtns.forEach(function (b, i) {
    b.addEventListener('click', function () {
      if (layers.length > 1) {
        var o = layers[act === 0 ? 1 : 0];
        fx.duration = o.duration; fx.fps = o.fps; fx.w = o.w; fx.h = o.h;
        syncAll();
      }
      fx.lname = PRE[i][0];
      layers[act] = fx;
      renderLayerList();
    });
  });

  // ---------- layer list UI ----------
  var lbox = document.createElement('div');
  lbox.innerHTML =
    '<div class="vsec" style="margin-top:2px">Layers (top of list = drawn on top)</div><div id="vl-list"></div>' +
    '<div class="vr"><select id="vl-add"></select></div>' +
    '<div class="vbtns" style="margin-top:4px"><button id="vl-dup">⧉ Duplicate layer</button>' +
    '<button id="vl-save">💾 Save stack (.json)</button><button id="vl-open">📂 Open stack</button></div>' +
    '<input type="file" id="vl-file" accept=".json,application/json" hidden>';
  right.insertBefore(lbox, right.firstChild);

  function layerName(L) {
    return L.lname || ({ particles: 'Particles', lightning: 'Lightning', shockwave: 'Shockwave', slash: 'Slash' }[L.kind] || 'Layer');
  }
  function selectLayer(i) {
    layers[act] = fx; act = i; fx = layers[i];
    presetBtns.forEach(function (x) { x.classList.remove('on'); });
    syncAll(); renderLayerList();
  }
  function renderLayerList() {
    layers[act] = fx;
    var list = $('vl-list');
    list.innerHTML = '';
    for (var i = layers.length - 1; i >= 0; i--) (function (i) {
      var L = layers[i], row = document.createElement('div');
      row.className = 'vlr';
      row.innerHTML = '<button class="nm"></button><button class="eye"></button><button class="up" title="Move up">▲</button>' +
        '<button class="dn" title="Move down">▼</button><button class="rm" title="Delete layer">✕</button>';
      var nm = row.querySelector('.nm');
      nm.textContent = (i + 1) + '. ' + layerName(L);
      if (i === act) nm.classList.add('on');
      row.querySelector('.eye').textContent = L.lhide ? '—' : '👁';
      nm.addEventListener('click', function () { selectLayer(i); });
      row.querySelector('.eye').addEventListener('click', function () { L.lhide = !L.lhide; renderLayerList(); paintNow(); });
      function move(d) {
        var j = i + d;
        if (j < 0 || j >= layers.length) return;
        layers[act] = fx;
        var tmp = layers[i]; layers[i] = layers[j]; layers[j] = tmp;
        act = layers.indexOf(fx);
        renderLayerList(); paintNow();
      }
      row.querySelector('.up').addEventListener('click', function () { move(1); });
      row.querySelector('.dn').addEventListener('click', function () { move(-1); });
      row.querySelector('.rm').addEventListener('click', function () {
        if (layers.length < 2) { say('Keep at least one layer'); return; }
        layers[act] = fx;
        layers.splice(i, 1);
        if (i < act) act--; else if (i === act) act = Math.min(act, layers.length - 1);
        fx = layers[act];
        syncAll(); renderLayerList();
      });
      list.appendChild(row);
    })(i);
  }

  var addSel = $('vl-add');
  addSel.innerHTML = '<option value="">＋ Add layer from preset…</option>' +
    PRE.map(function (p, i) { return '<option value="' + i + '">' + p[0] + '</option>'; }).join('');
  addSel.addEventListener('change', function () {
    if (addSel.value === '') return;
    var p = PRE[Number(addSel.value)];
    addSel.value = '';
    layers[act] = fx;
    var b0 = layers[0];
    var L = Object.assign({}, DEF, p[1], { w: b0.w, h: b0.h, fps: b0.fps, duration: b0.duration, lname: p[0] });
    layers.push(L); act = layers.length - 1; fx = L;
    presetBtns.forEach(function (x) { x.classList.remove('on'); });
    syncAll(); renderLayerList();
  });
  $('vl-dup').addEventListener('click', function () {
    layers[act] = fx;
    var L = JSON.parse(JSON.stringify(fx));
    L.lname = layerName(fx) + ' copy';
    L.seed = ((fx.seed || 1) * 7 + 13) % 9999 + 1;
    layers.splice(act + 1, 0, L);
    act++; fx = L;
    syncAll(); renderLayerList();
  });
  $('vl-save').addEventListener('click', function () {
    layers[act] = fx;
    downloadBlob(new Blob([JSON.stringify({ vfxStack: 1, layers: layers }, null, 2)], { type: 'application/json' }), fname() + '-stack.json');
  });
  $('vl-open').addEventListener('click', function () { $('vl-file').click(); });
  $('vl-file').addEventListener('change', function () {
    var f = this.files[0]; this.value = '';
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var d = JSON.parse(rd.result);
        if (!d.layers || !d.layers.length) throw new Error('bad');
        layers = d.layers.map(function (l) { return Object.assign({}, DEF, l); });
        act = 0; fx = layers[0]; time = 0;
        presetBtns.forEach(function (x) { x.classList.remove('on'); });
        syncAll(); renderLayerList();
      } catch (err) { alert('This is not a VFX stack file.'); }
    };
    rd.readAsText(f);
  });

  renderLayerList();
})();

// ======================================================
// DAY 6: GRADIENT TOOL
// ======================================================
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var say = function (m) { if (window.toast) window.toast(m); };
  var clamp = function (x, a, b) { return Math.min(b, Math.max(a, x)); };

  var G = { stops: [{ o: 0, c: '#2f6fed', a: 100 }, { o: 100, c: '#ff4d6d', a: 100 }], sel: 0, cx: 50, cy: 50, rad: 100 };
  var forceGeom = false, prevType = fillTypeSel.value;

  // ---------- styles ----------
  var css = document.createElement('style');
  css.textContent =
    '#grad-ed{display:none;margin:2px 0 14px;padding:8px 8px 4px;border:1px solid #444;border-radius:8px;background:#262626}' +
    '.gchk{background-color:#fff;background-image:var(--g),linear-gradient(45deg,#bbb 25%,transparent 25%,transparent 75%,#bbb 75%),linear-gradient(45deg,#bbb 25%,transparent 25%,transparent 75%,#bbb 75%);background-size:100% 100%,10px 10px,10px 10px;background-position:0 0,0 0,5px 5px}' +
    '#gb-wrap{position:relative;height:54px;margin:4px 12px 8px}' +
    '#gb{position:absolute;left:0;right:0;top:0;height:26px;border-radius:5px;border:1px solid #111;cursor:copy;touch-action:none}' +
    '#gs-layer{position:absolute;left:0;right:0;top:28px;height:26px}' +
    '.gs{position:absolute;top:0;width:26px;height:26px;margin-left:-13px;touch-action:none;cursor:grab}' +
    '.gs i{display:block;width:16px;height:16px;margin:4px auto 0;border:2px solid #fff;border-radius:3px;box-shadow:0 0 0 1px #000}' +
    '.gs.sel i{border-color:#ff9f1c;box-shadow:0 0 0 2px #000;transform:scale(1.2)}' +
    '#gp{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}' +
    '#gp button{width:46px;height:24px;padding:0;border:1px solid #555;border-radius:4px;cursor:pointer}' +
    '.gh{position:absolute;display:none;z-index:9;width:16px;height:16px;transform:translate(-50%,-50%);border:3px solid #fff;box-shadow:0 0 0 2px #000;touch-action:none;cursor:move}' +
    '.gh.a{border-radius:50%;background:#2f6fed}.gh.b{background:#ff9f1c}' +
    '#gh-line{position:absolute;display:none;z-index:8;height:2px;background:#fff;box-shadow:0 0 0 1px #000;pointer-events:none;transform-origin:0 50%}' +
    '@media (pointer:coarse){.gs{width:38px;height:36px;margin-left:-19px}#gb-wrap{height:64px}#gs-layer{height:36px}#gp button{width:56px;height:32px}.gh{width:26px;height:26px}}';
  document.head.appendChild(css);

  // ---------- colour helpers ----------
  function rgbOf(h) { var n = parseInt(String(h).slice(1), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function hexOf(r) { return '#' + r.map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join(''); }
  function sorted() { return G.stops.slice().sort(function (a, b) { return a.o - b.o; }); }
  function cssGrad(list) {
    return 'linear-gradient(to right,' + list.map(function (s) {
      return 'rgba(' + rgbOf(s.c).join(',') + ',' + (s.a / 100) + ') ' + s.o + '%';
    }).join(',') + ')';
  }
  function colorAt(pos) {
    var st = sorted(), i = 0;
    if (pos <= st[0].o) return { c: st[0].c, a: st[0].a };
    if (pos >= st[st.length - 1].o) return { c: st[st.length - 1].c, a: st[st.length - 1].a };
    while (i < st.length - 1 && st[i + 1].o <= pos) i++;
    var A = st[i], B = st[i + 1], t = (pos - A.o) / ((B.o - A.o) || 1);
    var ra = rgbOf(A.c), rb = rgbOf(B.c);
    return { c: hexOf([0, 1, 2].map(function (n) { return ra[n] + (rb[n] - ra[n]) * t; })), a: Math.round(A.a + (B.a - A.a) * t) };
  }

  // ---------- item helpers ----------
  function firstLeaf(item) { while (item && item.className === 'Group' && item.children.length) item = item.children[0]; return item; }
  function leavesOf(item, out) {
    out = out || [];
    if (item.className === 'Group') item.children.forEach(function (c) { leavesOf(c, out); });
    else out.push(item);
    return out;
  }
  function gradOf(item) { var l = firstLeaf(item), fc = l && l.fillColor; return (fc && fc.type === 'gradient') ? fc : null; }
  function isGrad() { return fillTypeSel.value === 'linear' || fillTypeSel.value === 'radial'; }

  function stopsForPaper() {
    return sorted().map(function (s, i) {
      var c = new paper.Color(s.c); c.alpha = s.a / 100;
      return [c, clamp(s.o / 100, i === 0 ? 0 : 0.001, 1)];
    });
  }
  function defaultGeom(item, radial) {
    var b = item.bounds;
    if (radial) {
      var o = new paper.Point(b.x + b.width * G.cx / 100, b.y + b.height * G.cy / 100);
      var r = Math.max(Math.max(b.width, b.height) / 2 * G.rad / 100, 1);
      return [o, o.add(new paper.Point(r, 0))];
    }
    var a = (Number(gradAngleInput.value) || 0) * Math.PI / 180;
    var dir = new paper.Point(Math.cos(a), Math.sin(a));
    var len = Math.abs(b.width * dir.x) + Math.abs(b.height * dir.y);
    return [b.center.subtract(dir.multiply(len / 2)), b.center.add(dir.multiply(len / 2))];
  }

  // the app's fill builder now uses the stop list
  makeFill = function (item) {
    var type = fillTypeSel.value;
    if (type === 'none') return null;
    if (type === 'solid') return colorWithAlpha(fillInput.value, Number(fillOpInput.value));
    var radial = type === 'radial', fc = item.fillColor, geo;
    if (!forceGeom && fc && fc.type === 'gradient' && !!fc.gradient.radial === radial && fc.origin && fc.destination) {
      geo = [new paper.Point(fc.origin.x, fc.origin.y), new paper.Point(fc.destination.x, fc.destination.y)];
    } else geo = defaultGeom(item, radial);
    return { gradient: { stops: stopsForPaper(), radial: radial }, origin: geo[0], destination: geo[1] };
  };

  // ---------- editor panel ----------
  var typeRow = fillTypeSel.closest('.prop-row');
  var ed = document.createElement('div');
  ed.id = 'grad-ed';
  ed.innerHTML =
    '<div id="gb-wrap"><div id="gb" class="gchk"></div><div id="gs-layer"></div></div>' +
    '<div class="prop-row">Stop color <input type="color" id="gs-color"></div>' +
    '<div class="prop-row">Opacity % <input type="number" id="gs-alpha" min="0" max="100"></div>' +
    '<div class="prop-row">Position % <input type="number" id="gs-pos" min="0" max="100" step="1"></div>' +
    '<div class="layer-actions"><button id="gs-del">Delete stop</button><button id="gs-rev">Reverse</button><button id="gs-even">Even out</button></div>' +
    '<div id="gr-rad" style="display:none">' +
    '<div class="prop-row">Center X % <input type="number" id="gr-cx" min="-100" max="200" value="50"></div>' +
    '<div class="prop-row">Center Y % <input type="number" id="gr-cy" min="-100" max="200" value="50"></div>' +
    '<div class="prop-row">Radius % <input type="number" id="gr-r" min="1" max="500" value="100"></div></div>' +
    '<div id="gp"></div>' +
    '<p class="hint">Tap the bar to add a stop. Drag a stop to move it. Each stop has its own opacity. For gradients, Fill opacity is not used. Press D for the Gradient tool, click a shape and drag on the canvas.</p>';
  typeRow.parentNode.insertBefore(ed, typeRow.nextSibling);

  var gb = $('gb'), layer = $('gs-layer'), gsColor = $('gs-color'), gsAlpha = $('gs-alpha'), gsPos = $('gs-pos');
  var markers = [];

  function show(el, on) { var row = el.closest('.prop-row'); if (row) row.style.display = on ? '' : 'none'; }
  function syncVisibility() {
    var g = isGrad(), rad = fillTypeSel.value === 'radial';
    ed.style.display = g ? 'block' : 'none';
    $('gr-rad').style.display = rad ? 'block' : 'none';
    show(fill2Input, false);                       // replaced by the stop editor
    show(fillInput, !g);
    show(fillOpInput, !g);
    show(gradAngleInput, fillTypeSel.value === 'linear');
  }

  function light() {
    gb.style.setProperty('--g', cssGrad(sorted()));
    markers.forEach(function (m, i) {
      var s = G.stops[i];
      m.style.left = s.o + '%';
      m.firstChild.style.background = s.c;
    });
  }
  function fillInputs() {
    var s = G.stops[G.sel];
    if (!s) return;
    gsColor.value = s.c;
    if (document.activeElement !== gsAlpha) gsAlpha.value = s.a;
    if (document.activeElement !== gsPos) gsPos.value = Math.round(s.o * 10) / 10;
    $('gr-cx').value = Math.round(G.cx); $('gr-cy').value = Math.round(G.cy); $('gr-r').value = Math.round(G.rad);
  }
  function selectStop(i) {
    G.sel = clamp(i, 0, G.stops.length - 1);
    markers.forEach(function (m, n) { m.classList.toggle('sel', n === G.sel); });
    fillInputs();
  }
  function applyLive(final) {
    if (!selection.length) { if (final) say('Select a shape first, then edit its gradient'); return; }
    selection.forEach(paintFill);
    forceRedraw();
    if (final) saveState();
  }

  function buildMarkers() {
    layer.innerHTML = ''; markers = [];
    G.stops.forEach(function (s, i) {
      var m = document.createElement('div');
      m.className = 'gs'; m.innerHTML = '<i></i>';
      m.addEventListener('pointerdown', function (e) {
        e.preventDefault(); e.stopPropagation();
        m.setPointerCapture(e.pointerId);
        selectStop(i);
        var r = gb.getBoundingClientRect(), moved = false;
        function mv(ev) {
          moved = true;
          G.stops[i].o = Math.round(clamp((ev.clientX - r.left) / r.width * 100, 0, 100) * 10) / 10;
          light(); fillInputs(); applyLive(false);
        }
        function up() {
          m.removeEventListener('pointermove', mv);
          m.removeEventListener('pointerup', up);
          m.removeEventListener('pointercancel', up);
          if (moved) applyLive(true);
        }
        m.addEventListener('pointermove', mv);
        m.addEventListener('pointerup', up);
        m.addEventListener('pointercancel', up);
      });
      layer.appendChild(m); markers.push(m);
    });
    light(); selectStop(G.sel);
  }

  gb.addEventListener('pointerdown', function (e) {       // tap the bar = add a stop
    e.preventDefault();
    var r = gb.getBoundingClientRect();
    var pos = Math.round(clamp((e.clientX - r.left) / r.width * 100, 0, 100) * 10) / 10;
    var c = colorAt(pos);
    G.stops.push({ o: pos, c: c.c, a: c.a });
    G.sel = G.stops.length - 1;
    buildMarkers(); applyLive(true);
  });

  gsColor.addEventListener('click', function (e) {
    e.preventDefault();
    var s = G.stops[G.sel];
    ColorPicker.open(gsColor, s.c, s.a, function (hex, a, final) {
      s.c = hex; s.a = a; fillInputs(); light(); applyLive(final);
    }, { alpha: true });
  });
  gsAlpha.addEventListener('input', function () {
    G.stops[G.sel].a = clamp(Number(gsAlpha.value) || 0, 0, 100); light(); applyLive(false);
  });
  gsAlpha.addEventListener('change', function () { applyLive(true); });
  gsPos.addEventListener('input', function () {
    G.stops[G.sel].o = clamp(Number(gsPos.value) || 0, 0, 100); light(); applyLive(false);
  });
  gsPos.addEventListener('change', function () { applyLive(true); });

  wire('gs-del', function () {
    if (G.stops.length <= 2) { say('A gradient needs at least 2 stops'); return; }
    G.stops.splice(G.sel, 1);
    G.sel = Math.min(G.sel, G.stops.length - 1);
    buildMarkers(); applyLive(true);
  });
  wire('gs-rev', function () { G.stops.forEach(function (s) { s.o = Math.round((100 - s.o) * 10) / 10; }); light(); fillInputs(); applyLive(true); });
  wire('gs-even', function () {
    var st = sorted();
    st.forEach(function (s, i) { s.o = Math.round(i * 1000 / (st.length - 1)) / 10; });
    light(); fillInputs(); applyLive(true);
  });

  [['gr-cx', 'cx'], ['gr-cy', 'cy'], ['gr-r', 'rad']].forEach(function (p) {
    var el = $(p[0]);
    el.addEventListener('input', function () {
      G[p[1]] = Number(el.value) || 0;
      forceGeom = true; applyLive(false); forceGeom = false;
    });
    el.addEventListener('change', function () { if (selection.length) saveState(); });
  });
  gradAngleInput.addEventListener('input', function () {
    if (!isGrad()) return;
    forceGeom = true; applyLive(false); forceGeom = false;
  });

  // presets
  var PRESETS = [
    ['Sunset', [[0, '#ff512f', 100], [50, '#f09819', 100], [100, '#ffe259', 100]]],
    ['Ocean', [[0, '#1c6dd0', 100], [100, '#6dd5ed', 100]]],
    ['Fire', [[0, '#ffe259', 100], [40, '#ff8a1f', 100], [100, '#a40000', 100]]],
    ['Rainbow', [[0, '#ff0000', 100], [20, '#ffd400', 100], [40, '#00c853', 100], [60, '#00b8ff', 100], [80, '#3d5afe', 100], [100, '#d500f9', 100]]],
    ['Gold', [[0, '#bf953f', 100], [30, '#fcf6ba', 100], [60, '#b38728', 100], [100, '#fbf5b7', 100]]],
    ['Chrome', [[0, '#ffffff', 100], [45, '#9aa4b2', 100], [55, '#3b4452', 100], [100, '#c8d0da', 100]]],
    ['Neon', [[0, '#00f5ff', 100], [100, '#ff00e5', 100]]],
    ['White to clear', [[0, '#ffffff', 100], [100, '#ffffff', 0]]],
    ['Black to clear', [[0, '#000000', 100], [100, '#000000', 0]]]
  ];
  PRESETS.forEach(function (p) {
    var b = document.createElement('button');
    b.title = p[0]; b.className = 'gchk';
    b.style.setProperty('--g', cssGrad(p[1].map(function (s) { return { o: s[0], c: s[1], a: s[2] }; })));
    b.addEventListener('click', function () {
      G.stops = p[1].map(function (s) { return { o: s[0], c: s[1], a: s[2] }; });
      G.sel = 0; buildMarkers(); applyLive(true);
    });
    $('gp').appendChild(b);
  });

  // ---------- fill type switching ----------
  fillTypeSel.addEventListener('change', function () {
    var t = fillTypeSel.value, was = prevType;
    prevType = t;
    syncVisibility();
    if ((t === 'linear' || t === 'radial') && was !== 'linear' && was !== 'radial') {
      G.stops = [
        { o: 0, c: fillInput.value, a: Number(fillOpInput.value) || 100 },
        { o: 100, c: fill2Input.value, a: 100 }
      ];
      G.sel = 0; buildMarkers();
      forceGeom = true; applyLive(true); forceGeom = false;
    }
  });

  // ---------- read a selected shape's gradient into the editor ----------
  function loadFromColor(fc, leaf) {
    var stops = fc.gradient.stops, n = stops.length;
    G.stops = stops.map(function (s, i) {
      var c = s.color;
      return {
        o: Math.round((s.offset == null ? i / Math.max(1, n - 1) : s.offset) * 1000) / 10,
        c: c.toCSS(true), a: Math.round((c.alpha == null ? 1 : c.alpha) * 100)
      };
    });
    var b = leaf.bounds;
    if (fc.gradient.radial && fc.origin && fc.destination && b.width > 0 && b.height > 0) {
      G.cx = (fc.origin.x - b.x) / b.width * 100;
      G.cy = (fc.origin.y - b.y) / b.height * 100;
      G.rad = fc.origin.getDistance(fc.destination) / (Math.max(b.width, b.height) / 2) * 100;
    } else if (fc.origin && fc.destination) {
      gradAngleInput.value = Math.round(fc.destination.subtract(fc.origin).angle);
    }
    G.sel = 0;
    buildMarkers();
  }
  var _sync = syncPanelFromItem;
  syncPanelFromItem = function (item) {
    _sync(item);
    prevType = fillTypeSel.value;
    var fc = gradOf(item);
    if (fc) loadFromColor(fc, firstLeaf(item));
    syncVisibility();
  };

  // ---------- Gradient tool (draw the direction on the canvas) ----------
  tools.gradient = new paper.Tool();
  var gTargets = [], gStart = null, gMoved = false;

  tools.gradient.onMouseDown = function (e) {
    gMoved = false; gStart = e.point;
    var hit = paper.project.hitTest(e.point, { fill: true, stroke: true, tolerance: 4 });
    if (hit) {
      var top = topLevelItem(hit.item);
      if (selection.indexOf(top) < 0) setSelection([top]);
    }
    gTargets = selection.slice();
    if (!gTargets.length) say('Click a shape first, then drag to set the gradient');
  };
  tools.gradient.onMouseDrag = function (e) {
    if (!gTargets.length) return;
    if (!gMoved && e.point.getDistance(gStart) < 3) return;
    if (!gMoved) {
      gMoved = true;
      if (!isGrad()) {                                   // solid -> gradient: colour fades to clear
        var l = firstLeaf(gTargets[0]), fc = l && l.fillColor, hex = fillInput.value, al = 100;
        if (fc && fc.type !== 'gradient') { hex = fc.toCSS(true); al = Math.round((fc.alpha == null ? 1 : fc.alpha) * 100); }
        G.stops = [{ o: 0, c: hex, a: al }, { o: 100, c: hex, a: 0 }];
        G.sel = 0;
        fillTypeSel.value = 'linear'; prevType = 'linear';
        buildMarkers(); syncVisibility();
      }
    }
    var a = gStart, b = e.point, radial = fillTypeSel.value === 'radial';
    if (e.modifiers.shift && !radial) {
      var v = b.subtract(a), ang = Math.round(v.angle / 45) * 45;
      b = a.add(new paper.Point({ length: v.length, angle: ang }));
    }
    gTargets.forEach(function (it) {
      leavesOf(it).forEach(function (l) {
        if (l.className === 'Raster') return;
        l.fillColor = { gradient: { stops: stopsForPaper(), radial: radial }, origin: a, destination: b };
      });
    });
    forceRedraw();
  };
  tools.gradient.onMouseUp = function () {
    if (gMoved) saveState();
    gTargets = []; gMoved = false;
  };

  var gtBtn = document.createElement('button');
  gtBtn.className = 'tool-btn'; gtBtn.dataset.tool = 'gradient'; gtBtn.textContent = '◐';
  gtBtn.title = 'Gradient tool (D). Click a shape, then drag to set the gradient direction';
  $('toolbar').appendChild(gtBtn);
  gtBtn.addEventListener('click', function () { setTool('gradient'); });
  var _setTool = setTool;
  setTool = function (name) {
    _setTool(name);
    gtBtn.classList.toggle('active', name === 'gradient');
  };
  document.addEventListener('keydown', function (e) {
    var tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.toLowerCase() === 'd') setTool('gradient');
  });

  // ---------- on-canvas handles (drag the start / end dots) ----------
  var ghA = document.createElement('div'), ghB = document.createElement('div'), ghL = document.createElement('div');
  ghA.className = 'gh a'; ghB.className = 'gh b'; ghL.id = 'gh-line';
  ghA.title = 'Gradient start / center'; ghB.title = 'Gradient end';
  canvasArea.appendChild(ghL); canvasArea.appendChild(ghA); canvasArea.appendChild(ghB);

  function dragDot(el, which) {
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault(); e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      var moved = false;
      function mv(ev) {
        var p = mouseToProject(ev);
        moved = true;
        selection.forEach(function (it) {
          leavesOf(it).forEach(function (l) {
            var fc = l.fillColor;
            if (!fc || fc.type !== 'gradient') return;
            if (which === 'a') fc.origin = p; else fc.destination = p;
          });
        });
        forceRedraw();
      }
      function up() {
        el.removeEventListener('pointermove', mv);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        if (moved) saveState();
      }
      el.addEventListener('pointermove', mv);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }
  dragDot(ghA, 'a'); dragDot(ghB, 'b');

  function updateHandlesG() {
    var fc = (currentToolName === 'gradient' && selection.length) ? gradOf(selection[0]) : null;
    if (!fc || !fc.origin || !fc.destination) {
      ghA.style.display = ghB.style.display = ghL.style.display = 'none';
      return;
    }
    var a = paper.view.projectToView(fc.origin), b = paper.view.projectToView(fc.destination);
    ghA.style.display = ghB.style.display = ghL.style.display = 'block';
    ghA.style.left = a.x + 'px'; ghA.style.top = a.y + 'px';
    ghB.style.left = b.x + 'px'; ghB.style.top = b.y + 'px';
    var dx = b.x - a.x, dy = b.y - a.y;
    ghL.style.left = a.x + 'px'; ghL.style.top = a.y + 'px';
    ghL.style.width = Math.hypot(dx, dy) + 'px';
    ghL.style.transform = 'rotate(' + Math.atan2(dy, dx) + 'rad)';
  }
  var _tick = window.tickTimeline;
  window.tickTimeline = function (e) {
    if (_tick) _tick(e);
    if (fillTypeSel.value !== prevType) { prevType = fillTypeSel.value; syncVisibility(); }
    updateHandlesG();
  };

  buildMarkers();
  syncVisibility();
})();

// ======================================================
// DAY 7-A: GIF + WEBM EXPORT
// ======================================================
window.MediaExport = (function () {
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function medianCut(hist, n) {
    var colors = [];
    for (var k = 0; k < 32768; k++) {
      if (hist[k]) colors.push({ c: [(k >> 10) & 31, (k >> 5) & 31, k & 31], n: hist[k] });
    }
    if (!colors.length) return [[0, 0, 0]];
    var boxes = [colors];
    while (boxes.length < n) {
      var bi = -1, best = 0, ch = 0;
      for (var i = 0; i < boxes.length; i++) {
        var bx = boxes[i];
        if (bx.length < 2) continue;
        var mn = [31, 31, 31], mx = [0, 0, 0], q;
        for (var j = 0; j < bx.length; j++) {
          for (q = 0; q < 3; q++) {
            var v = bx[j].c[q];
            if (v < mn[q]) mn[q] = v;
            if (v > mx[q]) mx[q] = v;
          }
        }
        for (q = 0; q < 3; q++) {
          if (mx[q] - mn[q] > best) { best = mx[q] - mn[q]; bi = i; ch = q; }
        }
      }
      if (bi < 0) break;
      var box = boxes[bi];
      box.sort(function (a, b) { return a.c[ch] - b.c[ch]; });
      var total = 0, acc = 0, cut = 1, z;
      for (z = 0; z < box.length; z++) total += box[z].n;
      for (z = 0; z < box.length - 1; z++) {
        acc += box[z].n; cut = z + 1;
        if (acc >= total / 2) break;
      }
      boxes.splice(bi, 1, box.slice(0, cut), box.slice(cut));
    }
    return boxes.map(function (b) {
      var s = [0, 0, 0], t = 0;
      b.forEach(function (o) { t += o.n; for (var q = 0; q < 3; q++) s[q] += o.c[q] * o.n; });
      return s.map(function (v) { return Math.round(v / t * 255 / 31); });
    });
  }

  function nearest(key, pal, off) {
    var r = ((key >> 10) & 31) * 255 / 31, g = ((key >> 5) & 31) * 255 / 31, b = (key & 31) * 255 / 31;
    var best = 0, bd = 1e12;
    for (var i = 0; i < pal.length; i++) {
      var p = pal[i], d = (p[0] - r) * (p[0] - r) + (p[1] - g) * (p[1] - g) + (p[2] - b) * (p[2] - b);
      if (d < bd) { bd = d; best = i; }
    }
    return best + off;
  }

  function lzw(idx, minCode) {
    var clear = 1 << minCode, eoi = clear + 1, next = eoi + 1, size = minCode + 1;
    var dict = new Map(), out = [], cur = 0, bits = 0;
    function emit(code) {
      cur |= code << bits; bits += size;
      while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; }
    }
    emit(clear);
    var prefix = idx[0];
    for (var i = 1; i < idx.length; i++) {
      var k = idx[i], key = prefix * 256 + k, v = dict.get(key);
      if (v !== undefined) { prefix = v; continue; }
      emit(prefix);
      if (next === 4096) { emit(clear); dict.clear(); next = eoi + 1; size = minCode + 1; }
      else { if (next >= (1 << size)) size++; dict.set(key, next++); }
      prefix = k;
    }
    emit(prefix); emit(eoi);
    if (bits > 0) out.push(cur & 255);
    return out;
  }

  async function gif(getFrame, n, w, h, fps, transparent, loop, say) {
    var datas = [], i;
    for (i = 0; i < n; i++) {
      datas.push(getFrame(i).getContext('2d').getImageData(0, 0, w, h).data);
      if (say) say('GIF: rendering ' + (i + 1) + ' / ' + n);
      if (i % 2) await sleep(0);
    }
    var hist = new Int32Array(32768), stride = Math.max(1, Math.floor(w * h * n / 1500000));
    datas.forEach(function (d) {
      for (var p = 0; p < d.length; p += 4 * stride) {
        if (d[p + 3] >= 128) hist[((d[p] >> 3) << 10) | ((d[p + 1] >> 3) << 5) | (d[p + 2] >> 3)]++;
      }
    });
    var off = transparent ? 1 : 0, pal = medianCut(hist, 256 - off);
    var gct = new Uint8Array(768);
    pal.forEach(function (c, k) { gct[(k + off) * 3] = c[0]; gct[(k + off) * 3 + 1] = c[1]; gct[(k + off) * 3 + 2] = c[2]; });
    var cache = new Int16Array(32768).fill(-1);
    var parts = [new Uint8Array([71, 73, 70, 56, 57, 97, w & 255, w >> 8, h & 255, h >> 8, 0xF7, 0, 0]), gct];
    if (loop) parts.push(new Uint8Array([0x21, 0xFF, 0x0B, 78, 69, 84, 83, 67, 65, 80, 69, 50, 46, 48, 3, 1, 0, 0, 0]));
    var delay = Math.max(2, Math.round(100 / fps));
    for (i = 0; i < n; i++) {
      var d = datas[i], idx = new Uint8Array(w * h);
      for (var p = 0; p < w * h; p++) {
        var q = p * 4;
        if (transparent && d[q + 3] < 128) { idx[p] = 0; continue; }
        var key = ((d[q] >> 3) << 10) | ((d[q + 1] >> 3) << 5) | (d[q + 2] >> 3), v = cache[key];
        if (v < 0) { v = nearest(key, pal, off); cache[key] = v; }
        idx[p] = v;
      }
      parts.push(new Uint8Array([0x21, 0xF9, 4, transparent ? 9 : 4, delay & 255, delay >> 8, 0, 0]));
      parts.push(new Uint8Array([0x2C, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0, 8]));
      var codes = lzw(idx, 8), L = codes.length, buf = new Uint8Array(L + Math.ceil(L / 255) + 1), bp = 0;
      for (var s = 0; s < L; s += 255) {
        var sz = Math.min(255, L - s);
        buf[bp++] = sz;
        for (var zz = 0; zz < sz; zz++) buf[bp++] = codes[s + zz];
      }
      buf[bp++] = 0;
      parts.push(buf);
      if (say) say('GIF: encoding ' + (i + 1) + ' / ' + n);
      await sleep(0);
    }
    parts.push(new Uint8Array([0x3B]));
    return new Blob(parts, { type: 'image/gif' });
  }

  async function webm(getFrame, n, w, h, fps, loops, bg, say) {
    if (!window.MediaRecorder) throw new Error('This browser cannot record video. Use GIF instead.');
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    if (!cv.captureStream) throw new Error('This browser cannot record video. Use GIF instead.');
    var frames = [], i;
    for (i = 0; i < n; i++) {
      frames.push(getFrame(i));
      if (say) say('Video: rendering ' + (i + 1) + ' / ' + n);
      if (i % 2) await sleep(0);
    }
    var ctx = cv.getContext('2d');
    var stream = cv.captureStream(0), track = stream.getVideoTracks()[0], manual = !!(track && track.requestFrame);
    if (!manual) stream = cv.captureStream(fps);
    var mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .filter(function (t) { return MediaRecorder.isTypeSupported(t); })[0];
    if (!mime) throw new Error('WebM recording is not supported here. Use GIF instead.');
    var rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 }), chunks = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    var done = new Promise(function (res) { rec.onstop = res; });
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    rec.start();
    var t0 = performance.now(), k = 0;
    for (var L = 0; L < loops; L++) {
      for (i = 0; i < n; i++) {
        ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(frames[i], 0, 0);
        if (manual) track.requestFrame();
        k++;
        await sleep(Math.max(1, t0 + k * 1000 / fps - performance.now()));
      }
    }
    await sleep(150);
    rec.stop();
    await done;
    return new Blob(chunks, { type: 'video/webm' });
  }
  return { gif: gif, webm: webm };
})();

// ---- Export tab: animation GIF / WebM of the orange frame ----
(function () {
  var pane = document.querySelector('.tab-pane[data-pane="export"]');
  if (!pane) return;
  var say = function (m) { if (window.toast) window.toast(m); };
  pane.insertAdjacentHTML('beforeend',
    '<h3 class="section-title">Animation (GIF / video)</h3>' +
    '<label class="prop-row">Scale % <input type="number" id="am-scale" value="100" min="10" max="400"></label>' +
    '<label class="prop-row">From frame <input type="number" id="am-from" value="0" min="0"></label>' +
    '<label class="prop-row">To frame <input type="number" id="am-to" min="0" placeholder="last"></label>' +
    '<label class="prop-row">File name <input type="text" id="am-name" value="animation" style="width:100px"></label>' +
    '<div class="layer-actions"><button id="am-gif">⬇ GIF</button><button id="am-webm">⬇ WebM video</button></div>' +
    '<p class="hint">Records the orange frame at the animation FPS. Background: Transparent gives a transparent GIF. WebM always uses a color, black if Transparent. The GIF loops forever.</p>');
  var el = function (id) { return document.getElementById(id); };

  async function run(kind) {
    var A = window.animApi;
    if (!A) { alert('Animation hook (A2) is missing.'); return; }
    var len = A.anim.length;
    var from = Math.max(0, Math.min(len - 1, Math.round(Number(el('am-from').value) || 0)));
    var toRaw = el('am-to').value;
    var to = toRaw === '' ? len - 1 : Math.max(from, Math.min(len - 1, Math.round(Number(toRaw) || 0)));
    var sc = Math.max(10, Math.min(400, Number(el('am-scale').value) || 100)) / 100;
    var W = Math.max(1, Math.round(frame.w * sc)), H = Math.max(1, Math.round(frame.h * sc)), n = to - from + 1;
    if (W > 1024 || H > 1024 || W * H * n > 30000000) {
      alert('Too big (' + W + ' x ' + H + ', ' + n + ' frames). Lower the Scale % or the frame range.');
      return;
    }
    A.stop();
    var keep = A.frame(), area = new paper.Rectangle(frame.x, frame.y, frame.w, frame.h);
    var bg = expBg.value === 'color' ? expBgColor.value : null;
    var name = (el('am-name').value || 'animation').replace(/[^\w\-]+/g, '_');
    var getFrame = function (i) { A.applyFrame(from + i); return renderArea(area, W, H, false, bg); };
    try {
      var blob = kind === 'gif'
        ? await MediaExport.gif(getFrame, n, W, H, A.anim.fps, !bg, true, say)
        : await MediaExport.webm(getFrame, n, W, H, A.anim.fps, 1, bg || '#000000', say);
      downloadBlob(blob, name + (kind === 'gif' ? '.gif' : '.webm'));
      say('Saved ' + name);
    } catch (err) { alert('Export failed: ' + err.message); }
    A.applyFrame(keep);
    paper.project._needsUpdate = true;
    paper.view.update();
  }
  el('am-gif').addEventListener('click', function () { run('gif'); });
  el('am-webm').addEventListener('click', function () { run('webm'); });
})();

// ======================================================
// DAY 7-B: ELLIPSE ARC HANDLES
// ======================================================
(function () {
  var st = document.createElement('style');
  st.textContent =
    '.arc-h{position:absolute;display:none;z-index:11;width:18px;height:18px;transform:translate(-50%,-50%);' +
    'border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 2px #000;touch-action:none;cursor:grab}' +
    '.arc-h::before{content:"";position:absolute;inset:-14px}' +
    '@media (pointer:coarse){.arc-h{width:24px;height:24px}}';
  document.head.appendChild(st);

  var hS = document.createElement('div'), hE = document.createElement('div');
  hS.className = hE.className = 'arc-h';
  hS.style.background = '#00e676'; hE.style.background = '#ff3d71';
  hS.title = 'Arc start (Shift = snap 15°)'; hE.title = 'Arc end (Shift = snap 15°)';
  canvasArea.appendChild(hS); canvasArea.appendChild(hE);

  function current() {
    if (!window.ellApi || selection.length !== 1) return null;
    if (currentToolName !== 'select' && currentToolName !== 'ellipse') return null;
    return window.ellApi.ellOf(selection[0]);
  }

  function drag(el, which) {
    el.addEventListener('pointerdown', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      el.setPointerCapture(ev.pointerId);
      var moved = false;
      function mv(e2) {
        var p = current();
        if (!p) return;
        var e = p.data.ell, inv = mxFrom(e.M).inverted();
        if (!inv) return;
        var lp = inv.transform(mouseToProject(e2));
        var deg = Math.atan2(lp.y, lp.x) * 180 / Math.PI;
        if (e2.shiftKey) deg = Math.round(deg / 15) * 15;
        if (e.type === 'whole') e.type = 'slice';
        e[which] = Math.round(deg * 10) / 10;
        window.ellApi.rebuild(p);
        window.ellApi.sync(p);
        paper.project._needsUpdate = true;
        paper.view.update();
        moved = true;
      }
      function up() {
        el.removeEventListener('pointermove', mv);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        if (moved) saveState();
      }
      el.addEventListener('pointermove', mv);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }
  drag(hS, 'start'); drag(hE, 'end');

  function place(el, M, deg) {
    var a = deg * Math.PI / 180;
    var v = paper.view.projectToView(M.transform(new paper.Point(Math.cos(a), Math.sin(a))));
    el.style.display = 'block'; el.style.left = v.x + 'px'; el.style.top = v.y + 'px';
  }
  var prev = window.tickTimeline;
  window.tickTimeline = function (e) {
    if (prev) prev(e);
    var p = current();
    if (!p) { hS.style.display = hE.style.display = 'none'; return; }
    var el = p.data.ell, M = mxFrom(el.M);
    place(hS, M, el.start); place(hE, M, el.end);
  };
})();

// ======================================================
// DAY 7-C: GRADIENT STROKES
// ======================================================
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var say = function (m) { if (window.toast) window.toast(m); };
  var S = { type: 'solid', c2: '#ff4d6d', a2: 100 };

  strokeInput.closest('.prop-row').insertAdjacentHTML('afterend',
    '<label class="prop-row">Stroke type<select id="stroke-type">' +
    '<option value="solid">Solid</option><option value="linear">Linear gradient</option><option value="radial">Radial gradient</option></select></label>' +
    '<label class="prop-row" id="sc2-row" style="display:none">Stroke color 2<input type="color" id="stroke-color2" value="#ff4d6d"></label>' +
    '<div class="layer-actions" id="sc-copy" style="display:none"><button id="stroke-from-fill">Copy fill gradient to stroke</button></div>');

  function showRows() {
    var on = S.type !== 'solid';
    $('sc2-row').style.display = on ? '' : 'none';
    $('sc-copy').style.display = on ? '' : 'none';
  }
  function geom(item, radial) {
    var b = item.bounds;
    if (radial) {
      var r = Math.max(Math.max(b.width, b.height) / 2, 1);
      return [b.center, b.center.add(new paper.Point(r, 0))];
    }
    var a = (Number(gradAngleInput.value) || 0) * Math.PI / 180, dir = new paper.Point(Math.cos(a), Math.sin(a));
    var len = Math.abs(b.width * dir.x) + Math.abs(b.height * dir.y);
    return [b.center.subtract(dir.multiply(len / 2)), b.center.add(dir.multiply(len / 2))];
  }
  function makeStroke(item, force) {
    if (S.type === 'solid') return colorWithAlpha(strokeInput.value, Number(strokeOpInput.value));
    var radial = S.type === 'radial', sc = item.strokeColor, g;
    if (!force && sc && sc.type === 'gradient' && !!sc.gradient.radial === radial && sc.origin && sc.destination) {
      g = [sc.origin.clone(), sc.destination.clone()];
    } else g = geom(item, radial);
    return {
      gradient: { stops: [colorWithAlpha(strokeInput.value, Number(strokeOpInput.value)), colorWithAlpha(S.c2, S.a2)], radial: radial },
      origin: g[0], destination: g[1]
    };
  }
  function apply(force) {
    selection.forEach(function (i) {
      eachStrokeLeaf(i, function (l) {
        if (l.className === 'Raster') return;
        if (S.type !== 'solid' && !l.strokeWidth) l.strokeWidth = 2;
        l.strokeColor = makeStroke(l, force);
      });
    });
    forceRedraw();
  }

  $('stroke-type').addEventListener('change', function () {
    S.type = this.value; showRows();
    if (selection.length) { apply(true); saveState(); }
  });
  $('stroke-color2').addEventListener('click', function (e) {
    e.preventDefault();
    var el = this;
    ColorPicker.open(el, S.c2, S.a2, function (hex, a, fin) {
      S.c2 = hex; S.a2 = a; el.value = hex;
      if (selection.length) apply(false);
      if (fin && selection.length) saveState();
    }, { alpha: true });
  });

  // the stroke colour swatch must keep the gradient instead of overwriting it
  var origApply = applyStrokeToSelection;
  strokeInput.removeEventListener('input', origApply);
  applyStrokeToSelection = function () {
    style.stroke = colorWithAlpha(strokeInput.value, Number(strokeOpInput.value));
    if (S.type === 'solid') origApply(); else apply(false);
  };
  strokeInput.addEventListener('input', applyStrokeToSelection);

  gradAngleInput.addEventListener('input', function () {
    if (S.type === 'linear' && selection.length) apply(true);
  });

  $('stroke-from-fill').addEventListener('click', function () {
    if (!selection.length) { say('Select a shape first'); return; }
    var n = 0, radial = false;
    selection.forEach(function (i) {
      eachStrokeLeaf(i, function (l) {
        var fc = l.fillColor;
        if (!fc || fc.type !== 'gradient') return;
        radial = !!fc.gradient.radial;
        l.strokeColor = {
          gradient: { stops: fc.gradient.stops.map(function (s) { return [s.color.clone(), s.offset]; }), radial: radial },
          origin: fc.origin.clone(), destination: fc.destination.clone()
        };
        if (!l.strokeWidth) l.strokeWidth = 4;
        n++;
      });
    });
    if (!n) { say('The fill must be a gradient first'); return; }
    S.type = radial ? 'radial' : 'linear';
    $('stroke-type').value = S.type; showRows();
    forceRedraw(); saveState();
  });

  var _s = syncPanelFromItem;
  syncPanelFromItem = function (item) {
    _s(item);
    var l = item;
    while (l && l.className === 'Group' && l.children.length) l = l.children[0];
    var sc = l && l.strokeColor;
    if (sc && sc.type === 'gradient') {
      var stops = sc.gradient.stops, f = stops[0].color, e = stops[stops.length - 1].color;
      S.type = sc.gradient.radial ? 'radial' : 'linear';
      strokeInput.value = f.toCSS(true);
      S.c2 = e.toCSS(true);
      S.a2 = Math.round((e.alpha == null ? 1 : e.alpha) * 100);
    } else if (l) S.type = 'solid';
    $('stroke-type').value = S.type;
    $('stroke-color2').value = S.c2;
    showRows();
  };
})();

// ======================================================
// DAY 7-D: ANIMATION CURVE EDITOR
// ======================================================
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var say = function (m) { if (window.toast) window.toast(m); };
  var clamp = function (x, a, b) { return Math.min(b, Math.max(a, x)); };
  var Q = [1 / 3, 0, 2 / 3, 1];
  var NAMED = { linear: [0, 0, 1, 1], smooth: [1 / 3, 0, 2 / 3, 1], 'in': [1 / 3, 0, 2 / 3, 1 / 3], out: [1 / 3, 2 / 3, 2 / 3, 1] };
  var PRESETS = [['Linear', [0, 0, 1, 1]], ['Smooth', [1 / 3, 0, 2 / 3, 1]], ['Ease in', [1 / 3, 0, 2 / 3, 1 / 3]],
    ['Ease out', [1 / 3, 2 / 3, 2 / 3, 1]], ['Sharp', [0.75, 0, 0.25, 1]], ['Overshoot', [0.34, 1.56, 0.64, 1]],
    ['Anticipate', [0.36, 0, 0.66, -0.56]]];
  var SZ = 240, PAD = 28, YMIN = -0.7, YMAX = 1.7, open = false, drag = -1;

  var st = document.createElement('style');
  st.textContent =
    '#cv-ed{position:fixed;z-index:95000;display:none;width:260px;padding:8px;background:#2a2a2a;color:#ddd;border:1px solid #555;' +
    'border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.6);font:12px system-ui,sans-serif}' +
    '#cv-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}' +
    '#cv-ed button{background:#3a3a3a;color:#ddd;border:1px solid #555;border-radius:5px;padding:5px 8px;cursor:pointer;font-size:12px}' +
    '#cv-c{display:block;touch-action:none;background:#1e1e1e;border-radius:6px}' +
    '#cv-p{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}#cv-i{margin-top:6px;color:#999;font-size:11px;min-height:28px}' +
    '@media (pointer:coarse){#cv-ed button{padding:9px 11px}}';
  document.head.appendChild(st);

  var box = document.createElement('div');
  box.id = 'cv-ed';
  box.innerHTML = '<div id="cv-h"><b>Motion curve</b><button id="cv-x">✕</button></div>' +
    '<canvas id="cv-c" width="' + SZ + '" height="' + SZ + '"></canvas><div id="cv-i"></div><div id="cv-p"></div>';
  document.body.appendChild(box);
  var cv = $('cv-c'), cx = cv.getContext('2d'), info = $('cv-i');

  var btn = document.createElement('button');
  btn.id = 'tl-curve'; btn.textContent = '〰 Curve';
  btn.title = 'Edit the motion curve between two keys';
  $('tl-bar').appendChild(btn);

  var X = function (v) { return PAD + v * (SZ - 2 * PAD); };
  var Y = function (v) { return PAD + (YMAX - v) / (YMAX - YMIN) * (SZ - 2 * PAD); };
  function bez(s) {
    var m = 1 - s;
    return [3 * m * m * s * Q[0] + 3 * m * s * s * Q[2] + s * s * s, 3 * m * m * s * Q[1] + 3 * m * s * s * Q[3] + s * s * s];
  }
  function ease(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    var lo = 0, hi = 1, s = t;
    for (var i = 0; i < 22; i++) { s = (lo + hi) / 2; if (bez(s)[0] < t) lo = s; else hi = s; }
    return bez(s)[1];
  }

  function targets() {
    var out = [];
    function add(i) { if (out.indexOf(i) < 0) { out.push(i); childrenOf(i).forEach(add); } }
    selection.forEach(function (s) { add(topLevelItem(s)); });
    return out;
  }
  function segKey(it, f) {
    var ks = it.data && it.data.keys, best = null;
    if (!ks) return null;
    Object.keys(ks).forEach(function (k) { k = Number(k); if (k <= f && (best === null || k > best)) best = k; });
    return best === null ? null : ks[best];
  }
  function loadQ() {
    var A = window.animApi, f = A ? A.frame() : 0, found = false;
    targets().forEach(function (it) {
      if (found) return;
      var k = segKey(it, f);
      if (!k) return;
      found = true;
      var e = k.e;
      if (typeof e === 'string' && e.indexOf('bez:') === 0) Q = e.slice(4).split(',').map(Number);
      else if (NAMED[e]) Q = NAMED[e].slice();
    });
    info.textContent = found
      ? 'Frame ' + f + ': edits the curve of the segment after the key at or before this frame. Drag the two dots.'
      : 'Select an object that has keys, then open this again.';
  }
  function applyCurve(final) {
    var A = window.animApi;
    if (!A) return;
    var f = A.frame(), any = false;
    var str = 'bez:' + Q.map(function (v) { return Math.round(v * 1000) / 1000; }).join(',');
    targets().forEach(function (it) { var k = segKey(it, f); if (k) { k.e = str; any = true; } });
    if (any) { A.refresh(); if (final) A.commit(); }
  }

  function paint() {
    if (!open) return;
    requestAnimationFrame(paint);
    cx.clearRect(0, 0, SZ, SZ);
    cx.strokeStyle = '#444'; cx.lineWidth = 1;
    [0, 1].forEach(function (v) { cx.beginPath(); cx.moveTo(PAD, Y(v)); cx.lineTo(SZ - PAD, Y(v)); cx.stroke(); });
    cx.setLineDash([4, 4]); cx.strokeStyle = '#666';
    cx.beginPath(); cx.moveTo(X(0), Y(0)); cx.lineTo(X(1), Y(1)); cx.stroke(); cx.setLineDash([]);
    cx.strokeStyle = '#888';
    cx.beginPath(); cx.moveTo(X(0), Y(0)); cx.lineTo(X(Q[0]), Y(Q[1]));
    cx.moveTo(X(1), Y(1)); cx.lineTo(X(Q[2]), Y(Q[3])); cx.stroke();
    cx.strokeStyle = '#ff9f1c'; cx.lineWidth = 3; cx.beginPath();
    for (var s = 0; s <= 1.0001; s += 0.02) { var p = bez(s); if (s === 0) cx.moveTo(X(p[0]), Y(p[1])); else cx.lineTo(X(p[0]), Y(p[1])); }
    cx.stroke();
    var u = (performance.now() % 1600) / 1600, y = ease(u);
    cx.fillStyle = '#fff'; cx.beginPath(); cx.arc(X(u), Y(y), 5, 0, 6.3); cx.fill();
    cx.fillStyle = '#00e676'; cx.beginPath(); cx.arc(SZ - 10, Y(y), 5, 0, 6.3); cx.fill();
    [[Q[0], Q[1], '#2f6fed'], [Q[2], Q[3], '#ff3d71']].forEach(function (h) {
      cx.fillStyle = h[2]; cx.strokeStyle = '#fff'; cx.lineWidth = 2;
      cx.beginPath(); cx.arc(X(h[0]), Y(h[1]), 9, 0, 6.3); cx.fill(); cx.stroke();
    });
  }
  function pos(e) { var r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function setHandle(i, p) {
    Q[i * 2] = clamp((p[0] - PAD) / (SZ - 2 * PAD), 0, 1);
    Q[i * 2 + 1] = clamp(YMAX - (p[1] - PAD) / (SZ - 2 * PAD) * (YMAX - YMIN), YMIN, YMAX);
  }
  cv.addEventListener('pointerdown', function (e) {
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    var p = pos(e), d0 = Math.hypot(p[0] - X(Q[0]), p[1] - Y(Q[1])), d1 = Math.hypot(p[0] - X(Q[2]), p[1] - Y(Q[3]));
    drag = d0 <= d1 ? 0 : 1;
    setHandle(drag, p); applyCurve(false);
  });
  cv.addEventListener('pointermove', function (e) { if (drag >= 0) { setHandle(drag, pos(e)); applyCurve(false); } });
  function endDrag() { if (drag >= 0) { drag = -1; applyCurve(true); } }
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);

  PRESETS.forEach(function (p) {
    var b = document.createElement('button');
    b.textContent = p[0];
    b.addEventListener('click', function () { Q = p[1].slice(); applyCurve(true); });
    $('cv-p').appendChild(b);
  });
  function close() { open = false; box.style.display = 'none'; }
  $('cv-x').addEventListener('click', close);
  btn.addEventListener('click', function () {
    if (open) { close(); return; }
    if (!window.animApi) { alert('Animation hook (A2) is missing.'); return; }
    loadQ();
    box.style.display = 'block';
    var r = btn.getBoundingClientRect();
    box.style.left = clamp(r.left, 8, window.innerWidth - 270) + 'px';
    box.style.top = Math.max(8, r.top - box.offsetHeight - 8) + 'px';
    open = true; paint();
  });
})();

// ======================================================
// DAY 8-A: "MAKE WHOLE" BUTTON FOR ARCS
// ======================================================
(function () {
  var st = document.createElement('style');
  st.textContent =
    '#ell-whole-btn{position:absolute;display:none;z-index:12;transform:translate(-50%,-50%);padding:7px 13px;' +
    'background:#2f6fed;color:#fff;border:2px solid #fff;border-radius:18px;font:12px system-ui,sans-serif;cursor:pointer;' +
    'box-shadow:0 2px 10px rgba(0,0,0,.5)}' +
    '@media (pointer:coarse){#ell-whole-btn{padding:11px 17px;font-size:14px}}';
  document.head.appendChild(st);

  var b = document.createElement('button');
  b.id = 'ell-whole-btn';
  b.textContent = '◯ Make whole';
  canvasArea.appendChild(b);
  b.addEventListener('click', function () {
    var real = document.getElementById('ell-whole');
    if (real) real.click();
  });

  var prev = window.tickTimeline;
  window.tickTimeline = function (e) {
    if (prev) prev(e);
    var p = (selection.length === 1 && currentToolName !== 'node') ? selection[0] : null;
    var ell = p && p.className === 'Path' && p.data && p.data.ell;
    if (!ell || ell.type === 'whole') { b.style.display = 'none'; return; }
    var v = paper.view.projectToView(mxFrom(ell.M).transform(new paper.Point(0, 0)));
    b.style.display = 'block';
    b.style.left = v.x + 'px';
    b.style.top = v.y + 'px';
  };
})();
// ======================================================
// DAY 8-B: MULTI-POINT SELECTION (Node tool)
// ======================================================
(function () {
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

    if (hit && hit.type === 'segment' && ok(hit.segment)) {
      var seg = hit.segment;
      if (shift) {
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
      prevDown(event);
      if (!wasIn) set = [seg];
      nodeSel = ok(seg) ? seg : null;
      mode = (wasIn && set.length > 1) ? 'group' : 'single';
      return;
    }

    var insideSelected = hit && hit.type === 'fill' && selection.indexOf(topLevelItem(hit.item)) >= 0;
    if ((hit && !insideSelected) || add) {                 // old behaviour: handles, curves, add-point mode
      var onHandle = hit && (hit.type === 'handle-in' || hit.type === 'handle-out');
      if (!onHandle && !shift) set = [];
      prevDown(event);
      if (!set.length && ok(nodeSel)) set = [nodeSel];
      mode = 'single';
      return;
    }

    mode = 'marquee';                                       // empty space (or inside an already selected shape)
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
      nodeMoved = true; moved = true;
      return;
    }
    prevDrag(event);
  };

  tools.node.onMouseUp = function (event) {
    if (mode === 'marquee') {
      var box = null;
      if (rect) { box = rect.bounds; rect.remove(); rect = null; }
      if (!box) {                                           // just a tap
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
    if (mode === 'group' && moved) {
      set.forEach(function (s) { if (ok(s)) clearRound(s.path); });
      nodeMoved = true;
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
    var paths = candidates(), arr = [];
    paths.forEach(function (p) { p.segments.forEach(function (s) { arr.push(s); }); });
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
    '<p class="hint">Node tool (N): drag a box on empty space to select many points. Shift+tap (or the ⇧ button) adds or removes one. ' +
    'Drag a selected point to move them all. Delete removes them. Arrow keys move them (Shift = 10×).</p>');
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
    set = set.filter(ok);
    if (!set.length) return;
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

  // ---------- green markers ----------
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
})();

// ======================================================
// DAY 8-C: GRADIENT SWEEP BUTTON
// ======================================================
(function () {
  var gp = document.getElementById('gp');
  if (!gp) return;
  var say = function (m) { if (window.toast) window.toast(m); };
  gp.insertAdjacentHTML('beforebegin',
    '<div class="layer-actions"><button id="g-sweep" title="Slides the gradient across the shape over the whole animation">▶ Animate sweep</button></div>');
  document.getElementById('g-sweep').addEventListener('click', function () {
    var A = window.animApi;
    if (!A || !A.keyAt) { alert('Do step C0 first (the new animApi block).'); return; }
    if (!selection.length) { alert('Select a shape with a gradient fill first.'); return; }
    var leaves = [];
    (function walk(i) { if (i.className === 'Group') i.children.forEach(walk); else leaves.push(i); })(selection[0]);
    var gl = leaves.filter(function (l) {
      var f = l.fillColor; return f && f.type === 'gradient' && f.origin && f.destination;
    });
    if (!gl.length) { alert('The fill must be a linear or radial gradient.'); return; }
    var last = A.anim.length - 1;
    if (last < 1) { alert('Set the animation Length to at least 2 frames.'); return; }
    var saved = gl.map(function (l) { return [l.fillColor.origin.clone(), l.fillColor.destination.clone()]; });
    function shift(k) {
      gl.forEach(function (l, i) {
        var o = saved[i][0], d = saved[i][1], v = d.subtract(o);
        l.fillColor.origin = o.add(v.multiply(k));
        l.fillColor.destination = d.add(v.multiply(k));
      });
    }
    A.stop();
    shift(-1); A.keyAt(0);
    shift(1);  A.keyAt(last);
    A.goto(0);
    say('Gradient sweep keyed: frames 0 to ' + last);
  });
})();

// ======================================================
// DAY 8-E: LOTTIE EXPORT
// ======================================================
(function () {
  var pane = document.querySelector('.tab-pane[data-pane="export"]');
  if (!pane) return;
  var say = function (m) { if (window.toast) window.toast(m); };
  var $ = function (id) { return document.getElementById(id); };
  var r3 = function (v) { return Math.round(v * 1000) / 1000; };

  pane.insertAdjacentHTML('beforeend',
    '<h3 class="section-title">Lottie (animation JSON)</h3>' +
    '<label class="prop-row">File name <input type="text" id="lt-name" value="animation" style="width:100px"></label>' +
    '<div class="layer-actions"><button id="lt-export">⬇ Lottie .json</button><button id="lt-preview">▶ Preview</button></div>' +
    '<p class="hint">Exports the orange frame area as a Lottie animation. Paths, fills, strokes, position / rotation / scale / opacity keys, ' +
    'shape morphs, color keys and switch groups are exported. Text, images, blur, dashes, skew and gradient animation are not.</p>');

  function rgba(c) {
    if (!c || c.type === 'gradient') return null;
    var x = c.type === 'rgb' ? c : c.convert('rgb');
    return [r3(x.red), r3(x.green), r3(x.blue), x.alpha == null ? 1 : r3(x.alpha)];
  }
  var col = function (a) { return [r3(a[0]), r3(a[1]), r3(a[2]), 1]; };
  var alpha = function (a) { return r3((a[3] == null ? 1 : a[3]) * 100); };

  var NAMED = { linear: [0, 0, 1, 1], smooth: [0.333, 0, 0.667, 1], 'in': [0.333, 0, 0.667, 0.333],
                out: [0.333, 0.667, 0.667, 1], bounce: [0.34, 1.56, 0.64, 1] };
  function easeOf(e) {
    if (e === 'step') return null;
    if (typeof e === 'string' && e.indexOf('bez:') === 0) return e.slice(4).split(',').map(Number);
    return NAMED[e] || NAMED.smooth;
  }
  function easeProps(o, q, multi) {
    if (!q) { o.h = 1; return; }
    o.o = multi ? { x: q[0], y: q[1] } : { x: [q[0]], y: [q[1]] };
    o.i = multi ? { x: q[2], y: q[3] } : { x: [q[2]], y: [q[3]] };
  }
  function prop(frames, ks, get, multi) {
    if (frames.length < 2) return { a: 0, k: get(ks[frames[0]]) };
    return { a: 1, k: frames.map(function (f, idx) {
      var v = get(ks[f]), o = { t: f, s: multi ? v : [v] };
      if (idx < frames.length - 1) easeProps(o, easeOf(ks[f].e), multi);
      return o;
    }) };
  }

  function arrShape(arr, closed) {
    var v = [], i = [], o = [];
    arr.forEach(function (s) {
      v.push([r3(s[0]), r3(s[1])]); i.push([r3(s[2]), r3(s[3])]); o.push([r3(s[4]), r3(s[5])]);
    });
    return { i: i, o: o, v: v, c: !!closed };
  }
  function segShape(path, M) {
    var m0 = M ? new paper.Matrix(M.a, M.b, M.c, M.d, 0, 0) : null;
    return arrShape(path.segments.map(function (s) {
      var p = M ? M.transform(s.point) : s.point;
      var hi = m0 ? m0.transform(s.handleIn) : s.handleIn, ho = m0 ? m0.transform(s.handleOut) : s.handleOut;
      return [p.x, p.y, hi.x, hi.y, ho.x, ho.y];
    }), path.closed);
  }
  function morphProp(frames, ks, rest, pi, closed) {
    var at = function (f) { var k = ks[f]; return arrShape((k.shape && k.shape[pi]) ? k.shape[pi] : rest, closed); };
    if (frames.length < 2) return { a: 0, k: at(frames[0]) };
    return { a: 1, k: frames.map(function (f, idx) {
      var o = { t: f, s: [at(f)] };
      if (idx < frames.length - 1) easeProps(o, easeOf(ks[f].e), false);
      return o;
    }) };
  }
  function gradFill(f, inv) {
    var stops = f.gradient.stops, n = stops.length, flat = [], al = [], hasA = false;
    stops.forEach(function (st, i) {
      var c = rgba(st.color), off = st.offset == null ? i / Math.max(1, n - 1) : st.offset;
      flat.push(r3(off), c[0], c[1], c[2]);
      al.push(r3(off), c[3]);
      if (c[3] < 0.999) hasA = true;
    });
    var o = f.origin, e = f.destination;
    if (inv) { o = inv.transform(o); e = inv.transform(e); }
    return { ty: 'gf', nm: 'Gradient', o: { a: 0, k: 100 }, r: 1, bm: 0,
      g: { p: n, k: { a: 0, k: flat.concat(hasA ? al : []) } },
      s: { a: 0, k: [r3(o.x), r3(o.y)] }, e: { a: 0, k: [r3(e.x), r3(e.y)] }, t: f.gradient.radial ? 2 : 1 };
  }

  function layerOf(item, ind, len) {
    var d = item.data || {}, ks = d.keys;
    var frames = ks ? Object.keys(ks).map(Number).sort(function (a, b) { return a - b; }) : [];
    var inv = frames.length ? mxFrom(d.pose).inverted() : null;
    var keyed = frames.length > 0 && !!inv;
    if (!keyed) frames = [];
    var hasAll = function (name) {
      return keyed && frames.every(function (x) { return ks[x].look && ks[x][name]; });
    };

    var paths = item.className === 'CompoundPath' ? item.children.slice() : [item], its = [];
    paths.forEach(function (p, pi) {
      var shape;
      if (keyed && d.morph && d.rest && d.rest[pi]) shape = morphProp(frames, ks, d.rest[pi], pi, p.closed);
      else shape = { a: 0, k: segShape(p, keyed ? inv : null) };
      its.push({ ty: 'sh', nm: 'Path ' + (pi + 1), ks: shape, hd: false });
    });

    var f = item.fillColor, s = item.strokeColor, sw = item.strokeWidth || 0, stroke = null, fill = null;
    if (s && sw > 0) {
      var sc = s.type === 'gradient' ? rgba(s.gradient.stops[0].color) : rgba(s);
      var animC = s.type !== 'gradient' && hasAll('sc');
      stroke = { ty: 'st', nm: 'Stroke',
        c: animC ? prop(frames, ks, function (k) { return col(k.sc); }, true) : { a: 0, k: [sc[0], sc[1], sc[2], 1] },
        o: animC ? prop(frames, ks, function (k) { return alpha(k.sc); }, false) : { a: 0, k: r3(sc[3] * 100) },
        w: (keyed && frames.length > 1 && hasAll('lw') !== null && frames.every(function (x) { return ks[x].look; }))
          ? prop(frames, ks, function (k) { return r3(k.lw || 0); }, false) : { a: 0, k: r3(sw) },
        lc: { butt: 1, round: 2, square: 3 }[item.strokeCap] || 1,
        lj: { miter: 1, round: 2, bevel: 3 }[item.strokeJoin] || 1, ml: 4, bm: 0 };
    }
    if (f) {
      if (f.type === 'gradient') fill = gradFill(f, keyed ? inv : null);
      else {
        var c0 = rgba(f), af = hasAll('fc');
        fill = { ty: 'fl', nm: 'Fill',
          c: af ? prop(frames, ks, function (k) { return col(k.fc); }, true) : { a: 0, k: [c0[0], c0[1], c0[2], 1] },
          o: af ? prop(frames, ks, function (k) { return alpha(k.fc); }, false) : { a: 0, k: r3(c0[3] * 100) },
          r: item.fillRule === 'evenodd' ? 2 : 1, bm: 0 };
      }
    }
    var group = { ty: 'gr', nm: 'Shape', bm: 0, it: its.concat(stroke ? [stroke] : [], fill ? [fill] : [], [{
      ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] },
      r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 } }]) };

    var offX = -frame.x, offY = -frame.y, ks2;
    if (keyed) {
      var op;
      if (d.swGroup) {
        op = prop(frames, ks, function (k) { return k.sw === d.swIdx ? 100 : 0; }, false);
        if (op.a === 1) op.k.forEach(function (kf) { kf.h = 1; delete kf.o; delete kf.i; });
      } else {
        op = prop(frames, ks, function (k) { return r3((k.o == null ? 1 : k.o) * 100); }, false);
      }
      ks2 = {
        a: prop(frames, ks, function (k) { return [r3(k.qx), r3(k.qy), 0]; }, true),
        p: prop(frames, ks, function (k) { return [r3(k.x + offX), r3(k.y + offY), 0]; }, true),
        s: prop(frames, ks, function (k) { return [r3(k.sx * 100), r3(k.sy * 100), 100]; }, true),
        r: prop(frames, ks, function (k) { return r3(k.r); }, false),
        o: op
      };
    } else {
      ks2 = { a: { a: 0, k: [0, 0, 0] }, p: { a: 0, k: [offX, offY, 0] }, s: { a: 0, k: [100, 100, 100] },
              r: { a: 0, k: 0 }, o: { a: 0, k: r3((item.visible ? item.opacity : 0) * 100) } };
    }
    return { ddd: 0, ind: ind, ty: 4, nm: item.name || ('Shape ' + ind), sr: 1, ks: ks2, ao: 0,
             shapes: [group], ip: 0, op: len, st: 0, bm: 0 };
  }

  function build() {
    var A = window.animApi;
    if (!A) { alert('Do step C0 first (the new animApi block).'); return null; }
    var len = A.anim.length, fps = A.anim.fps, skipped = 0, flat = [];
    function flatten(it) {
      if (!it.visible && !(it.data && it.data.swGroup && it.data.keys)) return;
      if (it.className === 'Group') it.children.forEach(flatten);
      else if (it.className === 'Path' || it.className === 'CompoundPath') flat.push(it);
      else skipped++;
    }
    paper.project.layers.forEach(function (L) { if (L.visible) L.children.forEach(flatten); });
    if (!flat.length) { alert('Nothing to export.'); return null; }
    var layers = flat.slice().reverse().map(function (it, i) { return layerOf(it, i + 1, len); });
    var name = ($('lt-name').value || 'animation').replace(/[^\w\-]+/g, '_');
    return { skipped: skipped, name: name, data: {
      v: '5.7.0', fr: fps, ip: 0, op: len, w: Math.round(frame.w), h: Math.round(frame.h),
      nm: name, ddd: 0, assets: [], layers: layers } };
  }

  $('lt-export').addEventListener('click', function () {
    var r = build();
    if (!r) return;
    downloadBlob(new Blob([JSON.stringify(r.data)], { type: 'application/json' }), r.name + '.json');
    say('Lottie saved: ' + r.data.layers.length + ' layers' + (r.skipped ? ', ' + r.skipped + ' text/image skipped' : ''));
  });

  // ---------- preview ----------
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:96000;display:none;flex-direction:column;align-items:center;' +
    'justify-content:center;background:rgba(0,0,0,.85);gap:10px';
  overlay.innerHTML = '<div id="lt-box" style="background:#222;border:1px solid #555"></div>' +
    '<button id="lt-close" style="padding:9px 18px;background:#3a3a3a;color:#ddd;border:1px solid #555;border-radius:6px;font-size:14px">✕ Close preview</button>';
  document.body.appendChild(overlay);
  var player = null;
  function loadLib() {
    if (window.lottie) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js';
      s.onload = res;
      s.onerror = function () { rej(new Error('Could not load the Lottie player (offline?)')); };
      document.head.appendChild(s);
    });
  }
  function closePrev() {
    if (player) { player.destroy(); player = null; }
    overlay.style.display = 'none';
  }
  $('lt-close').addEventListener('click', closePrev);
  $('lt-preview').addEventListener('click', function () {
    var r = build();
    if (!r) return;
    loadLib().then(function () {
      var box = $('lt-box'), w = Math.min(window.innerWidth * 0.9, 640), h = w * r.data.h / r.data.w;
      if (h > window.innerHeight * 0.75) { h = window.innerHeight * 0.75; w = h * r.data.w / r.data.h; }
      box.style.width = w + 'px'; box.style.height = h + 'px'; box.innerHTML = '';
      overlay.style.display = 'flex';
      player = window.lottie.loadAnimation({ container: box, renderer: 'svg', loop: true, autoplay: true, animationData: r.data });
    }).catch(function (err) { alert(err.message); });
  });
})();