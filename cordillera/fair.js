/* ═══════════════════════════════════════════════════════════════════════════
   Motor FAIR en JavaScript — ISACA LATAM Quito 2026
   Réplica del modelo de caso_banco.py para que la demo corra dentro del deck.

   Mismo árbol, mismas fórmulas:
       TEF  = CF × PoA
       Vuln = P(TC > RS)        con TC y RS normales
       LEF  = TEF × Vuln
       Pérdida = Σ primarias + (SEP ? Σ secundarias : 0)   por evento

   Los valores de la BASE y de los presets vienen precomputados desde Python
   (window.FAIR_DATA) para que coincidan dígito por dígito con las slides.
   La simulación en vivo se usa sólo cuando el orador mueve un control.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  /* ── aleatoriedad reproducible ──────────────────────────────────────── */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seed) {
    const u = mulberry32(seed);
    let spare = null;
    return {
      uniform: u,
      /* Box-Muller con caché del segundo valor */
      normal: function () {
        if (spare !== null) { const s = spare; spare = null; return s; }
        let a = 0, b = 0;
        while (a === 0) a = u();
        b = u();
        const r = Math.sqrt(-2 * Math.log(a)), th = 2 * Math.PI * b;
        spare = r * Math.sin(th);
        return r * Math.cos(th);
      },
      lognormal: function (median, sigma) {
        return median * Math.exp(sigma * this.normal());
      },
      /* Knuth para lambda chico, que es el caso (LEF < 1) */
      poisson: function (lambda) {
        if (lambda > 30) {                       // normal como aproximación
          return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * this.normal()));
        }
        const L = Math.exp(-lambda);
        let k = 0, p = 1;
        do { k++; p *= u(); } while (p > L);
        return k - 1;
      }
    };
  }

  /* ── erf: aproximación de Abramowitz & Stegun 7.1.26 (|e| < 1.5e-7) ── */
  function erf(x) {
    const s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
      - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }

  /* ── el árbol ───────────────────────────────────────────────────────── */
  const PRIMARIAS = ["productividad", "respuesta", "reemplazo"];
  const SECUNDARIAS = ["multas", "reputacion", "respuesta_sec", "ventaja"];

  function vulnerabilidad(p) {
    const mu = p.tc_mu - p.rs_mu;
    const sd = Math.hypot(p.tc_sd, p.rs_sd);
    return 0.5 * (1 - erf(-mu / (sd * Math.SQRT2)));
  }
  function tef(p) { return p.cf * p.poa; }
  function lef(p) { return tef(p) * vulnerabilidad(p); }

  /** Costo esperado de UN evento, analítico. Sin simular. */
  function severidadEsperada(p) {
    let prim = 0, sec = 0;
    const det = {};
    PRIMARIAS.forEach(function (k) {
      det[k] = p[k + "_med"] * Math.exp(Math.pow(p[k + "_sig"], 2) / 2);
      prim += det[k];
    });
    SECUNDARIAS.forEach(function (k) {
      det[k] = p.sep * p[k + "_med"] * Math.exp(Math.pow(p[k + "_sig"], 2) / 2);
      sec += det[k];
    });
    return { total: prim + sec, primaria: prim, secundaria: sec, detalle: det };
  }

  /** Poisson compuesto. Devuelve el vector de pérdidas anuales. */
  function simular(p, n, seed) {
    n = n || 60000;
    const rng = makeRng(seed || 20260917);
    const lambda = lef(p);
    const out = new Float64Array(n);
    const pm = PRIMARIAS.map(function (k) { return [Math.log(p[k + "_med"]), p[k + "_sig"]]; });
    const sm = SECUNDARIAS.map(function (k) { return [Math.log(p[k + "_med"]), p[k + "_sig"]]; });
    for (let i = 0; i < n; i++) {
      const ev = rng.poisson(lambda);
      let tot = 0;
      for (let e = 0; e < ev; e++) {
        for (let j = 0; j < pm.length; j++) {
          tot += Math.exp(pm[j][0] + pm[j][1] * rng.normal());
        }
        if (rng.uniform() < p.sep) {
          for (let j = 0; j < sm.length; j++) {
            tot += Math.exp(sm[j][0] + sm[j][1] * rng.normal());
          }
        }
      }
      out[i] = tot;
    }
    return out;
  }

  function percentil(sorted, q) {
    const idx = (sorted.length - 1) * q;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  function metricas(x) {
    const n = x.length;
    let suma = 0, ceros = 0, g2 = 0, g5 = 0, g10 = 0;
    for (let i = 0; i < n; i++) {
      suma += x[i];
      if (x[i] === 0) ceros++;
      if (x[i] > 2e6) g2++;
      if (x[i] > 5e6) g5++;
      if (x[i] > 10e6) g10++;
    }
    const s = Float64Array.from(x).sort();
    const var95 = percentil(s, 0.95);
    let colaSuma = 0, colaN = 0;
    for (let i = 0; i < n; i++) if (x[i] >= var95) { colaSuma += x[i]; colaN++; }
    const ale = suma / n;
    const tvar95 = colaN ? colaSuma / colaN : var95;
    return {
      ale: ale, var95: var95, tvar95: tvar95, ec: tvar95 - ale,
      p_cero: ceros / n, p_gt_2m: g2 / n, p_gt_5m: g5 / n, p_gt_10m: g10 / n,
      _sorted: s
    };
  }

  /** Curva de excedencia: para cada monto, P(pérdida anual > monto). */
  function curva(x, xmax, pasos) {
    xmax = xmax || 16e6; pasos = pasos || 120;
    const n = x.length, pts = [];
    const s = Float64Array.from(x).sort();
    for (let k = 0; k <= pasos; k++) {
      const t = (xmax * k) / pasos;
      // cuántos superan t, por búsqueda binaria sobre el ordenado
      let lo = 0, hi = n;
      while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] > t) hi = m; else lo = m + 1; }
      pts.push([t, ((n - lo) / n) * 100]);
    }
    return pts;
  }

  /** Compone controles sobre los parámetros base (misma lógica que Python). */
  function aplicar(base, controles, pisos) {
    const q = Object.assign({}, base);
    controles.forEach(function (c) {
      Object.keys(c.efecto || {}).forEach(function (k) {
        if (/_med$|_sig$/.test(k)) q[k] = q[k] * (1 + c.efecto[k]);
        else q[k] = q[k] + c.efecto[k];
      });
    });
    Object.keys(pisos || {}).forEach(function (k) {
      q[k] = (k === "rs_mu") ? Math.min(q[k], pisos[k]) : Math.max(q[k], pisos[k]);
    });
    return q;
  }

  /* ── formato ────────────────────────────────────────────────────────── */
  function money(v) {
    const a = Math.abs(v);
    if (a >= 1e9) return "USD " + (v / 1e9).toFixed(2).replace(".", ",") + "B";
    if (a >= 100e6) return "USD " + Math.round(v / 1e6).toLocaleString("de-DE") + "M";
    if (a >= 1e6) return "USD " + (v / 1e6).toFixed(2).replace(".", ",") + "M";
    return "USD " + Math.round(v / 1e3) + "K";
  }
  function pct(v, dec) {
    return (v * 100).toFixed(dec === undefined ? 0 : dec).replace(".", ",") + "%";
  }
  function num(v, dec) {
    return v.toFixed(dec === undefined ? 2 : dec).replace(".", ",");
  }

  global.FAIR = {
    makeRng: makeRng, erf: erf,
    PRIMARIAS: PRIMARIAS, SECUNDARIAS: SECUNDARIAS,
    vulnerabilidad: vulnerabilidad, tef: tef, lef: lef,
    severidadEsperada: severidadEsperada,
    simular: simular, metricas: metricas, curva: curva, aplicar: aplicar,
    money: money, pct: pct, num: num
  };
})(window);
