// addons/my-feature.js
(function () {
  'use strict';
  if (window.__addon_myfeature) return;        // never run twice
  window.__addon_myfeature = true;

  var $ = function (id) { return document.getElementById(id); };
  var say = function (m) { if (window.toast) window.toast(m); };

  // 1. UI: put HTML into an existing panel
  // $('img-cut').parentNode.insertAdjacentHTML('afterend',
  //   '<div class="layer-actions"><button id="my-btn">My button</button></div>');

  // 2. Logic
  // wire('my-btn', function () { /* work */ saveState(); });

  // 3. Per-frame overlay (chain, never replace)
  var prevTick = window.tickTimeline;
  window.tickTimeline = function (e) { if (prevTick) prevTick(e); /* update overlays */ };
})();