/* ═══════════════════════════════════════════════════════════════════════════
   DEMO INTERACTIVA — el modelo de Banco Cordillera, vivo.

   Tres cosas que la hacen un instrumento y no una ilustración:
     · el árbol es clicable y cada nodo abre su composición
     · los cinco controles se encienden y apagan por separado, no en cascada
     · cuatro vistas del resultado: curva, distribución, componentes y qué mueve

   Los valores de cada combinación de controles vienen precomputados desde Python
   (32 combinaciones), así que cualquier cosa que pida la sala responde con el
   número exacto de las slides. Sólo se simula en vivo al mover un slider.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const F = window.FAIR, D = window.FAIR_DATA;
  if (!F || !D) return;

  const N_LIVE = 45000, $ = (s, r) => (r || document).querySelector(s);
  // paleta del deck de la Eko (fondo navy): azul = frecuencia/primaria, coral = secundaria,
  // verde = la curva y el ALE, ámbar = TVaR (igual que en las slides 33 y 34)
  const BLUE = "#4C86FF", MAG = "#FF5A36", INK = "#EEF1FF", GREEN = "#03FF9E", AMBER = "#FFC53D",
        N500 = "#8A92C4", N300 = "rgba(200,205,245,.45)", N100 = "rgba(255,255,255,.08)", NAVY = "#FFC53D", BG = "#070820";

  let activos = new Set();      // ids de controles encendidos
  let nodoSel = "risk";
  let vista = "curva";
  let modo = "arbol";        // arbol | resultado
  let libre = false;            // true = se movió un slider; ya no hay valor exacto
  let magPct = 100;
  let hover = null;             // monto bajo el mouse en la curva

  /* ── el árbol ─────────────────────────────────────────────────────────── */
  const NODOS = {
    risk: { x: 50, y: 1, w: 200, lv: 0, sg: "RIESGO", nm: "Pérdida anual", sub: "ALE" },
    lef: { x: 25, y: 36.5, w: 178, lv: 1, sg: "LEF", nm: "Frecuencia", sub: "golpes / año" },
    lm: { x: 75, y: 36.5, w: 178, lv: 1, sg: "LM", nm: "Magnitud", sub: "$ por golpe" },
    tef: { x: 12, y: 72, w: 148, lv: 2, sg: "TEF", nm: "Frec. amenaza", sub: "intentos / año" },
    vuln: { x: 38, y: 72, w: 148, lv: 2, sg: "VULN", nm: "Vulnerabilidad", sub: "P(TC > RS)" },
    pl: { x: 62, y: 72, w: 148, lv: 2, sg: "PL", nm: "Primaria", sub: "siempre" },
    sl: { x: 88, y: 72, w: 148, lv: 2, sg: "SL", nm: "Secundaria", sub: "si hay terceros" }
  };
  const ARISTAS = [["risk", "lef"], ["risk", "lm"], ["lef", "tef"], ["lef", "vuln"],
                   ["lm", "pl"], ["lm", "sl"]];
  const OPS = [{ x: 50, y: 32.5, t: "×" }, { x: 25, y: 68, t: "×" }, { x: 75, y: 68, t: "+" }];

  const DET = {
    risk: p => ({ t: "RIESGO · la pérdida anual esperada",
      d: "El producto de las dos ramas. Nadie lo estima: se deduce.",
      f: [["Frecuencia de pérdida (LEF)", F.num(F.lef(p), 3) + " / año"],
          ["× Magnitud por evento (LM)", F.money(F.severidadEsperada(p).total)],
          ["= Pérdida anual esperada", F.money(F.lef(p) * F.severidadEsperada(p).total)]],
      n: "Un evento cada " + F.num(1 / F.lef(p), 1) + " años." }),
    lef: p => ({ t: "LEF · cuántos golpes reales por año",
      d: "Para perder plata tienen que pasar dos cosas: que te intenten, y que el intento prospere.",
      f: [["Frecuencia de amenaza (TEF)", F.num(F.tef(p), 2) + " / año"],
          ["× Vulnerabilidad", F.pct(F.vulnerabilidad(p), 2)],
          ["= Golpes efectivos (LEF)", F.num(F.lef(p), 3) + " / año"]],
      n: "Cuatro hojas estimadas, un resultado que nadie estimó." }),
    tef: p => ({ t: "TEF · los intentos serios",
      d: "Cuántas veces te tocan, y en qué fracción de esas el actor decide actuar contra vos.",
      f: [["CF · Contact Frequency", F.num(p.cf, 0) + " / año"],
          ["× PoA · Probability of Action", F.pct(p.poa)],
          ["= Frecuencia de amenaza (TEF)", F.num(F.tef(p), 2) + " / año"]],
      n: "CF lo estima el SOC con telemetría; PoA sale de taller con fraude y riesgo operacional." }),
    vuln: p => ({ t: "VULN · no es un número tuyo",
      d: "Es la probabilidad de que la capacidad del atacante supere tu resistencia: dos distribuciones enfrentadas.",
      f: [["TC · capacidad del atacante", "p" + F.num(p.tc_mu, 0) + " ± " + F.num(p.tc_sd, 0)],
          ["RS · tu resistencia", "p" + F.num(p.rs_mu, 0) + " ± " + F.num(p.rs_sd, 0)],
          ["= P(TC > RS)", F.pct(F.vulnerabilidad(p), 2)]],
      n: "Si el atacante mejora y vos no te movés, tu vulnerabilidad sube sola." }),
    pl: p => { const s = F.severidadEsperada(p);
      return { t: "PL · pérdida primaria — en TODO evento",
        d: "Las tres formas que se sienten desde el primer día.",
        f: F.PRIMARIAS.map(k => [D.hojas[k], F.money(s.detalle[k])])
            .concat([["= Subtotal primaria", F.money(s.primaria)]]),
        n: "No dependen de que reaccione nadie: pasan siempre." }; },
    sl: p => { const s = F.severidadEsperada(p);
      return { t: "SL · secundaria — sólo si reaccionan terceros",
        d: "Gateada por SEP. Sin exfiltración confirmada puede no haber obligación de notificar; y sin notificación, no hay multa ni fuga.",
        f: [["Probabilidad de reacción (SEP)", F.pct(p.sep)]]
            .concat(F.SECUNDARIAS.map(k => [D.hojas[k], F.money(s.detalle[k])]))
            .concat([["= Subtotal secundaria", F.money(s.secundaria)]]),
        n: "Ya viene multiplicado por SEP: es el aporte esperado, no el condicional." }; },
    lm: p => { const s = F.severidadEsperada(p);
      return { t: "LM · cuánto cuesta un golpe",
        d: "Las seis formas de pérdida de la taxonomía, sumadas.",
        f: [["Pérdida primaria", F.money(s.primaria)],
            ["+ Riesgo secundario", F.money(s.secundaria)],
            ["= Magnitud por evento", F.money(s.total)]],
        n: "Contrastada contra el benchmark del sector escalado al tamaño: " +
           F.money(D.ancla) + "." }; }
  };

  const CTRL = [
    { id: "cf", lab: "CF · contactos / año", min: 6, max: 48, st: 1, v: () => D.base.cf,
      set: (p, v) => p.cf = v, fmt: v => F.num(v, 0), mag: false },
    { id: "poa", lab: "PoA · prob. de acción", min: 2, max: 60, st: 1, v: () => D.base.poa * 100,
      set: (p, v) => p.poa = v / 100, fmt: v => F.num(v, 0) + "%", mag: false },
    { id: "tc", lab: "TC · capacidad atacante", min: 30, max: 90, st: 1, v: () => D.base.tc_mu,
      set: (p, v) => p.tc_mu = v, fmt: v => "p" + F.num(v, 0), mag: false },
    { id: "rs", lab: "RS · tu resistencia", min: 50, max: 98, st: 1, v: () => D.base.rs_mu,
      set: (p, v) => p.rs_mu = v, fmt: v => "p" + F.num(v, 0), mag: false },
    { id: "sep", lab: "SEP · reacción de terceros", min: 5, max: 95, st: 1,
      v: () => D.base.sep * 100, set: (p, v) => p.sep = v / 100,
      fmt: v => F.num(v, 0) + "%", mag: true },
    { id: "mag", lab: "Magnitud · las seis formas", min: 30, max: 200, st: 5, v: () => 100,
      set: () => {}, fmt: v => F.num(v, 0) + "%", mag: true }
  ];

  // Cada palanca es una HOJA del árbol: alimenta un nodo concreto. Se declara acá
  // para poder iluminar la cadena cuando el orador pasa el mouse por encima —
  // es la propagación que se explica hablando, mostrada.
  const PADRE = { cf: "tef", poa: "tef", tc: "vuln", rs: "vuln", sep: "sl", mag: "lm" };
  const SUBE = { tef: "lef", vuln: "lef", pl: "lm", sl: "lm", lef: "risk", lm: "risk" };

  function cadena(k) {
    const out = [];
    while (k) { out.push(k); k = SUBE[k]; }
    return out;
  }

  function iluminar(id) {
    const ks = id ? cadena(PADRE[id]) : [];
    document.querySelectorAll(".dm-n").forEach(n =>
      n.classList.toggle("dhl", ks.indexOf(n.dataset.k) >= 0));
    document.querySelectorAll("#dm-svg path").forEach(pa =>
      pa.classList.toggle("dhl", ks.indexOf(pa.dataset.a) >= 0 &&
                                ks.indexOf(pa.dataset.b) >= 0));
  }

  // Valores del árbol en el estado declarado: la referencia contra la que se
  // muestra "antes X". Se compara contra la BASE y no contra el frame anterior:
  // en escena importa cuánto te moviste del punto de partida, no del último paso.
  let BASE_VALS = null;
  function valoresDe(p) {
    const sev = F.severidadEsperada(p);
    return { risk: F.money(F.lef(p) * sev.total), lef: F.num(F.lef(p), 3),
             lm: F.money(sev.total), tef: F.num(F.tef(p), 2),
             vuln: F.pct(F.vulnerabilidad(p), 1), pl: F.money(sev.primaria),
             sl: F.money(sev.secundaria) };
  }

  const ctrlActivos = () => D.controles.filter(c => activos.has(c.id));
  const clave = () => [...activos].sort().join("|");

  function params() {
    const p = F.aplicar(D.base, ctrlActivos(), D.pisos);
    if (libre) {
      CTRL.forEach(c => {
        if (c.id === "mag") return;
        const el = $("#dm-" + c.id);
        if (el) c.set(p, +el.value);
      });
      const k = magPct / 100;
      F.PRIMARIAS.concat(F.SECUNDARIAS).forEach(n => p[n + "_med"] *= k);
    }
    return p;
  }

  /* ── construcción ─────────────────────────────────────────────────────── */
  function build(host) {
    const emp = D.empresa;
    host.innerHTML =
      '<div class="dm-head">' +
        '<div><span class="dm-t">' + emp.nombre + '</span>' +
        '</div>' +
        '<div class="dm-hd-r">' +
          '<div class="dm-modos" id="dm-modos">' +
            '<button data-m="arbol">a · el árbol</button>' +
            '<button data-m="resultado">s · el resultado</button>' +
          '</div>' +
          '<div class="dm-act" id="dm-act">sin controles</div>' +
        '</div>' +
      '</div>' +
      '<div class="dm-main">' +
        '<div class="dm-left">' +
          '<div class="dm-tree" id="dm-tree"><svg id="dm-svg"></svg></div>' +
          '<div class="dm-det" id="dm-det"></div>' +
        '</div>' +
        '<div class="dm-right">' +
          '<div class="dm-tabs" id="dm-tabs"></div>' +
          '<div class="dm-cvwrap"><canvas class="dm-cv" id="dm-cv" width="1120" height="600">' +
          '</canvas><div class="dm-tip" id="dm-tip"></div></div>' +
          '<div class="dm-mets" id="dm-mets"></div>' +
        '</div>' +
      '</div>' +
      '<div class="dm-deal" id="dm-deal"></div>' +
      '<div class="dm-bot">' +
        '<div class="dm-chips" id="dm-chips"></div>' +
        '<div class="dm-pista" id="dm-pista"></div>' +
        '<div class="dm-info" id="dm-info"></div>' +
        '<div class="dm-sliders" id="dm-sliders"></div>' +
      '</div>';

    const tree = $("#dm-tree", host);
    Object.keys(NODOS).forEach(k => {
      const n = NODOS[k], d = document.createElement("div");
      d.className = "dtn lv" + n.lv + " dm-n"; d.dataset.k = k;
      d.style.cssText = "left:" + n.x + "%;top:" + n.y + "%;width:" + n.w + "px";
      d.innerHTML = '<span class="sg">' + n.sg + '</span>' +
        '<span class="nm" data-v="' + k + '">—</span><small>' + n.sub + "</small>" +
        '<span class="was" data-w="' + k + '"></span>';
      d.onclick = () => { nodoSel = k; render(false); };
      tree.appendChild(d);
    });
    OPS.forEach(o => {
      const d = document.createElement("div");
      d.className = "dop"; d.style.cssText = "left:" + o.x + "%;top:" + o.y + "%";
      d.textContent = o.t; tree.appendChild(d);
    });

    const VISTAS = [["curva", "Curva de pérdida"], ["dist", "Distribución"],
                    ["comp", "Componentes"], ["tor", "Qué mueve el número"]];
    $("#dm-tabs").innerHTML = VISTAS.map(([k, l]) =>
      '<button data-v="' + k + '">' + l + "</button>").join("");
    $("#dm-tabs").querySelectorAll("button").forEach(b => b.onclick = () => {
      vista = b.dataset.v; render(false);
    });

    $("#dm-modos").querySelectorAll("button").forEach(b => b.onclick = () => setModo(b.dataset.m));

    // el color dice qué rama toca: es lo que se pregunta en voz alta al prenderlo
    $("#dm-chips").innerHTML = '<span class="dlbl">Controles</span>' +
      D.controles.map(c => {
        const rama = /SEP|Multas|Reputaci|secundaria/i.test(c.nodo) ? "dmag" : "frec";
        return '<button class="' + rama + '" data-c="' + c.id + '">' + c.corto +
               '<i>' + F.money(c.costo) + "</i></button>";
      }).join("") +
      '<button class="clr" data-c="__none">ninguno</button>';
    $("#dm-chips").querySelectorAll("button").forEach(b => {
      b.onclick = () => {
        if (b.dataset.c === "__none") activos.clear();
        else activos.has(b.dataset.c) ? activos.delete(b.dataset.c) : activos.add(b.dataset.c);
        libre = false; resetSliders(); render(false);
      };
      b.onmouseenter = () => info(b.dataset.c);
      b.onmouseleave = () => info(null);
    });

    $("#dm-sliders").innerHTML = CTRL.map(c => {
      // marca del valor declarado: deja volver de un vistazo y le muestra a la sala
      // cuánto te moviste de lo que el modelo afirma
      const pos = (c.v() - c.min) / (c.max - c.min) * 100;
      const izq = "calc(8.5px + " + pos.toFixed(2) + "% - " +
                  (pos * 0.17).toFixed(2) + "px)";
      return '<div class="dm-c' + (c.mag ? " dmag" : "") + '" data-p="' + c.id + '">' +
        "<label>" + c.lab + "</label>" +
        '<span class="rail"><input type="range" id="dm-' + c.id + '" min="' + c.min +
        '" max="' + c.max + '" step="' + c.st + '" value="' + c.v() + '">' +
        '<i class="base" style="left:' + izq + '"></i></span>' +
        '<b id="dmv-' + c.id + '">—</b></div>';
    }).join("");
    CTRL.forEach(c => {
      const inp = $("#dm-" + c.id);
      inp.oninput = () => { if (c.id === "mag") magPct = +inp.value; libre = true; render(true); };
      inp.onchange = () => render(false);
    });
    $("#dm-sliders").querySelectorAll(".dm-c").forEach(d => {
      d.onmouseenter = () => iluminar(d.dataset.p);
      d.onmouseleave = () => iluminar(null);
    });

    aristas();
    setModo("arbol");
  }

  function setModo(m) {
    modo = m;
    const host = document.querySelector(".demo");
    host.classList.remove("m-arbol", "m-resultado");
    host.classList.add("m-" + m);
    // el panel cambió de tamaño: el canvas se re-mide y se vuelve a dibujar
    requestAnimationFrame(() => { render(false); });
  }

  function resetSliders() {
    const p = F.aplicar(D.base, ctrlActivos(), D.pisos);
    magPct = 100;
    [["cf", p.cf], ["poa", p.poa * 100], ["tc", p.tc_mu], ["rs", p.rs_mu],
     ["sep", p.sep * 100], ["mag", 100]].forEach(([id, v]) => {
      const e = $("#dm-" + id); if (e) e.value = v;
    });
  }

  function aristas() {
    const svg = $("#dm-svg");
    svg.setAttribute("viewBox", "0 0 1000 1000");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.innerHTML = ARISTAS.map(([a, b]) => {
      const A = NODOS[a], B = NODOS[b];
      const x1 = A.x * 10, y1 = A.y * 10 + 285, x2 = B.x * 10, y2 = B.y * 10;
      return '<path data-a="' + a + '" data-b="' + b + '" d="M' + x1 + ' ' + y1 +
        ' C' + x1 + ' ' + (y1 + 30) + ' ' + x2 + ' ' + (y2 - 30) + ' ' + x2 + ' ' + y2 +
        '" fill="none" stroke="rgba(200,205,245,.35)" stroke-width="3" ' +
        'vector-effect="non-scaling-stroke"/>';
    }).join("");
  }

  /* ── panel que explica cada control ───────────────────────────────────── */
  function info(id) {
    const box = $("#dm-info");
    if (!id || id === "__none") { box.className = "dm-info"; return; }
    const c = D.controles.find(x => x.id === id);
    if (!c) return;
    const k = c.costoDet;
    box.className = "dm-info on";
    box.innerHTML =
      '<div class="i-h"><b>' + c.nombre + "</b>" +
      '<span class="i-nodo">mueve ' + c.nodo + "</span></div>" +
      '<div class="i-d">' + c.detalle + "</div>" +
      '<div class="i-w"><i>Por qué está en la lista:</i> ' + c.porque + "</div>" +
      '<div class="i-n">' +
        "<span><em>efecto en el modelo</em>" + c.efectoTxt + "</span>" +
        "<span><em>costo anual</em>" + F.money(c.costo) + "</span>" +
        "<span><em>desglose</em>lic " + F.money(k.licencia) + " · implem " +
          F.money(k.implementacion) + "/3a · " + F.num(k.fte, 1) + " FTE</span>" +
        "<span><em>ROSI sobre el ALE</em><b class='" + (c.rosi < 0 ? "neg" : "pos") + "'>" +
          (c.rosi > 0 ? "+" : "") + Math.round(c.rosi * 100) + "%</b></span>" +
        "<span><em>ROSI con capital</em><b class='" + (c.rosiCap < 0 ? "neg" : "pos") + "'>" +
          (c.rosiCap > 0 ? "+" : "") + Math.round(c.rosiCap * 100) + "%</b></span>" +
      "</div>";
  }

  function pista() {
    const n = activos.size;
    $("#dm-pista").innerHTML = n
      ? "<b>" + n + (n === 1 ? " control encendido" : " controles encendidos") +
        ".</b> Se prenden y apagan por separado, en cualquier orden. " +
        "Pasá el mouse por uno para ver qué hace y cuánto cuesta."
      : "<b>Ningún control encendido: el banco tal como está hoy.</b> " +
        "Pasá el mouse por un control para ver el detalle; hacé clic para encenderlo.";
  }

  /* ── render ───────────────────────────────────────────────────────────── */
  let ultimo = null;
  function render(rapido) {
    const p = params();
    const ex = !libre ? D.exactos[clave()] : null;
    const x = ex ? null : F.simular(p, rapido ? 24000 : N_LIVE, 20260917);
    const m = ex || F.metricas(x);
    const sev = F.severidadEsperada(p);
    ultimo = { p, m, x };

    if (!BASE_VALS) BASE_VALS = valoresDe(F.aplicar(D.base, [], D.pisos));
    const set = (k, v) => {
      const e = document.querySelector('[data-v="' + k + '"]');
      if (e) e.textContent = v;
      const w = document.querySelector('[data-w="' + k + '"]');
      if (!w) return;
      const movido = BASE_VALS[k] !== v;
      w.textContent = movido ? "antes " + BASE_VALS[k] : "";
      const nodo = w.parentElement;
      if (nodo) nodo.classList.toggle("chg", movido);
    };
    set("risk", F.money(m.ale));
    set("lef", F.num(F.lef(p), 3));
    set("lm", F.money(sev.total));
    set("tef", F.num(F.tef(p), 2));
    set("vuln", F.pct(F.vulnerabilidad(p), 1));
    set("pl", F.money(sev.primaria));
    set("sl", F.money(sev.secundaria));
    document.querySelectorAll(".dm-n").forEach(n =>
      n.classList.toggle("sel", n.dataset.k === nodoSel));

    const d = DET[nodoSel](p);
    $("#dm-det").innerHTML =
      "<h5>" + d.t + "</h5><p>" + d.d + "</p><table>" +
      d.f.map((f, i) => "<tr" + (i === d.f.length - 1 ? ' class="tot"' : "") + "><td>" +
        f[0] + "</td><td>" + f[1] + "</td></tr>").join("") + "</table><em>" + d.n + "</em>";

    const B = D.exactos[""];
    $("#dm-mets").innerHTML = [["ALE", "ale"], ["VaR 95%", "var95"],
                               ["TVaR 95%", "tvar95"], ["Capital econ.", "ec"]]
      .map(([lab, k]) => {
        const dd = B[k] ? (m[k] - B[k]) / B[k] * 100 : 0;
        const chip = Math.abs(dd) < .5 ? "" :
          '<i class="' + (dd < 0 ? "dn" : "up") + '">' + (dd > 0 ? "+" : "") +
          Math.round(dd) + "%</i>";
        return '<div class="dm-m' + (k === "ec" ? " dm-cap" : "") + '"><span>' + lab +
               "</span><b>" + F.money(m[k]) + "</b>" + chip + "</div>";
      }).join("");

    CTRL.forEach(c => {
      const e = $("#dmv-" + c.id), inp = $("#dm-" + c.id);
      if (e && inp) e.textContent = c.fmt(+inp.value);
    });
    $("#dm-chips").querySelectorAll("button[data-c]").forEach(b =>
      b.classList.toggle("on", activos.has(b.dataset.c)));
    const act = ctrlActivos();
    $("#dm-act").textContent = act.length
      ? act.map(c => c.corto).join(" + ") + "  ·  " +
        F.money(act.reduce((s, c) => s + c.costo, 0)) + " / año"
      : "sin controles";
    $("#dm-act").className = "dm-act" + (act.length ? " on" : "");
    $("#dm-tabs").querySelectorAll("button").forEach(b =>
      b.classList.toggle("on", b.dataset.v === vista));
    $("#dm-modos").querySelectorAll("button").forEach(b =>
      b.classList.toggle("on", b.dataset.m === modo));

    // LA LÍNEA DE DECISIÓN: cuánto cuesta contra cuánto evita y cuánto libera.
    // Es la frase con la que un comité aprueba o rechaza, y hasta ahora había que
    // armarla mentalmente cruzando el costo del chip con el delta de las métricas.
    const deal = $("#dm-deal");
    if (act.length) {
      const costo = act.reduce((z, c) => z + c.costo, 0);
      const evita = B.ale - m.ale, libera = B.ec - m.ec;
      const retorno = (evita + libera * 0.14 - costo) / costo;
      deal.className = "dm-deal on";
      deal.innerHTML =
        '<span class="q">' + act.map(c => c.corto).join(" + ") + "</span>" +
        '<span class="c">cuesta <b>' + F.money(costo) + "</b> al año</span>" +
        '<span class="fl">→</span>' +
        '<span class="e">evita <b>' + F.money(evita) + "</b> de pérdida esperada</span>" +
        '<span class="e">y libera <b>' + F.money(libera) + "</b> de capital</span>" +
        '<span class="r ' + (retorno < 0 ? "neg" : "pos") + '">' +
          (retorno > 0 ? "+" : "") + Math.round(retorno * 100) + "%</span>";
    } else {
      deal.className = "dm-deal";
      deal.innerHTML = "";
    }
    pista();

    dibujar(rapido);
  }

  /* ── vistas ───────────────────────────────────────────────────────────── */
  // El espacio de dibujo es SIEMPRE 1120×600 lógicos. Al cambiar de modo el panel
  // cambia de proporción, y si el canvas se estirara con él las letras del gráfico
  // saldrían deformadas. Se escala uniforme y se centra (letterbox): todas las
  // funciones de dibujo siguen razonando en 1120×600 y no hay que tocarlas.
  let cvGeo = { k: 1, dx: 0, dy: 0, dpr: 2 };
  function ctx() {
    const cv = $("#dm-cv"), g = cv.getContext("2d");
    const r = cv.getBoundingClientRect(), dpr = 2;
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const k = Math.min(w / 1120, h / 600);
    const dx = (w - 1120 * k) / 2, dy = (h - 600 * k) / 2;
    cvGeo = { k: k, dx: dx, dy: dy, dpr: dpr };
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.setTransform(k, 0, 0, k, dx, dy);
    return { g, W: 1120, H: 600 };
  }

  function dibujar(rapido) {
    const { g, W, H } = ctx();
    const { p, m, x } = ultimo;
    if (vista === "curva") vCurva(g, W, H, p, m, x, rapido);
    else if (vista === "dist") vDist(g, W, H, p, m, x);
    else if (vista === "comp") vComp(g, W, H, p);
    else vTor(g, W, H);
  }

  let curvaGeo = null;
  function vCurva(g, W, H, p, m, x, rapido) {
    const PL = 112, PR = 44, PT = 26, PB = 64, XM = 16e6;
    // El eje Y se adapta: con parámetros extremos la curva arrancaba por encima
    // del 42% fijo y se salía del cuadro sin que se viera nada.
    const pico = Math.max(D.curvaBase[0][1], (1 - m.p_cero) * 100);
    const YM = Math.max(42, Math.ceil(pico * 1.12 / 10) * 10);
    const X = v => PL + (v / XM) * (W - PL - PR), Y = v => H - PB - (v / YM) * (H - PT - PB);
    g.strokeStyle = N100; g.lineWidth = 2; g.fillStyle = N500;
    g.font = "500 21px Bahnschrift, Segoe UI, sans-serif";
    g.textAlign = "right"; g.textBaseline = "middle";
    const paso = YM > 60 ? 20 : 10;
    for (let v = 0; v <= YM; v += paso) {
      g.beginPath(); g.moveTo(PL, Y(v)); g.lineTo(W - PR, Y(v)); g.stroke();
      g.fillText(v + "%", PL - 16, Y(v));
    }
    g.textAlign = "center"; g.textBaseline = "top";
    for (let v = 0; v <= XM; v += 4e6) {
      g.fillText(v === 0 ? "0" : "$" + (v / 1e6) + "M", X(v), H - PB + 14);
    }

    g.setLineDash([8, 7]); g.strokeStyle = N300; g.lineWidth = 3;
    g.beginPath(); D.curvaBase.forEach(([a, b], i) =>
      i ? g.lineTo(X(a), Y(b)) : g.moveTo(X(a), Y(b))); g.stroke(); g.setLineDash([]);
    if (activos.size) {
      // La etiqueta va sobre la parte ALTA de la línea punteada, no a media altura:
      // la otra etiqueta —«X% de perder más de USD 2M»— sigue al punto de los 2M, que
      // sube y baja con los controles, y entre el 7% y el 10% las dos se montaban.
      // Además se verifica la distancia: si aun así quedan cerca, ésta se corre arriba.
      const alto = D.curvaBase.find(q => q[1] <= 26) || D.curvaBase[0];
      let ey = Y(alto[1]) - 12;
      const otra = Y(m.p_gt_2m * 100) - 20;      // baseline de la etiqueta del punto
      if (Math.abs(ey - otra) < 42) ey = otra - 48;
      g.fillStyle = N500; g.font = "700 20px Bahnschrift, Segoe UI, sans-serif";
      g.textAlign = "left"; g.textBaseline = "bottom";
      g.fillText("hoy, sin controles", X(alto[0]) + 14, ey);
    }

    const pts = x ? F.curva(x, XM, rapido ? 60 : 110)
                  : F.curva(F.simular(p, N_LIVE, 20260917), XM, 110);
    curvaGeo = { X, Y, PL, PR, XM, W, pts };
    const gr = g.createLinearGradient(0, PT, 0, H - PB);
    gr.addColorStop(0, "rgba(3,255,158,.20)"); gr.addColorStop(1, "rgba(3,255,158,.02)");
    g.beginPath(); g.moveTo(X(0), Y(0));
    pts.forEach(([a, b]) => g.lineTo(X(a), Y(b)));
    g.lineTo(X(XM), Y(0)); g.closePath(); g.fillStyle = gr; g.fill();
    g.beginPath(); pts.forEach(([a, b], i) => i ? g.lineTo(X(a), Y(b)) : g.moveTo(X(a), Y(b)));
    g.strokeStyle = GREEN; g.lineWidth = 7; g.lineJoin = "round"; g.stroke();

    const tip = $("#dm-tip");
    if (hover !== null) {
      const hx = Math.max(0, Math.min(XM, hover));
      let hy = pts[pts.length - 1][1];
      for (let i = 1; i < pts.length; i++) {
        if (pts[i][0] >= hx) {
          const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
          hy = y0 + (y1 - y0) * ((hx - x0) / ((x1 - x0) || 1)); break;
        }
      }
      g.strokeStyle = N300; g.lineWidth = 2; g.setLineDash([5, 5]);
      g.beginPath(); g.moveTo(X(hx), Y(0)); g.lineTo(X(hx), Y(YM)); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.arc(X(hx), Y(hy), 13, 0, 7); g.fillStyle = GREEN; g.fill();
      g.strokeStyle = BG; g.lineWidth = 5; g.stroke();
      tip.style.display = "block";
      tip.style.left = (X(hx) / W * 100) + "%";
      tip.style.top = (Y(hy) / H * 100) + "%";
      tip.innerHTML = "<b>" + F.pct(hy / 100, 1) + "</b> de perder<br>más de " + F.money(hx);
    } else {
      tip.style.display = "none";
      const p2 = m.p_gt_2m * 100;
      g.beginPath(); g.arc(X(2e6), Y(p2), 12, 0, 7); g.fillStyle = GREEN; g.fill();
      g.strokeStyle = BG; g.lineWidth = 5; g.stroke();
      g.font = "700 26px Bahnschrift, Segoe UI, sans-serif"; g.fillStyle = INK;
      g.textAlign = "left"; g.textBaseline = "bottom";
      // sin subtexto: con controles fuertes el punto sube, la etiqueta baja y los
      // dos renglones se montaban. La invitación a pasar el mouse la hace el orador.
      g.fillText(F.pct(m.p_gt_2m) + " de perder más de USD 2M", X(2e6) + 26, Y(p2) - 20);
    }
  }

  function vDist(g, W, H, p, m, x) {
    const PL = 112, PR = 44, PT = 116, PB = 64, XM = 16e6, BINS = 56;
    const datos = x || F.simular(p, N_LIVE, 20260917);
    const h = new Array(BINS).fill(0);
    let fuera = 0;
    for (let i = 0; i < datos.length; i++) {
      if (datos[i] <= 0) continue;
      if (datos[i] > XM) { fuera++; continue; }
      h[Math.min(BINS - 1, Math.floor(datos[i] / XM * BINS))]++;
    }
    const ymax = Math.max.apply(null, h) * 1.06;
    const X = v => PL + (v / XM) * (W - PL - PR), Y = v => H - PB - (v / ymax) * (H - PT - PB);
    g.fillStyle = N500; g.font = "500 21px Bahnschrift, Segoe UI, sans-serif";
    g.textAlign = "center"; g.textBaseline = "top";
    for (let v = 0; v <= XM; v += 4e6) {
      g.fillText(v === 0 ? "0" : "$" + (v / 1e6) + "M", X(v), H - PB + 14);
    }
    const bw = (W - PL - PR) / BINS;
    g.fillStyle = BLUE;
    h.forEach((v, i) => g.fillRect(X(XM * i / BINS) + 1, Y(v), bw - 2, H - PB - Y(v)));
    // las tres marcas, escalonadas para que las etiquetas no se pisen
    [["ALE", m.ale, GREEN], ["VaR 95%", m.var95, MAG], ["TVaR 95%", m.tvar95, AMBER]]
      .forEach(([lab, v, col], i) => {
        if (v > XM) return;
        g.strokeStyle = col; g.lineWidth = 4;
        g.beginPath(); g.moveTo(X(v), Y(0)); g.lineTo(X(v), PT - 8 - i * 34); g.stroke();
        g.fillStyle = col; g.font = "700 22px Bahnschrift, Segoe UI, sans-serif";
        g.textAlign = "left"; g.textBaseline = "bottom";
        g.fillText(lab + "  " + F.money(v), X(v) + 12, PT - 10 - i * 34);
      });
    g.fillStyle = N500; g.font = "italic 400 20px Bahnschrift, Segoe UI, sans-serif";
    g.textAlign = "right"; g.textBaseline = "bottom";
    g.fillText(F.pct(m.p_cero) + " de los años no tiene ningún evento  ·  " +
      F.num(fuera / datos.length * 100, 1) + "% se sale por la derecha", W - PR, H - 12);
  }

  function vComp(g, W, H, p) {
    const s = F.severidadEsperada(p);
    const items = F.PRIMARIAS.concat(F.SECUNDARIAS).map(k => ({
      n: D.hojas[k], v: s.detalle[k], pr: F.PRIMARIAS.indexOf(k) >= 0
    })).sort((a, b) => b.v - a.v);
    const max = items[0].v, PL = 268, PR = 168, PT = 24, PB = 48;
    const bh = (H - PT - PB) / items.length;
    items.forEach((it, i) => {
      const y = PT + i * bh, w = Math.max(2, (it.v / max) * (W - PL - PR));
      g.fillStyle = it.pr ? BLUE : MAG; g.globalAlpha = it.pr ? 1 : .82;
      g.fillRect(PL, y + bh * .17, w, bh * .66);
      g.globalAlpha = 1;
      g.fillStyle = INK; g.font = "700 22px Bahnschrift, Segoe UI, sans-serif";
      g.textAlign = "right"; g.textBaseline = "middle";
      g.fillText(it.n, PL - 20, y + bh / 2);
      g.fillStyle = it.pr ? BLUE : MAG; g.textAlign = "left";
      g.fillText(F.money(it.v), PL + w + 18, y + bh / 2);
    });
    g.fillStyle = N500; g.font = "italic 400 20px Bahnschrift, Segoe UI, sans-serif";
    g.textAlign = "left"; g.textBaseline = "bottom";
    g.fillText("azul = primaria, ocurre siempre   ·   coral = secundaria, ya multiplicada por SEP",
               PL - 250, H - 10);
  }

  let torCache = null, torClave = "";
  function calcTornado(p) {
    /* Se recalcula con los parámetros de pantalla: si el orador mueve una hoja,
       la respuesta a «¿y si nos equivocamos?» también cambia. N chico a propósito:
       son 17 simulaciones y tiene que salir en menos de medio segundo. */
    const N = 14000;
    const base = F.metricas(F.simular(p, N, 20260917)).ale;
    const out = D.palancas.map(pl => {
      const vs = pl.rango.map(v => {
        const q = Object.assign({}, p); q[pl.key] = v;
        return F.metricas(F.simular(q, N, 20260917)).ale;
      });
      return { lab: pl.lab, hoja: pl.hoja, bajo: Math.min(vs[0], vs[1]),
               alto: Math.max(vs[0], vs[1]), amp: Math.abs(vs[1] - vs[0]) };
    });
    out.sort((a, b) => b.amp - a.amp);
    return { base: base, filas: out };
  }

  function vTor(g, W, H) {
    const p = ultimo.p;
    const ck = clave() + "|" + (libre ? JSON.stringify(p) : "");
    if (ck !== torClave) { torCache = calcTornado(p); torClave = ck; }
    const f = torCache.filas.slice(0, 8), base = torCache.base;
    const max = Math.max.apply(null, f.map(z => z.alto)) * 1.04;
    const PL = 300, PR = 150, PT = 42, PB = 46;
    const bh = (H - PT - PB) / f.length;
    const X = v => PL + (v / max) * (W - PL - PR);
    f.forEach((z, i) => {
      const y = PT + i * bh, frec = ["cf", "poa", "tc", "rs"].indexOf(z.hoja) >= 0;
      g.fillStyle = frec ? BLUE : MAG; g.globalAlpha = frec ? .95 : .78;
      g.fillRect(X(z.bajo), y + bh * .2, Math.max(3, X(z.alto) - X(z.bajo)), bh * .6);
      g.globalAlpha = 1;
      g.fillStyle = INK; g.font = "600 21px Bahnschrift, Segoe UI, sans-serif";
      g.textAlign = "right"; g.textBaseline = "middle";
      g.fillText(z.lab, PL - 20, y + bh / 2);
      g.fillStyle = frec ? BLUE : MAG; g.textAlign = "left";
      g.font = "700 21px Bahnschrift, Segoe UI, sans-serif";
      g.fillText(F.money(z.amp), X(z.alto) + 16, y + bh / 2);
    });
    g.strokeStyle = INK; g.lineWidth = 3;
    g.beginPath(); g.moveTo(X(base), PT - 6); g.lineTo(X(base), H - PB); g.stroke();
    g.fillStyle = INK; g.font = "700 21px Bahnschrift, Segoe UI, sans-serif";
    g.textAlign = "center"; g.textBaseline = "bottom";
    g.fillText("ALE base " + F.money(base), X(base), PT - 12);
    g.fillStyle = N500; g.font = "italic 400 20px Bahnschrift, Segoe UI, sans-serif";
    g.textAlign = "left"; g.textBaseline = "bottom";
    g.fillText("cuánto se movería el resultado si esa hoja estuviera mal estimada",
               PL - 282, H - 10);
  }

  /* ── hover sobre la curva ─────────────────────────────────────────────── */
  function montarHover() {
    const cv = $("#dm-cv");
    cv.onmousemove = e => {
      if (vista !== "curva" || !curvaGeo) return;
      const r = cv.getBoundingClientRect();
      // del píxel CSS al espacio lógico, descontando el centrado del letterbox
      const px = ((e.clientX - r.left) * cvGeo.dpr - cvGeo.dx) / cvGeo.k;
      const { PL, PR, XM, W } = curvaGeo;
      if (px < PL || px > W - PR) {
        if (hover !== null) { hover = null; dibujar(true); }
        return;
      }
      hover = (px - PL) / (W - PL - PR) * XM;
      dibujar(true);
    };
    cv.onmouseleave = () => { if (hover !== null) { hover = null; dibujar(false); } };
  }


  /* ── piloto automático: el guion del video, en loop ────────────────────── */
  // Mismos tramos y tiempos que grabar_demo.py. Cualquier toque del orador (click,
  // tecla de la demo) lo frena y la demo queda manual; la pastilla o la tecla P lo retoma.
  const BASEV = { cf: 24, poa: 18, tc: 58, rs: 82, sep: 55, mag: 100 };
  const FPS = 20;
  let autoOn = false, autoTm = null, gen = 0;
  const suave = u => u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  function setSl(id, v, vivo) {
    const e = $("#dm-" + id); if (!e) return;
    e.value = v; e.dispatchEvent(new Event("input", { bubbles: true }));
    if (!vivo) e.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function hl(id, on) {
    const d = document.querySelector('.dm-c[data-p="' + id + '"]'); if (!d) return;
    d.classList.toggle("drag", on); iluminar(on ? id : null);
  }
  function guion() {
    const A = [];
    const quieto = s => A.push({ t: "wait", ms: s * 1000 });
    const tecla = k => A.push({ t: "key", k: k });
    const arrastre = (tr, s, res) => A.push({ t: "drag", tr: tr, ms: s * 1000, res: res });
    const apagar = id => A.push({ t: "hloff", id: id });
    const hoja = (id, ext) => { arrastre([[id, BASEV[id], ext]], 5, id); quieto(1.4);
      arrastre([[id, ext, BASEV[id]]], 4); apagar(id); quieto(.4); };
    tecla("x"); tecla("q"); quieto(4);
    hoja("cf", 42); hoja("poa", 42); hoja("tc", 80); hoja("rs", 58); hoja("sep", 88); hoja("mag", 170);
    arrastre([["tc", 58, 80], ["rs", 82, 58]], 7, "rs"); quieto(4); apagar("rs"); tecla("x"); quieto(2);
    arrastre([["cf", 24, 40], ["poa", 18, 38], ["tc", 58, 76]], 7, "cf"); quieto(4); apagar("cf"); tecla("x"); quieto(2);
    tecla("w"); quieto(6); tecla("e"); quieto(6); tecla("r"); quieto(7); tecla("q"); quieto(4);
    tecla("1"); quieto(6); tecla("x"); quieto(5); tecla("2"); quieto(6); tecla("5"); quieto(10);
    tecla("w"); quieto(6); tecla("e"); quieto(6); tecla("r"); quieto(6); tecla("q"); quieto(12);
    return A;
  }
  function pill() { const p = $("#dm-auto"); if (p) { p.classList.toggle("on", autoOn); p.textContent = autoOn ? "piloto automático · P" : "manual · P para retomar"; } }
  function correr(A, i, g) {
    if (g !== gen || !autoOn) return;
    if (i >= A.length) { correr(guion(), 0, g); return; }          // loop
    const a = A[i], sig = ms => { autoTm = setTimeout(() => correr(A, i + 1, g), ms); };
    if (a.t === "wait") return sig(a.ms);
    if (a.t === "key") { DEMO.tecla(a.k, true); return sig(0); }
    if (a.t === "hloff") { hl(a.id, false); return sig(0); }
    if (a.t === "drag") {
      if (a.res) hl(a.res, true);
      const n = Math.max(1, Math.round(a.ms / 1000 * FPS)); let k = 0;
      const paso = () => {
        if (g !== gen || !autoOn) return;
        k++; const u = suave(k / n), ult = k >= n;
        a.tr.forEach(([id, d, h]) => setSl(id, Math.round(d + (h - d) * u), !ult));
        if (ult) sig(0); else autoTm = setTimeout(paso, 1000 / FPS);
      };
      return paso();
    }
  }
  function auto(on) {
    autoOn = on; gen++; clearTimeout(autoTm);
    document.querySelectorAll(".dm-c.drag").forEach(d => d.classList.remove("drag"));
    iluminar(null); pill();
    if (on) correr(guion(), 0, gen);
  }
  window.DEMO = {
    montar: function (host) {
      if (!host.dataset.built) {
        host.dataset.built = "1"; build(host); montarHover();
        const p = document.createElement("div"); p.id = "dm-auto"; p.className = "dm-auto";
        p.onclick = e => { e.stopPropagation(); auto(!autoOn); }; ($(".dm-hd-r", host) || host).appendChild(p); pill();
        host.addEventListener("pointerdown", e => { if (autoOn && e.target.id !== "dm-auto") auto(false); }, true);
      }
    },
    auto: auto,
    tecla: function (k, desdePiloto) {
      if (!desdePiloto && autoOn && k !== "p" && k !== "P") auto(false);
      if (k === "p" || k === "P") { auto(!autoOn); return true; }
      const ids = D.controles.map(c => c.id);
      if (k >= "1" && k <= String(ids.length)) {
        // Atajo de escena: 1..5 carga la frontera de manera acumulativa.
        // Los botones siguen siendo toggles independientes para preguntas libres.
        activos.clear();
        ids.slice(0, +k).forEach(id => activos.add(id));
        libre = false; resetSliders(); render(false); return true;
      }
      if (k === "0" || k === "x" || k === "X") {
        activos.clear(); libre = false; resetSliders(); render(false); return true;
      }
      const V = { q: "curva", w: "dist", e: "comp", r: "tor" };
      if (V[k]) { vista = V[k]; render(false); return true; }
      // a · s · d: contiguas en la fila del medio, se encuentran sin mirar
      const M = { a: "arbol", s: "resultado" };
      if (M[k]) { setModo(M[k]); return true; }
      return false;
    }
  };
})();
