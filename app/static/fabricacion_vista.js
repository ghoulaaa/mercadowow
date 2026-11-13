// Vista «Fabricación» (rediseño V2): pestañas Recetas y Oportunidades, filtros agrupados, tabla comparable,
// tarjetas por criterio, detalle de receta en un panel lateral y lista de fabricación.
// Los cálculos NO están aquí: calcularFilas/simularReceta (fabricacion_tabla.js), oportunidades() e
// indicadores (oportunidades.js) y la presentación sin DOM (fabricacion_ui.js), todo probado en Node.

import { filasACsv, filtrarFilas, ordenarFilas, simularReceta, calcularFilas, NOMBRE_ORIGEN } from "./fabricacion_tabla.js";
import { REGLA_POR_DEFECTO } from "./fabricacion.js";
import { parsearMoneda } from "./moneda.js";
import { NIVEL_TEXTO, UMBRAL, indicadores, oportunidades } from "./oportunidades.js";
import { serieHistorial, subarbolReceta } from "./fabricacion_historial.js";
import { dibujarGrafico } from "./grafico.js";
import {
  CAMPOS_ALERTA, MAX_COMPARAR, alternar as alternarSpell, anadirComparar, compararRecetas, crearAlerta, evaluarAlertas, normalizarExtras,
} from "./fabricacion_extras.js";
import {
  COLUMNAS_FAB, CRITERIOS, FILTROS_VACIOS, actividad, agruparPorProducto, anadirALista, chipsFiltros, consolidarLista,
  contarFiltrosPanel, diferenciasVariantes, etiquetaRiesgo, limpiarFiltros, motivosReferencia, motivosRevision,
  normalizarColumnas, normalizarLista, quitarFiltro, textoMateriales,
} from "./fabricacion_ui.js";

const POR_PAGINA = 50;
const CLAVE_LOCAL = "mw_fabricacion1";
const CLAVE_EXTRAS = "mw_fabricacion_extras";
const CLAVE_LISTA = "mw_fabricacion_lista";
const CASILLAS = ["soloCompletas", "soloRentables", "soloConVenta", "soloMaterialesEnVenta", "soloConVentas", "soloFavoritas"];
const HORAS_VIEJO = 8;

/**
 * @param {object} d  utilidades de app.js: {$, el, monedaNodo, iconoNodo, nom, nombreProf, fecha, hace, local, avisar,
 *                    abrirObjeto, mercado: () => clave, formatear, copiarTexto, ponerDensidad, iconoProfesion}
 */
export function crearVistaFabricacion(d) {
  const { $, el } = d;
  const guardado = d.local.leer(CLAVE_LOCAL, {}) ?? {};
  // Filtros: lo guardado o, la primera vez, solo las recetas con todos los precios (como antes).
  const f = { ...FILTROS_VACIOS, soloCompletas: true, ...(guardado.filtros ?? {}),
              profesiones: Array.isArray(guardado.profesiones) ? guardado.profesiones : [], texto: "" };
  const op = { valorSinOfertas: true, fabricarIntermedios: true, comision: 5, ...(guardado.opciones ?? {}) };
  let orden = guardado.orden ?? { clave: "neta", dir: "desc" };
  let criterio = Object.hasOwn(CRITERIOS, guardado.criterio) ? guardado.criterio : "equilibrio";
  let columnas = normalizarColumnas(guardado.columnas);
  let datos = null, datosMercado = null, filas = [], pagina = 1, cargando = null, error = null;
  let modo = "tabla";
  const abiertos = new Set();   // productos con sus variantes desplegadas
  let congelado = null;         // orden de grupos a la vista mientras llegan precios nuevos
  const nombreEs = (id) => d.nom(id, null);
  const nombreObj = (id, en) => d.nom(id, en ?? datos?.objetos?.[id]?.n ?? `#${id}`);

  const guardar = () => d.local.escribir(CLAVE_LOCAL, {
    profesiones: f.profesiones, orden, opciones: op, criterio, columnas,
    filtros: Object.fromEntries(["roiMin", "netaMin", "nivelMin", "nivelMax", ...CASILLAS].map((k) => [k, f[k]])),
  });

  let extras = normalizarExtras(d.local.leer(CLAVE_EXTRAS, null));
  const guardarExtras = () => d.local.escribir(CLAVE_EXTRAS, extras);
  const esFavorita = (spell) => extras.favoritas.includes(spell);
  let lista = normalizarLista(d.local.leer(CLAVE_LISTA, null));
  const deshacer = [];   // estados anteriores de la lista (para «Deshacer»)

  // ---------- utilidades de pintado ----------
  const pct = (v) => (v == null ? null : `${v.toLocaleString("es", { maximumFractionDigits: v !== 0 && Math.abs(v) < 10 ? 1 : 0 })} %`);
  const cant = (n) => (Number.isInteger(n) ? n.toLocaleString("es") : n.toLocaleString("es", { maximumFractionDigits: 2 }));
  /** «Sin datos» explícito (nunca un 0), con su motivo para lectores de pantalla y al pasar el ratón. */
  function sinDato(texto = "Sin datos", motivo = "") {
    const s = el("span", "sin-dato", texto);
    if (motivo) { s.title = motivo; s.setAttribute("aria-label", `${texto}: ${motivo}`); }
    return s;
  }
  function moneda(v, { signo = false } = {}) {
    if (v == null) return sinDato("—", "Sin datos");
    const caja = el("span", "fab-moneda" + (signo ? (v > 0 ? " pos" : v < 0 ? " neg" : " cero") : ""));
    if (signo && v !== 0) caja.append(el("span", "signo", v > 0 ? "+" : "−"));
    caja.append(d.monedaNodo(Math.abs(v)));
    return caja;
  }
  function boton(texto, cls = "btn btn-piedra btn-small", datosBoton = {}) {
    const b = el("button", cls, texto);
    b.type = "button";
    Object.assign(b.dataset, datosBoton);
    return b;
  }
  /** Botón «?» con ayuda breve (la abre app.js con clic, teclado o toque). */
  function ayuda(texto, etiqueta = "Más información") {
    const b = boton("?", "ayuda");
    b.dataset.ayuda = texto;
    b.setAttribute("aria-label", etiqueta);
    return b;
  }
  /** Etiqueta discreta cuyo motivo se abre con la ayuda global (clic, teclado o toque). */
  function marca(texto, cls, motivos, etiqueta) {
    const b = boton(texto, `ayuda fab-marca ${cls}`);
    b.dataset.ayuda = motivos.join(". ") + ".";
    b.setAttribute("aria-label", `${etiqueta}: ${motivos.join(". ")}`);
    return b;
  }
  const textoActividad = (x) => {
    const a = actividad(x);
    if (!a) return null;
    return { valor: a.valor.toLocaleString("es", { maximumFractionDigits: 1 }), regional: a.regional };
  };
  function nodoActividad(x, largo = false) {
    const a = textoActividad(x);
    if (!a) return sinDato("Sin datos", "Ninguna fuente publica ventas de este objeto");
    const s = el("span", "fab-act");
    s.append(`${a.valor}${largo ? " ventas" : ""}/día`);
    if (a.regional) s.append(el("span", "fab-region", "región"));
    s.title = a.regional ? "Ventas al día estimadas en toda la región US (TSM), no solo en este reino"
      : "Ventas al día estimadas en este reino (AHledger)";
    return s;
  }

  // ---------- cabecera: dato, recarga, menú ----------
  function pintarDato() {
    const b = $("fab-dato");
    const e = datos?.escaneo;
    b.textContent = e ? `Datos: ${d.hace(e)}` : "Datos: —";
    const viejo = e && (Date.now() - new Date(e)) > HORAS_VIEJO * 3600e3;
    b.classList.toggle("viejo", !!viejo);
    b.title = e ? `Escaneo del ${d.fecha(e)}${viejo ? `. Tiene más de ${HORAS_VIEJO} horas: los precios pueden haber cambiado.` : ""}`
      + (datos?.demo ? " · DATOS FICTICIOS" : "") : "Sin escaneo";
    b.setAttribute("aria-label", b.title);
  }
  // Clic, teclado o toque: la fecha exacta del escaneo en un aviso breve.
  $("fab-dato").addEventListener("click", () => d.avisar($("fab-dato").title));
  $("fab-recargar").addEventListener("click", () => cargar({ forzar: true }));
  $("fab-reintentar").addEventListener("click", () => cargar({ forzar: true }));

  function menu(abrir) {
    const m = $("fab-menu"), b = $("fab-menu-btn");
    const si = abrir ?? m.hidden;
    m.hidden = !si; b.setAttribute("aria-expanded", String(si));
    if (si) m.querySelector("[role=menuitem]")?.focus();
  }
  $("fab-menu-btn").addEventListener("click", () => menu());
  $("fab-menu").addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.preventDefault(); menu(false); $("fab-menu-btn").focus(); } });
  $("fab-csv").addEventListener("click", () => {
    menu(false);
    const l = ordenarFilas(filtradas(), orden.clave, orden.dir);
    const blob = new Blob(["﻿" + filasACsv(l, (x) => d.nom(x.id, x.nombre))], { type: "text/csv;charset=utf-8" });
    const a = el("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fabricacion-${(datos?.mercado ?? "mercado").replaceAll(":", "-")}.csv`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    d.avisar(`CSV con ${l.length.toLocaleString("es")} recetas descargado.`);
  });

  // Popovers (profesión, columnas, menú): se cierran al pulsar fuera.
  const popovers = [["fab-prof-pop", "fab-prof-btn"], ["fab-col-pop", "fab-col-btn"], ["fab-menu", "fab-menu-btn"]];
  function cerrarPopovers(excepto = null) {
    for (const [p, b] of popovers) if (p !== excepto && !$(p).hidden) { $(p).hidden = true; $(b).setAttribute("aria-expanded", "false"); }
  }
  document.addEventListener("click", (ev) => {
    for (const [p, b] of popovers) {
      if (!$(p).hidden && !$(p).contains(ev.target) && !$(b).contains(ev.target)) { $(p).hidden = true; $(b).setAttribute("aria-expanded", "false"); }
    }
    if (!$("fab-sug").hidden && !$("fab-combo").contains(ev.target)) cerrarSugerencias();
  });
  for (const [p, b] of popovers.slice(0, 2)) {
    $(p).addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); $(p).hidden = true; $(b).setAttribute("aria-expanded", "false"); $(b).focus(); }
    });
  }

  // ---------- búsqueda con sugerencias (iconos y teclado) ----------
  let sug = [], sugActiva = -1, temporizador = null;
  function cerrarSugerencias() {
    $("fab-sug").hidden = true; $("fab-texto").setAttribute("aria-expanded", "false"); $("fab-texto").removeAttribute("aria-activedescendant");
    sugActiva = -1;
  }
  function pintarSugerencias() {
    const ul = $("fab-sug");
    ul.replaceChildren(...sug.map((s, k) => {
      const li = el("li", "sug" + (k === sugActiva ? " activa" : ""));
      li.id = `fab-sug-${k}`; li.setAttribute("role", "option"); li.setAttribute("aria-selected", String(k === sugActiva));
      li.dataset.k = k; li.dataset.id = s.id;
      const t = el("span", "sug-txt");
      t.append(el("span", "objeto-nombre" + (s.calidad ? ` q-${s.calidad}` : ""), s.nombre),
        el("span", "sug-sub", `${d.nombreProf(s.profesion)}${s.n > 1 ? ` · ${s.n} recetas` : ""}`));
      li.append(d.iconoNodo(s.icono, s.nombre, s.calidad), t);
      return li;
    }));
    const hay = sug.length > 0 && document.activeElement === $("fab-texto");
    ul.hidden = !hay;
    $("fab-texto").setAttribute("aria-expanded", String(hay));
    if (sugActiva >= 0) $("fab-texto").setAttribute("aria-activedescendant", `fab-sug-${sugActiva}`);
    else $("fab-texto").removeAttribute("aria-activedescendant");
  }
  function calcularSugerencias() {
    const t = $("fab-texto").value.trim();
    if (t.length < 2 || !filas.length) { sug = []; return; }
    const encontradas = filtrarFilas(filas, { texto: t }, nombreEs);
    sug = agruparPorProducto(ordenarFilas(encontradas, "neta", "desc")).slice(0, 8).map((g) => ({
      id: g.id, spell: g.principal.spell, nombre: d.nom(g.id, g.principal.nombre), icono: g.principal.icono,
      calidad: g.principal.calidad, profesion: g.principal.profesion, n: g.variantes.length,
    }));
    sugActiva = -1;
  }
  function aplicarTexto(t) {
    f.texto = t; pagina = 1; congelado = null;
    $("fab-texto-borrar").hidden = !t;
    pintar();
  }
  $("fab-texto").addEventListener("input", () => {
    clearTimeout(temporizador);
    $("fab-texto-borrar").hidden = !$("fab-texto").value;
    temporizador = setTimeout(() => { calcularSugerencias(); pintarSugerencias(); aplicarTexto($("fab-texto").value); }, 140);
  });
  $("fab-texto").addEventListener("keydown", (ev) => {
    const abierta = !$("fab-sug").hidden;
    if (ev.key === "ArrowDown" && sug.length) { ev.preventDefault(); sugActiva = (sugActiva + 1) % sug.length; pintarSugerencias(); }
    else if (ev.key === "ArrowUp" && sug.length) { ev.preventDefault(); sugActiva = sugActiva <= 0 ? sug.length - 1 : sugActiva - 1; pintarSugerencias(); }
    else if (ev.key === "Enter") {
      ev.preventDefault();
      if (abierta && sugActiva >= 0) elegirSugerencia(sugActiva);
      else { cerrarSugerencias(); clearTimeout(temporizador); aplicarTexto($("fab-texto").value); }
    } else if (ev.key === "Escape" && abierta) { ev.preventDefault(); ev.stopPropagation(); cerrarSugerencias(); }
  });
  $("fab-texto").addEventListener("blur", () => setTimeout(() => { if (!$("fab-combo").contains(document.activeElement)) cerrarSugerencias(); }, 150));
  $("fab-sug").addEventListener("pointerdown", (ev) => {
    const li = ev.target.closest("[data-k]");
    if (!li) return;
    ev.preventDefault();
    elegirSugerencia(Number(li.dataset.k));
  });
  function elegirSugerencia(k) {
    const s = sug[k];
    if (!s) return;
    $("fab-texto").value = s.nombre;
    cerrarSugerencias();
    aplicarTexto(s.nombre);
    abrirDetalle(s.spell, $("fab-texto"));
  }
  $("fab-texto-borrar").addEventListener("click", () => {
    $("fab-texto").value = ""; sug = []; cerrarSugerencias(); aplicarTexto(""); $("fab-texto").focus();
  });

  // ---------- profesión: selector buscable con iconos ----------
  const profesionesDisponibles = () => [...new Set((datos?.recetas ?? []).map((r) => r.p))]
    .sort((a, b) => d.nombreProf(a).localeCompare(d.nombreProf(b), "es"));
  function pintarProfesiones() {
    const todas = profesionesDisponibles();
    const t = $("fab-prof-buscar").value.trim().toLowerCase();
    const cuenta = new Map();
    for (const r of datos?.recetas ?? []) cuenta.set(r.p, (cuenta.get(r.p) ?? 0) + 1);
    const ul = $("fab-prof-lista");
    const li0 = el("li");
    const todasLbl = el("label", "fab-prof-op");
    const c0 = el("input"); c0.type = "checkbox"; c0.checked = f.profesiones.length === 0; c0.dataset.prof = "";
    todasLbl.append(c0, el("span", "fab-prof-nombre", "Todas las profesiones"));
    li0.append(todasLbl);
    ul.replaceChildren(li0, ...todas.filter((p) => !t || d.nombreProf(p).toLowerCase().includes(t)).map((p) => {
      const li = el("li");
      const lbl = el("label", "fab-prof-op");
      const c = el("input"); c.type = "checkbox"; c.checked = f.profesiones.includes(p); c.dataset.prof = p;
      lbl.append(c, d.iconoNodo(d.iconoProfesion?.(p), d.nombreProf(p)), el("span", "fab-prof-nombre", d.nombreProf(p)),
        el("span", "fab-prof-n", (cuenta.get(p) ?? 0).toLocaleString("es")));
      li.append(lbl);
      return li;
    }));
    // Botón: «Todas las profesiones», el nombre de la elegida o «3 profesiones».
    const n = f.profesiones.length;
    $("fab-prof-txt").textContent = n === 0 ? "Todas las profesiones" : n === 1 ? d.nombreProf(f.profesiones[0]) : `${n} profesiones`;
    const ic = $("fab-prof-icono");
    ic.replaceChildren(n === 1 ? d.iconoNodo(d.iconoProfesion?.(f.profesiones[0]), d.nombreProf(f.profesiones[0])) : "");
    ic.hidden = n !== 1;
  }
  $("fab-prof-btn").addEventListener("click", () => {
    const p = $("fab-prof-pop"), abrir = p.hidden;
    cerrarPopovers("fab-prof-pop");
    p.hidden = !abrir; $("fab-prof-btn").setAttribute("aria-expanded", String(abrir));
    if (abrir) { $("fab-prof-buscar").value = ""; pintarProfesiones(); $("fab-prof-buscar").focus(); }
  });
  $("fab-prof-buscar").addEventListener("input", pintarProfesiones);
  $("fab-prof-lista").addEventListener("change", (ev) => {
    const c = ev.target.closest("[data-prof]");
    if (!c) return;
    const p = c.dataset.prof;
    if (p === "") f.profesiones = [];
    else f.profesiones = c.checked ? [...new Set([...f.profesiones, p])] : f.profesiones.filter((x) => x !== p);
    cambioFiltros();
    pintarProfesiones();
    $("fab-prof-lista").querySelector(`[data-prof="${CSS.escape(p)}"]`)?.focus();
  });

  // ---------- filtros ----------
  function filtrosAControles() {
    for (const k of CASILLAS) $(`fab-${k}`).checked = !!f[k];
    for (const [k, id] of [["roiMin", "fab-roi"], ["nivelMin", "fab-nivel-min"], ["nivelMax", "fab-nivel-max"]]) $(id).value = f[k] ?? "";
    $("fab-neta").value = f.netaMin == null ? "" : d.formatear(f.netaMin);
    $("fab-neta").removeAttribute("aria-invalid");
    $("fab-valor-sin-ofertas").checked = op.valorSinOfertas;
    $("fab-intermedios").checked = op.fabricarIntermedios;
    $("fab-casa").value = String(op.comision);
    $("fab-orden").value = `${orden.clave}:${orden.dir}`;
    if ($("fab-orden").value !== `${orden.clave}:${orden.dir}`) {
      const o = el("option", "", `${orden.clave} ${orden.dir === "asc" ? "↑" : "↓"}`); o.value = `${orden.clave}:${orden.dir}`;
      $("fab-orden").append(o); $("fab-orden").value = o.value;
    }
    $("fab-criterio").value = criterio;
  }
  const num = (id) => { const v = $(id).value.trim(); return v === "" ? null : Number(v); };
  function cambioFiltros({ recalcular = false } = {}) {
    guardar(); pagina = 1; congelado = null; $("fab-nuevo-orden").hidden = true;
    if (recalcular) calcular();
    pintar();
  }
  $("fab-soloRentables").addEventListener("change", () => { f.soloRentables = $("fab-soloRentables").checked; cambioFiltros(); });
  $("fab-panel-filtros").addEventListener("change", (ev) => {
    const id = ev.target.id;
    for (const k of CASILLAS) f[k] = $(`fab-${k}`).checked;
    f.roiMin = num("fab-roi"); f.nivelMin = num("fab-nivel-min"); f.nivelMax = num("fab-nivel-max");
    try {
      f.netaMin = $("fab-neta").value.trim() === "" ? null : parsearMoneda($("fab-neta").value);
      $("fab-neta").removeAttribute("aria-invalid");
    } catch (e) {
      $("fab-neta").setAttribute("aria-invalid", "true");
      d.avisar(e.message, "bad");
    }
    const recalcular = ["fab-valor-sin-ofertas", "fab-intermedios", "fab-casa"].includes(id);
    op.valorSinOfertas = $("fab-valor-sin-ofertas").checked;
    op.fabricarIntermedios = $("fab-intermedios").checked;
    op.comision = Number($("fab-casa").value);
    cambioFiltros({ recalcular });
    if (recalcular) d.avisar("Cálculo actualizado con la nueva opción.");
  });
  $("fab-orden").addEventListener("change", () => {
    const [clave, dir] = $("fab-orden").value.split(":");
    orden = { clave, dir };
    cambioFiltros();
  });
  $("fab-criterio").addEventListener("change", () => { criterio = $("fab-criterio").value; cambioFiltros(); });
  function limpiarTodo() {
    Object.assign(f, limpiarFiltros(f));
    filtrosAControles(); pintarProfesiones(); cambioFiltros();
    d.avisar("Filtros limpiados.");
  }
  $("fab-quitar").addEventListener("click", limpiarTodo);
  $("fab-limpiar-vacio").addEventListener("click", () => {
    Object.assign(f, limpiarFiltros(f), { texto: "" });
    $("fab-texto").value = ""; $("fab-texto-borrar").hidden = true;
    filtrosAControles(); pintarProfesiones(); cambioFiltros();
  });
  $("fab-chips").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-quitar]");
    if (b) {
      Object.assign(f, quitarFiltro(f, b.dataset.quitar));
      filtrosAControles(); pintarProfesiones(); cambioFiltros();
      requestAnimationFrame(() => ($("fab-chips").querySelector(".chip-filtro") ?? $("fab-texto")).focus());
      return;
    }
    if (ev.target.closest("[data-limpiar]")) limpiarTodo();
  });
  function pintarChips() {
    const chips = chipsFiltros(f, { nombreProf: d.nombreProf, formatear: d.formatear });
    const cont = $("fab-chips");
    cont.hidden = chips.length === 0;
    cont.replaceChildren(...chips.map((c) => {
      const b = boton("", "chip-filtro", { quitar: c.clave });
      b.setAttribute("aria-label", `Quitar filtro: ${c.texto}`);
      const x = el("span", "x", "×"); x.setAttribute("aria-hidden", "true");
      b.append(c.texto, x);
      return b;
    }));
    if (chips.length) cont.append(boton("Limpiar filtros", "enlace", { limpiar: "1" }));
    const n = contarFiltrosPanel(f);
    $("fab-filtros-n").hidden = n === 0;
    $("fab-filtros-n").textContent = String(n);
    $("fab-filtros-btn").setAttribute("aria-label", n ? `Filtros (${n} activos)` : "Filtros");
    $("fab-soloRentables").checked = f.soloRentables;
  }

  // ---------- columnas y densidad ----------
  function pintarColumnasPop() {
    const pop = $("fab-col-pop");
    pop.replaceChildren(el("p", "fab-pop-tit", "Columnas visibles"), ...COLUMNAS_FAB.map(([k, t]) => {
      const lbl = el("label", "check");
      const c = el("input"); c.type = "checkbox"; c.checked = columnas.includes(k); c.dataset.col = k;
      lbl.append(c, ` ${t}`);
      return lbl;
    }), boton("Restablecer", "enlace", { colDefecto: "1" }));
  }
  $("fab-col-btn").addEventListener("click", () => {
    const p = $("fab-col-pop"), abrir = p.hidden;
    cerrarPopovers("fab-col-pop");
    p.hidden = !abrir; $("fab-col-btn").setAttribute("aria-expanded", String(abrir));
    if (abrir) { pintarColumnasPop(); p.querySelector("input")?.focus(); }
  });
  $("fab-col-pop").addEventListener("change", (ev) => {
    const c = ev.target.closest("[data-col]");
    if (!c) return;
    const sig = c.checked ? [...columnas, c.dataset.col] : columnas.filter((k) => k !== c.dataset.col);
    columnas = normalizarColumnas(sig.length ? sig : ["neta"]);
    guardar(); pintar();
  });
  $("fab-col-pop").addEventListener("click", (ev) => {
    if (!ev.target.closest("[data-col-defecto]")) return;
    columnas = normalizarColumnas(null); guardar(); pintarColumnasPop(); pintar();
  });
  for (const b of document.querySelectorAll(".fab-densidad [data-densidad]")) b.addEventListener("click", () => d.ponerDensidad?.(b.dataset.densidad));

  // ---------- datos y cálculo ----------
  function opcionesMotor() {
    return { regla: { ...REGLA_POR_DEFECTO, comision_pct: op.comision }, valorSinOfertas: op.valorSinOfertas,
             fabricarIntermedios: op.fabricarIntermedios };
  }
  function calcular() {
    filas = datos ? calcularFilas(datos, opcionesMotor()) : [];
    porSpell = new Map(filas.map((x) => [x.spell, x]));
    pintarAlertas();
  }
  let porSpell = new Map();

  function esqueleto() {
    const tb = $("fab-tbody");
    tb.replaceChildren(...Array.from({ length: 10 }, () => {
      const tr = el("tr", "esq");
      for (let k = 0; k < columnas.length + 1; k++) { const td = el("td", k ? "num" : ""); td.append(el("span", "barra-esq")); tr.append(td); }
      return tr;
    }));
    $("fab-oport").replaceChildren(...Array.from({ length: 6 }, () => el("li", "op-card esq-card")));
  }

  async function cargar({ forzar = false, silencioso = false } = {}) {
    const mercado = d.mercado();
    if (!mercado) return;
    if (!forzar && datos && datosMercado === mercado) return;
    if (cargando) return cargando;
    const habia = !!datos && datosMercado === mercado;
    $("vista-fabricacion").setAttribute("aria-busy", "true");
    if (!datos) esqueleto();
    $("fab-recargar").classList.add("girando"); $("fab-recargar").disabled = true;
    cargando = (async () => {
      try {
        const r = await fetch(`/api/recetas?fabricacion=1&mercado=${encodeURIComponent(mercado)}`, { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j) throw new Error(j?.error ?? `HTTP ${r.status}`);
        // Precios nuevos con resultados a la vista: el orden no cambia por sorpresa (se ofrece «Reordenar»).
        if (habia && silencioso && modo === "tabla") congelado = gruposVisibles.map((g) => g.id);
        datos = j; datosMercado = mercado; error = null;
        hist = { ...hist, estado: null, serie: null, crudo: null };
        calcular(); pintarProfesiones(); pintar();
        if (congelado) $("fab-nuevo-orden").hidden = false;
        if (detalle.spell != null && !$("fab-det").hidden) pintarDetalle();
        if (!$("fab-lista").hidden) pintarLista();
        if (forzar && !silencioso) d.avisar("Recetas y precios actualizados.");
      } catch (e) {
        error = e.message;
        $("fab-error-txt").textContent = `No se pudieron cargar las recetas: ${e.message}.`
          + (datos ? " Se muestran los últimos datos recibidos." : "");
        $("fab-error").hidden = false;
        if (!datos) { $("fab-tbody").replaceChildren(); $("fab-oport").replaceChildren(); }
      } finally {
        cargando = null;
        $("vista-fabricacion").removeAttribute("aria-busy");
        $("fab-recargar").classList.remove("girando"); $("fab-recargar").disabled = false;
        if (!error) $("fab-error").hidden = true;
      }
    })();
    return cargando;
  }
  $("fab-reordenar").addEventListener("click", () => { congelado = null; $("fab-nuevo-orden").hidden = true; pintar(); });

  /** Filas que pasan los filtros (incluido «Solo favoritas»). */
  const filtradas = () => filtrarFilas(f.soloFavoritas ? filas.filter((x) => esFavorita(x.spell)) : filas, f, nombreEs);

  // ---------- tabla ----------
  let gruposVisibles = [];
  const COLS = Object.fromEntries(COLUMNAS_FAB.map(([k, t, , a]) => [k, { titulo: t, ayuda: a }]));

  function pintarCabecera() {
    const tr = $("fab-cab");
    const ths = [["nombre", "Objeto", ""], ...columnas.map((k) => [k, COLS[k].titulo, COLS[k].ayuda])].map(([k, t, a]) => {
      const th = el("th", k === "nombre" ? "c-fobj" : `num c-${k}`);
      th.scope = "col";
      const b = boton(t, "th-orden", { orden: k });
      if (a) b.title = a;
      th.setAttribute("aria-sort", orden.clave === k ? (orden.dir === "asc" ? "ascending" : "descending") : "none");
      th.append(b);
      return th;
    });
    tr.replaceChildren(...ths);
  }
  $("fab-cab").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-orden]");
    if (!b) return;
    const clave = b.dataset.orden;
    orden = orden.clave === clave ? { clave, dir: orden.dir === "desc" ? "asc" : "desc" }
      : { clave, dir: ["nombre", "coste", "disponible", "nivel"].includes(clave) ? "asc" : "desc" };
    filtrosAControles(); cambioFiltros();
  });

  function celda(k, x) {
    const td = el("td", `num c-${k}`);
    td.dataset.k = COLS[k].titulo;   // etiqueta en las tarjetas del móvil
    switch (k) {
      case "coste":
        if (x.coste != null) td.append(moneda(x.coste));
        else {
          const falta = x.a.faltan.map((id) => nombreObj(id)).join(", ");
          td.append(sinDato("Falta precio", `Falta el precio de: ${falta || "algún material"}`));
        }
        break;
      case "venta":
        if (x.a.ingresoBruto == null) td.append(sinDato("Sin precio", "El objeto no tiene precio en este mercado"));
        else {
          td.append(moneda(x.a.ingresoBruto));
          if (x.a.unidadesProducidas !== 1) td.title = `${cant(x.a.unidadesProducidas)} unidades × ${d.formatear(x.precioVenta)}`;
        }
        break;
      case "neta": td.append(moneda(x.neta, { signo: true })); break;
      case "bruta": td.append(moneda(x.bruta, { signo: true })); break;
      case "roi": case "margen": {
        const v = x[k];
        if (v == null) td.append(sinDato("—", "Sin datos"));
        else { td.textContent = pct(v); td.classList.add(v > 0 ? "pos" : v < 0 ? "neg" : "cero"); }
        break;
      }
      case "ventas": td.append(nodoActividad(x)); break;
      case "disponible":
        if (x.disponible == null) td.append(sinDato("—", "La fuente no publica cuántas hay a la venta"));
        else td.textContent = x.disponible.toLocaleString("es");
        break;
      case "profesion": td.className = "c-profesion"; td.textContent = d.nombreProf(x.profesion); break;
      case "nivel": td.textContent = x.nivel == null ? "—" : String(x.nivel); break;
    }
    return td;
  }

  function filaReceta(x, { grupo = null, variante = false, cambios = [] } = {}) {
    const tr = el("tr", "fab-fila" + (variante ? " fab-variante" : "") + (!x.completo ? " incompleta" : ""));
    tr.dataset.spell = x.spell; tr.dataset.id = x.id;
    const td = el("td", "c-fobj");
    const fila = el("div", "fab-obj-fila");
    fila.append(botonEstrella(x));
    const b = boton("", "fab-obj", { abrir: x.spell });
    const nombre = d.nom(x.id, x.nombre);
    const txt = el("span", "objeto-txt");
    const nom = el("span", "objeto-nombre" + (x.calidad ? ` q-${x.calidad}` : ""), nombre);
    const sub = [d.nombreProf(x.profesion), x.nivel != null ? String(x.nivel) : null,
      x.a.rendimiento.min !== x.a.rendimiento.max ? `da ${x.a.rendimiento.min}–${x.a.rendimiento.max}`
        : x.a.rendimiento.min > 1 ? `da ${x.a.rendimiento.min}` : null].filter(Boolean).join(" · ");
    txt.append(nom, el("span", "objeto-id", variante || cambios.length ? `${variante ? "" : "Recomendada · "}${cambios.join(" · ") || sub}` : sub));
    b.append(d.iconoNodo(x.icono, nombre, x.calidad), txt);
    b.title = `${nombre} — ver materiales y cálculo`;
    b.setAttribute("aria-label", `${nombre}, ${sub}. Ver materiales y cálculo`);
    fila.append(b);
    // Marcas discretas: precio de referencia, revisar, incompleta; y las variantes del mismo objeto.
    const marcas = el("span", "fab-marcas");
    const ref = motivosReferencia(x);
    if (ref.length) marcas.append(marca("Referencia", "ref", ref, "Calculado con precios de referencia"));
    const rev = motivosRevision(x, indicadores(x, datos.objetos));
    if (rev.length) marcas.append(marca("Revisar", "rev", rev, "Revisar"));
    if (grupo && grupo.variantes.length > 1 && !variante) {
      const v = boton(`${grupo.variantes.length} recetas`, "fab-variantes", { variantes: grupo.id });
      v.setAttribute("aria-expanded", String(abiertos.has(grupo.id)));
      v.title = "Otras recetas que fabrican el mismo objeto";
      v.innerHTML += '<svg aria-hidden="true"><use href="#i-abajo" /></svg>';
      marcas.append(v);
    }
    if (marcas.children.length) fila.append(marcas);
    td.append(fila);
    tr.append(td, ...columnas.map((k) => celda(k, x)));
    return tr;
  }

  function pintarTabla() {
    pintarCabecera();
    const l = ordenarFilas(filtradas(), orden.clave, orden.dir);
    let grupos = agruparPorProducto(l);
    if (congelado) {
      const pos = new Map(congelado.map((id, k) => [id, k]));
      grupos = [...grupos].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
    }
    const total = Math.max(1, Math.ceil(grupos.length / POR_PAGINA));
    pagina = Math.min(Math.max(1, pagina), total);
    gruposVisibles = grupos.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
    const nodos = [];
    for (const g of gruposVisibles) {
      const abierto = abiertos.has(g.id) && g.variantes.length > 1;
      const dif = abierto ? new Map(diferenciasVariantes(g.variantes, (id) => nombreObj(id)).map((v) => [v.spell, v.cambios])) : null;
      nodos.push(filaReceta(g.principal, { grupo: g, cambios: dif?.get(g.principal.spell) ?? [] }));
      if (abierto) for (const v of g.variantes.slice(1)) nodos.push(filaReceta(v, { variante: true, cambios: dif.get(v.spell) }));
    }
    $("fab-tbody").replaceChildren(...nodos);
    const recetasTxt = l.length === 1 ? "1 receta" : `${l.length.toLocaleString("es")} recetas`;
    $("fab-contador").textContent = grupos.length === l.length ? recetasTxt
      : `${recetasTxt} · ${grupos.length === 1 ? "1 objeto" : `${grupos.length.toLocaleString("es")} objetos`}`;
    vacio(l.length === 0);
    $("fab-paginador").hidden = total <= 1;
    $("fab-pag-txt").textContent = `Página ${pagina} de ${total}`;
    $("fab-pag-ant").disabled = pagina <= 1;
    $("fab-pag-sig").disabled = pagina >= total;
  }
  function vacio(si) {
    $("fab-vacio").hidden = !si || !datos;
    const hay = chipsFiltros(f).length > 0 || f.soloRentables || !!f.texto;
    $("fab-vacio-txt").textContent = !si ? "" : hay ? "Ninguna receta coincide con la búsqueda y los filtros."
      : modo === "oportunidades" ? "Ninguna receta destaca con los datos actuales." : "Este mercado no tiene recetas.";
    $("fab-limpiar-vacio").hidden = !hay;
  }
  $("fab-pag-ant").addEventListener("click", () => { pagina--; pintar(); $("vista-fabricacion").scrollIntoView({ block: "start" }); });
  $("fab-pag-sig").addEventListener("click", () => { pagina++; pintar(); $("vista-fabricacion").scrollIntoView({ block: "start" }); });
  $("fab-tbody").addEventListener("click", (ev) => {
    const fav = ev.target.closest("[data-fav]");
    if (fav) { alternarFavorita(Number(fav.dataset.fav)); return; }
    const v = ev.target.closest("[data-variantes]");
    if (v) {
      const id = Number(v.dataset.variantes);
      if (abiertos.has(id)) abiertos.delete(id); else abiertos.add(id);
      pintar();
      $("fab-tbody").querySelector(`[data-variantes="${id}"]`)?.focus();
      return;
    }
    if (ev.target.closest(".fab-marca, .ayuda")) return;
    const b = ev.target.closest("[data-abrir]") ?? ev.target.closest("tr.fab-fila")?.querySelector("[data-abrir]");
    if (b) abrirDetalle(Number(b.dataset.abrir), b);
  });

  // ---------- Oportunidades: una lista con criterio ----------
  function pintarOportunidades() {
    const o = oportunidades(filtradas(), datos.objetos, { limite: 60 });
    const grupos = agruparPorProducto(o[criterio]);
    const r = o.resumen;
    $("fab-contador").textContent = grupos.length === 1 ? "1 receta recomendable" : `${grupos.length.toLocaleString("es")} recetas recomendables`;
    const ay = $("ayuda-oport-resumen");
    ay.hidden = false;
    ay.dataset.ayuda = `De ${r.recetas.toLocaleString("es")} recetas con todos los precios (con tus filtros), `
      + `${r.conGanancia.toLocaleString("es")} ganan en teoría y ${r.recomendables.toLocaleString("es")} son recomendables. `
      + `No se recomiendan ${r.sinDemanda.toLocaleString("es")} sin ventas registradas ni ${r.sospechosas.toLocaleString("es")} con precio sospechoso. `
      + "Se muestran las 60 mejores según el criterio.";
    $("ayuda-criterio").dataset.ayuda = Object.values(CRITERIOS).map((c) => `${c.titulo}: ${c.ayuda}`).join(" ");
    $("fab-oport").replaceChildren(...grupos.map((g) => tarjeta(g)));
    vacio(grupos.length === 0);
    $("fab-paginador").hidden = true;
  }

  function tarjeta(g) {
    const x = g.principal, i = x.i;
    const li = el("li", "op-card");
    li.dataset.id = x.id; li.dataset.spell = x.spell;
    const nombre = d.nom(x.id, x.nombre);
    const cab = el("div", "op-cab");
    const t = el("div", "op-titulo");
    t.append(el("h3", "op-nombre" + (x.calidad ? ` q-${x.calidad}` : ""), nombre),
      el("span", "op-prof", `${d.nombreProf(x.profesion)}${x.nivel != null ? ` · ${x.nivel}` : ""}${g.variantes.length > 1 ? ` · ${g.variantes.length} recetas` : ""}`));
    cab.append(d.iconoNodo(x.icono, nombre, x.calidad, true), t, botonEstrella(x));
    const neta = el("div", "op-neta");
    neta.append(moneda(x.neta, { signo: true }), el("span", "op-neta-k", "ganancia neta por fabricación"));
    const sec = el("p", "op-sec");
    sec.append("Coste ", moneda(x.coste), ` · Retorno ${pct(x.roi) ?? "—"}`);
    const pie = el("div", "op-pie");
    const act = el("span", "op-act");
    act.append(nodoActividad(x, true));
    const rg = etiquetaRiesgo(i);
    const riesgo = marca(rg.texto, `riesgo r-${rg.nivel}`, rg.motivos.length ? rg.motivos : ["Sin riesgos detectados con los datos actuales"], rg.texto);
    pie.append(act, riesgo);
    const ref = motivosReferencia(x);
    if (ref.length) pie.append(marca("Referencia", "ref", ref, "Calculado con precios de referencia"));
    const acciones = el("div", "op-acciones");
    acciones.append(boton("Ver materiales", "btn btn-piedra btn-small", { abrir: x.spell }));
    const an = el("details", "op-analisis");
    an.append(el("summary", "", "Ver análisis"), analisis(x));
    li.append(cab, neta, sec, pie, acciones, an);
    return li;
  }

  function analisis(x) {
    const i = x.i;
    const dl = el("dl", "op-dl");
    const fila = (k, v) => { dl.append(el("dt", "", k)); const dd = el("dd"); dd.append(v); dl.append(dd); };
    const a = actividad(x);
    fila("Demanda", a ? `${NIVEL_TEXTO[i.demanda]} · ${a.valor.toLocaleString("es", { maximumFractionDigits: 1 })} ventas/día `
      + (a.regional ? "en toda la región US (TSM)" : "en este reino (AHledger)") : "Sin datos de ventas");
    fila("Competencia", i.competencia === "ninguna" ? "Ninguna oferta del producto ahora"
      : i.dias != null ? `${NIVEL_TEXTO[i.competencia]} · ${x.disponible.toLocaleString("es")} a la venta ≈ ${i.dias.toLocaleString("es", { maximumFractionDigits: 1 })} días de ventas estimadas`
      : "Sin datos");
    if (criterio === "equilibrio" && i.techoDia != null) {
      const s = el("span"); s.append("Hasta ", d.monedaNodo(Math.round(i.techoDia)), " al día si vendieras tú todas las ventas estimadas");
      fila("Techo diario", s);
    }
    if (i.descuentoMateriales != null) fila("Materiales", `${i.descuentoMateriales >= 0 ? "−" : "+"}${Math.abs(Math.round(i.descuentoMateriales))} % frente a sus precios históricos`);
    fila("Riesgo", i.motivosRiesgo.length ? i.motivosRiesgo.join(" · ") : "Sin riesgos detectados");
    fila("Alcance", "Estimación con el último escaneo y las ventas estimadas de la fuente. No garantiza que se venda ni el plazo.");
    return dl;
  }
  $("fab-oport").addEventListener("click", (ev) => {
    const fav = ev.target.closest("[data-fav]");
    if (fav) { alternarFavorita(Number(fav.dataset.fav)); return; }
    const b = ev.target.closest("[data-abrir]");
    if (b) abrirDetalle(Number(b.dataset.abrir), b);
  });

  // ---------- paneles laterales ----------
  let panel = null, opener = null;
  function abrirPanel(id, desde) {
    if (panel && panel !== id) cerrarPanel({ devolver: false });
    opener = desde ?? document.activeElement;
    panel = id;
    $(id).hidden = false; $("fab-velo").hidden = false;
    document.body.classList.add("fab-con-panel");
    for (const b of document.querySelectorAll(`[aria-controls="${id}"]`)) b.setAttribute("aria-expanded", "true");
    const h = $(id).querySelector("h2");
    if (h && !h.hasAttribute("tabindex")) h.tabIndex = -1;
    requestAnimationFrame(() => ($(id).querySelector("[data-foco]") ?? h ?? $(id)).focus());
  }
  function cerrarPanel({ devolver = true } = {}) {
    if (!panel) return;
    const id = panel;
    $(id).hidden = true; $("fab-velo").hidden = true; panel = null;
    document.body.classList.remove("fab-con-panel");
    for (const b of document.querySelectorAll(`[aria-controls="${id}"]`)) b.setAttribute("aria-expanded", "false");
    if (id === "fab-det") detalle.spell = null;
    if (devolver && opener?.isConnected) opener.focus();
    else if (devolver && id === "fab-det" && opener?.dataset?.abrir) $("vista-fabricacion").querySelector(`[data-abrir="${opener.dataset.abrir}"]`)?.focus();
  }
  $("fab-velo").addEventListener("click", () => cerrarPanel());
  for (const id of ["fab-panel-filtros", "fab-det", "fab-lista", "fab-alertas", "fab-cmp"]) {
    $(id).tabIndex = -1;
    $(id).addEventListener("click", (ev) => { if (ev.target.closest("[data-cerrar]")) cerrarPanel(); });
    $(id).addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !ev.target.closest(".fab-pop")) { ev.preventDefault(); cerrarPanel(); return; }
      if (ev.key !== "Tab") return;
      // El foco no se escapa del panel abierto.
      const foc = [...$(id).querySelectorAll("button, [href], input, select, textarea, summary, [tabindex]:not([tabindex='-1'])")]
        .filter((n) => !n.disabled && n.offsetParent !== null);
      if (!foc.length) return;
      if (ev.shiftKey && document.activeElement === foc[0]) { ev.preventDefault(); foc.at(-1).focus(); }
      else if (!ev.shiftKey && document.activeElement === foc.at(-1)) { ev.preventDefault(); foc[0].focus(); }
    });
  }
  $("fab-filtros-btn").addEventListener("click", (ev) => { filtrosAControles(); abrirPanel("fab-panel-filtros", ev.currentTarget); });
  function cabPanel(titulo, idTit, extra = null) {
    const cab = el("div", "fab-drawer-cab");
    const h = el("h2", "", titulo); h.id = idTit; h.tabIndex = -1;
    const x = boton("", "btn-icono", { cerrar: "1" });
    x.setAttribute("aria-label", "Cerrar"); x.innerHTML = '<svg aria-hidden="true"><use href="#i-cerrar" /></svg>';
    cab.append(h);
    if (extra) cab.append(extra);
    cab.append(x);
    return cab;
  }

  // ---------- detalle de una receta ----------
  const detalle = { spell: null, veces: 1, manual: {}, precioVenta: undefined };
  function abrirDetalle(spell, desde) {
    if (!porSpell.has(spell)) return;
    if (detalle.spell !== spell) Object.assign(detalle, { spell, veces: 1, manual: {}, precioVenta: undefined });
    hist = hist.spell === spell ? hist : { spell: null, dias: 7, estado: null, serie: null, crudo: null, error: null };
    pintarDetalle();
    abrirPanel("fab-det", desde);
  }
  const monedaEditable = (c) => {
    if (c == null) return "";
    const o = Math.floor(c / 10000), p = Math.floor((c % 10000) / 100), co = c % 100;
    return [o ? `${o}o` : "", p ? `${p}p` : "", co || (!o && !p) ? `${co}c` : ""].filter(Boolean).join(" ");
  };
  function campoPrecio(valor, clave, manual, etiqueta) {
    const i = el("input", "d-precio" + (manual ? " d-manual" : ""));
    i.type = "text"; i.autocomplete = "off"; i.spellcheck = false;
    i.value = monedaEditable(valor); i.placeholder = "sin precio";
    i.dataset.precio = clave;
    i.setAttribute("aria-label", etiqueta);
    i.title = "Escribe otro precio para simular (12o 34p 56c, 50p, 300). Vacío = precio del mercado.";
    return i;
  }

  function pintarDetalle() {
    const x = porSpell.get(detalle.spell);
    const cont = $("fab-det");
    if (!x) { cont.replaceChildren(cabPanel("Receta", "fab-det-tit"), el("p", "muted", "Esta receta ya no está en los datos.")); return; }
    const motor = opcionesMotor();
    const r = simularReceta(datos, x.spell, { ...motor, manual: detalle.manual, fabricaciones: detalle.veces, precioVenta: detalle.precioVenta });
    const r1 = detalle.veces === 1 ? r : simularReceta(datos, x.spell, { ...motor, manual: detalle.manual, fabricaciones: 1, precioVenta: detalle.precioVenta });
    const a = r.a, a1 = r1.a;
    const nombre = d.nom(x.id, x.nombre);

    const extraCab = el("span", "fab-det-acc");
    const fav = boton(esFavorita(x.spell) ? "★" : "☆", "fab-estrella", { fav: x.spell });
    fav.setAttribute("aria-pressed", String(esFavorita(x.spell)));
    fav.setAttribute("aria-label", esFavorita(x.spell) ? "Quitar de favoritas" : "Marcar como favorita");
    extraCab.append(fav);
    const cab = cabPanel(nombre, "fab-det-tit", extraCab);
    cab.querySelector("h2").className = "fab-det-nombre" + (x.calidad ? ` q-${x.calidad}` : "");

    // Objeto, profesión, rendimiento e ID (con copiar).
    const head = el("div", "fab-det-head");
    head.dataset.id = x.id;
    const meta = el("div", "fab-det-meta");
    const rend = a1.rendimiento.min === a1.rendimiento.max ? `${a1.rendimiento.min}` : `${a1.rendimiento.min}–${a1.rendimiento.max} (media ${cant(a1.rendimiento.medio)})`;
    meta.append(el("span", "", `${d.nombreProf(x.profesion)}${x.nivel != null ? ` · nivel ${x.nivel}` : ""}`),
      el("span", "", `Produce ${rend} por fabricación`));
    const idc = el("span", "fab-det-id");
    idc.append(`Objeto #${x.id} · receta ${x.spell} `);
    const cp = boton("Copiar ID", "enlace", { copiarId: x.id });
    idc.append(cp);
    meta.append(idc);
    head.append(d.iconoNodo(x.icono, nombre, x.calidad, true), meta);

    // Variantes del mismo objeto.
    const nodos = [cab, head];
    const variantes = filas.filter((y) => y.id === x.id);
    if (variantes.length > 1) {
      const dif = new Map(diferenciasVariantes(variantes, (id) => nombreObj(id)).map((v) => [v.spell, v.cambios]));
      const sec = el("div", "fab-det-var");
      sec.setAttribute("role", "group"); sec.setAttribute("aria-label", "Recetas de este objeto");
      sec.append(el("span", "fab-det-k", "Recetas de este objeto"));
      for (const v of ordenarFilas(variantes, orden.clave, orden.dir)) {
        const b = boton("", "fab-var-op", { variante: v.spell });
        b.setAttribute("aria-pressed", String(v.spell === x.spell));
        const n = el("span", "fab-var-txt", dif.get(v.spell).join(" · ") || v.receta);
        b.append(n, moneda(v.neta, { signo: true }));
        sec.append(b);
      }
      nodos.push(sec);
    }

    // Cantidad a fabricar.
    const cantidad = el("div", "fab-det-cant");
    const lbl = el("label", "fab-det-k", "Fabricaciones"); lbl.htmlFor = "fab-veces";
    const menos = boton("−", "fab-paso", { paso: "-1" }); menos.setAttribute("aria-label", "Una fabricación menos");
    const inp = el("input"); inp.id = "fab-veces"; inp.type = "number"; inp.min = "1"; inp.max = "100000"; inp.step = "1";
    inp.value = String(detalle.veces); inp.inputMode = "numeric"; inp.dataset.foco = "1";
    const mas = boton("+", "fab-paso", { paso: "1" }); mas.setAttribute("aria-label", "Una fabricación más");
    const unidades = el("span", "muted small", `= ${a.rendimiento.min === a.rendimiento.max ? "" : "≈ "}${cant(a.unidadesProducidas)} ${nombre}`);
    cantidad.append(lbl, el("span", "fab-stepper"), unidades);
    cantidad.querySelector(".fab-stepper").append(menos, inp, mas);
    if (a.maxFabricable.veces != null && a.maxFabricable.veces > 0) {
      const mx = boton(`Máximo con lo publicado: ${a.maxFabricable.veces.toLocaleString("es")}`, "enlace small", { maximo: Math.min(a.maxFabricable.veces, 100000) });
      cantidad.append(mx);
    }
    nodos.push(cantidad);

    // Resultado: por unidad, por fabricación y por lote.
    // Columnas: por unidad (solo si una fabricación da más de una), por fabricación y por lote (si hay más de una).
    const u1 = a1.unidadesProducidas;
    const conUnidad = u1 !== 1, conLote = detalle.veces > 1;
    const res = el("table", "fab-res");
    const thead = el("thead"), trh = el("tr");
    trh.append(el("th", "", ""));
    for (const t of [conUnidad ? "Por unidad" : null, "Por fabricación", conLote ? `Lote (×${detalle.veces.toLocaleString("es")})` : null]) {
      if (!t) continue;
      const th = el("th", "num", t); th.scope = "col"; trh.append(th);
    }
    thead.append(trh);
    const tb = el("tbody");
    const porU = (v) => (v == null ? null : Math.round(v / u1));
    const filaRes = (t, v1, vl, { signo = false, cls = "" } = {}) => {
      const tr = el("tr", cls);
      const th = el("th", "", t); th.scope = "row"; tr.append(th);
      for (const v of [conUnidad ? porU(v1) : undefined, v1, conLote ? vl : undefined]) {
        if (v === undefined) continue;
        const td = el("td", "num"); td.append(moneda(v, { signo })); tr.append(td);
      }
      tb.append(tr);
    };
    filaRes("Coste de materiales", a1.costeFabricacion, a.costeFabricacion);
    filaRes("Venta estimada", a1.ingresoBruto, a.ingresoBruto);
    filaRes(`Comisión (${op.comision} %)`, a1.comision == null ? null : -a1.comision, a.comision == null ? null : -a.comision, { signo: true });
    filaRes("Ganancia neta", a1.gananciaNeta, a.gananciaNeta, { signo: true, cls: "fab-res-neta" });
    res.append(thead, tb);
    const resumen = el("div", "fab-det-res");
    resumen.append(res);
    const kpis = el("p", "small muted fab-det-kpi");
    kpis.append(`Retorno ${pct(a1.roi) ?? "—"} · Margen ${pct(a1.margenNeto) ?? "—"} · Para no perder, vende a `, moneda(a1.precioEquilibrio), " o más por unidad");
    resumen.append(kpis);
    if (conUnidad) resumen.append(el("p", "small muted", "«Por unidad» divide entre las unidades medias que produce: es aproximado."));
    nodos.push(resumen);

    // Precio de venta (editable) y fuente.
    const fuente = el("div", "fab-det-fuente small");
    const notaVenta = detalle.precioVenta !== undefined ? "precio tuyo" : x.topeAplicado ? "recortado al tope del valor de mercado"
      : x.ventaSinOfertas ? "sin ofertas: valor de mercado" : "compra mínima";
    const pv = el("label", "fab-det-pv");
    pv.append("Precio de venta por unidad ", campoPrecio(a.precioVenta, "venta", detalle.precioVenta !== undefined, "Precio de venta por unidad"),
      el("span", "muted", ` ${notaVenta}`));
    fuente.append(pv, el("p", "muted", `Precios del escaneo del ${d.fecha(datos.escaneo)} (${d.hace(datos.escaneo)})`
      + `${datos.cantidades ? ` · unidades a la venta según ${datos.cantidades.proveedor}` : ""}.`));
    for (const m of motivosReferencia(x)) fuente.append(el("p", "fab-nota-ref", m));
    nodos.push(fuente);

    // Materiales.
    const mat = el("section", "fab-det-mat");
    const mcab = el("div", "fab-det-sec-cab");
    mcab.append(el("h3", "", "Materiales"));
    if (r.simulado) mcab.append(boton("Restablecer precios", "enlace small", { restablecer: "1" }));
    mat.append(mcab);
    const ul = el("ul", "fab-mats");
    for (const m of r.desglose.materiales) ul.append(itemMaterial(m));
    mat.append(ul);
    const tot = el("p", "fab-mats-tot");
    tot.append(a.completo ? "Total " : "Coste incompleto: falta el precio de algún material ", moneda(a.costeFabricacion));
    mat.append(tot);
    if (detalle.veces > 1 && r.desglose.materiales.some((m) => m.origen === "subasta")) {
      mat.append(el("p", "small fab-nota-ref", "Todas las unidades se valoran a la compra mínima. Comprar muchas puede salir más caro: "
        + "la fuente no publica cuántas hay a cada precio."));
    }
    if (r.desglose.materiales.some((m) => m.faltanEnSubasta > 0)) {
      mat.append(el("p", "small bad", "Hay menos unidades publicadas de las que necesitas de algún material (marcado arriba)."));
    }
    nodos.push(mat);

    // Acciones.
    const acc = el("div", "fab-det-acciones");
    acc.append(boton("Añadir a lista", "btn btn-rojo btn-small", { anadirLista: x.spell }),
      boton("Copiar materiales", "btn btn-piedra btn-small", { copiarMateriales: "1" }),
      boton(extras.comparar.includes(x.spell) ? "Quitar de comparar" : "Comparar", "btn btn-piedra btn-small", { comparar: x.spell }),
      boton("Ver ficha del objeto", "btn btn-piedra btn-small", { verObjeto: x.id }));
    nodos.push(acc);
    nodos.push(formAlertaReceta(x));

    // Historial bajo demanda.
    const h = el("details", "fab-det-hist");
    h.open = hist.spell === x.spell && hist.estado != null;
    h.append(el("summary", "", "Historial de precios"));
    const hc = el("div", "d-hist"); hc.dataset.spell = x.spell;
    h.append(hc);
    h.addEventListener("toggle", () => { if (h.open && hist.spell !== x.spell) cargarHistorial(x.spell, 7); else if (h.open) pintarHistorial(hc, x.spell); });
    if (h.open) setTimeout(() => pintarHistorial(hc, x.spell), 0);
    nodos.push(h);

    const avisos = [...new Set(a.avisos)].filter((t) => !/sin verificar/.test(t));
    if (avisos.length) { const ua = el("ul", "small muted fab-det-avisos"); for (const t of avisos) ua.append(el("li", "", t)); nodos.push(ua); }
    nodos.push(el("p", "small muted", `Comisión y depósito sin verificar en Forever. Depósito al publicar: ${d.formatear(a1.deposito)} (se recupera al vender).`));

    const cuerpo = el("div", "fab-drawer-cuerpo");
    cuerpo.append(...nodos.slice(1));
    cont.replaceChildren(nodos[0], cuerpo);
  }

  function itemMaterial(m, nivel = 0) {
    const li = el("li", "fab-mat" + (nivel ? " hijo" : ""));
    li.dataset.id = m.id;
    const nombre = nombreObj(m.id, m.nombre);
    const fila = el("div", "fab-mat-fila");
    const n = boton("", "fab-mat-nombre", { verObjeto: m.id });
    n.append(d.iconoNodo(m.icono, nombre, m.calidad), el("span", "objeto-nombre" + (m.calidad ? ` q-${m.calidad}` : ""), nombre));
    n.title = `Ver ficha de ${nombre}`;
    const c = el("span", "fab-mat-cant", `× ${cant(m.cantidad)}`);
    const origen = el("span", `origen o-${m.origen ?? "sin"}`, m.origen ? NOMBRE_ORIGEN[m.origen] ?? m.origen : "Sin precio");
    const precio = el("span", "fab-mat-precio");
    if (!nivel) precio.append(campoPrecio(m.precioUnitario, String(m.id), m.origen === "manual", `Precio por unidad de ${nombre}`));
    else precio.append(moneda(m.precioUnitario));
    const total = el("span", "fab-mat-total"); total.append(moneda(m.costeTotal));
    fila.append(n, c, total);
    const sub = el("div", "fab-mat-sub");
    sub.append(origen, precio, el("span", "muted small", "c/u"));
    if (!nivel && m.ahorroFabricando > 0 && m.origen === "fabricar") {
      const s = el("span", "small pos-txt"); s.append("Fabricarlo ahorra ", d.monedaNodo(m.ahorroFabricando), " c/u"); sub.append(s);
    } else if (!nivel && m.fabricar != null && m.comprar != null && m.origen !== "fabricar") {
      sub.append(el("span", "small muted", m.fabricar < m.comprar ? "Fabricarlo sería más barato (opción desactivada)" : "Comprarlo es más barato que fabricarlo"));
    }
    if (m.faltanEnSubasta > 0) sub.append(el("span", "small bad", `Solo hay ${m.disponible.toLocaleString("es")} publicadas`));
    li.append(fila, sub);
    if (m.hijos?.length) {
      const det = el("details", "fab-mat-hijos");
      det.append(el("summary", "small", `Se fabrica con ${m.hijos.length} ${m.hijos.length === 1 ? "material" : "materiales"}`));
      const ul = el("ul", "fab-mats");
      for (const h2 of m.hijos) ul.append(itemMaterial(h2, nivel + 1));
      det.append(ul);
      li.append(det);
    }
    return li;
  }

  function aplicarCampoDetalle(i) {
    if (i.id === "fab-veces") {
      const n = Math.round(Number(i.value));
      if (!Number.isInteger(n) || n < 1 || n > 100000) { d.avisar("Fabricaciones: un número entero de 1 a 100.000.", "bad"); i.value = String(detalle.veces); return; }
      if (n === detalle.veces) return;
      detalle.veces = n; pintarDetalle(); $("fab-veces")?.focus();
      return;
    }
    const clave = i.dataset.precio;
    if (!clave) return;
    let v;
    try { v = i.value.trim() === "" ? null : parsearMoneda(i.value); }
    catch (e) { d.avisar(e.message, "bad"); i.setAttribute("aria-invalid", "true"); return; }
    if (clave === "venta") detalle.precioVenta = v == null ? undefined : v;
    else if (v == null) delete detalle.manual[clave];
    else detalle.manual[clave] = v;
    pintarDetalle();
    $("fab-det").querySelector(`[data-precio="${clave}"]`)?.focus();
    d.avisar("Simulación: la tabla sigue con los precios del mercado.");
  }
  $("fab-det").addEventListener("change", (ev) => { if (ev.target.matches("input") && !ev.target.closest(".fab-alerta-form")) aplicarCampoDetalle(ev.target); });
  $("fab-det").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && ev.target.matches("input") && !ev.target.closest(".fab-alerta-form")) { ev.preventDefault(); aplicarCampoDetalle(ev.target); }
  });
  $("fab-det").addEventListener("click", async (ev) => {
    const t = ev.target;
    const paso = t.closest("[data-paso]");
    if (paso) { detalle.veces = Math.min(100000, Math.max(1, detalle.veces + Number(paso.dataset.paso))); pintarDetalle(); $("fab-det").querySelector(`[data-paso="${paso.dataset.paso}"]`)?.focus(); return; }
    const mx = t.closest("[data-maximo]");
    if (mx) { detalle.veces = Number(mx.dataset.maximo); pintarDetalle(); $("fab-veces")?.focus(); return; }
    if (t.closest("[data-restablecer]")) { detalle.manual = {}; detalle.precioVenta = undefined; pintarDetalle(); d.avisar("Precios del mercado restablecidos."); return; }
    const v = t.closest("[data-variante]");
    if (v) { const s = Number(v.dataset.variante); Object.assign(detalle, { spell: s, manual: {}, precioVenta: undefined }); pintarDetalle(); $("fab-det").querySelector(`[data-variante="${s}"]`)?.focus(); return; }
    const fav = t.closest("[data-fav]");
    if (fav) { alternarFavorita(Number(fav.dataset.fav)); return; }
    const vo = t.closest("[data-ver-objeto]");
    if (vo) { cerrarPanel({ devolver: false }); d.abrirObjeto(Number(vo.dataset.verObjeto)); return; }
    const ci = t.closest("[data-copiar-id]");
    if (ci) { const ok = await d.copiarTexto?.(ci.dataset.copiarId); d.avisar(ok ? `ID ${ci.dataset.copiarId} copiado.` : "No se pudo copiar.", ok ? "" : "bad"); return; }
    if (t.closest("[data-copiar-materiales]")) {
      const r = simularReceta(datos, detalle.spell, { ...opcionesMotor(), manual: detalle.manual, fabricaciones: detalle.veces, precioVenta: detalle.precioVenta });
      const texto = textoMateriales(r.desglose.materiales, (m) => nombreObj(m.id, m.nombre));
      const ok = await d.copiarTexto?.(texto);
      d.avisar(ok ? "Materiales copiados." : "No se pudo copiar.", ok ? "" : "bad");
      return;
    }
    const al = t.closest("[data-anadir-lista]");
    if (al) { cambiarLista(anadirALista(lista, Number(al.dataset.anadirLista), detalle.veces)); d.avisar(`Añadida a la lista (×${detalle.veces.toLocaleString("es")}).`); return; }
    const cmp = t.closest("[data-comparar]");
    if (cmp) { alternarComparar(Number(cmp.dataset.comparar)); pintarDetalle(); return; }
    const ca = t.closest("[data-alerta-receta]");
    if (ca) {
      const caja = ca.closest(".fab-alerta-form");
      const campo = caja.querySelector("select").value;
      let umbral;
      try { umbral = leerUmbral(campo, caja.querySelector("input").value); } catch (e) { d.avisar(e.message, "bad"); return; }
      if (umbral == null) { d.avisar("Pon un umbral", "bad"); return; }
      if (nuevaAlerta({ tipo: "receta", spell: Number(ca.dataset.alertaReceta), campo, umbral })) caja.querySelector("input").value = "";
    }
  });

  function formAlertaReceta(x) {
    const det = el("details", "fab-alerta-receta");
    det.append(el("summary", "", "Crear alerta"));
    const form = el("div", "fab-alerta-form");
    const sel = el("select");
    sel.setAttribute("aria-label", "Qué vigilar");
    for (const [v, t] of Object.entries(CAMPOS_ALERTA)) { const o = el("option", "", t === "ROI" ? "Retorno" : t); o.value = v; sel.append(o); }
    const inp = el("input"); inp.type = "text"; inp.placeholder = "p. ej. 1o o 50"; inp.setAttribute("aria-label", "Umbral");
    form.append(el("span", "small", "Avísame cuando"), sel, el("span", "small", "≥"), inp, boton("Crear", "btn btn-piedra btn-small", { alertaReceta: x.spell }));
    det.append(form);
    return det;
  }

  // ---------- historial (bajo demanda, en el detalle) ----------
  let hist = { spell: null, dias: 7, estado: null, serie: null, crudo: null, error: null };
  const PERIODOS = [[1, "24 h"], [7, "7 d"], [30, "30 d"], [90, "90 d"]];
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
      if (hist.spell !== spell || hist.dias !== dias) return;
      hist = { ...hist, estado: "ok", crudo: j, serie: serieHistorial(datos, spell, j, opcionesMotor()) };
    } catch (e) {
      if (hist.spell !== spell) return;
      hist = { ...hist, estado: "error", error: e.message };
    }
    repintarHistorial();
  }
  function repintarHistorial() {
    const c = $("fab-det").querySelector(".d-hist");
    if (c) pintarHistorial(c, Number(c.dataset.spell));
  }
  function pintarHistorial(cont, spell) {
    const cab = el("div", "periodos");
    cab.setAttribute("role", "group"); cab.setAttribute("aria-label", "Periodo del historial");
    for (const [dias, t] of PERIODOS) {
      const b = boton(t, "btn-periodo", { histDias: dias });
      b.setAttribute("aria-pressed", String(hist.spell === spell && hist.dias === dias));
      cab.append(b);
    }
    const cuerpo = el("div", "d-hist-cuerpo");
    if (hist.spell !== spell || hist.estado === "cargando") cuerpo.append(el("p", "muted small", "Cargando el historial…"));
    else if (hist.estado === "error") cuerpo.append(el("p", "bad small", "No se pudo cargar el historial: " + hist.error));
    else {
      const s = hist.serie;
      if (!s || s.escaneos < 2) cuerpo.append(el("p", "muted small", "Todavía no hay historial suficiente en este periodo."));
      else {
        cuerpo.append(el("p", "muted small", `${s.escaneos} escaneos. Cada punto usa los precios de ese escaneo y las mismas reglas; tus precios simulados no se aplican.`));
        const g1 = el("div", "d-hist-graf"), g2 = el("div", "d-hist-graf");
        cuerpo.append(el("h4", "small", "Venta y coste de fabricación"), g1, el("h4", "small", "Ganancia neta"), g2);
        setTimeout(() => {
          dibujarGrafico(g1, { puntos: s.puntos.map((p) => [p[0], p[1], p[2]]), nombres: ["Precio de venta", "Coste de fabricación"],
                               cantidad: s.unidades.n ? s.puntos.map((p) => [p[0], p[4]]) : undefined });
          dibujarGrafico(g2, { puntos: s.puntos.map((p) => [p[0], p[3], null]), nombres: ["Ganancia neta", null] });
        }, 0);
      }
    }
    cont.replaceChildren(cab, cuerpo);
  }
  $("fab-det").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-hist-dias]");
    if (b) cargarHistorial(Number(b.closest(".d-hist").dataset.spell), Number(b.dataset.histDias));
  });

  // ---------- favoritas y comparador (hasta 3) ----------
  function botonEstrella(x) {
    const fav = esFavorita(x.spell);
    const b = boton(fav ? "★" : "☆", "fab-estrella", { fav: x.spell });
    b.setAttribute("aria-pressed", String(fav));
    b.setAttribute("aria-label", `${fav ? "Quitar de favoritas" : "Marcar como favorita"}: ${d.nom(x.id, x.nombre)}`);
    b.title = fav ? "Quitar de favoritas" : "Marcar como favorita";
    return b;
  }
  function alternarFavorita(spell) {
    const era = esFavorita(spell);
    extras.favoritas = alternarSpell(extras.favoritas, spell);
    guardarExtras();
    for (const b of document.querySelectorAll(`#vista-fabricacion [data-fav="${spell}"]`)) {
      b.textContent = era ? "☆" : "★"; b.setAttribute("aria-pressed", String(!era));
      b.setAttribute("aria-label", era ? "Marcar como favorita" : "Quitar de favoritas");
    }
    d.avisar(era ? "Quitada de favoritas." : "Marcada como favorita.");
    if (f.soloFavoritas) pintar();
  }
  function alternarComparar(spell) {
    if (extras.comparar.includes(spell)) extras.comparar = extras.comparar.filter((s) => s !== spell);
    else {
      const r = anadirComparar(extras.comparar, spell);
      if (r.error) { d.avisar(r.error, "bad"); return; }
      extras.comparar = r.lista;
      d.avisar(`Añadida al comparador (${extras.comparar.length}/${MAX_COMPARAR}).`);
    }
    guardarExtras(); pintarBotones();
  }
  function pintarComparar() {
    const c = compararRecetas(filas, extras.comparar, datos?.objetos ?? {});
    const cont = $("fab-cmp");
    const nodos = [cabPanel(`Comparar recetas (${c.recetas.length}/${MAX_COMPARAR})`, "fab-cmp-tit")];
    const cuerpo = el("div", "fab-drawer-cuerpo");
    if (c.recetas.length < 2) cuerpo.append(el("p", "muted", "Añade al menos 2 recetas desde su detalle con «Comparar»."));
    const t = el("table", "tabla cmp-tabla");
    const th = el("thead"), trh = el("tr");
    trh.append(el("th", "", ""));
    for (const x of c.recetas) {
      const h = el("th", "cmp-col"); h.scope = "col";
      const b = boton("", "cmp-receta", { abrir: x.spell });
      b.append(d.iconoNodo(x.icono, d.nom(x.id, x.nombre), x.calidad), el("span", "", d.nom(x.id, x.nombre)), el("span", "muted small", d.nombreProf(x.profesion)));
      const q = boton("Quitar", "enlace small", { quitarComparar: x.spell });
      h.append(b, q);
      trh.append(h);
    }
    th.append(trh);
    const tb = el("tbody");
    const NOMBRES = { ROI: "Retorno", "Ventas/día": "Ventas al día" };
    for (const m of c.metricas) {
      const tr = el("tr");
      const n = el("th", "", NOMBRES[m.nombre] ?? m.nombre); n.scope = "row"; tr.append(n);
      m.valores.forEach((v, k) => {
        const td = el("td", "num" + (m.mejores[k] ? " cmp-mejor" : ""));
        if (m.tipo === "moneda") td.append(moneda(v, { signo: m.clave === "neta" }));
        else if (m.tipo === "pct") td.textContent = pct(v) ?? "—";
        else td.textContent = v == null ? "—" : v.toLocaleString("es", { maximumFractionDigits: 1 });
        if (m.mejores[k]) td.title = "La mejor de las comparadas";
        tr.append(td);
      });
      tb.append(tr);
    }
    t.append(th, tb);
    if (c.recetas.length) { const w = el("div", "tabla-wrap"); w.append(t); cuerpo.append(w); }
    if (c.recetas.length) cuerpo.append(boton("Vaciar comparador", "btn btn-piedra btn-small", { vaciarComparador: "1" }));
    nodos.push(cuerpo);
    cont.replaceChildren(...nodos);
  }
  $("fab-cmp-btn").addEventListener("click", (ev) => { pintarComparar(); abrirPanel("fab-cmp", ev.currentTarget); });
  $("fab-cmp").addEventListener("click", (ev) => {
    const q = ev.target.closest("[data-quitar-comparar]");
    if (q) { alternarComparar(Number(q.dataset.quitarComparar)); pintarComparar(); return; }
    if (ev.target.closest("[data-vaciar-comparador]")) { extras.comparar = []; guardarExtras(); pintarBotones(); pintarComparar(); return; }
    const a = ev.target.closest("[data-abrir]");
    if (a) abrirDetalle(Number(a.dataset.abrir), $("fab-cmp-btn"));
  });

  // ---------- lista de fabricación ----------
  function cambiarLista(nueva, { registrar = true } = {}) {
    if (registrar) { deshacer.push(JSON.stringify(lista)); if (deshacer.length > 30) deshacer.shift(); }
    lista = normalizarLista(nueva);
    d.local.escribir(CLAVE_LISTA, lista);
    pintarBotones();
    if (!$("fab-lista").hidden) pintarLista();
  }
  const simularLista = (spell, veces) => (porSpell.has(spell)
    ? simularReceta(datos, spell, { ...opcionesMotor(), fabricaciones: veces }) : null);
  function pintarLista() {
    const cont = $("fab-lista");
    const des = boton("Deshacer", "enlace small", { deshacer: "1" });
    des.disabled = deshacer.length === 0;
    const nodos = [cabPanel("Lista de fabricación", "fab-lista-tit", des)];
    const cuerpo = el("div", "fab-drawer-cuerpo");
    if (!lista.items.length) {
      cuerpo.append(el("p", "muted", "Tu lista está vacía. Abre una receta y pulsa «Añadir a lista»."));
      nodos.push(cuerpo); cont.replaceChildren(...nodos); return;
    }
    const c = datos ? consolidarLista(lista, simularLista) : { recetas: lista.items.map((x) => ({ ...x, existe: false })), materiales: [] };
    const ulR = el("ul", "fab-lista-rec");
    for (const r of c.recetas) {
      const x = porSpell.get(r.spell);
      const li = el("li");
      if (x) li.dataset.id = x.id;
      const n = x ? boton("", "fab-mat-nombre", { abrir: r.spell }) : el("span", "muted", `Receta ${r.spell} (ya no está en los datos)`);
      if (x) n.append(d.iconoNodo(x.icono, d.nom(x.id, x.nombre), x.calidad), el("span", "objeto-nombre" + (x.calidad ? ` q-${x.calidad}` : ""), d.nom(x.id, x.nombre)));
      const st = el("span", "fab-stepper");
      const menos = boton("−", "fab-paso", { listaPaso: `${r.spell}:-1` }); menos.setAttribute("aria-label", "Una menos");
      const inp = el("input"); inp.type = "number"; inp.min = "1"; inp.max = "100000"; inp.value = String(r.veces); inp.dataset.listaVeces = r.spell;
      inp.setAttribute("aria-label", "Fabricaciones");
      const mas = boton("+", "fab-paso", { listaPaso: `${r.spell}:1` }); mas.setAttribute("aria-label", "Una más");
      st.append(menos, inp, mas);
      const q = boton("Quitar", "enlace small", { listaQuitar: r.spell });
      const neta = el("span", "fab-lista-neta"); if (r.existe) neta.append(moneda(r.neta, { signo: true }));
      li.append(n, st, neta, q);
      ulR.append(li);
    }
    cuerpo.append(ulR);
    // Materiales consolidados.
    const sec = el("section", "fab-lista-mat");
    sec.append(el("h3", "", "Materiales"), el("p", "small muted", "Marca lo que ya tienes: se resta de lo que falta comprar."));
    // Una fila por material: nombre y gasto pendiente; debajo, cuántas necesitas, cuántas tienes y cuántas faltan.
    const ulM = el("ul", "fab-lista-mats");
    for (const m of c.materiales) {
      const li = el("li");
      li.dataset.id = m.id;
      const nombre = nombreObj(m.id, m.nombre);
      const arriba = el("div", "fab-lm-arriba");
      const n = el("span", "fab-lista-n");
      n.append(d.iconoNodo(m.icono, nombre, m.calidad), el("span", "objeto-nombre" + (m.calidad ? ` q-${m.calidad}` : ""), nombre));
      const pend = el("span", "fab-lm-gasto"); pend.append(moneda(m.pendiente));
      pend.title = "Gasto pendiente: lo que falta × su precio";
      arriba.append(n, pend);
      const abajo = el("div", "fab-lm-abajo small");
      const lbl = el("label", "fab-lm-tengo", "Tienes ");
      const i = el("input"); i.type = "number"; i.min = "0"; i.inputMode = "numeric"; i.value = m.tengo ? String(m.tengo) : ""; i.placeholder = "0";
      i.dataset.tengo = m.id; i.setAttribute("aria-label", `Unidades que ya tienes de ${nombre}`);
      lbl.append(i);
      abajo.append(el("span", "muted", `Necesitas ${cant(m.necesito)}`), lbl,
        el("span", m.falta ? "" : "pos-txt", m.falta ? `Falta ${m.falta.toLocaleString("es")}` : "Lo tienes todo"));
      li.append(arriba, abajo);
      ulM.append(li);
    }
    sec.append(ulM);
    const tot = el("dl", "fab-lista-tot");
    const lin = (k, v, signo = false) => { tot.append(el("dt", "", k)); const dd = el("dd"); dd.append(moneda(v, { signo })); tot.append(dd); };
    lin("Gasto pendiente (lo que falta comprar)", c.pendiente);
    lin("Coste total de los materiales", c.costeTotal);
    lin("Ganancia neta estimada de la lista", c.neta, true);
    sec.append(tot, el("p", "small muted", "Lo que ya tienes no cuenta como gratis: la ganancia usa el precio de mercado de todos los materiales."));
    if (c.incompletos.length) sec.append(el("p", "small bad", "Algún material no tiene precio: los totales están incompletos."));
    const acc = el("div", "fab-det-acciones");
    acc.append(boton("Copiar lo que falta", "btn btn-piedra btn-small", { copiarFalta: "1" }), boton("Vaciar lista", "btn btn-piedra btn-small", { vaciarLista: "1" }));
    sec.append(acc);
    cuerpo.append(sec);
    nodos.push(cuerpo);
    cont.replaceChildren(...nodos);
  }
  $("fab-lista-btn").addEventListener("click", (ev) => { pintarLista(); abrirPanel("fab-lista", ev.currentTarget); });
  $("fab-lista").addEventListener("click", async (ev) => {
    const t = ev.target;
    const paso = t.closest("[data-lista-paso]");
    if (paso) {
      const [s, dlt] = paso.dataset.listaPaso.split(":").map(Number);
      cambiarLista({ ...lista, items: lista.items.map((y) => (y.spell === s ? { ...y, veces: Math.max(1, y.veces + dlt) } : y)) });
      $("fab-lista").querySelector(`[data-lista-paso="${paso.dataset.listaPaso}"]`)?.focus();
      return;
    }
    const q = t.closest("[data-lista-quitar]");
    if (q) { cambiarLista({ ...lista, items: lista.items.filter((y) => y.spell !== Number(q.dataset.listaQuitar)) }); d.avisar("Quitada de la lista. Puedes deshacerlo."); return; }
    if (t.closest("[data-vaciar-lista]")) { cambiarLista({ items: [], tengo: {} }); d.avisar("Lista vaciada. Puedes deshacerlo."); return; }
    if (t.closest("[data-deshacer]")) {
      if (!deshacer.length) return;
      cambiarLista(JSON.parse(deshacer.pop()), { registrar: false });
      d.avisar("Cambio deshecho.");
      $("fab-lista").querySelector("[data-deshacer]")?.focus();
      return;
    }
    if (t.closest("[data-copiar-falta]")) {
      const c = consolidarLista(lista, simularLista);
      const texto = c.materiales.filter((m) => m.falta > 0).map((m) => `${m.falta} × ${nombreObj(m.id, m.nombre)}`).join("\n");
      const ok = texto ? await d.copiarTexto?.(texto) : false;
      d.avisar(texto ? (ok ? "Lista de compra copiada." : "No se pudo copiar.") : "No falta nada.", ok || !texto ? "" : "bad");
      return;
    }
    const a = t.closest("[data-abrir]");
    if (a) abrirDetalle(Number(a.dataset.abrir), $("fab-lista-btn"));
  });
  $("fab-lista").addEventListener("change", (ev) => {
    const v = ev.target.closest("[data-lista-veces]");
    if (v) {
      const n = Math.round(Number(v.value));
      if (!Number.isInteger(n) || n < 1) { d.avisar("Un número entero de 1 o más.", "bad"); pintarLista(); return; }
      cambiarLista({ ...lista, items: lista.items.map((y) => (y.spell === Number(v.dataset.listaVeces) ? { ...y, veces: n } : y)) });
      return;
    }
    const tg = ev.target.closest("[data-tengo]");
    if (tg) {
      const n = tg.value.trim() === "" ? 0 : Math.round(Number(tg.value));
      if (!Number.isInteger(n) || n < 0) { d.avisar("Un número entero de 0 o más.", "bad"); pintarLista(); return; }
      const tengo = { ...lista.tengo };
      if (n > 0) tengo[tg.dataset.tengo] = n; else delete tengo[tg.dataset.tengo];
      cambiarLista({ ...lista, tengo });
      $("fab-lista").querySelector(`[data-tengo="${tg.dataset.tengo}"]`)?.focus();
    }
  });

  // ---------- alertas ----------
  const valorAlerta = (campo, v) => (campo === "neta" ? d.formatear(v) : `${v.toLocaleString("es")} %`);
  const nombreAlerta = (c) => (c === "roi" ? "Retorno" : CAMPOS_ALERTA[c]);
  function textoAlerta(a) {
    const cond = `${nombreAlerta(a.campo)} ≥ ${valorAlerta(a.campo, a.umbral)}`;
    if (a.tipo === "receta") { const x = porSpell.get(a.spell); return `${x ? d.nom(x.id, x.nombre) : `Receta ${a.spell}`}: ${cond}`; }
    const profs = a.profesiones?.length ? ` de ${a.profesiones.map(d.nombreProf).join(", ")}` : "";
    return `Cualquier receta${profs} con ${cond}`;
  }
  let cumplidas = [];
  function pintarAlertas() {
    cumplidas = datos ? evaluarAlertas(filas, extras.alertas, datos.objetos) : [];
    const aviso = $("fab-alertas-cumplidas");
    aviso.hidden = cumplidas.length === 0;
    if (cumplidas.length) {
      const n = cumplidas.reduce((s, c) => s + c.recetas.length, 0);
      aviso.replaceChildren(el("span", "", `${cumplidas.length === 1 ? "Se cumple 1 alerta" : `Se cumplen ${cumplidas.length} alertas`} (${n} ${n === 1 ? "receta" : "recetas"}).`),
        boton("Ver", "btn btn-piedra btn-small", { verAlertas: "1" }));
    }
    pintarBotones();
    if (!$("fab-alertas").hidden) pintarPanelAlertas();
  }
  function pintarPanelAlertas() {
    const cont = $("fab-alertas");
    const cuerpo = el("div", "fab-drawer-cuerpo");
    cuerpo.append(el("p", "small muted", "Se revisan cada vez que llegan precios nuevos con esta página abierta, en este navegador."));
    const ul = el("ul", "fab-alertas-lista");
    if (!extras.alertas.length) ul.append(el("li", "muted", "Aún no tienes alertas."));
    for (const a of extras.alertas) {
      const li = el("li");
      const c = cumplidas.find((x) => x.alerta.id === a.id);
      const txt = el("div", "fab-al-txt");
      txt.append(el("span", c ? "pos-txt" : "", `${c ? "● " : "○ "}${textoAlerta(a)}`));
      if (c) {
        const recs = el("span", "small");
        c.recetas.slice(0, 5).forEach((x, k) => { if (k) recs.append(", "); recs.append(boton(d.nom(x.id, x.nombre), "enlace", { abrir: x.spell })); });
        if (c.recetas.length > 5) recs.append(` y ${c.recetas.length - 5} más`);
        txt.append(recs);
      }
      li.append(txt, boton("Borrar", "enlace small", { borrarAlerta: a.id }));
      ul.append(li);
    }
    const form = el("div", "fab-alerta-form");
    const sel = el("select"); sel.id = "fab-alerta-campo"; sel.setAttribute("aria-label", "Qué vigilar");
    for (const [v, t] of Object.entries(CAMPOS_ALERTA)) { const o = el("option", "", t === "ROI" ? "Retorno" : t); o.value = v; sel.append(o); }
    const inp = el("input"); inp.id = "fab-alerta-umbral"; inp.type = "text"; inp.placeholder = "p. ej. 1o o 50"; inp.setAttribute("aria-label", "Umbral");
    const mias = el("label", "check small");
    const cm = el("input"); cm.type = "checkbox"; cm.id = "fab-alerta-mias"; cm.checked = true;
    mias.append(cm, " solo de las profesiones elegidas");
    form.append(el("span", "small", "Cualquier receta con"), sel, el("span", "small", "≥"), inp, mias, boton("Crear alerta", "btn btn-piedra btn-small", { crearAlerta: "1" }));
    cuerpo.append(ul, el("h3", "", "Nueva alerta"), form);
    cont.replaceChildren(cabPanel("Alertas de fabricación", "fab-al-tit"), cuerpo);
  }
  function nuevaAlerta(datosAlerta) {
    try { extras.alertas = crearAlerta(extras.alertas, datosAlerta); } catch (e) { d.avisar(e.message, "bad"); return false; }
    guardarExtras(); pintarAlertas();
    d.avisar("Alerta creada.");
    return true;
  }
  function leerUmbral(campo, texto) {
    if (campo === "neta") return parsearMoneda(texto);
    const n = Number(String(texto).replace(",", ".").replace("%", "").trim());
    if (texto.trim() === "") return null;
    if (!Number.isFinite(n)) throw new Error("El retorno debe ser un número (por ejemplo, 50)");
    return n;
  }
  $("fab-alertas-btn").addEventListener("click", (ev) => { pintarPanelAlertas(); abrirPanel("fab-alertas", ev.currentTarget); });
  $("fab-alertas-cumplidas").addEventListener("click", (ev) => { if (ev.target.closest("[data-ver-alertas]")) { pintarPanelAlertas(); abrirPanel("fab-alertas", ev.target); } });
  $("fab-alertas").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-borrar-alerta]");
    if (b) { extras.alertas = extras.alertas.filter((a) => a.id !== b.dataset.borrarAlerta); guardarExtras(); pintarAlertas(); d.avisar("Alerta borrada."); return; }
    if (ev.target.closest("[data-crear-alerta]")) {
      const campo = $("fab-alerta-campo").value;
      let umbral;
      try { umbral = leerUmbral(campo, $("fab-alerta-umbral").value); } catch (e) { d.avisar(e.message, "bad"); return; }
      if (umbral == null) { d.avisar("Pon un umbral", "bad"); return; }
      nuevaAlerta({ tipo: "general", campo, umbral, profesiones: $("fab-alerta-mias").checked ? [...f.profesiones] : [] });
      return;
    }
    const a = ev.target.closest("[data-abrir]");
    if (a) abrirDetalle(Number(a.dataset.abrir), $("fab-alertas-btn"));
  });

  /** Contadores de los botones Comparar, Lista y Alertas. */
  function pintarBotones() {
    const nC = extras.comparar.length;
    $("fab-cmp-btn").hidden = nC === 0;
    $("fab-cmp-n").textContent = `${nC}/${MAX_COMPARAR}`;
    const nL = lista.items.length;
    $("fab-lista-n").hidden = nL === 0; $("fab-lista-n").textContent = String(nL);
    $("fab-lista-btn").setAttribute("aria-label", nL ? `Lista de fabricación (${nL})` : "Lista de fabricación");
    const nA = extras.alertas.length;
    $("fab-alertas-n").hidden = nA === 0;
    $("fab-alertas-n").textContent = String(nA);
    $("fab-alertas-n").classList.toggle("cumple", cumplidas.length > 0);
    $("fab-alertas-btn").setAttribute("aria-label", nA ? `Alertas (${nA}${cumplidas.length ? `, ${cumplidas.length} cumplidas` : ""})` : "Alertas");
  }

  // ---------- pintado general ----------
  function pintar() {
    pintarChips(); pintarBotones();
    if (!datos) return;
    pintarDato();
    $("fab-error").hidden = !error;
    $("fab-pf-n").textContent = filtradas().length.toLocaleString("es");   // «Ver N recetas» del panel de filtros
    if (modo === "oportunidades") pintarOportunidades(); else pintarTabla();
  }

  filtrosAControles();
  pintarBotones();

  return {
    /** Muestra la vista (pestaña Recetas u Oportunidades) y carga los datos del mercado actual si hace falta. */
    mostrar(m = "tabla") {
      modo = m;
      const oport = m === "oportunidades";
      $("vista-fabricacion").classList.toggle("modo-oport", oport);
      for (const [id, activo] of [["modo-tabla", !oport], ["modo-oport", oport]]) {
        if (activo) $(id).setAttribute("aria-current", "page"); else $(id).removeAttribute("aria-current");
      }
      $("ayuda-oport-resumen").hidden = !oport;
      if (datos && datosMercado === d.mercado()) pintar();
      return cargar();
    },
    abrirReceta: (spell) => abrirDetalle(spell),
    /** Hay escaneo nuevo: se vuelve a pedir sin mover lo que se ve (se ofrece «Reordenar»). */
    refrescar: () => cargar({ forzar: true, silencioso: true }),
    invalidar: () => { datosMercado = null; },
    enfocarBuscador() { $("fab-texto").focus(); $("fab-texto").select(); },
    /** Buscador global: filtra por texto. */
    buscarTexto(texto) { $("fab-texto").value = texto; aplicarTexto(texto); },
    /** Buscador global con un objeto: sus recetas y, si hay, el detalle de la mejor. */
    async buscarObjeto(id) {
      await cargar();
      const suyas = ordenarFilas(filas.filter((x) => x.id === id), orden.clave, orden.dir);
      const nombre = suyas[0] ? d.nom(id, suyas[0].nombre) : String(id);
      $("fab-texto").value = nombre; aplicarTexto(suyas.length ? nombre : String(id));
      if (suyas.length) abrirDetalle(suyas[0].spell);
      else d.avisar("Ninguna receta fabrica este objeto: se muestran las que lo usan como material.");
    },
  };
}

// UMBRAL se reexporta para quien necesite los umbrales de las oportunidades junto a la vista.
export { UMBRAL };
