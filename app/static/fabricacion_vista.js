// Vista «Fabricación» (etapa 2): tabla de rentabilidad de TODAS las recetas con el motor del navegador.
// La parte sin DOM (cálculo, filtros, orden, CSV) está en fabricacion_tabla.js y se prueba en Node.

import { calcularFilas, filasACsv, filtrarFilas, ordenarFilas } from "./fabricacion_tabla.js";
import { REGLA_POR_DEFECTO } from "./fabricacion.js";
import { parsearMoneda } from "./moneda.js";

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
    ...(guardado.filtros ?? {}),
    texto: "",
  };
  const op = { valorSinOfertas: true, fabricarIntermedios: true, comision: 5, ...(guardado.opciones ?? {}) };
  let orden = guardado.orden ?? { clave: "neta", dir: "desc" };
  let datos = null, datosMercado = null, filas = [], pagina = 1, cargando = null;

  const guardar = () => d.local.escribir(CLAVE_LOCAL, {
    profesiones: f.profesiones, orden, opciones: op,
    filtros: { roiMin: f.roiMin, netaMin: f.netaMin, nivelMin: f.nivelMin, nivelMax: f.nivelMax, soloCompletas: f.soloCompletas,
               soloRentables: f.soloRentables, soloConVenta: f.soloConVenta, soloMaterialesEnVenta: f.soloMaterialesEnVenta,
               soloConVentas: f.soloConVentas },
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
  const casillas = ["soloCompletas", "soloRentables", "soloConVenta", "soloMaterialesEnVenta", "soloConVentas"];
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
                       soloCompletas: false, soloRentables: false, soloConVenta: false, soloMaterialesEnVenta: false, soloConVentas: false });
    for (const id of ["fab-texto", "fab-roi", "fab-neta", "fab-nivel-min", "fab-nivel-max"]) $(id).value = "";
    for (const k of casillas) $(`fab-${k}`).checked = false;
    guardar(); pagina = 1; pintarProfesiones(); pintar();
  });
  $("fab-csv").addEventListener("click", () => {
    const lista = ordenarFilas(filtrarFilas(filas, f), orden.clave, orden.dir);
    const blob = new Blob(["﻿" + filasACsv(lista, (x) => d.nom(x.id, x.nombre))], { type: "text/csv;charset=utf-8" });
    const a = el("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fabricacion-${(datos?.mercado ?? "mercado").replaceAll(":", "-")}.csv`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("fab-pag-ant").addEventListener("click", () => { pagina--; pintar(); $("vista-fabricacion").scrollIntoView({ block: "start" }); });
  $("fab-pag-sig").addEventListener("click", () => { pagina++; pintar(); $("vista-fabricacion").scrollIntoView({ block: "start" }); });
  $("fab-tbody").addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr[data-id]");
    if (tr) d.abrirObjeto(Number(tr.dataset.id));
  });
  $("fab-tbody").addEventListener("keydown", (ev) => {
    const tr = ev.target.closest("tr[data-id]");
    if (tr && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); d.abrirObjeto(Number(tr.dataset.id)); }
  });

  // ---------- datos y cálculo ----------
  function calcular() {
    if (!datos) { filas = []; return; }
    const regla = { ...REGLA_POR_DEFECTO, comision_pct: op.comision };
    const t = performance.now();
    filas = calcularFilas(datos, { regla, valorSinOfertas: op.valorSinOfertas, fabricarIntermedios: op.fabricarIntermedios });
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
    tr.tabIndex = 0;
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
    tdObj.append(caja);
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
    const lista = ordenarFilas(filtrarFilas(filas, f), orden.clave, orden.dir);
    const total = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
    pagina = Math.min(Math.max(1, pagina), total);
    const desde = (pagina - 1) * POR_PAGINA;
    $("fab-tbody").replaceChildren(...lista.slice(desde, desde + POR_PAGINA).map(fila));
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
    mostrar: () => cargar(),
    /** Hay escaneo nuevo o se cambió de mercado: vuelve a pedir los datos. */
    refrescar: () => cargar({ forzar: true }),
    /** Hay datos nuevos pero la vista no se ve: se pedirán al volver a ella. */
    invalidar: () => { datosMercado = null; },
  };
}
