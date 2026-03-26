(function () {
  'use strict';

  /* ── Constants ── */
  var ITEM_ID_PADDING    = 3;
  var MAX_PERCENT        = 100;
  var FALLBACK_CONTAINERS = [
    { id: '20ST', name: "20' Standard",  volume_cbm: 33.2, max_payload_kg: 21770, description: 'Container standard da 20 piedi.' },
    { id: '40ST', name: "40' Standard",  volume_cbm: 67.0, max_payload_kg: 26500, description: 'Container standard da 40 piedi.' },
    { id: '40HC', name: "40' High Cube", volume_cbm: 76.0, max_payload_kg: 28500, description: 'Container da 40 piedi High Cube.' }
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

  /* ── Angular module ── */
  angular.module('containerApp', [])
    .controller('ContainerController', ['$scope', '$http', function ($scope, $http) {

      var _uid = 0;
      function uid() { return ++_uid; }

      /* State */
      $scope.loading        = true;
      $scope.loadError      = false;
      $scope.containerTypes = [];
      $scope.selectedContainer = null;
      $scope.rows           = [];
      $scope.risultati      = null;
      $scope.formError      = '';

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
          $scope.loading           = false;
          $scope.selectedContainer = $scope.containerTypes[0] || null;
          $scope.rows              = [createRow()];
        });

      /* Container selection */
      $scope.selectContainer = function (ct) {
        $scope.selectedContainer = ct;
        $scope.risultati         = null;
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

          for (var q = 0; q < qty; q++) {
            pallets.push({ item: item, description: desc, volume_m3: vol, weight_kg: kg });
          }
        }

        if (!valid) return;

        if (pallets.length === 0) {
          $scope.formError = 'Nessun collo da elaborare. Controlla le righe inserite.';
          return;
        }

        var ct = $scope.selectedContainer;

        /* Check single-unit feasibility */
        for (var pi = 0; pi < pallets.length; pi++) {
          var p = pallets[pi];
          if (p.volume_m3 > ct.volume_cbm) {
            $scope.formError = 'Il collo "' + p.item + '" ha volume (' +
              p.volume_m3.toFixed(4) + ' m³) superiore alla capacità del container (' +
              ct.volume_cbm + ' m³). Riduci le dimensioni o scegli un container diverso.';
            return;
          }
          if (p.weight_kg !== null && p.weight_kg > ct.max_payload_kg) {
            $scope.formError = 'Il collo "' + p.item + '" ha peso (' +
              p.weight_kg.toFixed(2) + ' kg) superiore al payload del container (' +
              ct.max_payload_kg + ' kg). Riduci il peso o scegli un container diverso.';
            return;
          }
        }

        /* First-Fit Decreasing by volume */
        pallets.sort(function (a, b) { return b.volume_m3 - a.volume_m3; });

        var bins = []; // each bin: { usedVolume, usedWeight, pallets[] }

        function newBin() {
          return { usedVolume: 0, usedWeight: 0, pallets: [] };
        }

        for (var pi2 = 0; pi2 < pallets.length; pi2++) {
          var pallet = pallets[pi2];
          var placed = false;

          for (var bi = 0; bi < bins.length; bi++) {
            var bin = bins[bi];
            var weightOk = (pallet.weight_kg === null) ||
                           (bin.usedWeight + pallet.weight_kg <= ct.max_payload_kg);
            if (bin.usedVolume + pallet.volume_m3 <= ct.volume_cbm && weightOk) {
              bin.usedVolume += pallet.volume_m3;
              bin.usedWeight += (pallet.weight_kg !== null ? pallet.weight_kg : 0);
              bin.pallets.push(pallet);
              placed = true;
              break;
            }
          }

          if (!placed) {
            var nb = newBin();
            nb.usedVolume += pallet.volume_m3;
            nb.usedWeight += (pallet.weight_kg !== null ? pallet.weight_kg : 0);
            nb.pallets.push(pallet);
            bins.push(nb);
          }
        }

        /* Build result containers with percentages */
        var hasWeight = pallets.some(function (p) { return p.weight_kg !== null; });

        var resultContainers = bins.map(function (bin) {
          return {
            pallets:    bin.pallets,
            usedVolume: bin.usedVolume,
            usedWeight: bin.usedWeight,
            volPct: Math.min((bin.usedVolume / ct.volume_cbm)     * MAX_PERCENT, MAX_PERCENT),
            wgtPct: hasWeight ? Math.min((bin.usedWeight / ct.max_payload_kg) * MAX_PERCENT, MAX_PERCENT) : 0
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
          containers:    resultContainers
        };
      };

    }]);

}());
