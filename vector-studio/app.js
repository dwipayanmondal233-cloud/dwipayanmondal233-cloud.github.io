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
  if (item.strokeColor) strokeInput.value = item.strokeColor.toCSS(true);
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

function applyBlurToSelection() {
  const px = Number(blurInput.value) || 0;
  blurLabel.textContent = px + ' px';
  selection.forEach(function (i) { applyBlurToItem(i, px); });
  paper.view.update();
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

// ----- Rectangle -----
let currentShape = null;
let startPoint = null;

tools.rect.onMouseDown = function (event) { startPoint = event.point; };

tools.rect.onMouseDrag = function (event) {
  if (currentShape) currentShape.remove();
  currentShape = new paper.Path.Rectangle({
    from: startPoint,
    to: event.point,
    fillColor: style.fill,
    strokeColor: style.stroke,
    strokeWidth: style.strokeWidth
  });
};

tools.rect.onMouseUp = function () {
  if (currentShape) {
    registerItem(currentShape, 'Rectangle', '▭');
    saveState();
  }
  currentShape = null;
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

// ---------- PAN LISTENERS (left untouched, per instructions) ----------
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
  if (nodeMoved) saveState();
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
setTimeout(fitFrame, 100);

// ======================================================
// RIG LINES: show parent / child links on the canvas
// ======================================================
const SVGNS = 'http://www.w3.org/2000/svg';
const rigSvg = document.createElementNS(SVGNS, 'svg');
rigSvg.id = 'rig-lines';
canvasArea.appendChild(rigSvg);

function rigLink(from, to, color, tag) {
  const a = paper.view.projectToView(from);
  const b = paper.view.projectToView(to);

  const line = document.createElementNS(SVGNS, 'line');
  line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
  line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', 2);
  line.setAttribute('stroke-dasharray', '6 4');
  rigSvg.appendChild(line);

  const dot = document.createElementNS(SVGNS, 'circle');
  dot.setAttribute('cx', b.x); dot.setAttribute('cy', b.y);
  dot.setAttribute('r', 5);
  dot.setAttribute('fill', color);
  dot.setAttribute('stroke', '#fff');
  rigSvg.appendChild(dot);

  const t = document.createElementNS(SVGNS, 'text');
  t.setAttribute('x', b.x + 9); t.setAttribute('y', b.y - 8);
  t.setAttribute('fill', color);
  t.setAttribute('font-size', 12);
  t.setAttribute('font-weight', 'bold');
  t.setAttribute('stroke', '#000');
  t.setAttribute('stroke-width', 0.6);
  t.setAttribute('paint-order', 'stroke');
  t.textContent = tag;
  rigSvg.appendChild(t);
}

function updateRigLines() {
  rigSvg.innerHTML = '';
  if (currentToolName !== 'select' || !selection.length) return;
  selection.forEach(function (item) {
    const par = item.data && item.data.parent ? findByUid(item.data.parent) : null;
    if (par) rigLink(getPivot(item), getPivot(par), '#ff9f1c', '👑 parent: ' + par.name);
    childrenOf(item).forEach(function (kid) {
      rigLink(getPivot(item), getPivot(kid), '#4da3ff', '↳ child: ' + kid.name);
    });
  });
}

// ======================================================
// MILESTONE 2: TIMELINE + KEYFRAMES
// ======================================================
const animSettings = { fps: 12, length: 24, loop: true, ease: 'smooth' };
let curFrame = 0, playPos = 0, playing = false, selKey = null, tlDrag = null;

const tlFrame = document.getElementById('tl-frame');
const tlLength = document.getElementById('tl-length');
const tlFps = document.getElementById('tl-fps');
const tlEase = document.getElementById('tl-ease');
const tlLoop = document.getElementById('tl-loop');
const tlPlay = document.getElementById('tl-play');
const tlCanvas = document.getElementById('tl-canvas');
const tlScroll = document.getElementById('tl-scroll');
const TL = { LW: 130, FW: 16, RH: 22, RULER: 24 };
let tlRows = [];

function syncTimelineUi() {
  tlLength.value = animSettings.length;
  tlFps.value = animSettings.fps;
  tlEase.value = animSettings.ease;
  tlLoop.checked = animSettings.loop;
}

function decomposeLocal(m, p0) {
  const sx = Math.hypot(m.a, m.b) || 1e-6;
  const sy = (m.a * m.d - m.b * m.c) / sx;
  const lx = m.a * p0[0] + m.c * p0[1];
  const ly = m.b * p0[0] + m.d * p0[1];
  return {
    dx: m.tx + lx - p0[0],
    dy: m.ty + ly - p0[1],
    r: Math.atan2(m.b, m.a) * 180 / Math.PI,
    sx: sx, sy: sy
  };
}

function composeLocal(k, p0) {
  const m = new paper.Matrix();
  m.translate(p0[0] + k.dx, p0[1] + k.dy);
  m.rotate(k.r, new paper.Point(0, 0));
  m.scale(k.sx, k.sy);
  m.translate(-p0[0], -p0[1]);
  return m;
}

function sampleTrack(keys, f) {
  if (f <= keys[0].t) return keys[0];
  const last = keys[keys.length - 1];
  if (f >= last.t) return last;
  let i = 0;
  while (keys[i + 1].t <= f) i++;
  const a = keys[i], b = keys[i + 1];
  let u = (f - a.t) / (b.t - a.t);
  if (animSettings.ease === 'step') u = 0;
  else if (animSettings.ease === 'smooth') u = u * u * (3 - 2 * u);
  const mix = function (x, y) { return x + (y - x) * u; };
  return { dx: mix(a.dx, b.dx), dy: mix(a.dy, b.dy), r: mix(a.r, b.r),
           sx: mix(a.sx, b.sx), sy: mix(a.sy, b.sy) };
}

function isIdentityish(m) {
  return Math.abs(m.a - 1) < 1e-9 && Math.abs(m.d - 1) < 1e-9 &&
         Math.abs(m.b) < 1e-9 && Math.abs(m.c) < 1e-9 &&
         Math.abs(m.tx) < 1e-6 && Math.abs(m.ty) < 1e-6;
}

function evaluateAt(f) {
  const items = allTopItems();
  const byUid = {};
  const cur = new Map();
  items.forEach(function (i) {
    if (i.data.uid) byUid[i.data.uid] = i;
    cur.set(i, mxFrom(i.data.pose));
  });
  const parentOf = function (i) { return i.data.parent ? byUid[i.data.parent] : null; };
  const hasKeys = function (i) { return i.data.track && i.data.track.length; };

  const link = new Map();
  items.forEach(function (i) {
    const par = parentOf(i);
    if (par && !hasKeys(i)) {
      const inv = cur.get(par).inverted() || new paper.Matrix();
      link.set(i, inv.append(cur.get(i)));
    }
  });

  const target = new Map();
  function targetOf(i, depth) {
    if (target.has(i)) return target.get(i);
    const par = depth < 50 ? parentOf(i) : null;
    let T;
    if (hasKeys(i)) {
      T = composeLocal(sampleTrack(i.data.track, f), i.data.rp || [0, 0]);
      if (par) T = targetOf(par, depth + 1).clone().append(T);
    } else if (par) {
      T = targetOf(par, depth + 1).clone().append(link.get(i));
    } else {
      T = cur.get(i);
    }
    target.set(i, T);
    return T;
  }

  animating = true;
  try {
    items.forEach(function (i) {
      if (!hasKeys(i) && !parentOf(i)) return;
      const inv = cur.get(i).inverted();
      if (!inv) return;
      const delta = targetOf(i, 0).clone().append(inv);
      if (!isIdentityish(delta)) i.transform(delta);
    });
  } finally {
    animating = false;
  }
  applyLooks(f);
}

function setFrame(f) {
  curFrame = Math.max(0, Math.min(animSettings.length, Math.round(f)));
  playPos = curFrame;
  evaluateAt(curFrame);
  if (document.activeElement !== tlFrame) tlFrame.value = curFrame;
}

function togglePlay() {
  if (playing) {
    playing = false;
    tlPlay.textContent = '▶ Play';
    setFrame(playPos);
  } else {
    if (curFrame >= animSettings.length) setFrame(0);
    playing = true;
    playPos = curFrame;
    tlPlay.textContent = '⏸ Pause';
  }
}

function tickTimeline(e) {
  if (playing) {
    const L = animSettings.length;
    playPos += (e && e.delta ? e.delta : 1 / 60) * animSettings.fps;
    if (playPos > L) {
      if (animSettings.loop) {
        playPos = playPos % L;
      } else {
        playing = false;
        tlPlay.textContent = '▶ Play';
        setFrame(L);
      }
    }
    if (playing) {
      curFrame = Math.floor(playPos);
      evaluateAt(playPos);
      if (document.activeElement !== tlFrame) tlFrame.value = curFrame;
    }
  }
  drawTimeline();
}
canvasEl.addEventListener('mousedown', function () { if (playing) togglePlay(); });

function unwrapRot(keys, k) {
  let ref = null;
  keys.forEach(function (o) { if (o.t < k.t) ref = o; });
  if (!ref) keys.forEach(function (o) { if (!ref && o.t > k.t) ref = o; });
  if (!ref) return;
  while (k.r - ref.r > 180) k.r -= 360;
  while (k.r - ref.r < -180) k.r += 360;
}

function setKey(items) {
  if (!items.length) {
    alert('Select the part(s) to key first (Select tool).');
    return;
  }
  const skipped = [];
  let n = 0;
  items.forEach(function (item) {
    if (!item.visible) return;
    const d = item.data;
    const keys = d.track || [];
    if (!keys.length && curFrame !== 0) { skipped.push(item.name || 'Object'); return; }

    if (!d.uid) d.uid = newUid();
    const P = mxFrom(d.pose);
    if (!d.rp) {
      const inv = P.inverted();
      const pv = getPivot(item);
      const r0 = inv ? inv.transform(pv) : pv;
      d.rp = [r0.x, r0.y];
    }
    const par = d.parent ? findByUid(d.parent) : null;
    const Pp = par ? mxFrom(par.data.pose) : new paper.Matrix();
    const local = (Pp.inverted() || new paper.Matrix()).append(P);

    const k = decomposeLocal(local, d.rp);
    k.t = curFrame;
    k.look = captureLook(item);
    if (item.className === 'Path') k.shape = captureShape(item);
    if (d.isSwitch) k.sel = d.sel || 0;
    const rest = keys.filter(function (o) { return o.t !== k.t; });
    unwrapRot(rest, k);
    rest.push(k);
    rest.sort(function (a, b) { return a.t - b.t; });
    d.track = rest;
    n++;
  });
  if (skipped.length) {
    alert('These parts have no key at frame 0 yet:\n' + skipped.join(', ') +
      '\n\nGo to frame 0, set the starting pose, press ◆ Key, then come back.');
  }
  if (n) { evaluateAt(curFrame); saveState(); }
}

function deleteKey() {
  let n = 0;
  selection.forEach(function (item) {
    const d = item.data;
    if (!d.track) return;
    const keep = d.track.filter(function (k) { return k.t !== curFrame; });
    if (keep.length !== d.track.length) {
      n++;
      if (keep.length) d.track = keep; else { delete d.track; delete d.rp; }
    }
  });
  selKey = null;
  if (n) saveState();
}

function clearKeys() {
  let n = 0;
  selection.forEach(function (item) {
    if (item.data.track) { delete item.data.track; delete item.data.rp; n++; }
  });
  selKey = null;
  if (n) saveState();
}

wire('tl-first', function () { setFrame(0); });
wire('tl-prev', function () { setFrame(curFrame - 1); });
wire('tl-next', function () { setFrame(curFrame + 1); });
wire('tl-play', togglePlay);
wire('tl-key', function () { setKey(selection.slice()); });
wire('tl-keyall', function () { setKey(allTopItems()); });
wire('tl-delkey', deleteKey);
wire('tl-clear', clearKeys);

tlFrame.addEventListener('change', function () { setFrame(Number(tlFrame.value) || 0); });
tlLength.addEventListener('change', function () {
  animSettings.length = Math.min(600, Math.max(1, Math.round(Number(tlLength.value) || 24)));
  tlLength.value = animSettings.length;
  if (curFrame > animSettings.length) setFrame(animSettings.length);
});
tlFps.addEventListener('change', function () {
  animSettings.fps = Math.min(60, Math.max(1, Math.round(Number(tlFps.value) || 12)));
  tlFps.value = animSettings.fps;
});
tlEase.addEventListener('change', function () { animSettings.ease = tlEase.value; });
tlLoop.addEventListener('change', function () { animSettings.loop = tlLoop.checked; });

document.addEventListener('keydown', function (e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ',') setFrame(curFrame - 1);
  if (e.key === '.') setFrame(curFrame + 1);
  if (e.key.toLowerCase() === 'j') setKey(selection.slice());
});

function diamond(c, x, y, r) {
  c.beginPath();
  c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y);
  c.closePath();
}

function drawTimeline() {
  tlRows = allTopItems().filter(function (i) {
    return i.data.track && i.data.track.length;
  }).reverse();

  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(tlScroll.clientWidth, TL.LW + (animSettings.length + 2) * TL.FW);
  const H = Math.max(tlScroll.clientHeight, TL.RULER + tlRows.length * TL.RH + 4);
  if (tlCanvas.width !== Math.round(W * dpr) || tlCanvas.height !== Math.round(H * dpr)) {
    tlCanvas.width = Math.round(W * dpr);
    tlCanvas.height = Math.round(H * dpr);
    tlCanvas.style.width = W + 'px';
    tlCanvas.style.height = H + 'px';
  }
  const c = tlCanvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#252525';
  c.fillRect(0, 0, W, H);
  c.font = '11px system-ui, sans-serif';

  tlRows.forEach(function (item, r) {
    const y = TL.RULER + r * TL.RH;
    c.fillStyle = selection.indexOf(item) >= 0 ? '#1f3f7a' : (r % 2 ? '#2a2a2a' : '#2e2e2e');
    c.fillRect(0, y, W, TL.RH);
  });

  c.fillStyle = '#1c1c1c';
  c.fillRect(0, 0, W, TL.RULER);
  for (let f = 0; f <= animSettings.length; f++) {
    const x = TL.LW + f * TL.FW;
    const major = f % 5 === 0;
    c.fillStyle = major ? '#888' : '#555';
    c.fillRect(x, major ? 14 : 18, 1, major ? 10 : 6);
    if (major) { c.fillStyle = '#aaa'; c.fillText(String(f), x + 3, 12); }
  }
  c.fillStyle = 'rgba(255,255,255,0.06)';
  c.fillRect(TL.LW + animSettings.length * TL.FW, TL.RULER, W, H);

  tlRows.forEach(function (item, r) {
    const y = TL.RULER + r * TL.RH + TL.RH / 2;
    item.data.track.forEach(function (k) {
      const isSel = selKey && selKey.key === k;
      diamond(c, TL.LW + k.t * TL.FW, y, 6);
      c.fillStyle = isSel ? '#ffffff' : '#ff9f1c';
      c.fill();
      c.strokeStyle = '#000';
      c.stroke();
    });
  });

  const px = TL.LW + (playing ? playPos : curFrame) * TL.FW;
  c.fillStyle = '#ff3b3b';
  c.fillRect(px - 1, 0, 2, H);
  c.beginPath(); c.moveTo(px - 6, 0); c.lineTo(px + 6, 0); c.lineTo(px, 9); c.closePath(); c.fill();

  const sx = tlScroll.scrollLeft;
  c.fillStyle = '#2a2a2a';
  c.fillRect(sx, 0, TL.LW, H);
  c.fillStyle = '#111';
  c.fillRect(sx + TL.LW - 1, 0, 1, H);
  c.save();
  c.beginPath(); c.rect(sx + 4, 0, TL.LW - 10, H); c.clip();
  c.fillStyle = '#888';
  c.fillText('Animated parts', sx + 6, 15);
  tlRows.forEach(function (item, r) {
    c.fillStyle = selection.indexOf(item) >= 0 ? '#fff' : '#ccc';
    c.fillText(item.name || 'Object', sx + 6, TL.RULER + r * TL.RH + 15);
  });
  c.restore();
}

function frameAtX(x) {
  return Math.max(0, Math.min(animSettings.length, Math.round((x - TL.LW) / TL.FW)));
}

tlCanvas.addEventListener('pointerdown', function (e) {
  if (playing) togglePlay();
  tlCanvas.setPointerCapture(e.pointerId);
  const x = e.offsetX, y = e.offsetY;
  const sx = tlScroll.scrollLeft;

  if (y < TL.RULER) {
    tlDrag = { mode: 'scrub' };
    if (x >= sx + TL.LW) setFrame(frameAtX(x));
    return;
  }
  const item = tlRows[Math.floor((y - TL.RULER) / TL.RH)];
  if (!item) { tlDrag = null; return; }
  selectItem(item);
  if (x < sx + TL.LW) { tlDrag = null; return; }

  const hit = item.data.track.filter(function (k) {
    return Math.abs(TL.LW + k.t * TL.FW - x) <= 7;
  })[0];
  if (hit) {
    selKey = { item: item, key: hit };
    setFrame(hit.t);
    tlDrag = { mode: 'key', item: item, key: hit, moved: false };
  } else {
    selKey = null;
    setFrame(frameAtX(x));
    tlDrag = { mode: 'scrub' };
  }
});

tlCanvas.addEventListener('pointermove', function (e) {
  if (!tlDrag) return;
  const f = frameAtX(e.offsetX);
  if (tlDrag.mode === 'scrub') {
    setFrame(f);
  } else if (f !== tlDrag.key.t) {
    const taken = tlDrag.item.data.track.some(function (k) {
      return k !== tlDrag.key && k.t === f;
    });
    if (taken) return;
    tlDrag.key.t = f;
    tlDrag.item.data.track.sort(function (a, b) { return a.t - b.t; });
    tlDrag.moved = true;
    setFrame(f);
  }
});

tlCanvas.addEventListener('pointerup', function () {
  if (tlDrag && tlDrag.moved) saveState();
  tlDrag = null;
});

const _projectData = projectData;
projectData = function () {
  const d = _projectData();
  d.anim = Object.assign({}, animSettings);
  return d;
};
const _loadProjectData = loadProjectData;
loadProjectData = function (data) {
  if (data && data.anim) { Object.assign(animSettings, data.anim); syncTimelineUi(); }
  _loadProjectData(data);
  setFrame(0);
};

syncTimelineUi();

// ======================================================
// MILESTONE 3: animate color / shape / opacity, SWITCH groups, ONION SKIN
// ======================================================
animSettings.onion = false;
animSettings.onionBefore = 2;
animSettings.onionAfter = 2;

function colorToArr(c) {
  if (!c) return null;
  if (c.type === 'gradient') return undefined;
  const k = c.type === 'rgb' ? c : c.convert('rgb');
  return [k.red, k.green, k.blue, k.alpha === undefined ? 1 : k.alpha];
}
function arrToColor(a) {
  return a ? new paper.Color(a[0], a[1], a[2], a[3]) : null;
}
function lerpArr(a, b, u) {
  if (!a || !b) return u < 1 ? a : b;
  return a.map(function (v, i) { return v + (b[i] - v) * u; });
}

function captureLook(item) {
  const L = { op: item.opacity };
  const cn = item.className;
  if (cn === 'Group' || cn === 'Raster') return L;
  L.fill = colorToArr(item.fillColor);
  L.stroke = colorToArr(item.strokeColor);
  L.sw = item.strokeWidth;
  L.bl = Number(item.data.blur) || 0;
  return L;
}

function captureShape(item) {
  const inv = mxFrom(item.data.pose).inverted();
  if (!inv) return undefined;
  return item.segments.map(function (s) {
    const p = inv.transform(s.point);
    const hi = inv.transform(s.point.add(s.handleIn)).subtract(p);
    const ho = inv.transform(s.point.add(s.handleOut)).subtract(p);
    return [p.x, p.y, hi.x, hi.y, ho.x, ho.y];
  });
}

function setSwitchIndex(group, idx) {
  const n = group.children.length;
  if (!n) return;
  idx = ((Math.round(idx) % n) + n) % n;
  group.data.sel = idx;
  group.children.forEach(function (c, i) { c.visible = (i === idx); });
}

function makeSwitch() {
  if (selection.length < 2) {
    alert('Select 2 or more objects first (Shift+click). Each one becomes a "face". If a face is made of several shapes, Group them first.');
    return;
  }
  selectedItem.layer.activate();
  const sorted = selection.slice().sort(function (a, b) { return a.index - b.index; });
  const g = new paper.Group(sorted);
  const c = g.bounds.center;
  g.data.isSwitch = true;
  g.data.pivot = [c.x, c.y];
  registerItem(g, 'Switch', '🔀');
  setSwitchIndex(g, 0);
  setSelection([g]);
  saveState();
}

function stepSwitch(dir) {
  const list = selection.filter(function (i) { return i.data && i.data.isSwitch; });
  if (!list.length) { alert('Select a switch group first.'); return; }
  list.forEach(function (g) { setSwitchIndex(g, (g.data.sel || 0) + dir); });
  saveState();
}

function unSwitch() {
  const list = selection.filter(function (i) { return i.data && i.data.isSwitch; });
  if (!list.length) return;
  list.forEach(function (g) {
    g.children.forEach(function (c) { c.visible = true; });
    delete g.data.isSwitch;
    delete g.data.sel;
  });
  saveState();
}

wire('sw-make', makeSwitch);
wire('sw-prev', function () { stepSwitch(-1); });
wire('sw-next', function () { stepSwitch(1); });
wire('sw-undo', unSwitch);

const swLabel = document.getElementById('sw-label');
const SW_HINT = 'Select a switch group to change its shown part.';
paper.view.on('frame', function () {
  const g = selectedItem && selectedItem.data && selectedItem.data.isSwitch ? selectedItem : null;
  const t = g ? 'Showing part ' + ((g.data.sel || 0) + 1) + ' of ' + g.children.length : SW_HINT;
  if (swLabel.textContent !== t) swLabel.textContent = t;
});

function bracketKeys(keys, f) {
  if (f <= keys[0].t) return { a: keys[0], b: keys[0], u: 0 };
  const last = keys[keys.length - 1];
  if (f >= last.t) return { a: last, b: last, u: 0 };
  let i = 0;
  while (keys[i + 1].t <= f) i++;
  const a = keys[i], b = keys[i + 1];
  let u = (f - a.t) / (b.t - a.t);
  if (animSettings.ease === 'step') u = 0;
  else if (animSettings.ease === 'smooth') u = u * u * (3 - 2 * u);
  return { a: a, b: b, u: u };
}

function applyLooks(f) {
  allTopItems().forEach(function (item) {
    const keys = item.data.track;
    if (!keys || !keys.length) return;
    const br = bracketKeys(keys, f);
    const a = br.a, b = br.b, u = br.u;
    const mix = function (x, y) { return x + (y - x) * u; };

    if (item.data.isSwitch && a.sel !== undefined) setSwitchIndex(item, a.sel);

    const A = a.look, B = b.look;
    if (A && B) {
      if (A.op !== undefined && B.op !== undefined) item.opacity = mix(A.op, B.op);
      if (A.fill !== undefined && B.fill !== undefined) item.fillColor = arrToColor(lerpArr(A.fill, B.fill, u));
      if (A.stroke !== undefined && B.stroke !== undefined) item.strokeColor = arrToColor(lerpArr(A.stroke, B.stroke, u));
      if (A.sw !== undefined && B.sw !== undefined) item.strokeWidth = mix(A.sw, B.sw);
      if (A.bl !== undefined && B.bl !== undefined) item.data.blur = mix(A.bl, B.bl);
    }

    const SA = a.shape, SB = b.shape;
    if (SA && SB && item.className === 'Path' &&
        SA.length === SB.length && item.segments.length === SA.length) {
      const P = mxFrom(item.data.pose);
      item.segments.forEach(function (s, i) {
        const x = SA[i], y = SB[i];
        const m = function (j) { return x[j] + (y[j] - x[j]) * u; };
        const rp = new paper.Point(m(0), m(1));
        const p = P.transform(rp);
        s.point = p;
        s.handleIn = P.transform(rp.add(new paper.Point(m(2), m(3)))).subtract(p);
        s.handleOut = P.transform(rp.add(new paper.Point(m(4), m(5)))).subtract(p);
      });
    }
  });
}

// ======================================================
// ONION SKIN
// ======================================================
const onionChk = document.getElementById('tl-onion');
const onionB = document.getElementById('tl-onb');
const onionA = document.getElementById('tl-ona');
const onionCanvas = document.createElement('canvas');
onionCanvas.id = 'onion-canvas';
canvasArea.appendChild(onionCanvas);

const _syncUi = syncTimelineUi;
syncTimelineUi = function () {
  _syncUi();
  onionChk.checked = !!animSettings.onion;
  onionB.value = animSettings.onionBefore;
  onionA.value = animSettings.onionAfter;
};
syncTimelineUi();

onionChk.addEventListener('change', function () { animSettings.onion = onionChk.checked; });
function clampOnion(input, key) {
  animSettings[key] = Math.min(6, Math.max(0, Math.round(Number(input.value) || 0)));
  input.value = animSettings[key];
}
onionB.addEventListener('change', function () { clampOnion(onionB, 'onionBefore'); });
onionA.addEventListener('change', function () { clampOnion(onionA, 'onionAfter'); });
document.addEventListener('keydown', function (e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key.toLowerCase() === 'o') {
    animSettings.onion = !animSettings.onion;
    onionChk.checked = animSettings.onion;
  }
});

function movesWithTimeline(item, depth) {
  if (item.data.track && item.data.track.length) return true;
  const par = depth < 20 && item.data.parent ? findByUid(item.data.parent) : null;
  return par ? movesWithTimeline(par, depth + 1) : false;
}

function snapshotLive() {
  return allTopItems().map(function (i) {
    const d = i.data;
    return {
      item: i,
      pose: d.pose ? d.pose.slice() : null,
      pivot: d.pivot ? d.pivot.slice() : null,
      visible: i.visible,
      blur: d.blur,
      sel: d.sel,
      look: captureLook(i),
      segs: i.className === 'Path' ? i.segments.map(function (s) {
        return [s.point.x, s.point.y, s.handleIn.x, s.handleIn.y, s.handleOut.x, s.handleOut.y];
      }) : null
    };
  });
}

function restoreLive(snap) {
  animating = true;
  try {
    snap.forEach(function (s) {
      const i = s.item, d = i.data;
      const inv = mxFrom(d.pose).inverted();
      if (inv) {
        const delta = mxFrom(s.pose).append(inv);
        if (!isIdentityish(delta)) i.transform(delta);
      }
      if (s.pose) d.pose = s.pose.slice(); else delete d.pose;
      if (s.pivot) d.pivot = s.pivot.slice(); else delete d.pivot;
      if (s.segs && i.segments.length === s.segs.length) {
        i.segments.forEach(function (seg, n) {
          const v = s.segs[n];
          seg.point = new paper.Point(v[0], v[1]);
          seg.handleIn = new paper.Point(v[2], v[3]);
          seg.handleOut = new paper.Point(v[4], v[5]);
        });
      }
      const L = s.look;
      i.opacity = L.op;
      if (L.fill !== undefined) i.fillColor = arrToColor(L.fill);
      if (L.stroke !== undefined) i.strokeColor = arrToColor(L.stroke);
      if (L.sw !== undefined) i.strokeWidth = L.sw;
      if (s.blur === undefined) delete d.blur; else d.blur = s.blur;
      if (d.isSwitch) setSwitchIndex(i, s.sel || 0);
      i.visible = s.visible;
    });
  } finally {
    animating = false;
  }
}

function rebuildOnion() {
  const el = paper.view.element;
  if (onionCanvas.width !== el.width || onionCanvas.height !== el.height) {
    onionCanvas.width = el.width;
    onionCanvas.height = el.height;
  }
  onionCanvas.style.width = el.style.width || '100%';
  onionCanvas.style.height = el.style.height || '100%';
  const ctx = onionCanvas.getContext('2d');
  ctx.clearRect(0, 0, onionCanvas.width, onionCanvas.height);
  if (!animSettings.onion || playing) return;

  const list = [];
  for (let k = animSettings.onionBefore; k >= 1; k--) list.push({ f: curFrame - k, k: k, c: '255,80,80' });
  for (let k = 1; k <= animSettings.onionAfter; k++) list.push({ f: curFrame + k, k: k, c: '60,200,110' });
  const frames = list.filter(function (g) { return g.f >= 0 && g.f <= animSettings.length; });
  if (!frames.length) return;

  const snap = snapshotLive();
  const sel = selection.slice();
  const full = sel.map(function (i) { return i.className === 'Path' && i.fullySelected; });
  const pen = penPath;
  paper.project.deselectAll();
  snap.forEach(function (s) {
    if (!movesWithTimeline(s.item, 0)) s.item.visible = false;
  });

  const tmp = document.createElement('canvas');
  tmp.width = el.width;
  tmp.height = el.height;
  const t = tmp.getContext('2d');
  try {
    frames.forEach(function (g) {
      evaluateAt(g.f);
      paper.project._needsUpdate = true;
      paper.view.update();
      t.globalCompositeOperation = 'source-over';
      t.clearRect(0, 0, tmp.width, tmp.height);
      t.drawImage(el, 0, 0);
      t.globalCompositeOperation = 'source-atop';
      t.fillStyle = 'rgba(' + g.c + ',0.55)';
      t.fillRect(0, 0, tmp.width, tmp.height);
      ctx.globalAlpha = 0.5 / g.k;
      ctx.drawImage(tmp, 0, 0);
    });
  } finally {
    ctx.globalAlpha = 1;
    restoreLive(snap);
    sel.forEach(function (i, n) { i.selected = true; if (full[n]) i.fullySelected = true; });
    if (pen) pen.selected = true;
    paper.project._needsUpdate = true;
  }
}

let stateVersion = 0, onionKey = '', pointerOnCanvas = false;

const _saveState = saveState;
saveState = function () { stateVersion++; _saveState(); };
const _restoreState = restoreState;
restoreState = function (s) { stateVersion++; _restoreState(s); };

window.addEventListener('pointerdown', function (e) {
  pointerOnCanvas = canvasArea.contains(e.target);
}, true);
['pointerup', 'pointercancel'].forEach(function (n) {
  window.addEventListener(n, function () { pointerOnCanvas = false; }, true);
});

paper.view.on('frame', function () {
  if (pointerOnCanvas) return;
  const v = paper.view;
  const key = [animSettings.onion ? 1 : 0, animSettings.onionBefore, animSettings.onionAfter,
    animSettings.length, playing ? 1 : 0, curFrame, stateVersion, v.zoom,
    Math.round(v.center.x * 10), Math.round(v.center.y * 10),
    v.element.width, v.element.height].join('|');
  if (key === onionKey) return;
  onionKey = key;
  rebuildOnion();
});

// ======================================================
// MILESTONE 13: COPY/PASTE KEYS + SPRITE SHEET
// ======================================================
let keyClip = null;

function copyKeys() {
  const items = selection.length ? selection : allTopItems();
  const out = [];
  items.forEach(function (item) {
    const track = item.data.track;
    if (!track || !item.data.uid) return;
    const key = track.filter(function (k) { return k.t === curFrame; })[0];
    if (key) out.push({ uid: item.data.uid, key: JSON.parse(JSON.stringify(key)) });
  });
  if (!out.length) {
    alert('No keys at frame ' + curFrame + '. Select a part that has a ◆ at this frame.');
    return;
  }
  keyClip = out;
}

function pasteKeys() {
  if (!keyClip) {
    alert('Copy a key first (◆ Copy key).');
    return;
  }
  let n = 0;
  keyClip.forEach(function (c) {
    const item = findByUid(c.uid);
    if (!item || !item.data.track) return;
    const k = JSON.parse(JSON.stringify(c.key));
    k.t = curFrame;
    const rest = item.data.track.filter(function (o) { return o.t !== k.t; });
    unwrapRot(rest, k);
    rest.push(k);
    rest.sort(function (a, b) { return a.t - b.t; });
    item.data.track = rest;
    n++;
  });
  if (n) {
    evaluateAt(curFrame);
    saveState();
  }
}

wire('tl-copykey', copyKeys);
wire('tl-pastekey', pasteKeys);

window.addEventListener('keydown', function (e) {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.code === 'KeyC') { e.preventDefault(); e.stopPropagation(); copyKeys(); }
  if (e.code === 'KeyV') { e.preventDefault(); e.stopPropagation(); pasteKeys(); }
}, true);

const ssFrom = document.getElementById('ss-from');
const ssTo = document.getElementById('ss-to');
const ssCols = document.getElementById('ss-cols');
const ssPad = document.getElementById('ss-pad');
const ssScale = document.getElementById('ss-scale');
const ssName = document.getElementById('ss-name');
const ssInfo = document.getElementById('ss-info');

function clampInt(v, lo, hi) {
  return Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
}

function exportSpriteSheet() {
  if (playing) togglePlay();

  const L = animSettings.length;
  let from = clampInt(ssFrom.value, 0, L);
  let to = clampInt(ssTo.value, 0, L);
  if (to < from) { const t = from; from = to; to = t; }

  const count = to - from + 1;
  const cols = Math.min(count, clampInt(ssCols.value, 1, 64));
  const rows = Math.ceil(count / cols);
  const pad = clampInt(ssPad.value, 0, 64);
  const scale = Math.min(800, Math.max(10, Number(ssScale.value) || 100)) / 100;
  const cw = Math.max(1, Math.round(frame.w * scale));
  const ch = Math.max(1, Math.round(frame.h * scale));
  const sheetW = pad + cols * (cw + pad);
  const sheetH = pad + rows * (ch + pad);

  if (sheetW > 16384 || sheetH > 16384 || sheetW * sheetH > 100000000) {
    alert('The sheet would be ' + sheetW + ' x ' + sheetH + ' px. That is too big.\nLower the cell scale, use fewer frames, or change Columns.');
    return;
  }

  const name = (ssName.value || 'sprites').trim().replace(/[^\w\-]+/g, '_') || 'sprites';
  const bg = expBg.value === 'color' ? expBgColor.value : null;
  const area = new paper.Rectangle(frame.x, frame.y, frame.w, frame.h);

  const sheet = document.createElement('canvas');
  sheet.width = sheetW;
  sheet.height = sheetH;
  const sctx = sheet.getContext('2d');

  const frames = {};
  const names = [];
  const snap = snapshotLive();

  try {
    for (let i = 0; i < count; i++) {
      const f = from + i;
      evaluateAt(f);
      const cell = renderArea(area, cw, ch, false, bg);
      const x = pad + (i % cols) * (cw + pad);
      const y = pad + Math.floor(i / cols) * (ch + pad);
      sctx.drawImage(cell, x, y);

      const fname = name + '_' + f;
      names.push(fname);
      frames[fname] = {
        frame: { x: x, y: y, w: cw, h: ch },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: cw, h: ch },
        sourceSize: { w: cw, h: ch }
      };
    }
  } finally {
    restoreLive(snap);
    paper.project._needsUpdate = true;
    paper.view.update();
  }

  const data = {
    frames: frames,
    animations: { [name]: names },
    meta: {
      app: 'Vector Studio',
      version: '1.0',
      image: name + '.png',
      format: 'RGBA8888',
      size: { w: sheetW, h: sheetH },
      scale: String(scale),
      frameWidth: cw,
      frameHeight: ch,
      frameCount: count,
      columns: cols,
      rows: rows,
      padding: pad,
      fps: animSettings.fps,
      loop: animSettings.loop
    }
  };

  sheet.toBlob(function (blob) {
    if (!blob) { alert('Export failed. Try a smaller size.'); return; }
    downloadBlob(blob, name + '.png');
    setTimeout(function () {
      downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name + '.json');
    }, 400);
  }, 'image/png');

  ssInfo.textContent = count + ' frames, ' + cols + ' x ' + rows + ' grid, sheet ' + sheetW + ' x ' + sheetH + ' px, cell ' + cw + ' x ' + ch + ' px.';
}

wire('ss-download', exportSpriteSheet);

function syncSpriteRange() {
  ssTo.value = Math.max(0, animSettings.length - 1);
}
tlLength.addEventListener('change', syncSpriteRange);
syncSpriteRange();

// ======================================================
// MILESTONE 14: PWA (service worker + install button)
// ======================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function (err) {
      console.log('Service worker failed:', err);
    });
  });
}

let installEvent = null;
const installBtn = document.getElementById('btn-install');

window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  installEvent = e;
  if (installBtn) installBtn.style.display = '';
});

if (installBtn) {
  installBtn.addEventListener('click', function () {
    if (!installEvent) return;
    installEvent.prompt();
    installEvent.userChoice.then(function () {
      installEvent = null;
      installBtn.style.display = 'none';
    });
  });
}

window.addEventListener('appinstalled', function () {
  if (installBtn) installBtn.style.display = 'none';
});

// ======================================================
// MILESTONE 15: TABLET / TOUCH SUPPORT
// ======================================================
const isCoarse = window.matchMedia('(pointer: coarse)').matches;
if (isCoarse) { TL.FW = 24; TL.RH = 30; }   // bigger timeline cells

canvasArea.addEventListener('contextmenu', function (e) { e.preventDefault(); });

let handMode = false;
let shiftToggle = false;
let gestureOn = false;
let gest = null;
const touchPts = new Map();

function viewPt(e) {
  const r = canvasEl.getBoundingClientRect();
  return new paper.Point(e.clientX - r.left, e.clientY - r.top);
}

function touchMid() {
  const arr = Array.from(touchPts.values());
  return arr.reduce(function (s, p) { return s.add(p); }, new paper.Point(0, 0)).divide(arr.length);
}

function startGesture() {
  if (!touchPts.size) return;
  const arr = Array.from(touchPts.values());
  gest = {
    zoom: paper.view.zoom,
    dist: arr.length > 1 ? arr[0].getDistance(arr[1]) : 0,
    p0: paper.view.viewToProject(touchMid())
  };
}

function updateGesture() {
  if (!gest) return;
  const arr = Array.from(touchPts.values());
  const mid = touchMid();
  const v = paper.view;
  let z = gest.zoom;
  if (arr.length > 1 && gest.dist > 10) {
    z = Math.min(20, Math.max(0.1, gest.zoom * arr[0].getDistance(arr[1]) / gest.dist));
  }
  v.zoom = z;
  const half = new paper.Point(v.viewSize.width / 2, v.viewSize.height / 2);
  v.center = gest.p0.subtract(mid.subtract(half).divide(z));
  updateZoomLabel();
}

// When a second finger lands, cancel the half-drawn stroke of the first finger
function abortStroke() {
  const drawing = ['rect', 'circle', 'star', 'line', 'brush', 'spray', 'eraser', 'lasso'];
  if (marquee) { marquee.remove(); marquee = null; }
  marqueeStart = null;
  if (drawing.indexOf(currentToolName) >= 0 && history[historyIndex]) {
    clearInterval(sprayTimer);
    restoreState(history[historyIndex]);
  }
  brushPath = null; brushPoints = []; currentShape = null;
  sprayGroup = null; lassoPath = null; erased = false; nodeMoved = false;
}

function isGestureTarget(e) {
  return e.pointerType === 'touch' &&
    !e.target.closest('button, #page-bar, #touch-bar, .handle, #pivot-dot');
}

canvasArea.addEventListener('pointerdown', function (e) {
  if (!isGestureTarget(e)) return;
  touchPts.set(e.pointerId, viewPt(e));
  if (touchPts.size >= 2 && !gestureOn) {
    gestureOn = true;
    if (!handMode) abortStroke();
  }
  if (handMode || gestureOn) startGesture();
}, true);

window.addEventListener('pointermove', function (e) {
  if (!touchPts.has(e.pointerId)) return;
  touchPts.set(e.pointerId, viewPt(e));
  if (handMode || gestureOn) updateGesture();
});

function touchEnd(e) {
  if (!touchPts.has(e.pointerId)) return;
  touchPts.delete(e.pointerId);
  if (!touchPts.size) { gestureOn = false; gest = null; }
  else if (handMode || gestureOn) startGesture();
}
window.addEventListener('pointerup', touchEnd);
window.addEventListener('pointercancel', touchEnd);

// Stop Paper.js from also seeing finger drags that belong to a gesture
['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (type) {
  window.addEventListener(type, function (e) {
    if (e.target !== canvasEl) return;
    const n = e.touches.length;
    if (type === 'touchstart') {
      if (handMode || gestureOn || n >= 2) e.stopPropagation();
    } else if (type === 'touchmove') {
      if (handMode || gestureOn) e.stopPropagation();
    } else {
      if (handMode || (gestureOn && n > 0)) e.stopPropagation();
    }
  }, { capture: true, passive: false });
});

// ----- Touch bar -----
const tbHand = document.getElementById('tb-hand');
const tbShift = document.getElementById('tb-shift');

function setHand(on) {
  handMode = on;
  spaceDown = on;   // makes mouse and stylus drag pan too
  canvasArea.style.cursor = on ? 'grab' : '';
  tbHand.classList.toggle('on', on);
}
tbHand.addEventListener('click', function () { setHand(!handMode); });

tbShift.addEventListener('click', function () {
  shiftToggle = !shiftToggle;
  tbShift.classList.toggle('on', shiftToggle);
});

// Make every tool think Shift is held while the ⇧ button is on
Object.keys(tools).forEach(function (name) {
  ['onMouseDown', 'onMouseDrag', 'onMouseUp'].forEach(function (fn) {
    const orig = tools[name][fn];
    if (!orig) return;
    tools[name][fn] = function (event) {
      if (shiftToggle) {
        event = Object.create(event, {
          modifiers: { value: Object.assign({}, event.modifiers, { shift: true }) }
        });
      }
      return orig.call(this, event);
    };
  });
});

wire('tb-rot', function () { handleMode = handleMode === 'rotate' ? 'scale' : 'rotate'; });
wire('tb-done', function () { finishPen(); });
wire('tb-del', function () {
  if (currentToolName === 'node' && nodeSel && nodeSel.path) removeNode(nodeSel);
  else deleteObject();
});

// ----- Timeline: scroll while scrubbing near the edge -----
tlCanvas.addEventListener('pointermove', function (e) {
  if (!tlDrag) return;
  const r = tlScroll.getBoundingClientRect();
  if (e.clientX > r.right - 30) tlScroll.scrollLeft += 12;
  else if (e.clientX < r.left + TL.LW + 30) tlScroll.scrollLeft -= 12;
});

// ======================================================
// START — bootstrap pages and the first undo step
// ======================================================
setTool('rect');
pages = [{ json: paper.project.exportJSON(), active: 0, name: 'Page 1' }];
currentPageIndex = 0;
saveState();
refreshPageBar();