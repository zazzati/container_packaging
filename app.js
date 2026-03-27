(function () {
  'use strict';

  /* ── Constants ── */
  var ITEM_ID_PADDING    = 3;
  var MAX_PERCENT        = 100;
  var SUPPORT_THRESHOLD  = 0.70; /* 70 % of base area must be supported for stacking */
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

  /* ── 3D Bin Packing — Extreme Points + Bottom-Left-Back ───────────────────
     Places items in 3D with stacking support using extreme-point insertion.
     Items may be rotated 90° on the floor plane (L↔W); height stays vertical.
     Scoring: bottom first (z), back first (x), left first (y).
     Reference: Crainic, Perboli & Tadei (2008) "Extreme Point-Based Heuristics
     for Three-Dimensional Bin Packing".
  ─────────────────────────────────────────────────────────────────────────── */
  function BinPacker3D(binL, binW, binH) {
    this.binL = binL; /* x-axis: length (depth) */
    this.binW = binW; /* y-axis: width          */
    this.binH = binH; /* z-axis: height         */
    this.placed = [];
    this.eps = [{ x: 0, y: 0, z: 0 }];
  }

  BinPacker3D.prototype.insert = function (itemL, itemW, itemH, allowRotation) {
    var EPS = 1e-9;
    var oris = allowRotation
      ? [{ l: itemL, w: itemW, h: itemH, rot: false },
         { l: itemW, w: itemL, h: itemH, rot: true }]
      : [{ l: itemL, w: itemW, h: itemH, rot: false }];

    var bestEP = null, bestOri = null, bestScore = Infinity;

    for (var oi = 0; oi < oris.length; oi++) {
      var o = oris[oi];
      for (var ei = 0; ei < this.eps.length; ei++) {
        var ep = this.eps[ei];
        if (ep.x + o.l > this.binL + EPS) continue;
        if (ep.y + o.w > this.binW + EPS) continue;
        if (ep.z + o.h > this.binH + EPS) continue;

        var box = { x: ep.x, y: ep.y, z: ep.z, l: o.l, w: o.w, h: o.h };
        if (this._overlapsAny(box)) continue;
        if (ep.z > EPS && !this._isSupported(box)) continue;

        /* Score: bottom → back → left  (lower is better) */
        var score = ep.z * 1e8 + ep.x * 1e4 + ep.y;
        if (score < bestScore - EPS) {
          bestScore = score;
          bestEP    = ep;
          bestOri   = o;
        }
      }
    }

    if (!bestEP) return null;

    var result = {
      x: bestEP.x, y: bestEP.y, z: bestEP.z,
      l: bestOri.l, w: bestOri.w, h: bestOri.h,
      rotated: bestOri.rot
    };

    this.placed.push(result);
    this._generateEPs(result);
    this._pruneEPs();
    return result;
  };

  BinPacker3D.prototype._overlapsAny = function (box) {
    for (var i = 0; i < this.placed.length; i++) {
      if (this._overlaps3D(box, this.placed[i])) return true;
    }
    return false;
  };

  BinPacker3D.prototype._overlaps3D = function (a, b) {
    var E = 1e-9;
    return !(a.x + a.l <= b.x + E || b.x + b.l <= a.x + E ||
             a.y + a.w <= b.y + E || b.y + b.w <= a.y + E ||
             a.z + a.h <= b.z + E || b.z + b.h <= a.z + E);
  };

  BinPacker3D.prototype._isSupported = function (box) {
    var EPS = 1e-9;
    var baseArea  = box.l * box.w;
    var supported = 0;
    for (var i = 0; i < this.placed.length; i++) {
      var p = this.placed[i];
      /* top of placed box must touch bottom of candidate */
      if (Math.abs((p.z + p.h) - box.z) > EPS) continue;
      var dx = Math.max(0, Math.min(box.x + box.l, p.x + p.l) - Math.max(box.x, p.x));
      var dy = Math.max(0, Math.min(box.y + box.w, p.y + p.w) - Math.max(box.y, p.y));
      supported += dx * dy;
    }
    return supported >= baseArea * SUPPORT_THRESHOLD - EPS;
  };

  BinPacker3D.prototype._generateEPs = function (box) {
    var EPS = 1e-9;
    var cands = [
      { x: box.x + box.l, y: box.y,         z: box.z },         /* right  */
      { x: box.x,         y: box.y + box.w, z: box.z },         /* front  */
      { x: box.x,         y: box.y,         z: box.z + box.h }  /* top    */
    ];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (c.x < this.binL - EPS && c.y < this.binW - EPS && c.z < this.binH - EPS) {
        this.eps.push(c);
      }
    }
  };

  BinPacker3D.prototype._pruneEPs = function () {
    var EPS = 1e-9;
    /* Remove points that fall strictly inside any placed box */
    var valid = [];
    for (var i = 0; i < this.eps.length; i++) {
      var ep = this.eps[i], inside = false;
      for (var j = 0; j < this.placed.length; j++) {
        var p = this.placed[j];
        if (ep.x > p.x - EPS && ep.x < p.x + p.l - EPS &&
            ep.y > p.y - EPS && ep.y < p.y + p.w - EPS &&
            ep.z > p.z - EPS && ep.z < p.z + p.h - EPS) {
          inside = true; break;
        }
      }
      if (!inside) valid.push(ep);
    }
    /* Deduplicate */
    var unique = [];
    for (var i = 0; i < valid.length; i++) {
      var dup = false;
      for (var j = 0; j < unique.length; j++) {
        if (Math.abs(valid[i].x - unique[j].x) < EPS &&
            Math.abs(valid[i].y - unique[j].y) < EPS &&
            Math.abs(valid[i].z - unique[j].z) < EPS) {
          dup = true; break;
        }
      }
      if (!dup) unique.push(valid[i]);
    }
    this.eps = unique;
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

    /* ── 3D container visualization directive (Three.js) ────────────────────── */
    .directive('container3dView', ['$window', function ($window) {

      function makeTextSprite(text) {
        var canvas = document.createElement('canvas');
        canvas.width  = 256;
        canvas.height = 128;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(15,23,42,0.75)';
        ctx.fillRect(4, 4, 248, 120);
        ctx.font      = 'bold 36px Segoe UI,Tahoma,sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 128, 64);
        var texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        var mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
        return new THREE.Sprite(mat);
      }

      return {
        restrict: 'E',
        scope: { placements: '=', ctLen: '=', ctWid: '=', ctHei: '=' },
        template: '<div style="width:100%;height:500px;position:relative;"></div>',
        link: function (scope, element) {
          var container = element[0].firstChild;
          if (!container) return;

          /* ── Three.js bootstrap ── */
          var scene = new THREE.Scene();
          scene.background = new THREE.Color(0xf1f5f9);

          var w = container.clientWidth  || 680;
          var h = container.clientHeight || 500;
          var camera   = new THREE.PerspectiveCamera(45, w / h, 0.01, 500);
          var renderer = new THREE.WebGLRenderer({ antialias: true });
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
          renderer.setSize(w, h);
          container.appendChild(renderer.domElement);

          var controls = new THREE.OrbitControls(camera, renderer.domElement);
          controls.enableDamping  = true;
          controls.dampingFactor  = 0.08;

          scene.add(new THREE.AmbientLight(0xffffff, 0.6));
          var dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
          dirLight.position.set(10, 15, 12);
          scene.add(dirLight);

          var boxGroup = new THREE.Group();
          scene.add(boxGroup);

          /* ── Helpers ── */
          function clearGroup() {
            while (boxGroup.children.length > 0) {
              var child = boxGroup.children[0];
              boxGroup.remove(child);
              if (child.geometry) child.geometry.dispose();
              if (child.material) {
                if (child.material.map) child.material.map.dispose();
                child.material.dispose();
              }
            }
          }

          /* ── Build 3D scene ── */
          function buildScene() {
            clearGroup();
            var L = scope.ctLen, W = scope.ctWid, H = scope.ctHei;
            if (!L || !W || !H) return;

            /* Container wireframe */
            var ctGeo = new THREE.BoxGeometry(L, H, W);
            var edges = new THREE.EdgesGeometry(ctGeo);
            var line  = new THREE.LineSegments(edges,
              new THREE.LineBasicMaterial({ color: 0x1e3a5f }));
            line.position.set(L / 2, H / 2, W / 2);
            boxGroup.add(line);
            ctGeo.dispose();

            /* Semi-transparent walls */
            var wallGeo = new THREE.BoxGeometry(L, H, W);
            var wallMat = new THREE.MeshBasicMaterial({
              color: 0x94a3b8, transparent: true, opacity: 0.06, side: THREE.BackSide
            });
            var walls = new THREE.Mesh(wallGeo, wallMat);
            walls.position.set(L / 2, H / 2, W / 2);
            boxGroup.add(walls);

            /* Floor plane */
            var floorGeo = new THREE.PlaneGeometry(L, W);
            var floorMat = new THREE.MeshBasicMaterial({ color: 0xdce8f5, side: THREE.DoubleSide });
            var floor = new THREE.Mesh(floorGeo, floorMat);
            floor.rotation.x = -Math.PI / 2;
            floor.position.set(L / 2, 0.001, W / 2);
            boxGroup.add(floor);

            /* Floor grid (1 m spacing) */
            var gridPts = [], gx, gz;
            for (gx = 0; gx <= L + 1e-9; gx += 1) {
              gridPts.push(new THREE.Vector3(gx, 0.002, 0));
              gridPts.push(new THREE.Vector3(gx, 0.002, W));
            }
            for (gz = 0; gz <= W + 1e-9; gz += 1) {
              gridPts.push(new THREE.Vector3(0, 0.002, gz));
              gridPts.push(new THREE.Vector3(L, 0.002, gz));
            }
            if (gridPts.length > 0) {
              var gridGeo = new THREE.BufferGeometry().setFromPoints(gridPts);
              boxGroup.add(new THREE.LineSegments(gridGeo,
                new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.25 })));
            }

            /* Placed items */
            var placements = scope.placements || [];
            for (var i = 0; i < placements.length; i++) {
              var p     = placements[i];
              var color = new THREE.Color(p.color);

              /* Solid box */
              var bGeo = new THREE.BoxGeometry(p.l, p.h, p.w);
              var bMat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: 0.82 });
              var mesh = new THREE.Mesh(bGeo, bMat);
              /* Mapping: packer x→three x, packer y→three z, packer z→three y */
              mesh.position.set(p.x + p.l / 2, p.z + p.h / 2, p.y + p.w / 2);
              boxGroup.add(mesh);

              /* Edge outline */
              var eGeo  = new THREE.EdgesGeometry(bGeo);
              var eLine = new THREE.LineSegments(eGeo,
                new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(0.55) }));
              eLine.position.copy(mesh.position);
              boxGroup.add(eLine);

              /* Label sprite */
              var sprite   = makeTextSprite(p.item);
              var sprScale = Math.min(p.l, p.w) * 0.7;
              sprite.scale.set(sprScale, sprScale * 0.5, 1);
              sprite.position.set(
                p.x + p.l / 2,
                p.z + p.h + sprScale * 0.15,
                p.y + p.w / 2
              );
              boxGroup.add(sprite);
            }

            /* Position camera */
            var maxDim = Math.max(L, W, H);
            camera.position.set(L * 1.2, maxDim * 1.1, W * 2.0);
            controls.target.set(L / 2, H / 3, W / 2);
            controls.update();
          }

          /* ── Animation loop ── */
          var animId;
          function animate() {
            animId = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
          }
          animate();

          /* ── Watchers ── */
          scope.$watch('[placements, ctLen, ctWid, ctHei]', function () {
            if (scope.ctLen && scope.ctWid && scope.ctHei) buildScene();
          }, true);

          function onResize() {
            var nw = container.clientWidth, nh = container.clientHeight;
            if (!nw || !nh) return;
            camera.aspect = nw / nh;
            camera.updateProjectionMatrix();
            renderer.setSize(nw, nh);
          }
          angular.element($window).on('resize', onResize);

          scope.$on('$destroy', function () {
            cancelAnimationFrame(animId);
            angular.element($window).off('resize', onResize);
            clearGroup();
            renderer.dispose();
            controls.dispose();
            if (renderer.domElement && renderer.domElement.parentNode) {
              renderer.domElement.parentNode.removeChild(renderer.domElement);
            }
          });
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
          rows: _rowsSnapshot($scope.rows)
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
      }

      $scope.fmtWeight = function (kg) {
        return kg !== null ? kg.toFixed(2) : '—';
      };

      /* ── Main calculation (3D bin packing with stacking) ── */
      $scope.calcola = function () {
        $scope.formError = '';
        $scope.risultati = null;

        if (!$scope.selectedContainer) {
          $scope.formError = 'Seleziona un tipo di container.';
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
            pallets.push({
              item: item, description: desc,
              length_m: lm, width_m: wm, height_m: hm,
              volume_m3: vol, weight_kg: kg, color: pallColor
            });
          }
        }

        if (!valid) return;

        if (pallets.length === 0) {
          $scope.formError = 'Nessun collo da elaborare. Controlla le righe inserite.';
          return;
        }

        var ct = $scope.selectedContainer;

        /* Check single-unit feasibility (floor footprint + height + weight) */
        for (var pi = 0; pi < pallets.length; pi++) {
          var p = pallets[pi];
          var fitsFloor = (p.length_m <= ct.inner_length_m && p.width_m <= ct.inner_width_m) ||
                          (p.width_m  <= ct.inner_length_m && p.length_m <= ct.inner_width_m);
          if (!fitsFloor) {
            $scope.formError = 'Il collo "' + p.item + '" (' +
              p.length_m.toFixed(3) + ' × ' + p.width_m.toFixed(3) +
              ' m) non entra nella pianta del container (' +
              ct.inner_length_m.toFixed(3) + ' × ' + ct.inner_width_m.toFixed(3) +
              ' m) nemmeno se ruotato di 90°.';
            return;
          }
          if (p.height_m > ct.inner_height_m) {
            $scope.formError = 'Il collo "' + p.item + '" (altezza ' +
              p.height_m.toFixed(3) + ' m) supera l\'altezza interna del container (' +
              ct.inner_height_m.toFixed(3) + ' m).';
            return;
          }
          if (p.weight_kg !== null && p.weight_kg > ct.max_payload_kg) {
            $scope.formError = 'Il collo "' + p.item + '" ha peso (' +
              p.weight_kg.toFixed(2) + ' kg) superiore al payload del container (' +
              ct.max_payload_kg + ' kg). Riduci il peso o scegli un container diverso.';
            return;
          }
        }

        /* ── 3D Packing — First Fit Decreasing by volume ── */
        pallets.sort(function (a, b) { return b.volume_m3 - a.volume_m3; });

        var bins = [];

        function newBin() {
          return {
            packer:     new BinPacker3D(ct.inner_length_m, ct.inner_width_m, ct.inner_height_m),
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

            var pos = bin.packer.insert(pallet.length_m, pallet.width_m, pallet.height_m, true);
            if (pos) {
              bin.usedVolume += pallet.volume_m3;
              bin.usedWeight += (pallet.weight_kg !== null ? pallet.weight_kg : 0);
              bin.placements.push({
                item: pallet.item, description: pallet.description,
                volume_m3: pallet.volume_m3, weight_kg: pallet.weight_kg,
                x: pos.x, y: pos.y, z: pos.z,
                l: pos.l, w: pos.w, h: pos.h,
                rotated: pos.rotated, color: pallet.color
              });
              placed = true;
              break;
            }
          }

          if (!placed) {
            var nb   = newBin();
            var pos2 = nb.packer.insert(pallet.length_m, pallet.width_m, pallet.height_m, true);
            nb.usedVolume += pallet.volume_m3;
            nb.usedWeight += (pallet.weight_kg !== null ? pallet.weight_kg : 0);
            nb.placements.push({
              item: pallet.item, description: pallet.description,
              volume_m3: pallet.volume_m3, weight_kg: pallet.weight_kg,
              x: pos2.x, y: pos2.y, z: pos2.z,
              l: pos2.l, w: pos2.w, h: pos2.h,
              rotated: pos2.rotated, color: pallet.color
            });
            bins.push(nb);
          }
        }

        /* Build result containers with percentages */
        var hasWeight = pallets.some(function (p) { return p.weight_kg !== null; });
        var floorArea = ct.inner_length_m * ct.inner_width_m;

        var resultContainers = bins.map(function (bin) {
          /* Floor utilization: footprint of ground-level items only */
          var usedFloor = bin.placements.reduce(function (s, p) {
            return s + (p.z < 0.01 ? p.l * p.w : 0);
          }, 0);
          /* Height utilization: highest point reached */
          var maxZ = bin.placements.reduce(function (m, p) {
            return Math.max(m, p.z + p.h);
          }, 0);

          return {
            pallets:    bin.placements,
            placements: bin.placements,
            usedVolume: bin.usedVolume,
            usedWeight: bin.usedWeight,
            maxHeight:  maxZ,
            volPct:     Math.min((bin.usedVolume / ct.volume_cbm) * MAX_PERCENT, MAX_PERCENT),
            wgtPct:     hasWeight ? Math.min((bin.usedWeight / ct.max_payload_kg) * MAX_PERCENT, MAX_PERCENT) : 0,
            floorPct:   Math.min((usedFloor / floorArea) * MAX_PERCENT, MAX_PERCENT),
            heightPct:  Math.min((maxZ / ct.inner_height_m) * MAX_PERCENT, MAX_PERCENT)
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
          ctHeight:      ct.inner_height_m,
          containers:    resultContainers
        };
      };

    }]);

}());
