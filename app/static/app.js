// Casa de Subastas — WoW Forever. Una sola vista: Mercado (barra lateral, tabla y detalle del objeto).
// La tabla recorre TODO el catálogo y la pide por páginas al servidor (filtros, orden y paginación en SQL).
import { dibujarGrafico } from "./grafico.js";
import { formatearMoneda, parsearMoneda } from "./moneda.js";
import { ESTADO_INICIAL, alEscribir, conSugerencias, teclado } from "./autocompletar.js";
import { leerRuta } from "./ruta.js";
import { NOMBRE_PROFESION } from "./recetas.js";
import { NOMBRE_CALIDAD, NOMBRE_CATEGORIA, NOMBRE_REC, SIN_CATEGORIA, formatearPct } from "./tabla.js";
import { ESTADO, POR_PAGINA, paginas, paramsMercado, segmentosSpark } from "./mercado.js";

// ---------- utilidades ----------
const $ = (id) => document.getElementById(id);
const el = (tag, cls, texto) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto !== undefined) e.textContent = texto;
  return e;
};
const fecha = (iso) => iso ? new Date(iso).toLocaleString("es", { dateStyle: "short", timeStyle: "short" }) : "—";
/** «hace 18 min», «hace 3 h», «hace 2 días». */
function hace(iso) {
  if (!iso) return "sin datos";
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return "ahora";
  if (min < 120) return `hace ${min} min`;
  if (min < 48 * 60) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} días`;
}
const local = {
  leer(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  escribir(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento: no pasa nada */ } },
};
const nombreCat = (c) => NOMBRE_CATEGORIA[c] ?? c;
const nombreProf = (p) => NOMBRE_PROFESION[p] ?? p;
const urlMercado = () => encodeURIComponent(ultimo.mercado.clave);

function iconoNodo(url, nombre, calidad, grande = false) {
  const ic = el("span", "icono" + (grande ? " grande" : ""));
  ic.setAttribute("aria-hidden", "true");
  ic.textContent = (nombre || "?").replace(/^\[FICTICIO\]\s*/, "").charAt(0).toUpperCase();
  if (calidad) ic.dataset.calidad = calidad;
  if (url) {
    // Icono oficial (CDN de Blizzard). Si no carga, queda la inicial como marcador neutro.
    const img = document.createElement("img");
    img.src = url; img.alt = ""; img.loading = "lazy"; img.decoding = "async";
    img.addEventListener("error", () => img.remove());
    ic.append(img);
  }
  return ic;
}

/** Oro, plata y cobre con su color (las letras o/p/c también están en el texto). */
function monedaNodo(cobre) {
  const span = el("span", "moneda");
  if (cobre == null) { span.textContent = "—"; span.classList.add("desconocido"); return span; }
  for (const parte of formatearMoneda(cobre).split(" ")) {
    span.append(el("span", { o: "o", p: "p", c: "c" }[parte.slice(-1)] ?? "", parte), " ");
  }
  return span;
}

let temporizadorAviso = null;
/** Aviso breve que se quita solo (no deja mensajes persistentes). */
function avisar(texto, tipo = "") {
  const a = $("aviso");
  a.textContent = texto; a.className = "aviso " + tipo; a.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { a.hidden = true; }, tipo === "bad" ? 8000 : 4000);
}

// ---------- estado global ----------
let mercadoActual = local.leer("mw_mercado2", null);
let ultimo = null;            // último estado recibido de /api/estado
let pagina = null;            // última respuesta de /api/mercado
let objetoActual = null;      // objeto abierto en el detalle
let rangoHistorial = "7d";
let firmaVersion = null;
let rapidoHasta = 0;
const filtro = { texto: "", categoria: "", subcategoria: "", calidad: "", pagina: 1 };
const abiertas = new Set();   // categorías desplegadas en el árbol

// ---------- vistas ----------
function mostrar(vista) {
  $("vista-login").hidden = vista !== "login";
  $("vista-mercado").hidden = vista !== "mercado";
  for (const id of ["grupo-mercado", "barra"]) $(id).hidden = vista === "login";
}

// ---------- mercado: región · tipo · facción · fuente ----------
const REGION = { us: "US", eu: "EU", kr: "KR", tw: "TW" };
const MODO = { pvp: "PvP", pve: "PvE", demo: "Demostración" };
const FACCION = { horde: "Horda", alliance: "Alianza" };
const PROVEEDOR = { ahledger: "AHledger", tsm: "TSM", csv: "Importación manual", demo: "Ficticio" };

/** «ahledger:forever:us:pvp-horde» → {region: "us", modo: "pvp", faccion: "horde"}. */
function partesMercado(m) {
  const [, , region, slug = ""] = m.clave.split(":");
  const [modo, faccion = ""] = slug.split("-");
  return { region, modo, faccion };
}

function opciones(sel, valores, nombres, elegido) {
  sel.replaceChildren(...valores.map((v) => { const o = el("option", "", nombres[v] ?? v ?? "—"); o.value = v; return o; }));
  sel.value = valores.includes(elegido) ? elegido : valores[0] ?? "";
  sel.disabled = valores.length < 2;
}

function pintarSelectores(s) {
  const lista = (s.mercados || []).map((m) => ({ ...m, ...partesMercado(m) }));
  const actual = lista.find((m) => m.clave === s.mercado.clave) ?? partesMercado(s.mercado);
  const unicos = (xs) => [...new Set(xs)];
  opciones($("sel-region"), unicos(lista.map((m) => m.region)), REGION, actual.region);
  const enRegion = lista.filter((m) => m.region === $("sel-region").value);
  opciones($("sel-modo"), unicos(enRegion.map((m) => m.modo)), MODO, actual.modo);
  const enModo = enRegion.filter((m) => m.modo === $("sel-modo").value);
  opciones($("sel-faccion"), unicos(enModo.map((m) => m.faccion)), { ...FACCION, "": "—" }, actual.faccion);
  const fuentes = enModo.filter((m) => m.faccion === $("sel-faccion").value);
  opciones($("sel-fuente"), fuentes.map((m) => m.clave),
    Object.fromEntries(fuentes.map((m) => [m.clave, PROVEEDOR[m.proveedor] ?? m.proveedor])), s.mercado.clave);
}

/** Al cambiar región, tipo o facción se elige la primera fuente disponible de esa combinación. */
function elegirMercado() {
  const lista = (ultimo?.mercados || []).map((m) => ({ ...m, ...partesMercado(m) }));
  const c = lista.filter((m) => m.region === $("sel-region").value && m.modo === $("sel-modo").value
    && m.faccion === $("sel-faccion").value);
  return c.find((m) => m.clave === $("sel-fuente").value)?.clave ?? c[0]?.clave ?? null;
}

async function cambiarMercado(clave) {
  if (!clave || clave === ultimo?.mercado?.clave) return;
  mercadoActual = clave;
  local.escribir("mw_mercado2", clave);
  pagina = null; firmaVersion = null; filtro.pagina = 1;
  cerrarDetalle();
  await refrescar();
}
for (const id of ["sel-region", "sel-modo", "sel-faccion"]) {
  $(id).addEventListener("change", () => {
    // Recalcula las listas dependientes y salta al primer mercado de esa combinación.
    pintarSelectores({ ...ultimo, mercado: { clave: elegirMercado() ?? ultimo.mercado.clave } });
    cambiarMercado(elegirMercado());
  });
}
$("sel-fuente").addEventListener("change", () => cambiarMercado($("sel-fuente").value));

// ---------- estado del mercado y antigüedad del dato ----------
async function cargar() {
  let r, s;
  const q = mercadoActual ? "?mercado=" + encodeURIComponent(mercadoActual) : "";
  try {
    r = await fetch("/api/estado" + q, { cache: "no-store" });
    s = await r.json();
  } catch {
    s = null;
  }
  if (r?.status === 401) { mostrar("login"); $("clave").focus(); return false; }
  if (r?.status === 404 && mercadoActual) { mercadoActual = null; return cargar(); }
  if (!r?.ok || !s) {
    // Sin conexión: se conserva lo que ya se ve y se avisa brevemente.
    if (ultimo) { avisar("Sin conexión con el servidor: se muestran los últimos datos recibidos.", "bad"); return false; }
    mostrar("mercado");
    $("estado-dato").textContent = "Sin conexión";
    $("estado-dato").className = "estado-dato bad";
    $("tbody").replaceChildren();
    $("sin-resultados").hidden = false;
    $("sin-resultados").textContent = "No se pudo conectar con la base de datos. " + (s?.error ?? "");
    return false;
  }
  ultimo = s;
  mostrar("mercado");
  $("btn-salir").hidden = !s.autenticado;
  const pend = s.base_de_datos?.migraciones_pendientes || [];
  if (pend.length) avisar("Falta configurar Supabase: ejecuta configurar.bat.", "bad");

  const m = s.mercado;
  pintarSelectores(s);
  $("banda-demo").hidden = !m.ficticio;
  document.body.classList.toggle("modo-demo", !!m.ficticio);
  $("btn-actualizar").hidden = !m.automatico;
  pintarEstadoDato();
  pintarPie();
  return true;
}

function pintarEstadoDato() {
  if (!ultimo) return;
  const m = ultimo.mercado, a = ultimo.actualizacion;
  const e = $("estado-dato");
  const viejo = a.hora_dato_original && (Date.now() - new Date(a.hora_dato_original)) > 8 * 3600e3;
  const fallos = a.fallos_seguidos > 0;
  e.replaceChildren(el("span", "", `Datos: ${hace(a.hora_dato_original)}`));
  if (m.automatico && a.ultima_consulta_ok) e.append(el("span", "consulta", ` · consulta: ${hace(a.ultima_consulta_ok)}`));
  if (fallos) e.append(el("span", "", " · ⚠"));
  e.className = "estado-dato" + (viejo && !m.ficticio ? " viejo" : "") + (fallos ? " bad" : "");
  e.title = [
    `Mercado: ${m.nombre}`,
    `Escaneo original: ${fecha(a.hora_dato_original)}`,
    m.automatico ? `Última consulta correcta: ${fecha(a.ultima_consulta_ok)}` : "Sin consulta automática",
    m.automatico && a.proxima ? `Próxima consulta: hacia las ${fecha(a.proxima)}` : null,
    viejo ? "El escaneo tiene más de 8 horas." : null,
    fallos ? `Fallos seguidos: ${a.fallos_seguidos} · ${a.ultimo_error ?? ""}` : null,
  ].filter(Boolean).join("\n");
  e.setAttribute("aria-label", e.title.replaceAll("\n", ". "));
}

/** Pie discreto con la atribución que exige la fuente y la cobertura del catálogo. */
function pintarPie() {
  const pie = $("pie");
  pie.replaceChildren();
  const a = ultimo?.mercado?.atribucion;
  if (a) {
    const link = el("a", "", a.texto);
    link.href = a.url; link.target = "_blank"; link.rel = "noopener";
    pie.append(link);
  } else if (ultimo?.mercado?.proveedor === "TSM") {
    pie.append(el("span", "", "Precios: archivo público de TradeSkillMaster"));
  }
  const cobertura = pagina ? ` · catálogo: ${pagina.total_catalogo.toLocaleString("es")} objetos conocidos (no es el total del juego)` : "";
  pie.append(el("span", "muted", ` · precios en oro (o), plata (p) y cobre (c) · nombres en inglés${cobertura}`));
}

// ---------- tabla del mercado (paginada en el servidor) ----------
function precioFiltro(id, errores) {
  try { return parsearMoneda($(id).value); } catch (e) { errores.push(e.message); return null; }
}
const enteroONull = (v) => { const n = Number(v); return v === "" || !Number.isInteger(n) || n < 0 ? null : n; };

function leerFiltros() {
  const errores = [];
  const [orden, dir] = $("f-orden").value.split(":");
  const f = {
    texto: filtro.texto, categoria: filtro.categoria, subcategoria: filtro.subcategoria, calidad: filtro.calidad,
    profesion: $("f-profesion").value, soloOfertas: $("f-ofertas").checked, orden, dir, pagina: filtro.pagina,
    nivel_min: enteroONull($("f-nivel-min").value), nivel_max: enteroONull($("f-nivel-max").value),
    precio_min: precioFiltro("f-precio-min", errores), precio_max: precioFiltro("f-precio-max", errores),
  };
  $("f-precio-error").hidden = errores.length === 0;
  $("f-precio-error").textContent = errores.join(" · ");
  return f;
}

let peticionN = 0;
let controlador = null;
/** Pide la página actual. Una respuesta de una petición anterior se descarta. */
async function cargarPagina({ silencioso = false } = {}) {
  if (!ultimo?.mercado?.clave) return;
  const clave = ultimo.mercado.clave;
  const n = ++peticionN;
  controlador?.abort();
  controlador = new AbortController();
  if (!silencioso) esqueleto();
  const q = new URLSearchParams({ mercado: clave, ...paramsMercado(leerFiltros()) });
  let r, d;
  try {
    r = await fetch("/api/mercado?" + q, { cache: "no-store", signal: controlador.signal });
    d = await r.json();
  } catch (e) {
    if (e.name === "AbortError" || n !== peticionN) return;
    pintarTabla();   // se queda con la última página buena
    avisar("No se pudieron cargar los objetos: se conservan los últimos.", "bad");
    return;
  }
  if (n !== peticionN || d.mercado !== clave) return;
  if (r.status === 401) { await cargar(); return; }
  if (!r.ok) { pintarTabla(); avisar(d.error || "Error " + r.status, "bad"); return; }
  pagina = d;
  // Si la página pedida ya no existe (menos resultados), vuelve a la última.
  const ult = paginas(d.total, d.por_pagina);
  if (filtro.pagina > ult) { filtro.pagina = ult; return cargarPagina({ silencioso }); }
  pintarCalidades();
  pintarProfesiones();
  pintarArbol();
  pintarTabla();
  pintarPie();
}

/** Filas grises mientras llegan los datos. */
function esqueleto() {
  const tb = $("tbody");
  tb.replaceChildren();
  for (let i = 0; i < 14; i++) {
    const tr = el("tr", "esq");
    for (let k = 0; k < 5; k++) {
      const td = el("td", k ? "num" : "");
      td.append(el("span", "barra-esq"));
      tr.append(td);
    }
    tb.append(tr);
  }
  $("sin-resultados").hidden = true;
}

function celdaVariacion(x) {
  const td = el("td", "num var");
  const p = x.var24;
  if (p == null) {
    td.textContent = "—";
    td.title = x.estado === "con_ofertas" ? "Sin una observación propia de hace 24 h" : "";
    return td;
  }
  const dir = p > 0.05 ? "sube" : p < -0.05 ? "baja" : "";
  td.classList.add(dir || "igual");
  td.append(el("span", "flecha", dir === "sube" ? "▲" : dir === "baja" ? "▼" : "▬"), " ", formatearPct(p));
  td.title = `Hace 24 h: ${formatearMoneda(x.precio_24h)} (${fecha(x.hora_24h)})`;
  return td;
}

const NS = "http://www.w3.org/2000/svg";
/** Minigráfico de 7 días: una línea por tramo continuo; los periodos sin escaneos quedan en blanco. */
function celdaSpark(x) {
  const td = el("td", "c-spark");
  const segs = segmentosSpark(x.spark);
  const pts = segs.flat();
  if (pts.length < 2) { td.textContent = pts.length ? "·" : ""; return td; }
  const W = 72, H = 22, fin = Math.max(...pts.map((p) => p[0])), ini = fin - 7 * 86400e3;
  const vs = pts.map((p) => p[1]), min = Math.min(...vs), max = Math.max(...vs);
  const X = (t) => ((t - ini) / (fin - ini)) * (W - 2) + 1;
  const Y = (v) => max === min ? H / 2 : H - 2 - ((v - min) / (max - min)) * (H - 4);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", W); svg.setAttribute("height", H);
  svg.setAttribute("aria-hidden", "true");
  for (const s of segs) {
    if (s.length === 1) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", X(s[0][0])); c.setAttribute("cy", Y(s[0][1])); c.setAttribute("r", 1.5);
      svg.append(c);
      continue;
    }
    const l = document.createElementNS(NS, "polyline");
    l.setAttribute("points", s.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" "));
    svg.append(l);
  }
  td.title = `7 días: mín. ${formatearMoneda(min)} · máx. ${formatearMoneda(max)}` +
    (segs.length > 1 ? " · con periodos sin escaneos" : "");
  td.append(svg);
  return td;
}

function celdaPrecio(x) {
  const td = el("td", "num");
  if (x.estado === "con_ofertas") {
    td.append(monedaNodo(x.precio));
  } else {
    td.append(el("span", "estado-txt " + x.estado, ESTADO[x.estado]));
    td.title = x.estado === "sin_ofertas"
      ? `No está en el último escaneo. Visto por última vez ${fecha(x.visto)}` +
        (x.ultimo_precio != null ? ` a ${formatearMoneda(x.ultimo_precio)}` : "")
      : "Nunca se ha visto a la venta en este mercado";
  }
  return td;
}

function pintarTabla() {
  const d = pagina;
  const tbody = $("tbody");
  const frag = document.createDocumentFragment();
  for (const x of d?.filas ?? []) {
    const tr = el("tr");
    tr.dataset.id = x.id;
    if (x.estado !== "con_ofertas") tr.classList.add("sin-oferta");
    if (x.id === objetoActual) tr.classList.add("activa");

    const tdObj = el("td", "c-obj");
    const b = el("button", "objeto");
    b.type = "button"; b.dataset.detalle = x.id;
    const txt = el("span", "objeto-txt");
    txt.append(el("span", "objeto-nombre" + (x.calidad ? ` q-${x.calidad}` : ""), x.nombre),
      el("span", "objeto-id", [x.subcategoria || nombreCat(x.categoria), x.nivel ? `nivel ${x.nivel}` : null]
        .filter(Boolean).join(" · ")));
    b.append(iconoNodo(x.icono, x.nombre, x.calidad), txt);
    b.title = `#${x.id} · ${NOMBRE_CALIDAD[x.calidad] ?? "calidad desconocida"}`;
    tdObj.append(b);

    const tdCant = el("td", "num", x.cantidad == null ? "—" : x.cantidad.toLocaleString("es"));
    tr.append(tdObj, celdaPrecio(x), tdCant, celdaVariacion(x), celdaSpark(x));
    frag.append(tr);
  }
  tbody.replaceChildren(frag);
  const total = d?.total ?? 0;
  $("sin-resultados").hidden = !d || total > 0;
  $("sin-resultados").textContent = "Ningún objeto coincide con los filtros.";
  $("contador").textContent = d ? `${total.toLocaleString("es")} objetos` : "";
  $("titulo-resultados").textContent = filtro.texto ? `«${filtro.texto}»`
    : filtro.subcategoria ? filtro.subcategoria : filtro.categoria ? nombreCat(filtro.categoria) : "Todos los objetos";
  // Paginador.
  const n = paginas(total, d?.por_pagina ?? POR_PAGINA);
  $("paginador").hidden = !d || n < 2;
  $("pag-txt").textContent = `Página ${filtro.pagina.toLocaleString("es")} de ${n.toLocaleString("es")}`;
  $("pag-ant").disabled = filtro.pagina <= 1;
  $("pag-sig").disabled = filtro.pagina >= n;
  // Cabeceras ordenables: refleja el orden actual.
  const [clave, dir] = $("f-orden").value.split(":");
  for (const th of document.querySelectorAll(".tabla-mercado th")) {
    const bo = th.querySelector("[data-orden]");
    th.setAttribute("aria-sort", bo?.dataset.orden === clave ? (dir === "asc" ? "ascending" : "descending") : "none");
  }
}

/** Cualquier cambio de filtro u orden vuelve a la página 1. */
function repintar() { filtro.pagina = 1; cargarPagina(); }

$("tbody").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-detalle]") ?? ev.target.closest("tr[data-id]");
  if (!b) return;
  location.hash = `#/objeto/${Number(b.dataset.detalle ?? b.dataset.id)}`;
});
for (const [id, paso] of [["pag-ant", -1], ["pag-sig", 1]]) {
  $(id).addEventListener("click", () => {
    filtro.pagina = Math.max(1, filtro.pagina + paso);
    cargarPagina();
    $("vista-mercado").scrollIntoView({ block: "start" });
  });
}
$("f-orden").addEventListener("change", repintar);
for (const b of document.querySelectorAll(".th-orden")) {
  b.addEventListener("click", () => {
    const [clave, dir] = $("f-orden").value.split(":");
    const k = b.dataset.orden;
    const nuevaDir = clave === k ? (dir === "asc" ? "desc" : "asc") : (k === "nombre" || k === "precio" ? "asc" : "desc");
    const valor = `${k}:${nuevaDir}`;
    if (![...$("f-orden").options].some((o) => o.value === valor)) {
      const o = el("option", "", `${b.textContent} ${nuevaDir === "asc" ? "↑" : "↓"}`); o.value = valor; $("f-orden").append(o);
    }
    $("f-orden").value = valor;
    repintar();
  });
}

// ---------- filtros laterales ----------
let temporizadorFiltro = null;
for (const id of ["f-nivel-min", "f-nivel-max", "f-precio-min", "f-precio-max"]) {
  $(id).addEventListener("input", () => { clearTimeout(temporizadorFiltro); temporizadorFiltro = setTimeout(repintar, 300); });
}
$("f-ofertas").addEventListener("change", repintar);
$("f-profesion").addEventListener("change", repintar);

const ORDEN_CALIDAD = ["POOR", "COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY", "ARTIFACT", "HEIRLOOM"];
function pintarCalidades() {
  const cont = $("f-calidad");
  const presentes = ORDEN_CALIDAD.filter((q) => pagina?.calidades.includes(q));
  cont.replaceChildren();
  for (const q of ["", ...presentes]) {
    const b = el("button", "chip-calidad" + (q ? ` q-${q}` : ""));
    b.type = "button";
    b.setAttribute("aria-pressed", String(filtro.calidad === q));
    if (q) b.append(el("span", `punto p-${q}`));
    b.append(q ? NOMBRE_CALIDAD[q] : "Todas");
    b.addEventListener("click", () => { filtro.calidad = q; pintarCalidades(); repintar(); });
    cont.append(b);
  }
}

function pintarProfesiones() {
  const sel = $("f-profesion"), previa = sel.value;
  const lista = (pagina?.profesiones ?? []).slice().sort((a, b) => nombreProf(a).localeCompare(nombreProf(b), "es"));
  sel.replaceChildren(el("option", "", "Todas"), ...lista.map((p) => { const o = el("option", "", nombreProf(p)); o.value = p; return o; }));
  sel.firstChild.value = "";
  sel.value = lista.includes(previa) ? previa : "";
  sel.disabled = lista.length === 0;
}

/** Árbol: «Todos los objetos» + categorías reales del catálogo, con icono y contador (respeta los demás filtros). */
function pintarArbol() {
  const ul = $("arbol-cat");
  const cats = (pagina?.categorias ?? []).slice().sort((a, b) =>
    a.categoria === SIN_CATEGORIA ? 1 : b.categoria === SIN_CATEGORIA ? -1
      : nombreCat(a.categoria).localeCompare(nombreCat(b.categoria), "es"));
  const total = cats.reduce((s, c) => s + c.n, 0);
  const fila = (texto, n, icono, activo, alPulsar, extra = null, titulo = "") => {
    const li = el("li");
    const cab = el("div", "arbol-fila");
    const b = el("button", "arbol-btn");
    b.type = "button";
    if (titulo) b.title = titulo;
    if (icono !== undefined) b.append(iconoNodo(icono, texto));
    b.append(el("span", "arbol-txt", texto), el("span", "arbol-n", n.toLocaleString("es")));
    if (activo) b.setAttribute("aria-current", "true");
    b.addEventListener("click", alPulsar);
    cab.append(b);
    if (extra) cab.append(extra);
    li.append(cab);
    return li;
  };
  const items = [fila("Todos los objetos", total, undefined, !filtro.categoria, () => elegirCategoria("", ""))];
  for (const c of cats) {
    let plegar = null;
    if (c.subcategorias.length) {
      plegar = el("button", "arbol-plegar");
      plegar.type = "button";
      const abierta = abiertas.has(c.categoria);
      plegar.setAttribute("aria-expanded", String(abierta));
      plegar.setAttribute("aria-label", `${abierta ? "Contraer" : "Expandir"} ${nombreCat(c.categoria)}`);
      plegar.textContent = abierta ? "▾" : "▸";
      plegar.addEventListener("click", () => { abierta ? abiertas.delete(c.categoria) : abiertas.add(c.categoria); pintarArbol(); });
    }
    const li = fila(nombreCat(c.categoria), c.n, c.icono, filtro.categoria === c.categoria && !filtro.subcategoria,
      () => elegirCategoria(c.categoria, ""), plegar, NOMBRE_CATEGORIA[c.categoria] ? c.categoria : "");
    if (abiertas.has(c.categoria) && c.subcategorias.length) {
      const sub = el("ul");
      for (const s of c.subcategorias) {
        sub.append(fila(s.subcategoria, s.n, undefined, filtro.categoria === c.categoria && filtro.subcategoria === s.subcategoria,
          () => elegirCategoria(c.categoria, s.subcategoria)));
      }
      li.append(sub);
    }
    items.push(li);
  }
  ul.replaceChildren(...items);
}

function elegirCategoria(cat, sub) {
  filtro.categoria = cat; filtro.subcategoria = sub;
  if (cat) abiertas.add(cat);
  pintarArbol();
  repintar();
  if (estrecho()) cerrarLateral();
}

$("btn-limpiar").addEventListener("click", () => {
  Object.assign(filtro, { texto: "", categoria: "", subcategoria: "", calidad: "", pagina: 1 });
  for (const id of ["f-nivel-min", "f-nivel-max", "f-precio-min", "f-precio-max"]) $(id).value = "";
  $("f-ofertas").checked = false;
  $("f-profesion").value = "";
  $("f-orden").value = "nombre:asc";
  $("buscador").value = "";
  pintarCalidades();
  repintar();
});

// ---------- barra lateral en el móvil ----------
const estrecho = () => window.matchMedia("(max-width: 900px)").matches;
const detalleSuperpuesto = () => window.matchMedia("(max-width: 1279px)").matches;
function abrirLateral() {
  $("lateral").classList.add("abierta"); $("velo-lateral").hidden = false;
  $("btn-lateral").setAttribute("aria-expanded", "true");
  $("btn-cerrar-lateral").focus();
}
function cerrarLateral() {
  if (!$("lateral").classList.contains("abierta")) return;
  $("lateral").classList.remove("abierta"); $("velo-lateral").hidden = true;
  $("btn-lateral").setAttribute("aria-expanded", "false");
  $("btn-lateral").focus();
}
$("btn-lateral").addEventListener("click", abrirLateral);
$("btn-cerrar-lateral").addEventListener("click", cerrarLateral);
$("velo-lateral").addEventListener("click", cerrarLateral);

// ---------- detalle del objeto ----------
let focoAntesDetalle = null;
function abrirPanel() {
  const p = $("panel-ficha");
  if (p.hidden) focoAntesDetalle = document.activeElement;
  p.hidden = false;
  document.body.classList.add("con-detalle");
  $("velo-detalle").hidden = !detalleSuperpuesto();
  for (const tr of $("tbody").querySelectorAll("tr")) tr.classList.toggle("activa", Number(tr.dataset.id) === objetoActual);
}
function cerrarDetalle() {
  objetoActual = null;
  $("panel-ficha").hidden = true;
  $("velo-detalle").hidden = true;
  document.body.classList.remove("con-detalle");
  for (const tr of $("tbody").querySelectorAll("tr.activa")) tr.classList.remove("activa");
}
function salirDelDetalle() {
  if (leerRuta(location.hash).vista === "objeto") location.hash = "#/";
  else cerrarDetalle();
}
$("det-cerrar").addEventListener("click", salirDelDetalle);
$("velo-detalle").addEventListener("click", salirDelDetalle);
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape" || ev.defaultPrevented) return;
  if (document.activeElement === $("buscador")) return;   // Escape del buscador solo cierra sugerencias
  if ($("lateral").classList.contains("abierta")) cerrarLateral();
  else if (!$("panel-ficha").hidden) salirDelDetalle();
});

function seccion(titulo, abierto = false) {
  const d = el("details", "det-sec");
  d.open = abierto;
  d.append(el("summary", "", titulo));
  return d;
}

function kv(filas) {
  const dl = el("dl", "kv");
  for (const [k, v, cls] of filas) {
    if (v == null) continue;
    const dd = el("dd", cls ?? "");
    if (v instanceof Node) dd.append(v); else dd.textContent = v;
    dl.append(el("dt", "", k), dd);
  }
  return dl;
}

function cabeceraObjeto(f) {
  const cab = el("div", "det-objeto");
  cab.append(iconoNodo(f.icono, f.nombre, f.calidad, true));
  const t = el("div");
  const idBtn = el("button", "btn-mini", `#${f.id}`);
  idBtn.type = "button"; idBtn.title = "Copiar el ID";
  idBtn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(String(f.id)); idBtn.textContent = `#${f.id} ✓`; }
    catch { idBtn.textContent = `#${f.id}`; }
  });
  t.append(el("div", "det-sub", [NOMBRE_CALIDAD[f.calidad] ?? f.calidad, [nombreCat(f.clase ?? SIN_CATEGORIA), f.subclase]
    .filter((x) => x && x !== nombreCat(SIN_CATEGORIA)).join(" › "), f.nivel ? `nivel ${f.nivel}` : null].filter(Boolean).join(" · ")), idBtn);
  if (f.wowhead_url) {
    const a = el("a", "wowhead", "Wowhead ↗");
    a.href = f.wowhead_url; a.target = "_blank"; a.rel = "noopener"; a.title = "Ver el objeto en Wowhead";
    t.append(a);
  }
  cab.append(t);
  return cab;
}

function seccionGrafico(id) {
  const sec = el("section", "det-sec-fija");
  const graf = el("div", "det-grafico");
  const grupo = el("div", "periodos");
  grupo.setAttribute("role", "group");
  grupo.setAttribute("aria-label", "Periodo del historial");
  for (const [rango, txt] of [["24h", "24 h"], ["7d", "7 d"], ["30d", "30 d"], ["90d", "90 d"]]) {
    const b = el("button", "btn-periodo", txt);
    b.type = "button"; b.dataset.rango = rango;
    b.setAttribute("aria-pressed", String(rango === rangoHistorial));
    b.addEventListener("click", () => {
      rangoHistorial = rango;
      for (const x of grupo.children) x.setAttribute("aria-pressed", String(x.dataset.rango === rango));
      cargarHistorialEn(graf, id, rango);
    });
    grupo.append(b);
  }
  sec.append(grupo, graf);
  cargarHistorialEn(graf, id, rangoHistorial);
  return sec;
}

async function cargarHistorialEn(cont, id, rango) {
  // Cada contenedor recuerda su última petición: una respuesta antigua no pisa a una nueva.
  const token = String(Math.random());
  cont.dataset.token = token;
  cont.replaceChildren(el("div", "esq-grafico"));
  try {
    const r = await fetch(`/api/historial-fuente?mercado=${urlMercado()}&id=${id}&rango=${rango}`);
    const h = await r.json();
    if (!r.ok) throw new Error(h.error || "HTTP " + r.status);
    if (cont.dataset.token !== token || !cont.isConnected) return;
    if (!h.puntos?.some((p) => p[1] != null || p[2] != null)) {
      cont.replaceChildren(el("p", "muted small", "Sin observaciones en este periodo."));
      return;
    }
    dibujarGrafico(cont, { puntos: h.puntos, nombres: h.nombres, cantidad: h.cantidad, med7: h.med7, med30: h.med30, pasoMs: h.paso_ms });
    if (h.nota) cont.append(el("p", "muted small", h.nota));
  } catch (e) {
    if (cont.dataset.token === token) cont.replaceChildren(el("p", "bad small", "No se pudo cargar el historial: " + e.message));
  }
}

/** Recetas que fabrican el objeto y recetas que lo usan (datos de AHledger), al desplegar. */
function seccionRecetas(id) {
  const sec = seccion("Recetas y profesiones");
  const cuerpo = el("div");
  cuerpo.append(el("p", "muted small", "Cargando…"));
  sec.append(cuerpo);
  let pedido = false;
  sec.addEventListener("toggle", () => {
    if (!sec.open || pedido) return;
    pedido = true;
    fetch(`/api/recetas?mercado=${urlMercado()}&objeto=${id}`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "HTTP " + r.status); return d; })
      .then((d) => {
        const nodos = [];
        for (const r of d.fabricacion) {
          nodos.push(el("h4", "", `Se fabrica: ${r.nombre} · ${nombreProf(r.profesion)}${r.nivel != null ? " " + r.nivel : ""}`));
          const ul = el("ul", "det-lista");
          for (const x of r.reactivos) {
            const li = el("li");
            const b = el("button", "enlace" + (x.calidad ? ` q-${x.calidad}` : ""), `${x.cantidad} × ${x.nombre}`);
            b.type = "button"; b.addEventListener("click", () => { location.hash = `#/objeto/${x.id}`; });
            li.append(b, " ", x.precio == null ? el("span", "muted", "sin precio") : monedaNodo(x.coste));
            ul.append(li);
          }
          nodos.push(ul);
          nodos.push(kv([
            ["Coste de materiales", r.completa ? monedaNodo(r.coste) : `incompleto (falta ${r.faltan.join(", ")})`],
            ["Valor neto fabricado", r.neto == null ? "sin precio del resultado" : monedaNodo(r.neto)],
            ["Margen", r.margen == null ? null : monedaNodo(r.margen), r.margen == null ? "" : r.margen >= 0 ? "sube" : "baja"],
          ]));
        }
        if (d.usos.length) {
          nodos.push(el("h4", "", `Se usa en ${d.usos.length} ${d.usos.length === 1 ? "receta" : "recetas"}`));
          const ul = el("ul", "det-lista");
          for (const u of d.usos.slice(0, 15)) {
            const li = el("li");
            const b = el("button", "enlace", u.resultado_nombre);
            b.type = "button"; b.addEventListener("click", () => { location.hash = `#/objeto/${u.resultado_id}`; });
            li.append(b, el("span", "muted", ` · ${nombreProf(u.profesion)}${u.nivel != null ? " " + u.nivel : ""} · ×${u.cantidad}`));
            ul.append(li);
          }
          if (d.usos.length > 15) ul.append(el("li", "muted", `y ${d.usos.length - 15} más`));
          nodos.push(ul);
        }
        if (!nodos.length) nodos.push(el("p", "muted small", "Ninguna receta conocida lo fabrica ni lo usa."));
        cuerpo.replaceChildren(...nodos);
      })
      .catch((e) => cuerpo.replaceChildren(el("p", "bad small", "No se pudieron cargar las recetas: " + e.message)));
  });
  return sec;
}

function seccionPropiedades(f) {
  const sec = seccion("Propiedades");
  sec.append(kv([
    ["Clase", [f.clase, f.subclase].filter(Boolean).join(" › ") || "desconocida"],
    ["Nivel del objeto", f.nivel ?? "desconocido"],
    ["Nivel requerido", f.nivel_requerido ?? "—"],
    ["Venta al NPC", f.venta_npc == null ? "desconocido" : monedaNodo(f.venta_npc)],
    ["Nombre en español", f.nombre_es ?? null],
    ["Descripción", "no disponible en las fuentes autorizadas"],
    ["Fuente del catálogo", f.fuente ? `${f.fuente}${f.verificado_en ? " · " + fecha(f.verificado_en) : ""}` : null],
  ]));
  return sec;
}

/** Una cifra del bloque de precios: etiqueta corta + valor (+ ayuda al pasar el cursor). */
function cifra(etiqueta, valor, ayuda, cls = "") {
  const d = el("div", "cifra " + cls);
  d.append(el("span", "cifra-k", etiqueta));
  const v = el("span", "cifra-v");
  if (valor instanceof Node) v.append(valor); else v.textContent = valor;
  d.append(v);
  if (ayuda) { d.title = ayuda; d.tabIndex = 0; }
  return d;
}

/** Bloque de precios: lo que se sabe, identificado claramente y sin inventar nada. */
function bloquePrecios(f) {
  const p = f.mercado, x = f.extremos_30d;
  const fuente = ultimo?.mercado?.proveedor === "TSM" ? "valor histórico de TSM" : "mediana de 30 días que publica la fuente";
  const grid = el("div", "det-precios");
  if (f.estado === "sin_datos" || !p) {
    grid.append(cifra("Precio actual", el("span", "estado-txt sin_datos", ESTADO.sin_datos),
      "Nunca se ha visto a la venta en este mercado", "principal"));
    return grid;
  }
  if (f.estado === "sin_ofertas") {
    grid.append(cifra("Precio actual", el("span", "estado-txt sin_ofertas", ESTADO.sin_ofertas),
      `No está en el último escaneo (${fecha(f.escaneo)})`, "principal"),
      cifra("Último visto", monedaNodo(p.precio ?? p.valor_mercado), `Compra mínima del ${fecha(p.hora)}`));
  } else {
    grid.append(cifra("Precio actual", monedaNodo(p.precio ?? p.valor_mercado),
      `Compra inmediata mínima del escaneo de ${fecha(p.hora)}`, "principal"),
      cifra("Cantidad", p.cantidad == null ? "—" : p.cantidad.toLocaleString("es"),
        p.cantidad == null ? "La fuente no publica cantidades" : "Unidades publicadas en el último escaneo"));
  }
  grid.append(
    cifra("Mínimo 30 d", x ? monedaNodo(x.minimo) : "—",
      x ? `Compra mínima más baja observada: ${fecha(x.minimo_hora)} (${x.observaciones} escaneos guardados)` : "Sin escaneos guardados en 30 días"),
    cifra("Mediana histórica", p.historico == null ? "—" : monedaNodo(p.historico),
      p.historico == null ? "La fuente no la publica" : `Referencia: ${fuente}`));
  if (p.mediana != null && f.estado === "con_ofertas") {
    grid.append(cifra("Mediana actual", monedaNodo(p.mediana), "Mediana de los anuncios del último escaneo"));
  }
  if (p.ventas_dia != null) {
    grid.append(cifra("Ventas/día", p.ventas_dia.toLocaleString("es", { maximumFractionDigits: p.ventas_dia >= 10 ? 0 : 1 }),
      "Estimación de AHledger: un escaneo no distingue una venta de una cancelación"));
  }
  return grid;
}

async function bloqueRecomendacion(id) {
  try {
    const r = await fetch(`/api/explicacion?mercado=${urlMercado()}&id=${id}`, { cache: "no-store" });
    if (!r.ok) return null;
    const d = await r.json();
    const l = d.lectura;
    const rec = el("div", "det-rec");
    if (d.ficticio) rec.append(el("span", "banda-mini", "DATOS FICTICIOS"));
    // Sin evidencia (historial corto, dato antiguo…) no hay etiqueta: no se recomienda nada.
    if (l.evidencia === false) rec.append(el("span", "etiqueta sin-evidencia", "Sin datos suficientes"));
    else rec.append(el("span", "etiqueta " + ({ VENDER: "rec-vender", GUARDAR: "rec-guardar", OBSERVACION: "rec-obs" }[l.rec] || ""),
      NOMBRE_REC[l.rec]));
    rec.lastChild.title = l.resumen ?? "";
    const motivo = seccion("Ver motivo");
    motivo.classList.add("motivo");
    const ul = el("ul", "det-lista");
    for (const t of [l.resumen, ...d.motivos]) if (t) ul.append(el("li", "", t));
    const riesgos = el("ul", "det-lista riesgos");
    for (const t of d.riesgos) riesgos.append(el("li", "", t));
    motivo.append(ul, riesgos, el("p", "muted small",
      `Confianza en los datos: ${l.nivel} · ${l.puntos}/100 (no es una probabilidad). Calculado ${fecha(d.calculado_en)}.`));
    rec.append(motivo);
    return rec;
  } catch { return null; }
}

async function abrirObjeto(id) {
  if (!ultimo) return;
  objetoActual = id;
  const filaPagina = pagina?.filas.find((x) => x.id === id);
  $("det-titulo").textContent = filaPagina?.nombre ?? `#${id}`;
  $("det-titulo").className = filaPagina?.calidad ? `q-${filaPagina.calidad}` : "";
  const cuerpo = $("det-cuerpo");
  cuerpo.replaceChildren(el("div", "esq-grafico"));
  abrirPanel();
  $("det-titulo").focus({ preventScroll: true });
  try {
    const r = await fetch(`/api/objeto?mercado=${urlMercado()}&id=${id}`, { cache: "no-store" });
    const f = await r.json();
    if (!r.ok) throw new Error(f.error || "HTTP " + r.status);
    if (objetoActual !== id) return;
    $("det-titulo").textContent = f.nombre;
    $("det-titulo").className = f.calidad ? `q-${f.calidad}` : "";
    const rec = f.estado === "sin_datos" ? null : await bloqueRecomendacion(id);
    if (objetoActual !== id) return;
    cuerpo.replaceChildren(...[cabeceraObjeto(f), bloquePrecios(f), rec,
      f.estado === "sin_datos" ? null : seccionGrafico(id), seccionPropiedades(f), seccionRecetas(id)].filter(Boolean));
  } catch (e) {
    if (objetoActual === id) cuerpo.replaceChildren(el("p", "bad", "No se pudo cargar el objeto: " + e.message));
  }
}

// ---------- rutas: #/ (mercado) y #/objeto/ID ----------
function aplicarRuta() {
  if (!ultimo) return;
  const r = leerRuta(location.hash);
  if (r.vista === "objeto") { if (r.id !== objetoActual || $("panel-ficha").hidden) abrirObjeto(r.id); }
  else if (!$("panel-ficha").hidden) {
    const id = objetoActual;
    cerrarDetalle();
    // El foco vuelve a donde estaba (la fila, el buscador…); si se abrió desde la dirección, a su fila.
    const fila = $("tbody").querySelector(`[data-detalle="${id}"]`);
    if (focoAntesDetalle?.isConnected && focoAntesDetalle !== document.body) focoAntesDetalle.focus();
    else if (fila) fila.focus();
    else $("buscador").focus();
  }
}
window.addEventListener("hashchange", aplicarRuta);
window.matchMedia("(max-width: 1279px)").addEventListener("change", () => {
  if (!$("panel-ficha").hidden) $("velo-detalle").hidden = !detalleSuperpuesto();
});

// ---------- buscador con autocompletado (patrón combobox) ----------
let ac = { ...ESTADO_INICIAL };
let sugerencias = [];
let sugerenciasN = 0;
let temporizadorAc = null;

function pintarSugerencias() {
  const lista = $("sugerencias"), input = $("buscador");
  lista.replaceChildren();
  sugerencias.forEach((s, k) => {
    const li = el("li", "sug" + (k === ac.activo ? " activa" : ""));
    li.id = `sug-${k}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(k === ac.activo));
    li.dataset.k = k;
    const txt = el("span", "sug-txt");
    txt.append(el("span", s.calidad ? `q-${s.calidad}` : "", s.nombre),
      el("span", "sug-sub", [NOMBRE_CALIDAD[s.calidad], s.subclase || nombreCat(s.clase), s.en_mercado ? null : "sin precio aquí"]
        .filter(Boolean).join(" · ")));
    li.append(iconoNodo(s.icono, s.nombre, s.calidad), txt);
    lista.append(li);
  });
  lista.hidden = !ac.abierto || sugerencias.length === 0;
  input.setAttribute("aria-expanded", String(!lista.hidden));
  if (ac.activo >= 0 && !lista.hidden) {
    input.setAttribute("aria-activedescendant", `sug-${ac.activo}`);
    $(`sug-${ac.activo}`)?.scrollIntoView({ block: "nearest" });
  } else input.removeAttribute("aria-activedescendant");
}

async function pedirSugerencias() {
  const q = $("buscador").value.trim();
  const n = ++sugerenciasN;   // descarta respuestas de búsquedas anteriores
  if (!q || !ultimo) { sugerencias = []; ac = conSugerencias(ac, 0); pintarSugerencias(); $("anuncio").textContent = ""; return; }
  try {
    const r = await fetch(`/api/catalogo?mercado=${urlMercado()}&q=${encodeURIComponent(q)}`, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok || n !== sugerenciasN) return;
    sugerencias = d.resultados.slice(0, 10);
  } catch { return; }
  ac = conSugerencias(ac, sugerencias.length);
  pintarSugerencias();
  $("anuncio").textContent = sugerencias.length ? `${sugerencias.length} sugerencias.` : "Sin coincidencias.";
}

function confirmarSugerencia(k) {
  const s = sugerencias[k];
  if (!s) return;
  $("buscador").value = s.nombre;     // el texto solo cambia al confirmar
  ac = { ...ac, abierto: false, activo: -1 };
  pintarSugerencias();
  location.hash = `#/objeto/${s.id}`;
  if (leerRuta(location.hash).id === objetoActual) abrirObjeto(s.id);
}

/** Enter sin sugerencia elegida: filtra la tabla por ese texto. */
function buscarEnMercado() {
  filtro.texto = $("buscador").value.trim();
  ac = { ...ac, abierto: false, activo: -1 };
  pintarSugerencias();
  repintar();
}

$("buscador").addEventListener("input", () => {
  ac = alEscribir(ac);
  if (!$("buscador").value.trim() && filtro.texto) { filtro.texto = ""; repintar(); }
  clearTimeout(temporizadorAc);
  temporizadorAc = setTimeout(pedirSugerencias, 150);
});
$("buscador").addEventListener("keydown", (ev) => {
  const r = teclado(ac, { tecla: ev.key, shift: ev.shiftKey, hayTexto: $("buscador").value.trim() !== "" });
  const activoAntes = ac.activo;
  ac = r.estado;
  if (r.prevenir) ev.preventDefault();
  if (r.accion === "confirmar") return confirmarSugerencia(activoAntes);
  if (r.accion === "buscar") return buscarEnMercado();
  pintarSugerencias();
});
$("buscador").addEventListener("blur", () => {
  // Al salir del buscador (Tab al final de la lista, clic fuera) se cierra sin tocar el texto.
  setTimeout(() => { if (document.activeElement !== $("buscador")) { ac = { ...ac, abierto: false, activo: -1 }; pintarSugerencias(); } }, 150);
});
// Ratón o toque: pointerdown para que la elección llegue antes de que el campo pierda el foco.
$("sugerencias").addEventListener("pointerdown", (ev) => {
  const li = ev.target.closest("[data-k]");
  if (!li) return;
  ev.preventDefault();
  confirmarSugerencia(Number(li.dataset.k));
});

// ---------- actualización ----------
$("btn-actualizar").addEventListener("click", async () => {
  const btn = $("btn-actualizar");
  btn.disabled = true; btn.classList.add("girando");
  try {
    const r = await fetch("/api/actualizar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mercado: ultimo?.mercado?.clave }),
    });
    const d = await r.json();
    avisar(d.mensaje || d.error || "Hecho", r.ok ? "" : "bad");
    rapidoHasta = Date.now() + 3 * 60_000;   // vigilar cada 5 s durante 3 min
  } catch (e) {
    avisar("No se pudo pedir la actualización: " + e.message, "bad");
  } finally {
    setTimeout(() => { btn.disabled = false; btn.classList.remove("girando"); }, 10000);
  }
});

// Cada 30 s (o cada 5 s justo después de «Actualizar») se consulta una huella mínima del mercado;
// si cambió, se recargan el estado y la página visible sin recargar la web ni cerrar el objeto abierto.
async function vigilar() {
  if (document.visibilityState === "visible" && ultimo?.mercado?.clave && $("vista-login").hidden) {
    try {
      const r = await fetch("/api/version?mercado=" + urlMercado(), { cache: "no-store" });
      if (r.status === 401) await cargar();
      else if (r.ok) {
        const firma = JSON.stringify(await r.json());
        if (firmaVersion !== null && firma !== firmaVersion) {
          await cargar();
          await cargarPagina({ silencioso: true });
          if (objetoActual != null) abrirObjeto(objetoActual);
        }
        firmaVersion = firma;
      }
    } catch { /* sin red: se reintenta en la próxima vuelta */ }
  }
  pintarEstadoDato();   // «hace N min» avanza aunque no haya datos nuevos
  setTimeout(vigilar, Date.now() < rapidoHasta ? 5000 : 30000);
}

async function refrescar() {
  if (!(await cargar())) return;
  aplicarRuta();          // un objeto pedido en la dirección se abre sin esperar a la tabla
  await cargarPagina();
}

// ---------- acceso ----------
$("form-login").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const err = $("error-login");
  err.hidden = true;
  try {
    const r = await fetch("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clave: $("clave").value }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
    $("clave").value = "";
    await refrescar();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
});

$("btn-salir").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  ultimo = null; pagina = null;
  cerrarDetalle();
  $("btn-salir").hidden = true;
  cargar();
});

refrescar();
vigilar();
