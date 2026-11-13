// Vista «Fabricación» (etapa 2): tabla de rentabilidad de TODAS las recetas con el motor del navegador.
// La parte sin DOM (cálculo, filtros, orden, CSV) está en fabricacion_tabla.js y se prueba en Node.

import { NOMBRE_ORIGEN, calcularFilas, filasACsv, filtrarFilas, ordenarFilas, simularReceta } from "./fabricacion_tabla.js";
import { REGLA_POR_DEFECTO } from "./fabricacion.js";
import { parsearMoneda } from "./moneda.js";
import { NIVEL_TEXTO, UMBRAL, oportunidades } from "./oportunidades.js";
import { serieHistorial, subarbolReceta } from "./fabricacion_historial.js";
import { dibujarGrafico } from "./grafico.js";
import {
  CAMPOS_ALERTA, MAX_COMPARAR, alternar as alternarSpell, anadirComparar, compararRecetas, crearAlerta, evaluarAlertas, normalizarExtras,
} from "./fabricacion_extras.js";

const POR_PAGINA = 100;
const CLAVE_LOCAL = "mw_fabricacion1";

const COLUMNAS = [
  ["nombre", "Objeto", "", "Producto que se fabrica. Debajo, la receta."],
  ["profesion", "Profesión", "c-prof", ""],
  ["nivel", "Nivel", "num c-nivel", "Habilidad de profesión requerida"],
  ["precio", "Venta", "num", "Precio unitario de venta: compra mínima o, sin ofertas, valor de mercado (con tope)"],
  ["coste", "Coste", "num", "Coste de una fabricación: lo más barato entre subasta, NPC o fabricar cada material"],
  ["bruta", "G. bruta", "num c-bruta", "Ingreso bruto − coste"],
  ["neta", "G. neta", "num", "Ingreso bruto − comisión − coste. El depósito se recupera al vender: no se resta"],
  ["roi", "ROI", "num", "Ganancia neta / coste × 100"],
  ["margen", "Margen", "num c-margen-n", "Ganancia neta / ingreso bruto × 100"],
  ["disponible", "Disponible", "num c-disp", "Unidades del producto a la venta (competencia)"],
  ["ventas", "Ventas/día", "num c-ventas", "Ventas al día estimadas (reino si existe; si no, región US, marcado)"],
];

/**
 * @param {object} d  utilidades de app.js: {$, el, monedaNodo, iconoNodo, nom, nombreProf, fecha, hace, local,
 *                    avisar, abrirObjeto, mercado: () => clave}
 */
export function crearVistaFabricacion(d) {
  const { $, el } = d;
  const guardado = d.local.leer(CLAVE_LOCAL, {});
  const f = {
    profesiones: guardado.profesiones ?? [], roiMin: null, netaMin: null, nivelMin: null, nivelMax: null,
    soloCompletas: true, soloRentables: false, soloConVenta: false, soloMaterialesEnVenta: false, soloConVentas: false,
    soloFavoritas: false,
    ...(guardado.filtros ?? {}),
    texto: "",
  };
  const op = { valorSinOfertas: true, fabricarIntermedios: true, comision: 5, ...(guardado.opciones ?? {}) };
  let orden = guardado.orden ?? { clave: "neta", dir: "desc" };
  let datos = null, datosMercado = null, filas = [], pagina = 1, cargando = null;
  let abierta = null;   // spell de la receta desplegada
  let modo = "tabla";   // «tabla» (todas las recetas) u «oportunidades»
  const nombreEs = (id) => d.nom(id, null);   // para buscar también por el nombre en español

  const guardar = () => d.local.escribir(CLAVE_LOCAL, {
    profesiones: f.profesiones, orden, opciones: op,
    filtros: { roiMin: f.roiMin, netaMin: f.netaMin, nivelMin: f.nivelMin, nivelMax: f.nivelMax, soloCompletas: f.soloCompletas,
               soloRentables: f.soloRentables, soloConVenta: f.soloConVenta, soloMaterialesEnVenta: f.soloMaterialesEnVenta,
               soloConVentas: f.soloConVentas, soloFavoritas: f.soloFavoritas },
  });

  // ---------- cabecera de la tabla ----------
  const trCab = $("fab-cab");
  for (const [clave, texto, cls, ayuda] of COLUMNAS) {
    const th = el("th", cls);
    th.scope = "col";
    const b = el("button", "th-orden", texto);
    b.type = "button"; b.dataset.orden = clave;
    if (ayuda) b.title = ayuda;
    th.append(b);
    trCab.append(th);
  }
  trCab.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-orden]");
    if (!b) return;
    const clave = b.dataset.orden;
    orden = orden.clave === clave
      ? { clave, dir: orden.dir === "desc" ? "asc" : "desc" }
      : { clave, dir: ["nombre", "profesion", "coste"].includes(clave) ? "asc" : "desc" };
    $("fab-orden").value = `${orden.clave}:${orden.dir}`;
    guardar(); pagina = 1; pintar();
  });

  // ---------- controles ----------
  const num = (id) => { const v = $(id).value.trim(); return v === "" ? null : Number(v); };
  const casillas = ["soloCompletas", "soloRentables", "soloConVenta", "soloMaterialesEnVenta", "soloConVentas", "soloFavoritas"];
  for (const k of casillas) $(`fab-${k}`).checked = !!f[k];
  for (const [k, id] of [["roiMin", "fab-roi"], ["nivelMin", "fab-nivel-min"], ["nivelMax", "fab-nivel-max"]]) {
    if (f[k] != null) $(id).value = f[k];
  }
  if (f.netaMin != null) $("fab-neta").value = String(f.netaMin);
  $("fab-valor-sin-ofertas").checked = op.valorSinOfertas;
  $("fab-intermedios").checked = op.fabricarIntermedios;
  $("fab-casa").value = String(op.comision);
  $("fab-orden").value = `${orden.clave}:${orden.dir}`;

  $("fab-filtros").addEventListener("submit", (ev) => ev.preventDefault());
  let temporizador = null;
  $("fab-texto").addEventListener("input", () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { f.texto = $("fab-texto").value; pagina = 1; pintar(); }, 150);
  });
  $("fab-filtros").addEventListener("change", (ev) => {
    const id = ev.target.id;
    if (id === "fab-texto") return;
    for (const k of casillas) f[k] = $(`fab-${k}`).checked;
    f.roiMin = num("fab-roi");
    f.nivelMin = num("fab-nivel-min");
    f.nivelMax = num("fab-nivel-max");
    try {
      f.netaMin = $("fab-neta").value.trim() === "" ? null : parsearMoneda($("fab-neta").value);
      $("fab-neta").removeAttribute("aria-invalid");
    } catch (e) {
      $("fab-neta").setAttribute("aria-invalid", "true");
      d.avisar(e.message, "bad");
    }
    if (id === "fab-orden") {
      const [clave, dir] = $("fab-orden").value.split(":");
      orden = { clave, dir };
    }
    const recalcular = ["fab-valor-sin-ofertas", "fab-intermedios", "fab-casa"].includes(id);
    op.valorSinOfertas = $("fab-valor-sin-ofertas").checked;
    op.fabricarIntermedios = $("fab-intermedios").checked;
    op.comision = Number($("fab-casa").value);
    guardar(); pagina = 1;
    if (recalcular) calcular();
    pintar();
  });
  $("fab-profesiones").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-prof]");
    if (!b) return;
    const p = b.dataset.prof;
    if (p === "") f.profesiones = [];
    else f.profesiones = f.profesiones.includes(p) ? f.profesiones.filter((x) => x !== p) : [...f.profesiones, p];
    guardar(); pagina = 1; pintarProfesiones(); pintar();
  });
  $("fab-quitar").addEventListener("click", () => {
    Object.assign(f, { texto: "", profesiones: [], roiMin: null, netaMin: null, nivelMin: null, nivelMax: null,
                       soloCompletas: false, soloRentables: false, soloConVenta: false, soloMaterialesEnVenta: false, soloConVentas: false,
                       soloFavoritas: false });
    for (const id of ["fab-texto", "fab-roi", "fab-neta", "fab-nivel-min", "fab-nivel-max"]) $(id).value = "";
    for (const k of casillas) $(`fab-${k}`).checked = false;
    guardar(); pagina = 1; pintarProfesiones(); pintar();
  });
  $("fab-csv").addEventListener("click", () => {
    const lista = ordenarFilas(filtradas(), orden.clave, orden.dir);
    const blob = new Blob(["﻿" + filasACsv(lista, (x) => d.nom(x.id, x.nombre))], { type: "text/csv;charset=utf-8" });
    const a = el("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fabricacion-${(datos?.mercado ?? "mercado").replaceAll(":", "-")}.csv`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("fab-pag-ant").addEventListener("click", () => { pagina--; pintar(); $("vista-fabricacion").scrollIntoView({ block: "start" }); });
  $("fab-pag-sig").addEventListener("click", () => { pagina++; pintar(); $("vista-fabricacion").scrollIntoView({ block: "start" }); });
  // Pulsar una receta despliega (o pliega) su desglose debajo; la ficha del objeto se abre desde ahí.
  function alternar(tr) {
    const spell = Number(tr.dataset.spell);
    const siguiente = tr.nextElementSibling;
    if (siguiente?.classList.contains("fab-desglose")) {
      siguiente.remove(); abierta = null; tr.setAttribute("aria-expanded", "false"); return;
    }
    $("fab-tbody").querySelector("tr.fab-desglose")?.remove();
    $("fab-tbody").querySelector("tr[aria-expanded='true']")?.setAttribute("aria-expanded", "false");
    const x = filas.find((r) => r.spell === spell);
    if (!x) return;
    abierta = spell;
    tr.setAttribute("aria-expanded", "true");
    tr.after(filaDesglose(x));
  }
  $("fab-tbody").addEventListener("click", (ev) => {
    const ver = ev.target.closest("[data-ver-objeto]");
    if (ver) { d.abrirObjeto(Number(ver.dataset.verObjeto)); return; }
    if (ev.target.closest("tr.fab-desglose")) return;
    const tr = ev.target.closest("tr[data-spell]");
    if (tr) alternar(tr);
  });
  $("fab-tbody").addEventListener("keydown", (ev) => {
    const tr = ev.target.closest("tr[data-spell]");
    if (tr && ev.target === tr && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); alternar(tr); }
  });

  // ---------- datos y cálculo ----------
  function calcular() {
    if (!datos) { filas = []; return; }
    const regla = { ...REGLA_POR_DEFECTO, comision_pct: op.comision };
    const t = performance.now();
    filas = calcularFilas(datos, { regla, valorSinOfertas: op.valorSinOfertas, fabricarIntermedios: op.fabricarIntermedios });
    // El historial abierto se recalcula con las nuevas opciones (los precios guardados no cambian).
    if (hist.estado === "ok" && hist.crudo) hist.serie = serieHistorial(datos, hist.spell, hist.crudo, opcionesMotor());
    pintarAlertas();
    $("fab-calculo").textContent = `${filas.length.toLocaleString("es")} recetas calculadas en ${Math.round(performance.now() - t)} ms`;
  }

  async function cargar({ forzar = false } = {}) {
    const mercado = d.mercado();
    if (!mercado) return;
    if (!forzar && datos && datosMercado === mercado) return;
    if (cargando) return cargando;
    $("vista-fabricacion").setAttribute("aria-busy", "true");
    $("fab-estado").textContent = "Cargando recetas y precios…";
    cargando = (async () => {
      try {
        const r = await fetch(`/api/recetas?fabricacion=1&mercado=${encodeURIComponent(mercado)}`, { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j) throw new Error(j?.error ?? `HTTP ${r.status}`);
        datos = j; datosMercado = mercado;
        hist = { ...hist, estado: null, serie: null, crudo: null };   // datos nuevos: el historial se vuelve a pedir
        calcular(); pintarProfesiones(); pintar();
      } catch (e) {
        $("fab-estado").textContent = "No se pudieron cargar las recetas: " + e.message
          + ". Si acabas de actualizar, aplica la migración 0040 (configurar.bat).";
        $("fab-estado").className = "bad small";
      } finally {
        cargando = null;
        $("vista-fabricacion").removeAttribute("aria-busy");
      }
    })();
    return cargando;
  }

  // ---------- pintado ----------
  function pintarProfesiones() {
    const cont = $("fab-profesiones");
    const todas = [...new Set((datos?.recetas ?? []).map((r) => r.p))].sort((a, b) => d.nombreProf(a).localeCompare(d.nombreProf(b), "es"));
    const b0 = el("button", "chip-prof", "Todas");
    b0.type = "button"; b0.dataset.prof = "";
    b0.setAttribute("aria-pressed", String(f.profesiones.length === 0));
    cont.replaceChildren(b0, ...todas.map((p) => {
      const b = el("button", "chip-prof", d.nombreProf(p));
      b.type = "button"; b.dataset.prof = p;
      b.setAttribute("aria-pressed", String(f.profesiones.includes(p)));
      return b;
    }));
  }

  const pctTexto = (v) => (v == null ? "—" : `${v.toLocaleString("es", { maximumFractionDigits: v !== 0 && Math.abs(v) < 10 ? 1 : 0 })} %`);
  const signo = (td, v) => { if (v != null) td.classList.add(v > 0 ? "ok" : v < 0 ? "bad" : "muted"); };

  function celdaMoneda(v, { conSigno = false, titulo = "" } = {}) {
    const td = el("td", "num");
    td.append(d.monedaNodo(v));
    if (conSigno) signo(td, v);
    if (titulo) td.title = titulo;
    return td;
  }

  function fila(x) {
    const tr = el("tr");
    tr.dataset.id = x.id;
    tr.dataset.spell = x.spell;
    tr.tabIndex = 0;
    tr.setAttribute("aria-expanded", "false");
    tr.title = "Pulsa para ver los ingredientes y el cálculo";
    if (!x.completo) tr.classList.add("incompleta");
    if (x.neta != null && x.neta < 0) tr.classList.add("perdida");

    const tdObj = el("td", "c-fobj");
    const caja = el("span", "objeto");
    const nombre = d.nom(x.id, x.nombre);
    const txt = el("span", "objeto-txt");
    const sub = [x.receta !== x.nombre ? x.receta : null,
                 x.a.rendimiento.min !== x.a.rendimiento.max ? `da ${x.a.rendimiento.min}–${x.a.rendimiento.max}`
                   : x.a.rendimiento.min > 1 ? `da ${x.a.rendimiento.min}` : null].filter(Boolean).join(" · ");
    txt.append(el("span", "objeto-nombre" + (x.calidad ? ` q-${x.calidad}` : ""), nombre), el("span", "objeto-id", sub || `#${x.id}`));
    if (!x.completo) txt.firstChild.append(el("span", "marca-op", "Incompleta"));
    else if (x.materialesSinOfertas.length) txt.firstChild.append(el("span", "marca-op aviso-op", "Mat. sin ofertas"));
    caja.append(d.iconoNodo(x.icono, nombre, x.calidad), txt);
    tdObj.append(botonEstrella(x), caja);
    tdObj.title = [
      `#${x.id} · receta ${x.spell}`,
      ...x.a.materiales.map((m) => `${m.cantidadPorFabricacion} × ${d.nom(m.id, datos.objetos[m.id]?.n ?? `#${m.id}`)} (${m.origen ?? "sin precio"})`),
      ...x.a.avisos,
    ].join("\n");

    const tdProf = el("td", "c-prof", d.nombreProf(x.profesion));
    const tdNivel = el("td", "num c-nivel", x.nivel == null ? "—" : String(x.nivel));
    const tdVenta = celdaMoneda(x.precioVenta, {
      titulo: x.topeAplicado ? "Recortado al tope del valor de mercado" : x.ventaSinOfertas ? "Sin ofertas ahora: valor de mercado" : "",
    });
    if (x.topeAplicado || x.ventaSinOfertas) tdVenta.classList.add("cant-ref");
    const tdCoste = celdaMoneda(x.coste, { titulo: x.completo ? "" : "Falta el precio de: " + x.a.faltan.map((id) => d.nom(id, datos.objetos[id]?.n ?? `#${id}`)).join(", ") });
    const tdBruta = celdaMoneda(x.bruta, { conSigno: true });
    tdBruta.classList.add("c-bruta");
    const tdNeta = celdaMoneda(x.neta, { conSigno: true, titulo: x.a.comision == null ? "" : `Comisión ${op.comision} %: ${d.formatear(x.a.comision)} · depósito (se recupera): ${d.formatear(x.a.deposito)}` });
    tdNeta.classList.add("c-neta");
    const tdRoi = el("td", "num", pctTexto(x.roi)); signo(tdRoi, x.roi);
    const tdMargen = el("td", "num c-margen-n", pctTexto(x.margen)); signo(tdMargen, x.margen);
    const tdDisp = el("td", "num c-disp", x.disponible == null ? "—" : x.disponible.toLocaleString("es"));
    if (x.disponible != null && datos.cantidades) { tdDisp.classList.add("cant-ref"); tdDisp.title = `Según AHledger (${d.fecha(datos.cantidades.escaneo)})`; }
    const v = x.ventasDia ?? x.ventasRegion;
    const tdVentas = el("td", "num c-ventas", v == null ? "—" : v.toLocaleString("es", { maximumFractionDigits: 1 }));
    if (x.ventasDia == null && x.ventasRegion != null) { tdVentas.classList.add("cant-ref"); tdVentas.title = "Toda la región US (no solo este reino)"; }
    tr.append(tdObj, tdProf, tdNivel, tdVenta, tdCoste, tdBruta, tdNeta, tdRoi, tdMargen, tdDisp, tdVentas);
    return tr;
  }

  // ---------- desglose y calculadora de una receta (etapa 3) ----------
  // Simulación de la receta abierta: precios tuyos, precio de venta y número de fabricaciones.
  // Solo afecta al desglose; la tabla sigue con los precios del mercado.
  // ---------- historial de la receta abierta (etapa 5) ----------
  // {spell, dias, estado: "cargando"|"ok"|"error", serie, crudo, error}. Se conserva al recalcular el desglose.
  let hist = { spell: null, dias: 7, estado: null, serie: null, crudo: null, error: null };
  const PERIODOS = [[1, "24 h"], [7, "7 d"], [30, "30 d"], [90, "90 d"]];

  function opcionesMotor() {
    return { regla: { ...REGLA_POR_DEFECTO, comision_pct: op.comision }, valorSinOfertas: op.valorSinOfertas,
             fabricarIntermedios: op.fabricarIntermedios };
  }

  async function cargarHistorial(spell, dias) {
    const sub = subarbolReceta(datos, spell);
    if (!sub) return;
    hist = { spell, dias, estado: "cargando", serie: null, crudo: null, error: null };
    repintarHistorial();
    try {
      const url = `/api/recetas?historial=1&dias=${dias}&mercado=${encodeURIComponent(d.mercado())}&ids=${sub.ids.slice(0, 300).join(",")}`;
      const r = await fetch(url, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) throw new Error(j?.error ?? `HTTP ${r.status}`);
      if (hist.spell !== spell || hist.dias !== dias) return;   // se pidió otra cosa mientras tanto
      hist = { ...hist, estado: "ok", crudo: j, serie: serieHistorial(datos, spell, j, opcionesMotor()) };
    } catch (e) {
      if (hist.spell !== spell) return;
      hist = { ...hist, estado: "error", error: e.message.includes("historial_fabricacion")
        ? "falta aplicar la migración 0041" : e.message };
    }
    repintarHistorial();
  }

  function repintarHistorial() {
    const cont = $("fab-tbody").querySelector("tr.fab-desglose .d-hist");
    if (cont) pintarHistorial(cont, Number(cont.dataset.spell));
  }

  function bloqueHistorial(x) {
    const cont = el("section", "d-hist");
    cont.dataset.spell = x.spell;
    // Se dibuja cuando ya está en la página (los gráficos necesitan su ancho).
    setTimeout(() => pintarHistorial(cont, x.spell), 0);
    return cont;
  }

  function pintarHistorial(cont, spell) {
    const cab = el("div", "d-hist-cab");
    cab.append(el("h3", "", "Historial"));
    const grupo = el("div", "periodos");
    grupo.setAttribute("role", "group"); grupo.setAttribute("aria-label", "Periodo del historial");
    for (const [dias, txt] of PERIODOS) {
      const b = el("button", "btn-periodo", txt);
      b.type = "button"; b.dataset.histDias = dias;
      b.setAttribute("aria-pressed", String(hist.spell === spell && hist.dias === dias && hist.estado != null));
      grupo.append(b);
    }
    cab.append(grupo);
    const cuerpo = el("div", "d-hist-cuerpo");
    if (hist.spell !== spell || hist.estado == null) {
      cuerpo.append(el("p", "muted small", "Elige un periodo para ver cómo han cambiado el precio de venta, el coste de fabricación y la ganancia neta."));
    } else if (hist.estado === "cargando") {
      cuerpo.append(el("p", "muted small", "Cargando el historial…"));
    } else if (hist.estado === "error") {
      cuerpo.append(el("p", "bad small", "No se pudo cargar el historial: " + hist.error));
    } else {
      pintarSerie(cuerpo, hist.serie, hist.crudo);
    }
    cont.replaceChildren(cab, cuerpo);
  }

  function pintarSerie(cuerpo, s, crudo) {
    if (!s || s.escaneos < 2) {
      cuerpo.append(el("p", "muted small", "Todavía no hay historial suficiente en este periodo."));
      return;
    }
    const primero = crudo.primer_escaneo ? ` · el mercado tiene datos desde el ${d.fecha(crudo.primer_escaneo)}` : "";
    cuerpo.append(el("p", "muted small", `${s.escaneos} escaneos desde el ${d.fecha(new Date(s.desde).toISOString())}${primero}. `
      + "Cada punto usa los precios de ese escaneo y las mismas reglas que la tabla; tus precios simulados no se aplican."));

    // Resumen: actual, mínimo, máximo y media.
    const t = el("table", "tabla d-hist-tabla");
    const th = el("thead"), trh = el("tr");
    for (const [txt, c] of [["", ""], ["Actual", "num"], ["Mínimo", "num"], ["Máximo", "num"], ["Media", "num"]]) {
      const h = el("th", c, txt); h.scope = "col"; trh.append(h);
    }
    th.append(trh);
    const tb = el("tbody");
    for (const [nombre, r, moneda] of [["Precio de venta", s.venta, true], ["Coste de fabricación", s.coste, true],
                                       ["Ganancia neta", s.neta, true], ["Unidades a la venta", s.unidades, false]]) {
      if (!moneda && r.n === 0) continue;
      const tr = el("tr");
      tr.append(el("th", "", nombre));
      tr.firstChild.scope = "row";
      for (const v of [r.actual, r.min, r.max, r.media]) {
        const td = el("td", "num");
        if (moneda) { td.append(d.monedaNodo(v)); if (nombre === "Ganancia neta" && v != null) td.classList.add(v > 0 ? "ok" : v < 0 ? "bad" : "muted"); }
        else td.textContent = v == null ? "—" : v.toLocaleString("es");
        tr.append(td);
      }
      tb.append(tr);
    }
    t.append(th, tb);
    const envoltura = el("div", "tabla-wrap");
    envoltura.append(t);
    cuerpo.append(envoltura);

    const g1 = el("div", "d-hist-graf"), g2 = el("div", "d-hist-graf");
    cuerpo.append(el("h4", "small", "Precio de venta y coste de fabricación"), g1, el("h4", "small", "Ganancia neta"), g2);
    dibujarGrafico(g1, {
      puntos: s.puntos.map((p) => [p[0], p[1], p[2]]),
      nombres: ["Precio de venta", "Coste de fabricación"],
      cantidad: s.unidades.n ? s.puntos.map((p) => [p[0], p[4]]) : undefined,
    });
    dibujarGrafico(g2, { puntos: s.puntos.map((p) => [p[0], p[3], null]), nombres: ["Ganancia neta", null] });
  }

  $("fab-tbody").addEventListener("click", (ev) => {
    const b = ev.target.closest("tr.fab-desglose [data-hist-dias]");
    if (!b) return;
    const cont = b.closest(".d-hist");
    cargarHistorial(Number(cont.dataset.spell), Number(b.dataset.histDias));
  });

  let sim = { spell: null, fabricaciones: 1, manual: {}, precioVenta: undefined };
  const simDe = (spell) => (sim.spell === spell ? sim : (sim = { spell, fabricaciones: 1, manual: {}, precioVenta: undefined }));

  const nombreDe = (id, en) => d.nom(id, en);
  const cantTexto = (n) => (Number.isInteger(n) ? n.toLocaleString("es") : n.toLocaleString("es", { maximumFractionDigits: 2 }));
  /** Cobre → «12o 34p 56c» sin separador de miles (se puede volver a leer con parsearMoneda). */
  const monedaEditable = (c) => {
    if (c == null) return "";
    const o = Math.floor(c / 10000), p = Math.floor((c % 10000) / 100), co = c % 100;
    return [o ? `${o}o` : "", p ? `${p}p` : "", co || (!o && !p) ? `${co}c` : ""].filter(Boolean).join(" ");
  };

  function celdaObjeto(m, nivel = 0) {
    const td = el("td", "d-obj");
    td.style.paddingLeft = `${8 + nivel * 22}px`;
    const caja = el("span", "objeto");
    const nombre = nombreDe(m.id, m.nombre);
    caja.append(d.iconoNodo(m.icono, nombre, m.calidad), el("span", "objeto-nombre" + (m.calidad ? ` q-${m.calidad}` : ""),
      (nivel ? "↳ " : "") + nombre));
    td.append(caja);
    td.title = `#${m.id}` + (nombre !== m.nombre ? ` · ${m.nombre}` : "");
    return td;
  }
  function celdaOrigen(m) {
    const td = el("td", "d-origen");
    if (m.origen == null) { td.append(el("span", "bad", "Sin precio")); return td; }
    td.append(el("span", `origen o-${m.origen}`, NOMBRE_ORIGEN[m.origen] ?? m.origen));
    return td;
  }
  /** Campo de precio editable. `clave`: id del objeto o «venta». */
  function campoPrecio(valor, clave, manual, etiqueta) {
    const i = el("input", "d-precio" + (manual ? " d-manual" : ""));
    i.type = "text"; i.autocomplete = "off"; i.spellcheck = false;
    i.value = monedaEditable(valor);
    i.placeholder = "sin precio";
    i.dataset.precio = clave;
    i.setAttribute("aria-label", etiqueta);
    i.title = "Escribe otro precio para simular (12o 34p 56c, 50p, 300…). Vacío = precio del mercado.";
    return i;
  }
  function filaMaterial(m, nivel = 0) {
    const tr = el("tr", nivel ? "d-hijo" : "");
    const tdPrecio = el("td", "num");
    tdPrecio.append(campoPrecio(m.precioUnitario, String(m.id), m.origen === "manual", `Precio por unidad de ${nombreDe(m.id, m.nombre)}`));
    const tdCoste = el("td", "num d-coste"); tdCoste.append(d.monedaNodo(m.costeTotal));
    // Alternativas: comprar frente a fabricar (solo en los ingredientes directos).
    const tdAlt = el("td", "d-alt small");
    if (!nivel) {
      const partes = [];
      if (m.comprar != null) partes.push(`Comprar ${d.formatear(m.comprar)}`);
      if (m.fabricar != null) partes.push(`Fabricar ${d.formatear(m.fabricar)}`);
      tdAlt.textContent = partes.join(" · ") || "—";
      if (m.ahorroFabricando > 0) tdAlt.append(el("span", "ok", ` (ahorras ${d.formatear(m.ahorroFabricando)})`));
    }
    const tdDisp = el("td", "num", nivel || m.disponible == null ? "—" : m.disponible.toLocaleString("es"));
    if (!nivel && m.faltanEnSubasta > 0) {
      tdDisp.append(el("span", "bad d-falta", ` faltan ${m.faltanEnSubasta.toLocaleString("es")}`));
      tdDisp.title = "Hay menos unidades a la venta de las que necesitas";
    }
    tr.append(celdaObjeto(m, nivel), el("td", "num", cantTexto(m.cantidad)), tdPrecio, celdaOrigen(m), tdCoste, tdAlt, tdDisp);
    return [tr, ...(m.hijos ?? []).flatMap((h) => filaMaterial(h, nivel + 1))];
  }

  function filaDesglose(x) {
    const s = simDe(x.spell);
    const r = simularReceta(datos, x.spell, {
      regla: { ...REGLA_POR_DEFECTO, comision_pct: op.comision }, valorSinOfertas: op.valorSinOfertas,
      fabricarIntermedios: op.fabricarIntermedios, manual: s.manual, fabricaciones: s.fabricaciones, precioVenta: s.precioVenta,
    });
    const a = r.a, des = r.desglose;
    const tr = el("tr", "fab-desglose");
    const td = el("td");
    td.colSpan = COLUMNAS.length;
    const caja = el("div", "desglose");

    // Cabecera: cuántas veces, qué se produce y acciones.
    const rend = a.rendimiento.min === a.rendimiento.max ? `${a.rendimiento.min}` : `${a.rendimiento.min}–${a.rendimiento.max}, media ${cantTexto(a.rendimiento.medio)}`;
    const cab = el("div", "d-cab");
    const lblN = el("label", "d-veces");
    const n = el("input");
    n.type = "number"; n.min = "1"; n.max = "100000"; n.step = "1"; n.value = String(s.fabricaciones); n.dataset.fabricaciones = "1";
    lblN.append(el("span", "", "Fabricar"), n, el("span", "", s.fabricaciones === 1 ? "vez" : "veces"));
    const unidades = a.rendimiento.min === a.rendimiento.max ? cantTexto(a.unidadesProducidas) : `≈ ${cantTexto(a.unidadesProducidas)}`;
    cab.append(lblN, el("span", "muted small",
      `produce ${unidades} × ${nombreDe(x.id, x.nombre)} (${rend} por vez) · ${d.nombreProf(x.profesion)}${x.nivel != null ? ` ${x.nivel}` : ""} · receta ${x.spell}`));
    const acciones = el("span", "d-acciones");
    if (a.maxFabricable.veces != null && a.maxFabricable.veces > 0 && a.maxFabricable.veces !== s.fabricaciones) {
      const b = el("button", "btn btn-piedra btn-small", `Usar el máximo (${a.maxFabricable.veces.toLocaleString("es")})`);
      b.type = "button"; b.dataset.maximo = String(Math.min(a.maxFabricable.veces, 100000));
      acciones.append(b);
    }
    if (r.simulado) {
      const b = el("button", "btn btn-piedra btn-small", "Restablecer precios");
      b.type = "button"; b.dataset.restablecer = "1";
      acciones.append(b);
    }
    const ver = el("button", "btn btn-piedra btn-small", "Ver ficha del objeto");
    ver.type = "button"; ver.dataset.verObjeto = x.id;
    acciones.append(ver);
    cab.append(acciones);

    const avisoSim = el("p", "d-sim small", "Simulación con precios tuyos: la tabla de arriba sigue con los precios del mercado.");
    avisoSim.hidden = !r.simulado;

    // Tabla de ingredientes (precios editables).
    const tabla = el("table", "tabla d-tabla");
    const th = el("thead"), trh = el("tr");
    for (const [t, c] of [["Ingrediente", ""], ["Cantidad", "num"], ["Precio unidad", "num"], ["Precio de", ""], ["Coste", "num"],
                          ["Comprar o fabricar (por unidad)", ""], ["Disponible", "num"]]) {
      const h = el("th", c, t); h.scope = "col"; trh.append(h);
    }
    th.append(trh);
    const tb = el("tbody");
    tb.append(...des.materiales.flatMap((m) => filaMaterial(m)));
    const tf = el("tfoot"), trf = el("tr");
    const tdTot = el("td", "num d-coste"); tdTot.append(d.monedaNodo(a.costeFabricacion));
    const etq = el("td", "", a.completo ? "Coste de fabricación" : "Coste incompleto: pon un precio a lo que falta");
    etq.colSpan = 4;
    trf.append(etq, tdTot, el("td"), el("td"));
    tf.append(trf);
    tabla.append(th, tb, tf);
    const envoltura = el("div", "tabla-wrap");
    envoltura.append(tabla);

    // Resultado paso a paso.
    const res = el("dl", "d-res");
    const linea = (t, v, { signo: sg = false, nota = "", nodo = null } = {}) => {
      const dt = el("dt", "", t), dd = el("dd");
      if (nodo) dd.append(nodo);
      else if (typeof v === "string") dd.textContent = v;
      else dd.append(d.monedaNodo(v));
      if (sg && typeof v === "number") dd.classList.add(v > 0 ? "ok" : v < 0 ? "bad" : "muted");
      if (nota) dd.append(el("span", "muted small", ` ${nota}`));
      res.append(dt, dd);
    };
    const notaVenta = s.precioVenta !== undefined ? "(precio tuyo)" : x.topeAplicado ? "(recortado al tope del valor de mercado)"
      : x.ventaSinOfertas ? "(sin ofertas: valor de mercado)" : "(compra mínima)";
    linea("Precio de venta por unidad", null, {
      nodo: campoPrecio(a.precioVenta, "venta", s.precioVenta !== undefined, "Precio de venta por unidad"), nota: notaVenta });
    linea("Ingreso bruto", a.ingresoBruto, { nota: a.precioVenta == null ? "" : `= ${d.formatear(a.precioVenta)} × ${cantTexto(a.unidadesProducidas)}` });
    linea(`Comisión de subasta (${op.comision} %)`, a.comision == null ? null : -a.comision);
    linea("Coste de fabricación", a.costeFabricacion == null ? null : -a.costeFabricacion);
    linea("Ganancia bruta", a.gananciaBruta, { signo: true, nota: "(ingreso − coste)" });
    linea("Ganancia neta", a.gananciaNeta, { signo: true, nota: "(ingreso − comisión − coste)" });
    linea("ROI", pctTexto(a.roi));
    linea("Margen neto", pctTexto(a.margenNeto));
    if (a.rendimiento.min !== a.rendimiento.max) linea("Ganancia neta si sale el mínimo", a.gananciaNetaMinima, { signo: true });
    linea("Depósito al publicar", a.deposito, { nota: "(se recupera al vender; no se resta)" });
    linea("Precio mínimo para no perder", a.precioEquilibrio, { nota: "por unidad" });
    const mf = a.maxFabricable;
    linea("Máximo fabricable con el stock", mf.ilimitado ? "Sin límite (materiales del NPC o fabricados)"
      : mf.veces == null ? "Desconocido (la fuente no publica cantidades de algún material)"
      : `${mf.veces.toLocaleString("es")} veces` + (mf.limitante ? ` (limita ${nombreDe(mf.limitante, datos.objetos[mf.limitante]?.n ?? `#${mf.limitante}`)})` : ""));

    const avisos = el("ul", "d-avisos small muted");
    if (!op.fabricarIntermedios) avisos.append(el("li", "", "«Fabricar materiales intermedios» está desactivado: todos los ingredientes se compran y no se compara con fabricarlos."));
    if (!op.valorSinOfertas) avisos.append(el("li", "", "«Valor de mercado si no hay ofertas» está desactivado: un ingrediente sin ofertas ahora deja la receta incompleta."));
    if (s.fabricaciones > 1 && des.materiales.some((m) => m.origen === "subasta")) {
      avisos.append(el("li", "", "Con varias fabricaciones se usa la compra mínima para todas las unidades. Las siguientes ofertas pueden ser más caras: la fuente no publica cuántas hay a cada precio."));
    }
    for (const t of a.avisos) avisos.append(el("li", "", t));
    caja.append(cab, bloqueExtrasReceta(x), avisoSim, envoltura, res, avisos, bloqueHistorial(x));
    td.append(caja);
    tr.append(td);
    return tr;
  }

  /** Vuelve a dibujar el desglose abierto (tras un cambio de la simulación) y devuelve el foco. */
  function repintarDesglose(foco) {
    const viejo = $("fab-tbody").querySelector("tr.fab-desglose");
    const x = filas.find((r) => r.spell === abierta);
    if (!viejo || !x) return;
    viejo.replaceWith(filaDesglose(x));
    if (foco) $("fab-tbody").querySelector(`tr.fab-desglose ${foco}`)?.focus();
  }

  function aplicarCampo(i) {
    const s = simDe(abierta);
    if (i.dataset.fabricaciones) {
      const n = Math.round(Number(i.value));
      if (!Number.isInteger(n) || n < 1 || n > 100000) {
        d.avisar("Fabricaciones: un número entero de 1 a 100.000.", "bad"); i.value = String(s.fabricaciones); return;
      }
      if (n === s.fabricaciones) return;
      s.fabricaciones = n;
      repintarDesglose("[data-fabricaciones]");
      return;
    }
    const clave = i.dataset.precio;
    if (!clave) return;
    let v;
    try { v = i.value.trim() === "" ? null : parsearMoneda(i.value); }
    catch (e) { d.avisar(e.message, "bad"); i.setAttribute("aria-invalid", "true"); return; }
    if (clave === "venta") s.precioVenta = v == null ? undefined : v;
    else if (v == null) delete s.manual[clave];
    else s.manual[clave] = v;
    repintarDesglose(`[data-precio="${clave}"]`);
  }
  $("fab-tbody").addEventListener("change", (ev) => {
    if (ev.target.matches("tr.fab-desglose input")) aplicarCampo(ev.target);
  });
  $("fab-tbody").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && ev.target.matches("tr.fab-desglose input")) { ev.preventDefault(); aplicarCampo(ev.target); }
  });
  $("fab-tbody").addEventListener("click", (ev) => {
    const b = ev.target.closest("tr.fab-desglose [data-maximo], tr.fab-desglose [data-restablecer]");
    if (!b) return;
    const s = simDe(abierta);
    if (b.dataset.maximo) s.fabricaciones = Number(b.dataset.maximo);
    else { s.manual = {}; s.precioVenta = undefined; }
    repintarDesglose(b.dataset.maximo ? "[data-fabricaciones]" : null);
  });

  // ---------- «Mejores oportunidades» (etapa 4) ----------
  const LISTAS = [
    ["equilibrio", "Mejor equilibrio", "Ganancia por unidad × ventas al día (hasta 10), a la mitad si hay algún riesgo. Lo más sensato para empezar."],
    ["ganancia", "Mayor ganancia neta", "Más oro por fabricación entre las que se venden y tienen un precio creíble."],
    ["roi", "Mayor rentabilidad (ROI)", "Más oro por cada oro invertido, con al menos 1 plata de ganancia por unidad."],
    ["demanda", "Buena demanda y poca competencia", "Se venden 1 o más al día y lo publicado se vende en 1 día o menos."],
    ["materialesBaratos", "Materiales baratos ahora", `Sus ingredientes cuestan al menos un ${UMBRAL.descuentoMateriales} % menos que con sus precios históricos.`],
    ["perdidas", "No conviene fabricar", "Se venden, pero ahora mismo fabricarlas cuesta más de lo que se saca."],
    ["descartadas", "Descartadas por riesgo", "Ganancia teórica alta, pero no se venden o su precio es sospechoso. Revísalas a mano antes de fabricar."],
  ];

  function chip(tipo, nivel, motivo) {
    const c = el("span", `chip-ind ind-${tipo} n-${nivel}`, `${{ demanda: "Demanda", competencia: "Competencia", riesgo: "Riesgo" }[tipo]}: ${NIVEL_TEXTO[nivel] ?? nivel}`);
    if (motivo) c.title = motivo;
    return c;
  }

  function itemOportunidad(x, clave) {
    const li = el("li", "op-item");
    const b = el("button", "op-boton");
    b.type = "button"; b.dataset.abrirReceta = x.spell;
    b.title = "Abrir la receta con su desglose";
    const nombre = d.nom(x.id, x.nombre);
    const cab = el("span", "op-cab");
    cab.append(d.iconoNodo(x.icono, nombre, x.calidad),
      el("span", "op-nombre" + (x.calidad ? ` q-${x.calidad}` : ""), nombre),
      el("span", "op-prof muted small", d.nombreProf(x.profesion)));
    const cifras = el("span", "op-cifras small");
    const neta = el("span", x.neta >= 0 ? "ok" : "bad"); neta.append(d.monedaNodo(x.neta));
    cifras.append(el("span", "muted", "Neta "), neta, el("span", "muted", ` · ROI ${pctTexto(x.roi)}`));
    const i = x.i;
    if (i.ventas != null) cifras.append(el("span", "muted", ` · ${i.ventas.toLocaleString("es", { maximumFractionDigits: 1 })}/día${i.regional ? " (región)" : ""}`));
    if (clave === "equilibrio" && i.techoDia != null) {
      const t = el("span", "muted", " · techo "); t.append(d.monedaNodo(Math.round(i.techoDia)), document.createTextNode("/día"));
      t.title = "Si vendieras tú todas las ventas estimadas del día";
      cifras.append(t);
    }
    if (clave === "materialesBaratos" && i.descuentoMateriales != null) cifras.append(el("span", "ok", ` · materiales −${Math.round(i.descuentoMateriales)} %`));
    const chips = el("span", "op-chips");
    chips.append(chip("demanda", i.demanda, i.ventas == null ? "Sin datos de ventas" : `${i.ventas} ventas/día${i.regional ? " en toda la región US" : ""}`),
      chip("competencia", i.competencia, i.dias != null ? `${x.disponible} a la venta ≈ ${i.dias.toLocaleString("es", { maximumFractionDigits: 1 })} días de ventas` : ""),
      chip("riesgo", i.riesgo, i.motivosRiesgo.join("\n") || "Sin riesgos detectados"));
    b.append(cab, cifras, chips);
    if (clave === "descartadas" || i.motivosRiesgo.length) {
      b.append(el("span", "op-motivo small muted", (i.motivosSospecha.length ? i.motivosSospecha : i.motivosRiesgo).join(" · ")));
    }
    li.append(b);
    return li;
  }

  function pintarOportunidades() {
    const o = oportunidades(filas, datos.objetos, { profesiones: f.profesiones, limite: 10 });
    const r = o.resumen;
    $("fab-contador").textContent = `${r.recomendables.toLocaleString("es")} recomendables de ${r.conGanancia.toLocaleString("es")} con ganancia teórica`;
    const cont = $("fab-oport");
    const intro = el("p", "op-intro small muted",
      `De ${r.recetas.toLocaleString("es")} recetas con todos los precios${f.profesiones.length ? " (profesiones elegidas)" : ""}, `
      + `${r.conGanancia.toLocaleString("es")} ganan en teoría. Se descartan ${r.sinDemanda.toLocaleString("es")} que no se venden `
      + `y ${r.sospechosas.toLocaleString("es")} con precio sospechoso. Pasa el ratón por los indicadores para ver el motivo; pulsa una receta para ver su desglose.`);
    const nodos = [intro];
    for (const [clave, titulo, texto] of LISTAS) {
      const lista = o[clave];
      const sec = el("section", `op-lista op-${clave}`);
      sec.append(el("h2", "", titulo), el("p", "small muted", texto));
      if (!lista.length) sec.append(el("p", "small muted op-vacia", "Ninguna con los datos actuales."));
      else {
        const ol = el("ol", "op-items");
        ol.append(...lista.map((x) => itemOportunidad(x, clave)));
        sec.append(ol);
      }
      nodos.push(sec);
    }
    const como = el("details", "op-como small");
    como.append(el("summary", "", "Cómo se calcula"),
      el("p", "", `Demanda: alta con ${UMBRAL.demandaAlta} o más ventas al día, media con ${UMBRAL.demandaMedia} o más, baja por debajo. Son estimaciones: AHledger (este reino) deduce las ventas de anuncios que desaparecen; TSM (toda la región US) usa ventas que suben los jugadores.`),
      el("p", "", `Competencia: unidades a la venta ÷ ventas al día. Baja si se vende en ${UMBRAL.competenciaBaja} día o menos, media hasta ${UMBRAL.competenciaMedia}, alta por encima.`),
      el("p", "", `Precio sospechoso: más de ${UMBRAL.sospechaHistorico} veces su histórico; sin histórico, más de ${UMBRAL.sospechaNpc} veces lo que paga el NPC (y más de 1 oro); o un anuncio por encima del tope del valor de mercado.`),
      el("p", "", "Riesgo alto: sin ventas o precio sospechoso (no se recomienda). Medio: se vende poco, mucha competencia, sin ofertas ahora, el rendimiento mínimo pierde o la receta tiene tiempo de espera (transmutaciones y Mooncloth en Classic; sin verificar en Forever)."));
    nodos.push(como);
    cont.replaceChildren(...nodos);
  }
  $("fab-oport").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-abrir-receta]");
    if (b) vistaAbrirReceta(Number(b.dataset.abrirReceta));
  });

  /** Abre una receta concreta en la tabla, con su desglose (desde «Mejores oportunidades»). */
  function vistaAbrirReceta(spell) {
    const x = filas.find((r) => r.spell === spell);
    if (!x) return;
    f.texto = String(spell); $("fab-texto").value = String(spell); pagina = 1; abierta = spell;
    // Que los filtros de la tabla no escondan justo la receta elegida.
    if (!filtrarFilas([x], f, nombreEs).length || (f.soloFavoritas && !esFavorita(spell))) {
      Object.assign(f, { roiMin: null, netaMin: null, nivelMin: null, nivelMax: null, soloCompletas: false, soloRentables: false,
                         soloConVenta: false, soloMaterialesEnVenta: false, soloConVentas: false, soloFavoritas: false });
      for (const id of ["fab-roi", "fab-neta", "fab-nivel-min", "fab-nivel-max"]) $(id).value = "";
      for (const k of casillas) $(`fab-${k}`).checked = false;
      guardar();
    }
    if (location.hash !== "#/fabricacion") location.hash = "#/fabricacion"; else pintar();
    setTimeout(() => $("fab-tbody").querySelector(`tr[data-spell="${spell}"]`)?.scrollIntoView({ block: "start" }), 50);
  }

  // ---------- etapa 6: favoritas, comparador y alertas (guardado en este navegador) ----------
  const CLAVE_EXTRAS = "mw_fabricacion_extras";
  let extras = normalizarExtras(d.local.leer(CLAVE_EXTRAS, null));
  let verComparacion = false;
  const guardarExtras = () => d.local.escribir(CLAVE_EXTRAS, extras);
  const esFavorita = (spell) => extras.favoritas.includes(spell);
  /** Filas que pasan los filtros de la tabla (incluido «Solo favoritas»). */
  const filtradas = () => filtrarFilas(f.soloFavoritas ? filas.filter((x) => esFavorita(x.spell)) : filas, f, nombreEs);
  const nombreReceta = (x) => d.nom(x.id, x.nombre) + (x.receta !== x.nombre ? ` (${x.receta})` : "");
  const valorAlerta = (campo, v) => (campo === "neta" ? d.formatear(v) : `${v.toLocaleString("es")} %`);

  function botonEstrella(x) {
    const b = el("button", "estrella-fab");
    b.type = "button"; b.dataset.fav = x.spell;
    const fav = esFavorita(x.spell);
    b.setAttribute("aria-pressed", String(fav));
    b.setAttribute("aria-label", fav ? "Quitar de favoritas" : "Marcar como favorita");
    b.title = fav ? "Quitar de favoritas" : "Marcar como favorita";
    b.textContent = fav ? "★" : "☆";
    return b;
  }

  function alternarFavorita(spell) {
    extras.favoritas = alternarSpell(extras.favoritas, spell);
    guardarExtras();
    for (const b of document.querySelectorAll(`[data-fav="${spell}"]`)) b.replaceWith(botonEstrella(filas.find((x) => x.spell === spell)));
    if (f.soloFavoritas) pintar();
  }

  function alternarComparar(spell) {
    if (extras.comparar.includes(spell)) extras.comparar = extras.comparar.filter((s) => s !== spell);
    else {
      const r = anadirComparar(extras.comparar, spell);
      if (r.error) { d.avisar(r.error, "bad"); return; }
      extras.comparar = r.lista;
    }
    guardarExtras();
    pintarComparar();
    repintarDesglose(null);
  }

  // Barra del comparador y tabla lado a lado.
  function pintarComparar() {
    const cont = $("fab-comparar");
    const c = compararRecetas(filas, extras.comparar, datos?.objetos ?? {});
    cont.hidden = c.recetas.length === 0;
    if (cont.hidden) { cont.replaceChildren(); return; }
    const barra = el("div", "cmp-barra");
    barra.append(el("strong", "", `Comparador (${c.recetas.length}/${MAX_COMPARAR})`));
    for (const x of c.recetas) {
      const ch = el("span", "cmp-chip");
      const q = el("button", "cmp-quitar", "✕");
      q.type = "button"; q.dataset.quitarComparar = x.spell; q.setAttribute("aria-label", `Quitar ${nombreReceta(x)} del comparador`);
      ch.append(el("span", "", d.nom(x.id, x.nombre)), q);
      barra.append(ch);
    }
    const ver = el("button", "btn btn-piedra btn-small", verComparacion ? "Ocultar comparación" : "Ver comparación");
    ver.type = "button"; ver.dataset.verComparacion = "1";
    ver.disabled = c.recetas.length < 2 && !verComparacion;
    if (c.recetas.length < 2) ver.title = "Añade al menos 2 recetas desde su desglose";
    const vaciar = el("button", "btn btn-piedra btn-small", "Vaciar");
    vaciar.type = "button"; vaciar.dataset.vaciarComparador = "1";
    barra.append(ver, vaciar);
    const nodos = [barra];
    if (verComparacion && c.recetas.length) {
      const t = el("table", "tabla cmp-tabla");
      const th = el("thead"), trh = el("tr");
      trh.append(el("th", "", ""));
      for (const x of c.recetas) {
        const h = el("th", "cmp-col");
        h.scope = "col";
        const b = el("button", "op-boton cmp-receta");
        b.type = "button"; b.dataset.abrirReceta = x.spell;
        b.append(d.iconoNodo(x.icono, d.nom(x.id, x.nombre), x.calidad), el("span", "", d.nom(x.id, x.nombre)),
          el("span", "muted small", d.nombreProf(x.profesion)));
        h.append(b);
        trh.append(h);
      }
      th.append(trh);
      const tb = el("tbody");
      for (const m of c.metricas) {
        const tr = el("tr");
        const n = el("th", "", m.nombre); n.scope = "row";
        tr.append(n);
        m.valores.forEach((v, k) => {
          const td = el("td", "num" + (m.mejores[k] ? " cmp-mejor" : ""));
          if (m.tipo === "moneda") td.append(d.monedaNodo(v));
          else if (m.tipo === "pct") td.textContent = pctTexto(v);
          else td.textContent = v == null ? "—" : v.toLocaleString("es", { maximumFractionDigits: 1 });
          if (m.mejores[k]) td.title = "La mejor de las comparadas";
          tr.append(td);
        });
        tb.append(tr);
      }
      const trR = el("tr"); const nR = el("th", "", "Riesgo"); nR.scope = "row"; trR.append(nR);
      for (const x of c.recetas) {
        const td = el("td");
        td.append(chip("riesgo", x.i.riesgo, x.i.motivosRiesgo.join("\n") || "Sin riesgos detectados"));
        trR.append(td);
      }
      tb.append(trR);
      t.append(th, tb);
      const env = el("div", "tabla-wrap");
      env.append(t);
      nodos.push(env);
    }
    cont.replaceChildren(...nodos);
  }
  $("fab-comparar").addEventListener("click", (ev) => {
    const q = ev.target.closest("[data-quitar-comparar]");
    if (q) { alternarComparar(Number(q.dataset.quitarComparar)); return; }
    if (ev.target.closest("[data-ver-comparacion]")) { verComparacion = !verComparacion; pintarComparar(); return; }
    if (ev.target.closest("[data-vaciar-comparador]")) { extras.comparar = []; verComparacion = false; guardarExtras(); pintarComparar(); repintarDesglose(null); return; }
    const a = ev.target.closest("[data-abrir-receta]");
    if (a) vistaAbrirReceta(Number(a.dataset.abrirReceta));
  });

  // Alertas: texto, evaluación y configuración.
  function textoAlerta(a) {
    const cond = `${CAMPOS_ALERTA[a.campo]} ≥ ${valorAlerta(a.campo, a.umbral)}`;
    if (a.tipo === "receta") {
      const x = filas.find((r) => r.spell === a.spell);
      return `${x ? nombreReceta(x) : `Receta ${a.spell}`}: ${cond}`;
    }
    const profs = a.profesiones?.length ? ` de ${a.profesiones.map(d.nombreProf).join(", ")}` : "";
    return `Cualquier receta${profs} con ${cond} (que se venda y con precio creíble)`;
  }

  function pintarAlertas() {
    const cumplidas = datos ? evaluarAlertas(filas, extras.alertas, datos.objetos) : [];
    const aviso = $("fab-alertas-cumplidas");
    aviso.hidden = cumplidas.length === 0;
    if (cumplidas.length) {
      const nodos = [el("strong", "", `🔔 ${cumplidas.length === 1 ? "Se cumple 1 alerta" : `Se cumplen ${cumplidas.length} alertas`} de fabricación`)];
      const ul = el("ul");
      for (const c of cumplidas) {
        const li = el("li");
        li.append(el("span", "", textoAlerta(c.alerta) + ": "));
        c.recetas.slice(0, 5).forEach((x, k) => {
          const b = el("button", "enlace", d.nom(x.id, x.nombre));
          b.type = "button"; b.dataset.abrirReceta = x.spell;
          b.title = `${CAMPOS_ALERTA[c.alerta.campo]}: ${c.alerta.campo === "neta" ? d.formatear(x.neta) : pctTexto(x.roi)}`;
          if (k) li.append(document.createTextNode(", "));
          li.append(b);
        });
        if (c.recetas.length > 5) li.append(el("span", "muted", ` y ${c.recetas.length - 5} más`));
        ul.append(li);
      }
      nodos.push(ul);
      aviso.replaceChildren(...nodos);
    }
    // Lista de alertas configuradas.
    const lista = $("fab-alertas-lista");
    lista.replaceChildren(...(extras.alertas.length ? extras.alertas.map((a) => {
      const li = el("li");
      const cumple = cumplidas.some((c) => c.alerta.id === a.id);
      li.append(el("span", cumple ? "ok" : "", (cumple ? "● " : "○ ") + textoAlerta(a)));
      const b = el("button", "btn btn-piedra btn-small", "Borrar");
      b.type = "button"; b.dataset.borrarAlerta = a.id;
      li.append(b);
      return li;
    }) : [el("li", "muted", "No tienes alertas de fabricación.")]));
    $("fab-alertas-n").textContent = extras.alertas.length ? ` (${extras.alertas.length})` : "";
  }

  function nuevaAlerta(datosAlerta) {
    try { extras.alertas = crearAlerta(extras.alertas, datosAlerta); }
    catch (e) { d.avisar(e.message, "bad"); return false; }
    guardarExtras(); pintarAlertas();
    d.avisar("Alerta creada. Se revisa cada vez que se cargan precios nuevos con esta página abierta.");
    return true;
  }

  function leerUmbral(campo, texto) {
    if (campo === "neta") return parsearMoneda(texto);
    const n = Number(String(texto).replace(",", ".").replace("%", "").trim());
    if (!Number.isFinite(n)) throw new Error("El ROI debe ser un número (por ejemplo, 50)");
    return n;
  }

  $("fab-alerta-crear").addEventListener("click", () => {
    const campo = $("fab-alerta-campo").value;
    let umbral;
    try { umbral = leerUmbral(campo, $("fab-alerta-umbral").value); }
    catch (e) { d.avisar(e.message, "bad"); return; }
    if (umbral == null) { d.avisar("Pon un umbral", "bad"); return; }
    const profesiones = $("fab-alerta-mias").checked ? [...f.profesiones] : [];
    if (nuevaAlerta({ tipo: "general", campo, umbral, profesiones })) $("fab-alerta-umbral").value = "";
  });
  $("fab-alertas-lista").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-borrar-alerta]");
    if (!b) return;
    extras.alertas = extras.alertas.filter((a) => a.id !== b.dataset.borrarAlerta);
    guardarExtras(); pintarAlertas();
  });
  $("fab-alertas-cumplidas").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-abrir-receta]");
    if (b) vistaAbrirReceta(Number(b.dataset.abrirReceta));
  });

  /** En el desglose: comparar y crear una alerta para esta receta. */
  function bloqueExtrasReceta(x) {
    const cont = el("div", "d-extras");
    const enCmp = extras.comparar.includes(x.spell);
    const cmp = el("button", "btn btn-piedra btn-small", enCmp ? "Quitar del comparador" : "Añadir al comparador");
    cmp.type = "button"; cmp.dataset.comparar = x.spell;
    const fav = el("button", "btn btn-piedra btn-small", esFavorita(x.spell) ? "★ Favorita" : "☆ Marcar favorita");
    fav.type = "button"; fav.dataset.fav = x.spell;
    const form = el("span", "d-alerta");
    const sel = el("select");
    sel.dataset.alertaCampo = "1";
    for (const [v, t] of Object.entries(CAMPOS_ALERTA)) { const o = el("option", "", t); o.value = v; sel.append(o); }
    const inp = el("input");
    inp.type = "text"; inp.placeholder = "p. ej. 1o o 50"; inp.dataset.alertaUmbral = "1";
    inp.setAttribute("aria-label", "Umbral de la alerta");
    const crear = el("button", "btn btn-piedra btn-small", "Crear alerta");
    crear.type = "button"; crear.dataset.alertaReceta = x.spell;
    form.append(el("span", "small muted", "Avísame si"), sel, el("span", "small muted", "≥"), inp, crear);
    cont.append(fav, cmp, form);
    return cont;
  }
  $("fab-tbody").addEventListener("click", (ev) => {
    const fav = ev.target.closest("[data-fav]");
    if (fav) { ev.stopPropagation(); alternarFavorita(Number(fav.dataset.fav)); repintarDesglose(null); return; }
    const cmp = ev.target.closest("tr.fab-desglose [data-comparar]");
    if (cmp) { alternarComparar(Number(cmp.dataset.comparar)); return; }
    const al = ev.target.closest("tr.fab-desglose [data-alerta-receta]");
    if (al) {
      const caja = al.closest(".d-alerta");
      const campo = caja.querySelector("[data-alerta-campo]").value;
      let umbral;
      try { umbral = leerUmbral(campo, caja.querySelector("[data-alerta-umbral]").value); }
      catch (e) { d.avisar(e.message, "bad"); return; }
      if (umbral == null) { d.avisar("Pon un umbral", "bad"); return; }
      nuevaAlerta({ tipo: "receta", spell: Number(al.dataset.alertaReceta), campo, umbral });
    }
  }, true);

  function pintar() {
    for (const th of trCab.children) {
      const c = th.querySelector("[data-orden]").dataset.orden;
      th.setAttribute("aria-sort", c === orden.clave ? (orden.dir === "asc" ? "ascending" : "descending") : "none");
    }
    if (!datos) return;
    const est = $("fab-estado");
    est.className = "muted small";
    est.textContent = datos.escaneo
      ? `Precios del escaneo del ${d.fecha(datos.escaneo)} (${d.hace(datos.escaneo)})` + (datos.demo ? " · DATOS FICTICIOS" : "")
      : "Este mercado aún no tiene escaneos: no hay precios.";
    if (modo === "oportunidades") { pintarOportunidades(); return; }
    pintarComparar();
    const lista = ordenarFilas(filtradas(), orden.clave, orden.dir);
    const total = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
    pagina = Math.min(Math.max(1, pagina), total);
    const desde = (pagina - 1) * POR_PAGINA;
    const visibles = lista.slice(desde, desde + POR_PAGINA);
    $("fab-tbody").replaceChildren(...visibles.flatMap((x) => {
      const tr = fila(x);
      if (x.spell !== abierta) return [tr];
      tr.setAttribute("aria-expanded", "true");
      return [tr, filaDesglose(x)];   // el desglose abierto sigue abierto al reordenar o recalcular
    }));
    const rentables = lista.filter((x) => x.neta > 0).length;
    $("fab-contador").textContent = `${lista.length.toLocaleString("es")} de ${filas.length.toLocaleString("es")} recetas · ${rentables.toLocaleString("es")} con ganancia`;
    $("fab-vacio").hidden = lista.length > 0;
    $("fab-paginador").hidden = total <= 1;
    $("fab-pag-txt").textContent = `Página ${pagina} de ${total}`;
    $("fab-pag-ant").disabled = pagina <= 1;
    $("fab-pag-sig").disabled = pagina >= total;
  }

  return {
    /** Muestra la vista y carga los datos del mercado actual si hace falta. */
    mostrar(m = "tabla") {
      modo = m;
      const oport = m === "oportunidades";
      $("vista-fabricacion").classList.toggle("modo-oport", oport);
      $("fab-oport").hidden = !oport;
      $("titulo-fabricacion").textContent = oport ? "Mejores oportunidades" : "Fabricación";
      for (const [id, activo] of [["modo-tabla", !oport], ["modo-oport", oport]]) {
        if (activo) $(id).setAttribute("aria-current", "page"); else $(id).removeAttribute("aria-current");
      }
      if (datos && datosMercado === d.mercado()) pintar();
      return cargar();
    },
    abrirReceta: (spell) => vistaAbrirReceta(spell),
    /** Hay escaneo nuevo o se cambió de mercado: vuelve a pedir los datos. */
    refrescar: () => cargar({ forzar: true }),
    /** Hay datos nuevos pero la vista no se ve: se pedirán al volver a ella. */
    invalidar: () => { datosMercado = null; },
    /** Buscador de arriba en esta sección: filtra por texto. */
    buscarTexto(texto) {
      if (modo !== "tabla") location.hash = "#/fabricacion";
      f.texto = texto; $("fab-texto").value = texto; pagina = 1; pintar();
    },
    /**
     * Buscador de arriba con un objeto elegido: muestra sus recetas y despliega el desglose si solo
     * hay una. Si nadie lo fabrica, muestra las recetas que lo usan como ingrediente.
     */
    async buscarObjeto(id) {
      if (modo !== "tabla") location.hash = "#/fabricacion";
      await cargar();
      f.texto = String(id); $("fab-texto").value = String(id); pagina = 1;
      const suyas = filas.filter((x) => x.id === id);
      abierta = suyas.length === 1 ? suyas[0].spell : null;
      // Que los filtros activos no escondan justo lo que se buscó.
      const ocultas = suyas.length && (!filtrarFilas(suyas, f, nombreEs).length || (f.soloFavoritas && !suyas.some((x) => esFavorita(x.spell))));
      if (ocultas) {
        Object.assign(f, { profesiones: [], roiMin: null, netaMin: null, nivelMin: null, nivelMax: null, soloCompletas: false,
                           soloRentables: false, soloConVenta: false, soloMaterialesEnVenta: false, soloConVentas: false, soloFavoritas: false });
        for (const id2 of ["fab-roi", "fab-neta", "fab-nivel-min", "fab-nivel-max"]) $(id2).value = "";
        for (const k of casillas) $(`fab-${k}`).checked = false;
        guardar(); pintarProfesiones();
        d.avisar("Se quitaron los filtros para mostrar la receta buscada.");
      }
      pintar();
      if (!suyas.length) d.avisar("Ninguna receta fabrica este objeto: se muestran las que lo usan como ingrediente.");
      const tr = $("fab-tbody").querySelector(abierta != null ? `tr[data-spell="${abierta}"]` : "tr[data-spell]");
      tr?.scrollIntoView({ block: "start", behavior: "smooth" });
    },
  };
}
