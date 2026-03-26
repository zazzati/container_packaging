(function () {
  'use strict';

  /* ── Constants ── */
  var ITEM_ID_PADDING    = 3;
  var MAX_PERCENT        = 100;
  var PALLET_COLORS = [
    '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
    '#06b6d4','#84cc16','#f97316','#ec4899','#6366f1',
    '#0ea5e9','#a3e635','#fb923c','#f43f5e','#a78bfa',
    '#34d399','#fbbf24','#60a5fa','#4ade80','#c084fc'
  ];
  var FALLBACK_CONTAINERS = [
    { id: '20ST', name: "20' Standard",  volume_cbm: 33.2, max_payload_kg: 21770, description: 'Container standard da 20 piedi.',  inner_length_m: 5.898,  inner_width_m: 2.352, inner_height_m: 2.393 },
    { id: '40ST', name: "40' Standard",  volume_cbm: 67.0, max_payload_kg: 26500, description: 'Container standard da 40 piedi.',  inner_length_m: 12.032, inner_width_m: 2.352, inner_height_m: 2.393 },
    { id: '40HC', name: "40' High Cube", volume_cbm: 76.0, max_payload_kg: 28500, description: 'Container da 40 piedi High Cube.', inner_length_m: 12.032, inner_width_m: 2.352, inner_height_m: 2.698 }
  ];

  /* ── Unit conversion helpers ── */
  function dimToMeters(value, uom) {
    switch (uom) {
      case 'm':  return value;
      case 'cm': return value / 100;
      case 'mm': return value / 1000;
      case 'in': return value * 0.0254;
      default:   return value;
    }
  }

  function weightToKg(value, uom) {
    return uom === 'lbs' ? value * 0.453592 : value;
  }

  /* ── MAXRECTS 2-D Bin Packing ─────────────────────────────────────────────
     Best Short Side Fit (BSSF) heuristic with 90° rotation support.
     Reference: Jylänki (2010) "A Thousand Ways to Pack the Bin".
  ─────────────────────────────────────────────────────────────────────────── */
  function MaxRects(binW, binH, gap) {
    this.binW = binW;
    this.binH = binH;
    this.gap  = (gap > 0) ? gap : 0;
    var g = this.gap;
    this.freeRects = [{ x: g, y: g, w: Math.max(0, binW - 2 * g), h: Math.max(0, binH - 2 * g) }];
    this.usedRects = [];
  }

  MaxRects.prototype.insert = function (rw, rh, allowRotation) {
    var EPS = 1e-9;
    var g   = this.gap;
    /* Each item is inserted at its padded size (actual + trailing gap), which
       reserves g space between adjacent items. The returned position/dims are
       the actual (un-padded) values so the canvas renders correctly. */
    var tries = allowRotation
      ? [[rw + g, rh + g, rw, rh, false], [rh + g, rw + g, rh, rw, true]]
      : [[rw + g, rh + g, rw, rh, false]];
    var best = null, bestScore = Infinity, bestRotated = false, bestAw = 0, bestAh = 0;
    for (var ti = 0; ti < tries.length; ti++) {
      var tw = tries[ti][0], th = tries[ti][1];
      var aw = tries[ti][2], ah = tries[ti][3], rot = tries[ti][4];
      for (var fi = 0; fi < this.freeRects.length; fi++) {
        var fr = this.freeRects[fi];
        if (tw <= fr.w + EPS && th <= fr.h + EPS) {
          var score = Math.min(fr.w - tw, fr.h - th);
          if (score < bestScore - EPS) {
            bestScore = score;
            best = { x: fr.x, y: fr.y, w: tw, h: th };
            bestRotated = rot;
            bestAw = aw; bestAh = ah;
          }
        }
      }
    }
    if (!best) return null;
    /* Split using the padded rectangle to reserve trailing gap space */
    this.usedRects.push({ x: best.x, y: best.y, w: best.w, h: best.h });
    this._split(best);
    this._prune();
    /* Return actual (un-padded) dims at the placed position */
    return { x: best.x, y: best.y, w: bestAw, h: bestAh, rotated: bestRotated };
  };

  MaxRects.prototype._split = function (used) {
    var nf = [];
    for (var i = 0; i < this.freeRects.length; i++) {
      var fr = this.freeRects[i];
      if (!this._overlaps(used, fr)) { nf.push(fr); continue; }
      if (used.x > fr.x)
        nf.push({ x: fr.x, y: fr.y, w: used.x - fr.x, h: fr.h });
      if (used.x + used.w < fr.x + fr.w)
        nf.push({ x: used.x + used.w, y: fr.y, w: (fr.x + fr.w) - (used.x + used.w), h: fr.h });
      if (used.y > fr.y)
        nf.push({ x: fr.x, y: fr.y, w: fr.w, h: used.y - fr.y });
      if (used.y + used.h < fr.y + fr.h)
        nf.push({ x: fr.x, y: used.y + used.h, w: fr.w, h: (fr.y + fr.h) - (used.y + used.h) });
    }
    this.freeRects = nf;
  };

  MaxRects.prototype._prune = function () {
    var rem = {}, fr = this.freeRects;
    for (var i = 0; i < fr.length; i++)
      for (var j = 0; j < fr.length; j++)
        if (i !== j && this._contains(fr[j], fr[i])) { rem[i] = true; break; }
    this.freeRects = fr.filter(function (_, idx) { return !rem[idx]; });
  };

  MaxRects.prototype._overlaps = function (a, b) {
    return !(a.x + a.w <= b.x || b.x + b.w <= a.x ||
             a.y + a.h <= b.y || b.y + b.h <= a.y);
  };

  MaxRects.prototype._contains = function (outer, inner) {
    return outer.x <= inner.x && outer.y <= inner.y &&
           outer.x + outer.w >= inner.x + inner.w &&
           outer.y + outer.h >= inner.y + inner.h;
  };

  /* ── IndexedDB Session Persistence ──────────────────────────────────────────
     Persists the user's row data and selected container across page reloads.
     Uses IndexedDB (structured-clone safe, no size limits).
     Falls back gracefully if IndexedDB is unavailable (private browsing, etc.).
  ─────────────────────────────────────────────────────────────────────────── */
  var DB_NAME    = 'containerAppDB';
  var DB_VERSION = 1;
  var STORE_NAME = 'session';
  var STATE_KEY  = 'appState';

  function openDB(cb) {
    if (!window.indexedDB) { cb(new Error('IndexedDB not available'), null); return; }
    var req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function (e) { e.target.result.createObjectStore(STORE_NAME); };
    req.onsuccess       = function (e) { cb(null, e.target.result); };
    req.onerror         = function (e) { cb(e.target.error, null); };
  }

  function dbSave(state, done) {
    openDB(function (err, db) {
      if (err) { if (done) done(err); return; }
      var tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(state, STATE_KEY);
      tx.oncomplete = function ()  { if (done) done(null); };
      tx.onerror    = function (e) { if (done) done(e.target.error); };
    });
  }

  function dbLoad(done) {
    openDB(function (err, db) {
      if (err) { done(null, null); return; }  /* graceful fallback */
      var tx  = db.transaction(STORE_NAME, 'readonly');
      var req = tx.objectStore(STORE_NAME).get(STATE_KEY);
      req.onsuccess = function (e) { done(null, e.target.result || null); };
      req.onerror   = function ()  { done(null, null); };
    });
  }

  function dbClear(done) {
    openDB(function (err, db) {
      if (err) { if (done) done(err); return; }
      var tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = function ()  { if (done) done(null); };
      tx.onerror    = function (e) { if (done) done(e.target.error); };
    });
  }

  /* ── Angular module ── */
  angular.module('containerApp', [])

    /* ── Floor-plan canvas directive ────────────────────────────────────────── */
    .directive('floorPlanCanvas', ['$window', function ($window) {
      var PADDING  = 40;
      var CANVAS_W = 680;

      function hexToRgba(hex, a) {
        var r = parseInt(hex.slice(1, 3), 16);
        var g = parseInt(hex.slice(3, 5), 16);
        var b = parseInt(hex.slice(5, 7), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
      }

      function darken(hex, amt) {
        return 'rgb(' +
          Math.max(0, parseInt(hex.slice(1, 3), 16) - amt) + ',' +
          Math.max(0, parseInt(hex.slice(3, 5), 16) - amt) + ',' +
          Math.max(0, parseInt(hex.slice(5, 7), 16) - amt) + ')';
      }

      function draw(canvas, ctLen, ctWid, placements) {
        if (!canvas || !ctLen || !ctWid) return;
        var drawW = CANVAS_W - 2 * PADDING;
        var scale = drawW / ctLen;
        var drawH = ctWid * scale;

        canvas.width  = CANVAS_W;
        canvas.height = Math.round(drawH) + 2 * PADDING;

        var ctx = canvas.getContext('2d');
        var ox = PADDING, oy = PADDING;

        /* Floor background */
        ctx.fillStyle = '#dce8f5';
        ctx.fillRect(ox, oy, drawW, drawH);

        /* 1 m grid */
        ctx.strokeStyle = 'rgba(100,116,139,0.20)';
        ctx.lineWidth = 0.8;
        for (var gx = scale; gx < drawW - 1; gx += scale) {
          ctx.beginPath(); ctx.moveTo(ox + gx, oy); ctx.lineTo(ox + gx, oy + drawH); ctx.stroke();
        }
        for (var gy = scale; gy < drawH - 1; gy += scale) {
          ctx.beginPath(); ctx.moveTo(ox, oy + gy); ctx.lineTo(ox + drawW, oy + gy); ctx.stroke();
        }

        /* Pallets */
        for (var i = 0; i < placements.length; i++) {
          var p  = placements[i];
          var px = ox + p.x * scale;
          var py = oy + p.y * scale;
          var pw = p.w * scale;
          var ph = p.h * scale;

          /* Fill */
          ctx.fillStyle = hexToRgba(p.color, 0.80);
          ctx.fillRect(px, py, pw, ph);

          /* Diagonal hatching for rotated items */
          if (p.rotated) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(px, py, pw, ph);
            ctx.clip();
            ctx.strokeStyle = darken(p.color, 40);
            ctx.lineWidth = 0.7;
            ctx.globalAlpha = 0.30;
            var sp = 9;
            for (var hx = -(ph); hx < pw + ph; hx += sp) {
              ctx.beginPath();
              ctx.moveTo(px + hx, py);
              ctx.lineTo(px + hx + ph, py + ph);
              ctx.stroke();
            }
            ctx.restore();
          }

          /* Border */
          ctx.strokeStyle = darken(p.color, 60);
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px + 0.75, py + 0.75, pw - 1.5, ph - 1.5);

          /* Item label (clipped to box) */
          var minSide = Math.min(pw, ph);
          var fontSize = Math.max(7, Math.min(minSide * 0.28, 13));
          ctx.save();
          ctx.beginPath();
          ctx.rect(px + 2, py + 2, pw - 4, ph - 4);
          ctx.clip();
          ctx.fillStyle = '#0f172a';
          ctx.font = 'bold ' + fontSize + 'px "Segoe UI",Tahoma,sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(p.item, px + pw / 2, py + ph / 2);
          ctx.restore();
        }

        /* Container border */
        ctx.strokeStyle = '#1e3a5f';
        ctx.lineWidth = 3;
        ctx.strokeRect(ox, oy, drawW, drawH);

        /* Corner bolts */
        var cm = 7;
        ctx.fillStyle = '#1e3a5f';
        [[ox, oy],[ox + drawW, oy],[ox, oy + drawH],[ox + drawW, oy + drawH]]
          .forEach(function (c) { ctx.fillRect(c[0] - cm/2, c[1] - cm/2, cm, cm); });

        /* Dimension labels */
        ctx.fillStyle = '#334155';
        ctx.font = '11px "Segoe UI",Tahoma,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ctLen.toFixed(3) + ' m  (lunghezza)', ox + drawW / 2, oy + drawH + PADDING * 0.60);
        ctx.save();
        ctx.translate(ox - PADDING * 0.60, oy + drawH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(ctWid.toFixed(3) + ' m  (larghezza)', 0, 0);
        ctx.restore();
      }

      return {
        restrict: 'E',
        scope: { placements: '=', ctLen: '=', ctWid: '=' },
        template: '<canvas style="max-width:100%; display:block; margin:0 auto;"></canvas>',
        link: function (scope, element) {
          var canvas = element[0].querySelector('canvas');
          function redraw() {
            if (scope.placements && scope.ctLen && scope.ctWid) {
              draw(canvas, scope.ctLen, scope.ctWid, scope.placements);
            }
          }
          scope.$watch('[placements, ctLen, ctWid]', redraw, true);
          angular.element($window).on('resize', redraw);
          scope.$on('$destroy', function () { angular.element($window).off('resize', redraw); });
        }
      };
    }])

    .controller('ContainerController', ['$scope', '$http', '$timeout', function ($scope, $http, $timeout) {

      var _uid = 0;
      function uid() { return ++_uid; }

      /* State */
      $scope.loading           = true;
      $scope.loadError         = false;
      $scope.sessionRestored   = false;
      $scope.containerTypes    = [];
      $scope.selectedContainer = null;
      $scope.rows              = [];
      $scope.risultati         = null;
      $scope.formError         = '';
      $scope.gapCm             = 10;   /* default 10 cm safety tolerance */

      /* Load container types */
      $http.get('containers.json')
        .then(function (resp) {
          $scope.containerTypes = resp.data;
        })
        .catch(function () {
          $scope.loadError      = true;
          $scope.containerTypes = FALLBACK_CONTAINERS;
        })
        .finally(function () {
          $scope.loading = false;

          /* Attempt to restore the last session from IndexedDB */
          dbLoad(function (err, saved) {
            $scope.$apply(function () {
              /* Restore container selection */
              if (saved && saved.selectedContainerId) {
                var found = null;
                for (var ci = 0; ci < $scope.containerTypes.length; ci++) {
                  if ($scope.containerTypes[ci].id === saved.selectedContainerId) {
                    found = $scope.containerTypes[ci];
                    break;
                  }
                }
                $scope.selectedContainer = found || $scope.containerTypes[0] || null;
              } else {
                $scope.selectedContainer = $scope.containerTypes[0] || null;
              }

              /* Restore rows — reassign fresh _id so ng-repeat tracks correctly */
              if (saved && Array.isArray(saved.rows) && saved.rows.length > 0) {
                $scope.rows = saved.rows.map(function (r) {
                  return angular.extend({}, r, { _id: uid() });
                });
                $scope.sessionRestored = true;
              } else {
                $scope.rows = [createRow()];
              }

              /* Restore gap tolerance */
              if (saved && saved.gapCm != null) {
                $scope.gapCm = saved.gapCm;
              }

              /* Begin auto-save watches only AFTER restore completes */
              _startAutoSave();
            });
          });
        });

      /* Container selection */
      $scope.selectContainer = function (ct) {
        $scope.selectedContainer = ct;
        $scope.risultati         = null;

        /* Ricalcolo automatico se ci sono dati già inseriti */
        var hasData = $scope.rows.some(function (r) {
          var l = parseFloat(r.length);
          var w = parseFloat(r.width);
          var h = parseFloat(r.height);
          return !isNaN(l) && l > 0 && !isNaN(w) && w > 0 && !isNaN(h) && h > 0;
        });

        if (hasData) {
          $scope.calcola();
        }
      };

      /* Row management */
      function createRow() {
        return {
          _id: uid(), item: '', description: '',
          length: null, width: null, height: null, dimUom: 'cm',
          weight: null, weightUom: 'kg', qty: 1
        };
      }

      $scope.addRow = function () {
        $scope.rows.push(createRow());
        $scope.risultati = null;
      };

      $scope.removeRow = function (idx) {
        if ($scope.rows.length > 1) {
          $scope.rows.splice(idx, 1);
          $scope.risultati = null;
        }
      };

      $scope.resetAll = function () {
        $scope.rows      = [createRow()];
        $scope.risultati = null;
        $scope.formError = '';
      };

      /* Cancella tutto (form + storage) e ricomincia da zero */
      $scope.clearAll = function () {
        dbClear();
        $scope.rows              = [createRow()];
        $scope.risultati         = null;
        $scope.formError         = '';
        $scope.sessionRestored   = false;
        $scope.gapCm             = 10;
        if ($scope.containerTypes.length > 0) {
          $scope.selectedContainer = $scope.containerTypes[0];
        }
      };

      /* ── Auto-save session (debounced 600 ms) ── */
      var _initialized = false;
      var _saveTimer   = null;

      function _rowsSnapshot(rows) {
        return rows.map(function (r) {
          return {
            item: r.item, description: r.description,
            length: r.length, width: r.width, height: r.height, dimUom: r.dimUom,
            weight: r.weight, weightUom: r.weightUom, qty: r.qty
          };
        });
      }

      function _persistSession() {
        if (!$scope.selectedContainer) return;
        dbSave({
          selectedContainerId: $scope.selectedContainer.id,
          rows: _rowsSnapshot($scope.rows),
          gapCm: $scope.gapCm
        });
      }

      function _scheduleSave() {
        if (!_initialized) return;
        if (_saveTimer) $timeout.cancel(_saveTimer);
        _saveTimer = $timeout(_persistSession, 600);
      }

      function _startAutoSave() {
        _initialized = true;
        $scope.$watch('rows', _scheduleSave, true);
        $scope.$watch('selectedContainer', _scheduleSave);
        $scope.$watch('gapCm', _scheduleSave);
      }

      $scope.fmtWeight = function (kg) {
        return kg !== null ? kg.toFixed(2) : '—';
      };

      /* ── Main calculation ── */
      $scope.calcola = function () {
        $scope.formError = '';
        $scope.risultati = null;

        if (!$scope.selectedContainer) {
          $scope.formError = 'Seleziona un tipo di container.';
          return;
        }

        /* Parse and validate gap tolerance */
        var gapCmRaw = parseFloat($scope.gapCm);
        var gapM = (!isNaN(gapCmRaw) && gapCmRaw >= 0) ? gapCmRaw / 100 : 0.10;

        var ct = $scope.selectedContainer;

        /* Effective usable dimensions after wall clearance (gap on each wall side) */
        var effLen = ct.inner_length_m - 2 * gapM;
        var effWid = ct.inner_width_m  - 2 * gapM;

        if (effLen <= 0 || effWid <= 0) {
          $scope.formError = 'La tolleranza (' + gapCmRaw.toFixed(0) + ' cm) è troppo grande per le dimensioni interne del container.';
          return;
        }

        /* Validate & expand rows into individual pallet units */
        var pallets = [];
        var valid   = true;

        for (var i = 0; i < $scope.rows.length; i++) {
          var r = $scope.rows[i];
          var l = parseFloat(r.length);
          var w = parseFloat(r.width);
          var h = parseFloat(r.height);
          var wt = parseFloat(r.weight);
          var qty = parseInt(r.qty, 10);

          if (isNaN(l) || l <= 0 || isNaN(w) || w <= 0 || isNaN(h) || h <= 0) {
            $scope.formError = 'Riga ' + (i + 1) + ': inserisci dimensioni (L, W, H) valide e positive.';
            valid = false; break;
          }
          var hasWt = (r.weight !== null && r.weight !== '' && !isNaN(wt));
          if (hasWt && wt < 0) {
            $scope.formError = 'Riga ' + (i + 1) + ': il peso, se inserito, deve essere >= 0.';
            valid = false; break;
          }
          if (isNaN(qty) || qty < 1) {
            $scope.formError = 'Riga ' + (i + 1) + ': la quantità deve essere >= 1.';
            valid = false; break;
          }

          var lm = dimToMeters(l, r.dimUom);
          var wm = dimToMeters(w, r.dimUom);
          var hm = dimToMeters(h, r.dimUom);
          var vol = lm * wm * hm;
          var kg  = hasWt ? weightToKg(wt, r.weightUom) : null;

          var item = r.item || ('P-' + String(i + 1).padStart(ITEM_ID_PADDING, '0'));
          var desc = r.description || '—';

          var pallColor = PALLET_COLORS[i % PALLET_COLORS.length];
          for (var q = 0; q < qty; q++) {
            pallets.push({ item: item, description: desc, length_m: lm, width_m: wm, volume_m3: vol, weight_kg: kg, color: pallColor });
          }
        }

        if (!valid) return;

        if (pallets.length === 0) {
          $scope.formError = 'Nessun collo da elaborare. Controlla le righe inserite.';
          return;
        }

        /* Check single-unit feasibility:
           Item (+ trailing gap) must fit in the effective area (bin minus wall clearance).
           Condition: itemDim + gap ≤ effDim  (since insert pads by gap and bin is shrunk by 2×gap) */
        for (var pi = 0; pi < pallets.length; pi++) {
          var p = pallets[pi];
          var fitsFloor = (p.length_m + gapM <= effLen && p.width_m + gapM <= effWid) ||
                          (p.width_m  + gapM <= effLen && p.length_m + gapM <= effWid);
          if (!fitsFloor) {
            $scope.formError = 'Il collo "' + p.item + '" (' +
              p.length_m.toFixed(3) + ' × ' + p.width_m.toFixed(3) +
              ' m) non entra nell\'area utile del container con tolleranza ' + (gapM * 100).toFixed(0) + ' cm (' +
              effLen.toFixed(3) + ' × ' + effWid.toFixed(3) +
              ' m) nemmeno se ruotato di 90°.';
            return;
          }
          if (p.weight_kg !== null && p.weight_kg > ct.max_payload_kg) {
            $scope.formError = 'Il collo "' + p.item + '" ha peso (' +
              p.weight_kg.toFixed(2) + ' kg) superiore al payload del container (' +
              ct.max_payload_kg + ' kg). Riduci il peso o scegli un container diverso.';
            return;
          }
        }

        /* ── MAXRECTS 2-D Floor Packing — Best Fit Decreasing by footprint area ── */
        pallets.sort(function (a, b) { return (b.length_m * b.width_m) - (a.length_m * a.width_m); });

        var bins = [];

        function newBin() {
          return {
            maxrects:   new MaxRects(ct.inner_length_m, ct.inner_width_m, gapM),
            usedVolume: 0,
            usedWeight: 0,
            placements: []
          };
        }

        for (var pi2 = 0; pi2 < pallets.length; pi2++) {
          var pallet = pallets[pi2];
          var placed = false;

          for (var bi = 0; bi < bins.length; bi++) {
            var bin = bins[bi];
            var weightOk = (pallet.weight_kg === null) ||
                           (bin.usedWeight + pallet.weight_kg <= ct.max_payload_kg);
            if (!weightOk) continue;

            var pos = bin.maxrects.insert(pallet.length_m, pallet.width_m, true);
            if (pos) {
              bin.usedVolume += pallet.volume_m3;
              bin.usedWeight += (pallet.weight_kg !== null ? pallet.weight_kg : 0);
              bin.placements.push({
                item: pallet.item, description: pallet.description,
                volume_m3: pallet.volume_m3, weight_kg: pallet.weight_kg,
                x: pos.x, y: pos.y, w: pos.w, h: pos.h,
                rotated: pos.rotated, color: pallet.color
              });
              placed = true;
              break;
            }
          }

          if (!placed) {
            var nb = newBin();
            var pos2 = nb.maxrects.insert(pallet.length_m, pallet.width_m, true);
            nb.usedVolume += pallet.volume_m3;
            nb.usedWeight += (pallet.weight_kg !== null ? pallet.weight_kg : 0);
            nb.placements.push({
              item: pallet.item, description: pallet.description,
              volume_m3: pallet.volume_m3, weight_kg: pallet.weight_kg,
              x: pos2.x, y: pos2.y, w: pos2.w, h: pos2.h,
              rotated: pos2.rotated, color: pallet.color
            });
            bins.push(nb);
          }
        }

        /* Build result containers with percentages and floor plan data */
        var hasWeight = pallets.some(function (p) { return p.weight_kg !== null; });
        var floorArea = ct.inner_length_m * ct.inner_width_m;

        var resultContainers = bins.map(function (bin) {
          var usedFloor = bin.placements.reduce(function (s, p) { return s + p.w * p.h; }, 0);
          return {
            pallets:    bin.placements,   /* backward compat with pallet table */
            placements: bin.placements,
            usedVolume: bin.usedVolume,
            usedWeight: bin.usedWeight,
            volPct:   Math.min((bin.usedVolume / ct.volume_cbm)      * MAX_PERCENT, MAX_PERCENT),
            wgtPct:   hasWeight ? Math.min((bin.usedWeight / ct.max_payload_kg) * MAX_PERCENT, MAX_PERCENT) : 0,
            floorPct: Math.min((usedFloor / floorArea) * MAX_PERCENT, MAX_PERCENT)
          };
        });

        var totalVol = pallets.reduce(function (s, p) { return s + p.volume_m3;  }, 0);
        var totalWgt = pallets.reduce(function (s, p) { return s + (p.weight_kg !== null ? p.weight_kg : 0); }, 0);

        $scope.risultati = {
          numContainers: bins.length,
          totalPallets:  pallets.length,
          totalVolume:   totalVol,
          totalWeight:   totalWgt,
          hasWeight:     hasWeight,
          ctLength:      ct.inner_length_m,
          ctWidth:       ct.inner_width_m,
          containers:    resultContainers
        };
      };

    }]);

}());
