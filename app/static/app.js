// Casa de Subastas — WoW Forever. Una sola vista: Mercado (barra lateral, tabla y detalle del objeto).
// La tabla recorre TODO el catálogo y la pide por páginas al servidor (filtros, orden y paginación en SQL).
import { dibujarGrafico } from "./grafico.js";
import { formatearMoneda, parsearMoneda } from "./moneda.js";
import { ESTADO_INICIAL, alEscribir, conSugerencias, teclado } from "./autocompletar.js";
import { leerRuta } from "./ruta.js";
import { crearVistaFabricacion } from "./fabricacion_vista.js";
import { NOMBRE_PROFESION } from "./recetas.js";
import { abreviar, paramsMapaCasa, pesoBloque, pesoGrupo, squarify, textoVariacion, tonoVariacion } from "./treemap.js";
import { PERFIL_POR_DEFECTO, sugerencia, textoMotivo } from "./subasta.js";
import { normalizarPerfil, perfilDeLista, textoAlerta } from "./listas.js";
import { agregarReciente, atajoBuscar, chipsFiltros, fusionarSinReordenar } from "./interfaz.js";
import { NOMBRE_CALIDAD, NOMBRE_CATEGORIA, NOMBRE_REC, SIN_CATEGORIA, formatearPct, nombreSubcategoria } from "./tabla.js";
import {
  ESTADO, MAX_IDS, NOMBRE_FAMILIA, NOMBRE_OPORTUNIDAD, NOMBRE_ROL, POR_PAGINA, TEXTO_SIN_FICHA, leerIds, leerPreciosNpc, paginas,
  paramsMercado, segmentosSpark, sinFicha, textoReglaGanga, textoTasa, textoVentasDia, verMargen,
} from "./mercado.js";

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
const nombreSub = nombreSubcategoria;   // subcategoría en español (solo para mostrar)
/** Nombres oficiales en español (API de Blizzard) por ID. Sin nombre oficial, el de la fuente (inglés). */
let nombresEs = new Map();
const nom = (id, en) => nombresEs.get(Number(id)) ?? en;
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
    img.src = url; img.alt = ""; img.loading = grande ? "eager" : "lazy"; img.decoding = "async";
    img.addEventListener("error", () => img.remove());
    ic.append(img);
  }
  return ic;
}

/** Oro, plata y cobre con su color (las letras o/p/c también están en el texto). */
function monedaNodo(cobre) {
  const span = el("span", "moneda");
  if (cobre == null) { span.textContent = "—"; span.classList.add("desconocido"); return span; }
  const NOMBRE = { o: "oro", p: "plata", c: "cobre" };
  const texto = [];
  for (const parte of formatearMoneda(cobre).split(" ")) {
    const u = parte.slice(-1), n = parte.slice(0, -1);
    const caja = el("span", "parte");
    caja.append(el("span", "n", n));
    const moneda = el("span", `coin coin-${u}`);
    moneda.setAttribute("aria-hidden", "true");
    caja.append(moneda);
    span.append(caja);
    texto.push(`${n} ${NOMBRE[u] ?? u}`);
  }
  // Lectores de pantalla y tooltip: «12 oro 47 plata»; a la vista, cifra y moneda.
  span.setAttribute("role", "img");
  span.setAttribute("aria-label", texto.join(" "));
  span.title = formatearMoneda(cobre);
  return span;
}

/**
 * Copia al portapapeles. Si el navegador no deja usar la API moderna (permisos, http, navegador antiguo),
 * prueba con el método clásico. Devuelve si se copió.
 */
async function copiarTexto(texto) {
  try { await navigator.clipboard.writeText(texto); return true; } catch { /* se prueba el método clásico */ }
  const ta = document.createElement("textarea");
  ta.value = texto; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  return ok;
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
const filtro = { texto: "", categoria: "", subcategoria: "", calidad: "", profesion: "", rol: "", familia: "", pagina: 1 };
const profAbiertas = new Set();   // profesiones desplegadas en la barra lateral
const abiertas = new Set();   // categorías desplegadas en el árbol

// ---------- vistas ----------
const enFab = () => leerRuta(location.hash).vista === "fabricacion";
function mostrar(vista) {
  // «Fabricación» es otra sección de la página principal: comparte barra lateral, estado y detalle.
  const fab = vista === "mercado" && enFab();
  $("vista-login").hidden = vista !== "login";
  $("vista-mercado").hidden = vista !== "mercado" || fab;
  $("vista-fabricacion").hidden = !fab;
  document.body.classList.toggle("modo-fab", fab);
  $("nav-mercado").toggleAttribute("aria-current", !fab);
  if (!fab) $("nav-mercado").setAttribute("aria-current", "page");
  $("nav-fabricacion").toggleAttribute("aria-current", fab);
  if (fab) $("nav-fabricacion").setAttribute("aria-current", "page");
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
    if (ultimo) { marcarConexion(false, r ? "Sin conexión con la base de datos" : "Sin conexión con el servidor"); return false; }
    mostrar("mercado");
    $("estado-dato").textContent = "Sin conexión";
    $("estado-dato").className = "estado-dato bad";
    $("tbody").replaceChildren();
    $("sin-resultados").hidden = false;
    $("sin-resultados-txt").textContent = "No se pudo conectar con la base de datos. " + (s?.error ?? "");
    $("btn-quitar-filtros").hidden = true;
    $("btn-reintentar").hidden = false;
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
  // Compacto: antigüedad del escaneo y, si algo falla, una marca. El detalle completo, al pulsarlo.
  e.replaceChildren(el("span", "", sinConexion ? "Sin conexión · " : ""), el("span", "estado-pref", "Datos: "), hace(a.hora_dato_original));
  if (fallos) e.append(el("span", "", " · fallo"));
  e.className = "estado-dato" + (viejo && !m.ficticio ? " viejo" : "") + (fallos || sinConexion ? " bad" : "");
  $("btn-reintentar").hidden = !(sinConexion || fallos);
  ajustarAltoBarra();   // el texto del estado puede cambiar el alto de la barra
  e.title = [
    sinConexion ? "Sin conexión: lo que ves son los últimos datos recibidos; se reintenta cada 15 s." : null,
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
  pie.append(el("span", "muted", " · o = oro, p = plata, c = cobre"));
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
    profesion: filtro.profesion, rol: filtro.rol, materiales: $("f-materiales").checked, familia: filtro.familia,
    soloOfertas: $("f-ofertas").checked, oportunidad: $("f-oportunidad").value, ventasRegion: $("f-region").value, lista: $("f-lista").value, orden, dir, pagina: filtro.pagina,
    nivel_min: enteroONull($("f-nivel-min").value), nivel_max: enteroONull($("f-nivel-max").value),
    precio_min: precioFiltro("f-precio-min", errores), precio_max: precioFiltro("f-precio-max", errores),
  };
  $("f-precio-error").hidden = errores.length === 0;
  $("f-precio-error").textContent = errores.join(" · ");
  return f;
}

let peticionN = 0;
let controlador = null;
let paginaPendiente = null;   // página con el orden nuevo, a la espera de «Reordenar»

/** «Sin datos» con su significado para lectores de pantalla (nunca un 0). */
function sinDato(titulo = "Sin datos") {
  const s = el("span", "sin-dato", "—");
  s.setAttribute("aria-label", titulo); s.title = titulo;
  return s;
}
/** Pide la página actual. Una respuesta de una petición anterior se descarta. */
async function cargarPagina({ silencioso = false } = {}) {
  if (!ultimo?.mercado?.clave) return;
  const clave = ultimo.mercado.clave;
  const n = ++peticionN;
  controlador?.abort();
  controlador = new AbortController();
  // Primera carga: filas grises. Después: la tabla actual se atenúa mientras llega la nueva.
  if (!silencioso) { if (pagina) cargando(true); else esqueleto(); }
  const q = new URLSearchParams({ mercado: clave, ...paramsMercado(leerFiltros()) });
  let r, d;
  try {
    r = await fetch("/api/mercado?" + q, { cache: "no-store", signal: controlador.signal });
    d = await r.json().catch(() => ({}));
  } catch (e) {
    if (e.name === "AbortError" || n !== peticionN) return;
    cargando(false);
    pintarTabla();   // se queda con la última página buena
    marcarConexion(false, "Sin conexión con el servidor");
    return;
  }
  if (n !== peticionN) return;
  cargando(false);
  if (r.status === 401) { await cargar(); return; }
  if (r.status >= 500) { pintarTabla(); marcarConexion(false, "Sin conexión con la base de datos"); return; }
  if (!r.ok) { pintarTabla(); avisar(d.error || "Error " + r.status, "bad"); return; }
  if (d.mercado !== clave) return;     // respuesta de otro mercado: se descarta
  marcarConexion(true);
  // Precios nuevos con la misma página a la vista: las filas no cambian de sitio por sorpresa; si el
  // orden activo cambió, se ofrece «Reordenar».
  if (silencioso && pagina?.filas && pagina.pagina === d.pagina) {
    const { filas, cambioOrden } = fusionarSinReordenar(pagina.filas, d.filas);
    paginaPendiente = cambioOrden ? d : null;
    if (cambioOrden) d = { ...d, filas };
  } else paginaPendiente = null;
  $("nuevo-orden").hidden = !paginaPendiente || vista === "mapa";
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

/** Indicador discreto: tabla atenuada y aria-busy (los lectores de pantalla saben que se actualiza). */
function cargando(si) {
  $("vista-mercado").setAttribute("aria-busy", String(si));
  $("vista-mercado").classList.toggle("cargando", si);
}

/** Filas grises mientras llegan los datos. */
function esqueleto() {
  const tb = $("tbody");
  tb.replaceChildren();
  for (let i = 0; i < 14; i++) {
    const tr = el("tr", "esq");
    for (let k = 0; k < 6; k++) {
      const td = el("td", k === 3 ? "num c-margen" : k ? "num" : "");
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
    td.append(sinDato(x.estado === "con_ofertas" ? "Sin dato de hace 24 h" : "Sin datos"));
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
  const td = el("td", "c-spark" + (x.var24 > 0.05 ? " sube" : x.var24 < -0.05 ? " baja" : ""));
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
  const td = el("td", "num c-precio");
  if (x.estado === "con_ofertas") {
    td.append(monedaNodo(x.precio));
  } else {
    td.append(el("span", "estado-txt " + x.estado, ESTADO[x.estado]));
    td.title = x.estado === "sin_ofertas"
      ? "Ningún anuncio en el último escaneo." +
        (x.ultimo_precio != null ? ` Última compra mínima vista: ${formatearMoneda(x.ultimo_precio)} (${fecha(x.visto)}).` : "") +
        (x.valor_mercado != null ? ` Valor de mercado de la fuente: ${formatearMoneda(x.valor_mercado)}.` : "")
      : "Nunca se ha visto en este mercado";
  }
  return td;
}

/** Margen estimado por unidad (X2). Sin compra mínima o sin referencia no hay número: se deja «—». */
function celdaMargen(x) {
  const td = el("td", "num c-margen");
  if (x.margen == null) {
    td.append(sinDato(x.estado === "con_ofertas" ? "Sin valor de mercado ni venta al NPC" : "Sin datos"));
    return td;
  }
  if (x.margen < 0) { td.classList.add("negativo"); td.append(el("span", "signo", "−")); }
  td.append(monedaNodo(Math.abs(x.margen)));
  if (x.margen_pct != null) td.append(el("span", "margen-pct", formatearPct(x.margen_pct)));
  td.title = x.margen_tipo === "npc"
    ? `Venta al NPC ${formatearMoneda(x.venta_npc)} − compra mínima ${formatearMoneda(x.precio)}. Sin comisión: se vende al NPC.`
    : `Valor de mercado ${formatearMoneda(x.valor_mercado)} − ${pagina?.reglas_oportunidad?.comision_pct ?? 5} % de comisión − compra mínima ${formatearMoneda(x.precio)}. ` +
      "Estimación: no descuenta el depósito ni garantiza que se venda a ese precio.";
  return td;
}

/** Aviso fijo sobre las oportunidades: de cuándo es el dato y cómo se calcula. */
function pintarAvisoOportunidad() {
  const p = $("aviso-oportunidad");
  const f = { oportunidad: $("f-oportunidad").value, orden: $("f-orden").value.split(":")[0] };
  const ver = verMargen(f) && vista !== "mapa";
  p.hidden = !ver;
  $("tabla-mercado").classList.toggle("con-margen", verMargen(f));
  if (!ver) return;
  const r = pagina?.reglas_oportunidad;
  // Una línea a la vista; el cálculo completo, en la ayuda «?».
  const ayuda = el("button", "ayuda", "?");
  ayuda.type = "button"; ayuda.setAttribute("aria-label", "Cómo se calcula el margen");
  ayuda.dataset.ayuda = `Escaneo ${hace(pagina?.escaneo)}: la oferta puede haberse vendido ya. ` +
    `Margen por unidad = valor de mercado − ${r?.comision_pct ?? 5} % de comisión − compra mínima ` +
    "(o venta al NPC − compra mínima si el NPC paga más). No descuenta el depósito. " + textoReglaGanga(r, formatearMoneda);
  p.replaceChildren(el("strong", "", "Comprueba el precio en el juego antes de comprar"),
    el("span", "muted", ` · escaneo ${hace(pagina?.escaneo)} `), ayuda);
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
    const sf = sinFicha(x.nombre);
    const nombreVisible = nom(x.id, x.nombre);
    txt.append(el("span", "objeto-nombre" + (x.calidad ? ` q-${x.calidad}` : ""), nombreVisible),
      el("span", "objeto-id" + (sf ? " sin-ficha" : ""), sf ? TEXTO_SIN_FICHA
          : [nombreSub(x.subcategoria) || nombreCat(x.categoria), x.nivel ? `nivel ${x.nivel}` : null].filter(Boolean).join(" · ")));
    if (x.ganga) txt.firstChild.append(el("span", "marca-op", "Ganga"));
    if (x.bajo_npc) txt.firstChild.append(el("span", "marca-op", "< NPC"));
    b.append(iconoNodo(x.icono, nombreVisible, x.calidad), txt);
    b.title = sf ? `#${x.id} · ni AHledger ni TSM publican su nombre, calidad ni icono`
      : `#${x.id} · ${NOMBRE_CALIDAD[x.calidad] ?? "calidad desconocida"}` + (nombreVisible !== x.nombre ? ` · ${x.nombre}` : "");
    if (x.id === objetoActual) b.setAttribute("aria-current", "true");
    tdObj.append(botonEstrella(x), b);

    const tdCant = el("td", "num c-cant");
    tdCant.append(x.cantidad == null ? sinDato(d.cantidad_fuente ? "Sin unidades en el último escaneo de AHledger"
        : x.estado === "con_ofertas" ? "La fuente no publica la cantidad" : "Sin datos")
      : document.createTextNode(x.cantidad.toLocaleString("es")));
    // Cantidad de otra fuente (AHledger) en un mercado que no la publica (TSM): se dice de dónde y de cuándo es.
    if (x.cantidad_ref && d.cantidad_fuente) {
      tdCant.classList.add("cant-ref");
      tdCant.title = `Unidades según AHledger (escaneo ${fecha(d.cantidad_fuente.escaneo)}). El precio es de TSM.`;
    }
    const tdPrecio = celdaPrecio(x);
    // En tablas estrechas la variación va bajo el precio (su columna se oculta): la misma cifra, otra posición.
    if (x.var24 != null) {
      const mini = el("span", "var-mini " + (x.var24 > 0.05 ? "sube" : x.var24 < -0.05 ? "baja" : "igual"),
        `${x.var24 > 0.05 ? "▲" : x.var24 < -0.05 ? "▼" : "▬"} ${formatearPct(x.var24)}`);
      tdPrecio.append(mini);
    }
    tr.append(tdObj, tdPrecio, tdCant, celdaMargen(x), celdaVariacion(x), celdaSpark(x));
    frag.append(tr);
  }
  tbody.replaceChildren(frag);
  // Origen de las cantidades: propio, o AHledger (con la hora de su escaneo) si la fuente no las publica.
  const cf = d?.cantidad_fuente;
  $("th-cantidad-fuente").hidden = !cf;
  $("th-cantidad-fuente").textContent = cf ? cf.proveedor : "";
  $("th-cantidad").title = cf ? `Unidades a la venta según ${cf.proveedor} (escaneo ${fecha(cf.escaneo)}, ${hace(cf.escaneo)}). Los precios son de TSM.`
    : "Unidades publicadas en el último escaneo";
  // Sin cantidades en toda la página (ninguna fuente las tiene): la columna no ocupa sitio.
  $("tabla-mercado").classList.toggle("sin-cantidad", !!d && d.filas.length > 0 && d.filas.every((x) => x.cantidad == null));
  const total = d?.total ?? 0;
  const chips = pintarChips();
  $("sin-resultados").hidden = !d || total > 0;
  $("sin-resultados-txt").textContent = chips ? "Ningún objeto coincide con los filtros." : "No hay objetos en este mercado.";
  $("btn-quitar-filtros").hidden = !chips;
  $("contador").textContent = d ? `${total.toLocaleString("es")} ${total === 1 ? "objeto" : "objetos"}` : "";
  // Título: lo que se está viendo, en pocas palabras.
  const partes = [];
  if (filtro.profesion) partes.push(nombreProf(filtro.profesion) + (filtro.rol ? ` · ${NOMBRE_ROL[filtro.rol].toLowerCase()}` : ""));
  if ($("f-materiales").checked) partes.push(filtro.familia ? NOMBRE_FAMILIA[filtro.familia] : "Materiales");
  if (filtro.subcategoria) partes.push(nombreSub(filtro.subcategoria)); else if (filtro.categoria) partes.push(nombreCat(filtro.categoria));
  if (filtro.texto) partes.push(`«${filtro.texto}»`);
  if ($("f-oportunidad").value) partes.unshift(NOMBRE_OPORTUNIDAD[$("f-oportunidad").value]);
  if ($("f-region").value) partes.push(`se vende en la región (≥ ${$("f-region").value}/día)`);
  if ($("f-lista").value) partes.unshift(`Lista «${misListas.find((l) => String(l.id) === $("f-lista").value)?.nombre ?? "?"}»`);
  const tit = partes.join(" · ");
  $("titulo-resultados").textContent = tit ? tit[0].toUpperCase() + tit.slice(1) : "Mercado";
  // Oportunidades: cuántas hay con los demás filtros, y el aviso de que el dato puede ir con retraso.
  for (const o of $("f-oportunidad").options) {
    const n = d?.oportunidades?.[o.value];
    if (o.value) o.textContent = NOMBRE_OPORTUNIDAD[o.value] + (n == null ? "" : ` (${n.toLocaleString("es")})`);
  }
  pintarAvisoOportunidad();
  // Referencia regional: de cuándo es el archivo (en su ayuda, no como párrafo fijo).
  const reg = d?.region;
  $("f-region").disabled = !!d && !reg;
  $("ayuda-region").dataset.ayuda = reg
    ? `Ventas al día en toda la región ${reg.region} según TSM (todos los reinos, no solo PvP Horda), archivo del ` +
      `${new Date(reg.actualizado).toLocaleDateString("es")}. Es una referencia: no cambia las recomendaciones.`
    : "Este mercado no tiene archivo regional de TSM.";
  $("btn-favoritos").setAttribute("aria-pressed", String(!!listaFavoritos() && $("f-lista").value === String(listaFavoritos()?.id)));
  guardarEstado();
  // Paginador.
  const n = paginas(total, d?.por_pagina ?? POR_PAGINA);
  $("paginador").hidden = !d || n < 2;
  $("pag-txt").textContent = `Página ${filtro.pagina.toLocaleString("es")} de ${n.toLocaleString("es")}`;
  $("pag-ant").disabled = filtro.pagina <= 1;
  $("pag-sig").disabled = filtro.pagina >= n;
  if (vista === "mapa") {   // la tabla se mantiene al día (contadores), pero no se ve
    $("paginador").hidden = true; $("sin-resultados").hidden = true;
    if (mapaDatos) $("contador").textContent = contadorMapa(mapaDatos);
  }
  // Cabeceras ordenables: refleja el orden actual.
  const [clave, dir] = $("f-orden").value.split(":");
  for (const th of document.querySelectorAll("#tabla-mercado th")) {
    const bo = th.querySelector("[data-orden]");
    th.setAttribute("aria-sort", bo?.dataset.orden === clave ? (dir === "asc" ? "ascending" : "descending") : "none");
  }
}

/** Cualquier cambio de filtro u orden vuelve a la página 1 (y rehace el mapa si está a la vista). */
function repintar() { filtro.pagina = 1; cargarPagina(); if (vista === "mapa") cargarMapa(); }

// ---------- favoritos desde cada fila (lista «Favoritos») ----------
let favoritos = new Set();
const listaFavoritos = () => misListas.find((l) => l.nombre === "Favoritos") ?? null;

function botonEstrella(x) {
  const b = el("button", "estrella");
  b.type = "button";
  const es = favoritos.has(x.id);
  b.setAttribute("aria-pressed", String(es));
  b.setAttribute("aria-label", `${es ? "Quitar de" : "Añadir a"} favoritos: ${nom(x.id, x.nombre)}`);
  b.title = es ? "Quitar de favoritos" : "Añadir a favoritos";
  b.dataset.fav = x.id;
  b.innerHTML = '<svg aria-hidden="true"><use href="#i-estrella" /></svg>';
  return b;
}

async function alternarFavorito(id, nombre) {
  const dentro = !favoritos.has(id);
  const l = listaFavoritos();
  const d = await postJson("/api/listas", l
    ? { accion: "poner", id: l.id, objeto: id, dentro }
    : { accion: "crear", nombre: "Favoritos", objeto: id });
  ponerListas(d.listas, d.favoritos);
  avisar(`${nombre} ${dentro ? "añadido a" : "quitado de"} favoritos`);
  // Filtrando por favoritos, quitar uno lo saca de la tabla.
  if (!dentro && $("f-lista").value === String(listaFavoritos()?.id)) cargarPagina({ silencioso: true });
}

// ---------- filtros activos como etiquetas ----------
function estadoFiltros() {
  const f = leerFiltros();
  return { ...f, ventasRegion: f.ventasRegion || "", lista: f.lista || "" };
}
const NOMBRES_CHIP = {
  categoria: (c) => nombreCat(c), profesion: (p) => nombreProf(p), rol: (r) => NOMBRE_ROL[r]?.toLowerCase() ?? r,
  familia: (f) => NOMBRE_FAMILIA[f] ?? f, calidad: (q) => NOMBRE_CALIDAD[q] ?? q,
  oportunidad: (o) => NOMBRE_OPORTUNIDAD[o] ?? o, moneda: (c) => formatearMoneda(c),
  subcategoria: (s) => nombreSub(s),
  lista: (id) => `Lista «${misListas.find((l) => String(l.id) === String(id))?.nombre ?? "?"}»`,
};

/** Pinta las etiquetas removibles. Devuelve cuántas hay. */
function pintarChips() {
  const chips = chipsFiltros(estadoFiltros(), NOMBRES_CHIP);
  const cont = $("chips-filtros");
  cont.hidden = chips.length === 0 || vista === "mapa";
  cont.replaceChildren(...chips.map((c) => {
    const b = el("button", "chip-filtro");
    b.type = "button"; b.dataset.quitar = c.clave;
    b.setAttribute("aria-label", `Quitar filtro: ${c.texto}`);
    const x = el("span", "x", "×"); x.setAttribute("aria-hidden", "true");
    b.append(c.texto, x);
    return b;
  }));
  if (chips.length > 1) {
    const todo = el("button", "enlace", "Limpiar todo");
    todo.type = "button"; todo.addEventListener("click", limpiarTodo);
    cont.append(todo);
  }
  return chips.length;
}

function quitarFiltro(clave) {
  switch (clave) {
    case "texto": filtro.texto = ""; $("buscador").value = ""; $("btn-borrar-busqueda").hidden = true; break;
    case "categoria": filtro.categoria = ""; filtro.subcategoria = ""; break;
    case "profesion": filtro.profesion = ""; filtro.rol = ""; break;
    case "materiales": $("f-materiales").checked = false; filtro.familia = ""; break;
    case "calidad": filtro.calidad = ""; break;
    case "nivel": $("f-nivel-min").value = ""; $("f-nivel-max").value = ""; break;
    case "precio": $("f-precio-min").value = ""; $("f-precio-max").value = ""; break;
    case "ofertas": $("f-ofertas").checked = false; break;
    case "oportunidad":
      $("f-oportunidad").value = "";
      if ($("f-orden").value.startsWith("margen")) $("f-orden").value = "nombre:asc";
      break;
    case "region": $("f-region").value = ""; break;
    case "lista": $("f-lista").value = ""; break;
  }
  pintarCalidades(); pintarArbol(); pintarProfesiones();
  repintar();
}
$("chips-filtros").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-quitar]");
  if (!b) return;
  quitarFiltro(b.dataset.quitar);
  // El foco no se pierde: pasa a la etiqueta siguiente o al buscador.
  requestAnimationFrame(() => ($("chips-filtros").querySelector(".chip-filtro") ?? $("buscador")).focus());
});

function limpiarTodo() {
  Object.assign(filtro, { texto: "", categoria: "", subcategoria: "", calidad: "", profesion: "", rol: "", familia: "", pagina: 1 });
  for (const id of ["f-nivel-min", "f-nivel-max", "f-precio-min", "f-precio-max"]) $(id).value = "";
  $("f-ofertas").checked = false;
  $("f-oportunidad").value = "";
  $("f-region").value = "";
  $("f-lista").value = "";
  $("f-materiales").checked = false;
  if ($("f-orden").value.startsWith("margen")) $("f-orden").value = "nombre:asc";
  $("buscador").value = "";
  $("btn-borrar-busqueda").hidden = true;
  pintarCalidades(); pintarArbol(); pintarProfesiones();
  repintar();
}
$("btn-quitar-filtros").addEventListener("click", () => { limpiarTodo(); $("buscador").focus(); });
$("btn-reordenar").addEventListener("click", () => {
  if (paginaPendiente) pagina = paginaPendiente;
  paginaPendiente = null;
  $("nuevo-orden").hidden = true;
  pintarTabla();
});

// ---------- filtros, orden, densidad y vista se conservan al recargar ----------
const CAMPOS_GUARDADOS = ["f-nivel-min", "f-nivel-max", "f-precio-min", "f-precio-max", "f-oportunidad", "f-region", "f-orden"];
function guardarEstado() {
  local.escribir("mw_estado", {
    filtro: { ...filtro },
    campos: Object.fromEntries(CAMPOS_GUARDADOS.map((id) => [id, $(id).value])),
    materiales: $("f-materiales").checked, ofertas: $("f-ofertas").checked, lista: $("f-lista").value,
  });
}
let listaPendiente = "";   // la lista guardada se aplica cuando llegan las listas
function restaurarEstado() {
  const e = local.leer("mw_estado", null);
  if (!e || typeof e !== "object") return;
  for (const k of Object.keys(filtro)) if (typeof e.filtro?.[k] === typeof filtro[k]) filtro[k] = e.filtro[k];
  for (const id of CAMPOS_GUARDADOS) {
    const v = e.campos?.[id];
    if (typeof v !== "string") continue;
    const s = $(id);
    if (s.tagName === "SELECT" && ![...s.options].some((o) => o.value === v)) {
      if (id !== "f-orden" || !/^[a-z_0-9]+:(asc|desc)$/.test(v)) continue;
      const o = el("option", "", v.replace(":asc", " ↑").replace(":desc", " ↓")); o.value = v; s.append(o);
    }
    s.value = v;
  }
  $("f-materiales").checked = !!e.materiales;
  $("f-ofertas").checked = !!e.ofertas;
  listaPendiente = typeof e.lista === "string" ? e.lista : "";
  $("buscador").value = filtro.texto;
  $("btn-borrar-busqueda").hidden = !filtro.texto;
  if (filtro.categoria) abiertas.add(filtro.categoria);
  if (filtro.profesion) profAbiertas.add(filtro.profesion);
}

// Densidad de la tabla: cómoda (por defecto) o compacta.
function ponerDensidad(d) {
  document.body.classList.toggle("compacta", d === "compacta");
  for (const b of document.querySelectorAll("#densidad [data-densidad]")) b.setAttribute("aria-pressed", String(b.dataset.densidad === d));
  local.escribir("mw_densidad", d);
}
for (const b of document.querySelectorAll("#densidad [data-densidad]")) b.addEventListener("click", () => ponerDensidad(b.dataset.densidad));
ponerDensidad(local.leer("mw_densidad", "comoda") === "compacta" ? "compacta" : "comoda");

// «Favoritos» en la cabecera: atajo al filtro de la lista «Favoritos».
$("btn-favoritos").addEventListener("click", () => {
  const l = listaFavoritos();
  if (!l) { avisar("Aún no tienes favoritos: pulsa la estrella de un objeto."); return; }
  $("f-lista").value = $("f-lista").value === String(l.id) ? "" : String(l.id);
  repintar();
});

// Grupos plegables de la barra lateral: se recuerda cuáles están abiertos.
for (const d of document.querySelectorAll(".lateral details[id]")) {
  const abiertosGuardados = local.leer("mw_plegables", null);
  if (abiertosGuardados && d.id in abiertosGuardados) d.open = !!abiertosGuardados[d.id];
  d.addEventListener("toggle", () => {
    const g = local.leer("mw_plegables", {}) ?? {};
    g[d.id] = d.open;
    local.escribir("mw_plegables", g);
  });
}

$("tbody").addEventListener("click", (ev) => {
  const fav = ev.target.closest("[data-fav]");
  if (fav) {
    const id = Number(fav.dataset.fav);
    const nombre = nom(id, pagina?.filas.find((x) => x.id === id)?.nombre ?? `#${id}`);
    fav.disabled = true;
    alternarFavorito(id, nombre).catch((e) => avisar("No se pudo guardar el favorito: " + e.message, "bad"))
      .finally(() => { fav.disabled = false; });
    return;
  }
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
      // Solo el texto visible de la cabecera (sin el texto oculto para lectores de pantalla).
      const visible = b.firstChild?.nodeType === Node.TEXT_NODE ? b.firstChild.textContent : b.textContent;
      const o = el("option", "", `${visible} ${nuevaDir === "asc" ? "↑" : "↓"}`); o.value = valor; $("f-orden").append(o);
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
$("f-region").addEventListener("change", () => { repintar(); if (estrecho()) cerrarLateral(); });
$("f-lista").addEventListener("change", () => { repintar(); if (estrecho()) cerrarLateral(); });
$("f-oportunidad").addEventListener("change", () => {
  // Al elegir una oportunidad, lo útil es ver primero la de mayor margen.
  if ($("f-oportunidad").value && !$("f-orden").value.startsWith("margen")) $("f-orden").value = "margen:desc";
  if (!$("f-oportunidad").value && $("f-orden").value.startsWith("margen")) $("f-orden").value = "nombre:asc";
  repintar();
  if (estrecho()) cerrarLateral();
});
$("f-materiales").addEventListener("change", () => {
  if (!$("f-materiales").checked) filtro.familia = "";
  pintarProfesiones();
  repintar();
});

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

/**
 * Profesiones (desplegables, con icono y contador) y familias de materiales.
 * Los contadores vienen del servidor y respetan la categoría y los filtros generales.
 */
function pintarProfesiones() {
  const d = pagina;
  // «Materiales de profesiones» y sus familias.
  $("n-materiales").textContent = d ? d.materiales_total.toLocaleString("es") : "";
  const ulF = $("familias");
  ulF.hidden = !$("f-materiales").checked;
  ulF.replaceChildren(...(d?.familias ?? []).map((f) => {
    const li = el("li");
    const b = el("button", "arbol-btn mini");
    b.type = "button";
    b.append(el("span", "arbol-txt", NOMBRE_FAMILIA[f.familia] ?? f.familia), el("span", "arbol-n", f.n.toLocaleString("es")));
    if (filtro.familia === f.familia) b.setAttribute("aria-current", "true");
    b.addEventListener("click", () => { filtro.familia = filtro.familia === f.familia ? "" : f.familia; pintarProfesiones(); repintar(); });
    li.append(b);
    return li;
  }));
  // Profesiones.
  const lista = (d?.profesiones_roles ?? []).slice().sort((a, b) => nombreProf(a.profesion).localeCompare(nombreProf(b.profesion), "es"));
  const ul = $("arbol-prof");
  ul.replaceChildren(...lista.map((p) => {
    const li = el("li");
    const cab = el("div", "arbol-fila");
    const b = el("button", "arbol-btn");
    b.type = "button";
    b.title = `${p.profesion}: materiales, recetas y productos (de las recetas de AHledger y la clasificación oficial)`;
    b.append(iconoNodo(p.icono, nombreProf(p.profesion)), el("span", "arbol-txt", nombreProf(p.profesion)),
      el("span", "arbol-n", p.n.toLocaleString("es")));
    if (filtro.profesion === p.profesion && !filtro.rol) b.setAttribute("aria-current", "true");
    b.addEventListener("click", () => elegirProfesion(filtro.profesion === p.profesion && !filtro.rol ? "" : p.profesion, ""));
    const abierta = profAbiertas.has(p.profesion);
    const plegar = el("button", "arbol-plegar", abierta ? "▾" : "▸");
    plegar.type = "button";
    plegar.setAttribute("aria-expanded", String(abierta));
    plegar.setAttribute("aria-label", `${abierta ? "Contraer" : "Expandir"} ${nombreProf(p.profesion)}`);
    plegar.addEventListener("click", () => { abierta ? profAbiertas.delete(p.profesion) : profAbiertas.add(p.profesion); pintarProfesiones(); });
    cab.append(b, plegar);
    li.append(cab);
    if (abierta) {
      // Alternar entre materiales, recetas y productos de esa profesión.
      const grupo = el("div", "roles");
      grupo.setAttribute("role", "group");
      grupo.setAttribute("aria-label", `Ver de ${nombreProf(p.profesion)}`);
      for (const rol of ["material", "receta", "producto"]) {
        const r = el("button", "chip-rol", `${NOMBRE_ROL[rol]} ${p[rol].toLocaleString("es")}`);
        r.type = "button";
        r.disabled = p[rol] === 0;
        const activo = filtro.profesion === p.profesion && filtro.rol === rol;
        r.setAttribute("aria-pressed", String(activo));
        // Pulsar el rol activo lo quita y deja la profesión entera.
        r.addEventListener("click", () => elegirProfesion(p.profesion, activo ? "" : rol));
        grupo.append(r);
      }
      li.append(grupo);
    }
    return li;
  }));
}

function elegirProfesion(prof, rol) {
  filtro.profesion = prof; filtro.rol = prof ? rol : "";
  if (prof) profAbiertas.add(prof);
  pintarProfesiones();
  repintar();
  if (estrecho() && rol) cerrarLateral();
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
        sub.append(fila(nombreSub(s.subcategoria), s.n, undefined, filtro.categoria === c.categoria && filtro.subcategoria === s.subcategoria,
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

$("btn-limpiar").addEventListener("click", limpiarTodo);

// ---------- catálogo: cobertura medida e importación verificable de IDs ----------
function pintarCobertura(c) {
  if (!c) return;
  const n = (x) => (x ?? 0).toLocaleString("es");
  $("cat-total").textContent = n(c.catalogo);
  const dl = $("cat-cobertura");
  dl.replaceChildren();
  const fila = (k, v, ayuda) => { const dt = el("dt", "", k); if (ayuda) dt.title = ayuda; dl.append(dt, el("dd", "", v)); };
  fila("En el catálogo", n(c.catalogo), `Objetos con ficha verificada (${c.fuente})`);
  fila("Vistos en subasta", n(c.por_origen.mercado), "Aparecieron en algún escaneo de un mercado real");
  fila("De recetas", n(c.por_origen.receta), `Materiales o resultados de recetas de AHledger (${n(c.por_origen.solo_receta)} solo por recetas)`);
  if (c.por_origen.importacion) fila("Importados", n(c.por_origen.importacion), "Añadidos por ID desde aquí");
  if (c.pendientes) fila("Por verificar", n(c.pendientes), "En cola: se comprueban con AHledger cada 5 minutos, por lotes");
  if (c.sin_ficha_en_fuente) fila("Sin ficha en la fuente", n(c.sin_ficha_en_fuente), "AHledger no tiene ese ID: no se añaden");
  const nota = el("dd", "nota", "No es el total del juego: ninguna fuente permitida publica la lista completa.");
  dl.append(nota);
}

let coberturaPedida = false;
async function cargarCobertura() {
  try {
    const r = await fetch("/api/cobertura", { cache: "no-store" });
    if (r.ok) pintarCobertura(await r.json());
  } catch { /* se queda como está */ }
}
$("grupo-catalogo").addEventListener("toggle", () => {
  if ($("grupo-catalogo").open && !coberturaPedida) { coberturaPedida = true; cargarCobertura(); }
});

/** Informe del catálogo: por categoría, iconos, precio TSM, duplicados y errores (se pide al desplegarlo). */
$("cat-informe").addEventListener("toggle", async () => {
  if (!$("cat-informe").open) return;
  const cuerpo = $("cat-informe-cuerpo");
  cuerpo.replaceChildren(el("p", "muted small", "Cargando…"));
  try {
    const r = await fetch("/api/cobertura?informe=1", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
    const n = (x) => (x ?? 0).toLocaleString("es");
    const resumen = el("dl", "cobertura");
    const fila = (k, v, ayuda) => { const dt = el("dt", "", k); if (ayuda) dt.title = ayuda; resumen.append(dt, el("dd", "", v)); };
    fila("IDs únicos", n(d.ids_unicos), "Clave por ID y versión del juego: un ID no puede repetirse");
    fila("Duplicados", n(d.duplicados));
    fila("Iconos de Blizzard", n(d.iconos.blizzard));
    fila("Iconos vía AHledger", n(d.iconos.ahledger), "Objetos nuevos de Forever cuyo icono sirve AHledger");
    fila("Sin icono", n(d.iconos.sin_icono), `${n(d.iconos.sin_icono_con_ficha)} con ficha; el resto, sin ficha en la fuente`);
    fila("Sin ficha en la fuente", n(d.sin_ficha), "AHledger solo da un nombre provisional y TSM no da nombre");
    fila("Con precio de TSM", n(d.precios_tsm.vistos), "Objetos que alguna vez han aparecido en el archivo de TSM");
    fila("Con ofertas ahora", n(d.precios_tsm.con_ofertas_ultimo_escaneo), "Con compra mínima en el último escaneo de TSM");
    fila("Errores de la fuente", n(d.errores.reduce((s, e) => s + e.n, 0)), d.errores.map((e) => `${e.motivo}: ${e.n}`).join(" · "));
    fila("Pendientes", n(d.pendientes + d.por_reverificar));
    const tabla = el("table", "tabla mini informe");
    const cab = el("tr");
    for (const [t, c, ayuda] of [["Categoría", ""], ["Total", "num", "Objetos en el catálogo"],
      ["Sin ic.", "num", "Sin icono"], ["TSM", "num", "Con precio de TSM alguna vez"]]) {
      const th = el("th", c, t); if (ayuda) th.title = ayuda; cab.append(th);
    }
    tabla.append(cab);
    for (const x of d.por_categoria) {
      const tr = el("tr");
      tr.append(el("td", "", nombreCat(x.categoria)), el("td", "num", n(x.total)), el("td", "num", n(x.sin_icono)), el("td", "num", n(x.visto_tsm)));
      tr.title = `${x.categoria}: ${n(x.icono_blizzard)} iconos de Blizzard, ${n(x.icono_ahledger)} vía AHledger, ` +
        `${n(x.sin_calidad)} sin calidad, ${n(x.sin_ficha)} sin ficha, ${n(x.ofertas_tsm)} con ofertas en TSM ahora`;
      tabla.append(tr);
    }
    cuerpo.replaceChildren(resumen, tabla,
      el("p", "muted small", `Última verificación con AHledger: ${fecha(d.ultima_verificacion)}.`));
  } catch (e) {
    cuerpo.replaceChildren(el("p", "bad small", "No se pudo cargar el informe: " + e.message));
  }
});

$("ids-archivo").addEventListener("change", async () => {
  const f = $("ids-archivo").files[0];
  if (f) $("ids-texto").value = await f.text();
});
$("form-ids").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const msg = $("ids-msg");
  const { ids, errores } = leerIds($("ids-texto").value);
  msg.hidden = false;
  if (!ids.length) { msg.className = "small bad"; msg.textContent = errores[0] ?? "Escribe al menos un ID."; return; }
  if (ids.length > MAX_IDS) { msg.className = "small bad"; msg.textContent = `Máximo ${MAX_IDS} IDs por importación.`; return; }
  try {
    const r = await fetch("/api/cobertura", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
    pintarCobertura(d.cobertura);
    msg.className = "small ok";
    msg.textContent = `${d.validos} IDs recibidos: ${d.ya_en_catalogo} ya estaban, ${d.nuevos_en_cola} nuevos en cola para verificar con AHledger.` +
      (errores.length ? ` ${errores.length} no eran IDs (${errores.slice(0, 2).join("; ")}${errores.length > 2 ? "…" : ""}).` : "");
    $("ids-texto").value = ""; $("ids-archivo").value = "";
  } catch (e) {
    msg.className = "small bad";
    msg.textContent = "No se pudieron añadir: " + e.message;
  }
});

// ---------- precios de compra al NPC (X4): importación verificable ----------
let npcPendiente = null;   // filas comprobadas, a la espera de «Guardar»

function pintarListaNpc(lista) {
  $("npc-total").textContent = lista.length ? String(lista.length) : "";
  $("npc-lista").replaceChildren(...lista.map((x) => {
    const li = el("li");
    const b = el("button", "enlace", nom(x.id, x.nombre));
    b.type = "button"; b.addEventListener("click", () => { location.hash = `#/objeto/${x.id}`; });
    li.append(b, " ", monedaNodo(x.precio));
    return li;
  }));
}
async function cargarListaNpc() {
  try {
    const r = await fetch(`/api/compra-npc?mercado=${urlMercado()}`, { cache: "no-store" });
    if (r.ok) pintarListaNpc(await r.json());
  } catch { /* la lista es solo informativa */ }
}
$("grupo-npc").addEventListener("toggle", () => { if ($("grupo-npc").open) cargarListaNpc(); });
$("npc-archivo").addEventListener("change", async () => {
  const f = $("npc-archivo").files[0];
  if (f) $("npc-texto").value = await f.text();
});
$("npc-texto").addEventListener("input", () => { npcPendiente = null; $("npc-guardar").disabled = true; });

async function enviarNpc(filas, aplicar) {
  const r = await fetch(`/api/compra-npc?mercado=${urlMercado()}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filas, aplicar }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
  return d;
}
$("form-npc").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const msg = $("npc-msg");
  msg.hidden = false;
  npcPendiente = null; $("npc-guardar").disabled = true;
  const { filas, errores } = leerPreciosNpc($("npc-texto").value);
  if (!filas.length) { msg.className = "small bad"; msg.textContent = errores[0] ?? "Escribe al menos una línea «ID,precio»."; return; }
  try {
    const d = await enviarNpc(filas, false);
    const mal = [...errores, ...d.rechazadas.map((x) => `Fila ${x.fila} (${x.id}): ${x.motivo}`)];
    const ok = d.aceptadas.map((x) => `${nom(x.id, x.nombre)}: ${x.borrar ? "borrar" : formatearMoneda(x.precio)}`);
    msg.className = "small " + (mal.length ? "bad" : "ok");
    msg.textContent = (ok.length ? `Se guardarían ${ok.length}: ${ok.slice(0, 6).join(" · ")}${ok.length > 6 ? "…" : ""}. ` : "Nada que guardar. ") +
      (mal.length ? `${mal.length} rechazadas: ${mal.slice(0, 3).join("; ")}${mal.length > 3 ? "…" : ""}` : "");
    if (d.aceptadas.length) { npcPendiente = d.aceptadas.map((x) => ({ id: x.id, precio: x.borrar ? null : x.precio })); $("npc-guardar").disabled = false; }
  } catch (e) {
    msg.className = "small bad"; msg.textContent = "No se pudo comprobar: " + e.message;
  }
});
$("npc-guardar").addEventListener("click", async () => {
  if (!npcPendiente) return;
  const msg = $("npc-msg");
  try {
    const d = await enviarNpc(npcPendiente, true);
    msg.className = "small ok";
    msg.textContent = `Guardados ${d.aceptadas.length}. Las recetas ya los usan como «introducido por ti».`;
    npcPendiente = null; $("npc-guardar").disabled = true;
    $("npc-texto").value = ""; $("npc-archivo").value = "";
    cargarListaNpc();
    if (objetoActual) abrirObjeto(objetoActual, { silencioso: true });
  } catch (e) {
    msg.className = "small bad"; msg.textContent = "No se pudo guardar: " + e.message;
  }
});

// ---------- vista «Mapa»: treemap de materiales por familia ----------
let vista = local.leer("mw_vista", "lista") === "mapa" ? "mapa" : "lista";   // cualquier otro valor guardado = lista
let periodoMapa = "24h";
let mapaDatos = null;
let mapaN = 0;
// X5: mapa de toda la casa (clase › subclase › objetos).
let ambitoMapa = local.leer("mw_mapa_ambito", "materiales") === "casa" ? "casa" : "materiales";
const casaNivel = { clase: "", subclase: "" };

function ponerAmbito(a) {
  ambitoMapa = a;
  local.escribir("mw_mapa_ambito", a);
  for (const b of document.querySelectorAll("#mapa-ambito [data-ambito]")) b.setAttribute("aria-pressed", String(b.dataset.ambito === a));
  cargarMapa();
}
for (const b of document.querySelectorAll("#mapa-ambito [data-ambito]")) b.addEventListener("click", () => ponerAmbito(b.dataset.ambito));
for (const b of document.querySelectorAll("#mapa-ambito [data-ambito]")) b.setAttribute("aria-pressed", String(b.dataset.ambito === ambitoMapa));

function irNivelCasa(clase, subclase = "") {
  casaNivel.clase = clase; casaNivel.subclase = clase ? subclase : "";
  cargarMapa();
}

/** Migas del mapa de la casa: «Toda la casa › Clase › Subclase», cada nivel anterior se puede pulsar. */
function pintarMigas(d) {
  const nav = $("mapa-migas");
  nav.hidden = d?.ambito !== "casa";
  if (nav.hidden) return;
  const pasos = [["Toda la casa", "", ""]];
  if (d.clase) pasos.push([nombreCat(d.clase), d.clase, ""]);
  if (d.subclase) pasos.push([nombreSub(d.subclase), d.clase, d.subclase]);
  nav.replaceChildren(...pasos.flatMap(([txt, c, s], i) => {
    const ultimoPaso = i === pasos.length - 1;
    const n = ultimoPaso ? el("span", "", txt) : el("button", "enlace", txt);
    if (!ultimoPaso) { n.type = "button"; n.addEventListener("click", () => irNivelCasa(c, s)); }
    else n.setAttribute("aria-current", "location");
    return i ? [el("span", "muted", " › "), n] : [n];
  }));
}
const PERIODO_TXT = { "24h": "24 h", "3d": "3 días", "7d": "7 días" };

function ponerVista(v) {
  vista = v;
  local.escribir("mw_vista", v);
  for (const b of document.querySelectorAll(".btn-vista[data-modo]")) b.setAttribute("aria-pressed", String(b.dataset.modo === v));
  $("mapa").hidden = v !== "mapa";
  $("vista-lista").hidden = v === "mapa";
  document.querySelector(".res-cab .orden").hidden = v === "mapa";
  if (v === "mapa") {
    $("paginador").hidden = true; $("sin-resultados").hidden = true;
    $("chips-filtros").hidden = true; $("nuevo-orden").hidden = true;
    for (const id of ["btn-favoritos", "densidad"]) $(id).hidden = true;
    cargarMapa();
  } else {
    for (const id of ["btn-favoritos", "densidad"]) $(id).hidden = false;
    pintarTabla();
  }
}
// Solo los botones Lista / Mapa (los de densidad usan el mismo estilo, pero no cambian la vista).
for (const b of document.querySelectorAll(".btn-vista[data-modo]")) b.addEventListener("click", () => ponerVista(b.dataset.modo));
for (const b of document.querySelectorAll("#mapa-periodos [data-periodo]")) {
  b.addEventListener("click", () => {
    periodoMapa = b.dataset.periodo;
    for (const x of document.querySelectorAll("#mapa-periodos [data-periodo]")) x.setAttribute("aria-pressed", String(x === b));
    cargarMapa();
  });
}

async function cargarMapa() {
  if (!ultimo?.mercado?.clave) return;
  const n = ++mapaN;
  let q;
  if (ambitoMapa === "casa") {
    q = new URLSearchParams(paramsMapaCasa({ mercado: ultimo.mercado.clave, periodo: periodoMapa, clase: casaNivel.clase,
      subclase: casaNivel.subclase, calidad: filtro.calidad, soloOfertas: $("f-ofertas").checked }));
  } else {
    q = new URLSearchParams({ mercado: ultimo.mercado.clave, periodo: periodoMapa });
    if (filtro.profesion) q.set("profesion", filtro.profesion);
    if ($("f-materiales").checked && filtro.familia) q.set("familia", filtro.familia);
    if (filtro.calidad) q.set("calidad", filtro.calidad);
    if ($("f-ofertas").checked) q.set("solo_ofertas", "true");
  }
  $("mapa").classList.add("cargando");
  try {
    const r = await fetch("/api/mapa?" + q, { cache: "no-store" });
    const d = await r.json();
    if (n !== mapaN) return;
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
    mapaDatos = d;
    pintarMapa();
  } catch (e) {
    if (n === mapaN) avisar("No se pudo cargar el mapa: " + e.message, "bad");
  } finally {
    if (n === mapaN) $("mapa").classList.remove("cargando");
  }
}

const contadorMapa = (d) =>
  `${d.total.toLocaleString("es")} ${d.ambito === "casa" ? "objetos" : "materiales"} · ` +
  `${d.con_variacion.toLocaleString("es")} con variación en ${PERIODO_TXT[d.periodo]}` +
  (d.limite && d.total > d.limite ? ` · se ven los ${d.limite.toLocaleString("es")} primeros` : "");

/** Texto de un grupo del mapa de la casa (tooltip y lector de pantalla). */
function textoGrupo(g, d) {
  const nombre = d.nivel === "clases" ? nombreCat(g.clave) : nombreSub(g.clave);
  const partes = [nombre, `${g.n.toLocaleString("es")} objetos (${g.con_ofertas.toLocaleString("es")} con ofertas)`];
  partes.push(g.variacion != null
    ? `mediana ${textoVariacion(Number(g.variacion))} en ${PERIODO_TXT[d.periodo]} (de ${g.con_variacion.toLocaleString("es")} con historial)`
    : `sin historial comparable de hace ${PERIODO_TXT[d.periodo]}`);
  if (d.tamano === "cantidad") partes.push(`${Number(g.cantidad).toLocaleString("es")} uds. publicadas`);
  partes.push("pulsa para ver dentro");
  return partes.join(" · ");
}

function bloqueGrupo(g, d, r) {
  const v = g.variacion == null ? null : Number(g.variacion);
  const b = el("button", "m-bloque m-grupo t-" + (g.con_ofertas ? tonoVariacion(v) : "nodato"));
  b.type = "button";
  b.style.left = `${r.x}px`; b.style.top = `${r.y}px`;
  b.style.width = `${Math.max(0, r.w - 2)}px`; b.style.height = `${Math.max(0, r.h - 2)}px`;
  const texto = textoGrupo(g, d);
  b.setAttribute("aria-label", texto);
  b.dataset.tip = texto;
  b.dataset.grupo = g.clave;
  const nombre = d.nivel === "clases" ? nombreCat(g.clave) : nombreSub(g.clave);
  if (r.w >= 30 && r.h >= 28) b.append(iconoNodo(g.icono, nombre, null));
  if (r.w >= 64 && r.h >= 44) b.append(el("span", "m-nombre", abreviar(`${nombre} · ${g.n}`, Math.floor((r.w - 8) / 6.2))));
  if (r.w >= 40 && r.h >= 36) {
    const flecha = v > 0 ? "▲" : v < 0 ? "▼" : "▬";
    b.append(el("span", "m-var", v != null ? `${flecha} ${textoVariacion(v)}` : "s/h"));
  }
  return b;
}

/** Mapa de la casa: un solo treemap con los grupos (clases o subclases) o con los objetos de una subclase. */
function pintarMapaCasa(d, cont, ancho) {
  $("mapa-tamano").textContent = d.tamano === "cantidad"
    ? "Tamaño: unidades publicadas en el último escaneo"
    : d.nivel === "objetos" ? "Tamaño: igual para todos (esta fuente no publica cantidades)"
      : "Tamaño: número de objetos (esta fuente no publica cantidades) · color: mediana de la variación";
  $("titulo-resultados").textContent = "Mapa de la casa" + (d.clase ? ` · ${nombreCat(d.clase)}` : "") + (d.subclase ? ` · ${nombreSub(d.subclase)}` : "");
  const objetos = d.nivel === "objetos";
  const lista = objetos ? d.objetos : d.grupos;
  const peso = (x) => (objetos ? pesoBloque(x, d.tamano) : pesoGrupo(x, d.tamano));
  const conPeso = lista.filter((x) => peso(x) > 0), sinPeso = lista.filter((x) => peso(x) === 0);
  const pinta = (x, r) => (objetos ? bloqueMapa(x, d, r) : bloqueGrupo(x, d, r));
  const nodos = [];
  if (conPeso.length) {
    const areaBloque = ancho < 560 ? 2500 : 3600;
    const alto = Math.max(objetos ? 360 : 420, Math.round(window.innerHeight * 0.9),
      objetos ? Math.ceil((conPeso.length * areaBloque) / ancho) : 0);
    const area = el("div", "m-area");
    area.style.height = `${alto}px`;
    for (const r of squarify(conPeso.map((x) => ({ peso: peso(x) })), 0, 0, ancho, alto)) area.append(pinta(conPeso[r.i], r));
    nodos.push(area);
  }
  if (sinPeso.length) {   // sin unidades publicadas (solo con cantidades): franja uniforme aparte
    const sec = el("section", "m-familia");
    sec.append(el("h3", "m-fam-tit", `Sin ofertas ahora · ${sinPeso.length}`));
    const franja = el("div", "m-area m-franja");
    const lado = objetos ? 34 : 64, porFila = Math.max(1, Math.floor(ancho / lado));
    franja.style.height = `${Math.ceil(sinPeso.length / porFila) * lado}px`;
    sinPeso.forEach((x, i) => franja.append(pinta(x, { x: (i % porFila) * lado, y: Math.floor(i / porFila) * lado, w: lado, h: lado })));
    sec.append(franja);
    nodos.push(sec);
  }
  if (!nodos.length) nodos.push(el("p", "muted vacio", "Ningún objeto coincide con los filtros."));
  cont.replaceChildren(...nodos);
}

/** Texto completo de un bloque (tooltip y lector de pantalla). */
function textoBloque(o, d) {
  const partes = [nom(o.id, o.nombre)];
  if (o.estado === "con_ofertas") partes.push(`Compra mínima ${formatearMoneda(o.precio)}`);
  else partes.push(ESTADO[o.estado]);
  if (o.variacion != null) {
    partes.push(`${textoVariacion(o.variacion)} en ${PERIODO_TXT[d.periodo]} (antes ${formatearMoneda(o.precio_ref)}, ${fecha(o.hora_ref)})`);
  } else if (o.estado === "con_ofertas") {
    partes.push(`Sin historial comparable de hace ${PERIODO_TXT[d.periodo]}`);
  }
  if (d.tamano === "cantidad" && o.cantidad != null) partes.push(`${o.cantidad.toLocaleString("es")} uds. publicadas`);
  if (o.hora) partes.push(`Dato del ${fecha(o.hora)} (${hace(o.hora)})`);
  return partes.join(" · ");
}

function bloqueMapa(o, d, r) {
  const b = el("button", "m-bloque t-" + (o.estado === "con_ofertas" ? tonoVariacion(o.variacion) : "nodato"));
  b.type = "button";
  b.style.left = `${r.x}px`; b.style.top = `${r.y}px`;
  b.style.width = `${Math.max(0, r.w - 2)}px`; b.style.height = `${Math.max(0, r.h - 2)}px`;   // 2 px de separación
  const texto = textoBloque(o, d);
  b.setAttribute("aria-label", texto);
  b.dataset.tip = texto;
  b.dataset.id = o.id;
  // Contenido según el espacio: icono, nombre abreviado y variación con signo.
  if (r.w >= 30 && r.h >= 28) b.append(iconoNodo(o.icono, nom(o.id, o.nombre), o.calidad));
  else if (o.variacion != null) b.append(el("span", "m-var", o.variacion > 0 ? "▲" : o.variacion < 0 ? "▼" : "▬"));
  if (r.w >= 64 && r.h >= 44) b.append(el("span", "m-nombre", abreviar(nom(o.id, o.nombre), Math.floor((r.w - 8) / 6.2))));
  // Variación con flecha y signo (el color nunca va solo). En bloques estrechos, en formato compacto.
  if (r.w >= 40 && r.h >= 36) {
    const flecha = o.variacion > 0 ? "▲" : o.variacion < 0 ? "▼" : "▬";
    const corta = r.w < 72;
    const v = o.variacion != null
      ? `${flecha} ${corta ? `${o.variacion > 0 ? "+" : o.variacion < 0 ? "−" : ""}${Math.abs(Math.round(o.variacion))} %` : textoVariacion(o.variacion)}`
      : o.estado === "con_ofertas" ? "s/h" : o.estado === "sin_ofertas" ? "sin of." : "s/d";
    b.append(el("span", "m-var", v));
  }
  return b;
}

function pintarMapa() {
  const d = mapaDatos;
  if (!d) return;
  const cont = $("mapa-familias");
  const ancho = Math.max(240, cont.clientWidth || 600);
  pintarMigas(d);
  $("contador").textContent = contadorMapa(d);
  if (d.ambito === "casa") { pintarMapaCasa(d, cont, ancho); return; }
  $("mapa-tamano").textContent = d.tamano === "cantidad"
    ? "Tamaño: unidades publicadas en el último escaneo"
    : "Tamaño: igual para todos (esta fuente no publica cantidades)";
  $("mapa-tamano").title = d.tamano === "cantidad" ? "Los materiales sin ofertas van en una franja aparte" : "";
  $("contador").textContent = contadorMapa(d);
  $("titulo-resultados").textContent = "Mapa de materiales" +
    (filtro.profesion ? ` · ${nombreProf(filtro.profesion)}` : "") +
    ($("f-materiales").checked && filtro.familia ? ` · ${NOMBRE_FAMILIA[filtro.familia]}` : "");
  // Altura repartida por familias según su peso. Con tamaño uniforme, cada bloque mide al menos
  // ~60×60 px en escritorio (~40×40 en el móvil) para que quepan icono, nombre y variación.
  const pesos = d.familias.map((f) => f.objetos.reduce((s, o) => s + pesoBloque(o, d.tamano), 0));
  const total = pesos.reduce((s, p) => s + p, 0) || 1;
  const bloques = d.familias.reduce((s, f) => s + f.objetos.length, 0);
  const areaBloque = ancho < 560 ? 2500 : 3600;
  const altoTotal = Math.max(520, Math.round(window.innerHeight * 1.2), Math.ceil((bloques * areaBloque) / ancho));
  const nodos = [];
  d.familias.forEach((f, k) => {
    const sec = el("section", "m-familia");
    sec.append(el("h3", "m-fam-tit", `${NOMBRE_FAMILIA[f.familia] ?? f.familia} · ${f.objetos.length}`));
    const conPeso = f.objetos.filter((o) => pesoBloque(o, d.tamano) > 0);
    const sinPeso = f.objetos.filter((o) => pesoBloque(o, d.tamano) === 0);
    if (conPeso.length) {
      const alto = Math.max(48, Math.round((pesos[k] / total) * altoTotal));
      const area = el("div", "m-area");
      area.style.height = `${alto}px`;
      const rects = squarify(conPeso.map((o) => ({ peso: pesoBloque(o, d.tamano) })), 0, 0, ancho, alto);
      for (const r of rects) area.append(bloqueMapa(conPeso[r.i], d, r));
      sec.append(area);
    }
    if (sinPeso.length) {   // solo en modo «cantidad»: sin ofertas → franja uniforme aparte
      const franja = el("div", "m-area m-franja");
      const lado = 34, porFila = Math.max(1, Math.floor(ancho / lado));
      franja.style.height = `${Math.ceil(sinPeso.length / porFila) * lado}px`;
      sinPeso.forEach((o, i) => franja.append(bloqueMapa(o, d, { x: (i % porFila) * lado, y: Math.floor(i / porFila) * lado, w: lado, h: lado })));
      sec.append(franja);
    }
    nodos.push(sec);
  });
  if (!nodos.length) nodos.push(el("p", "muted vacio", "Ningún material coincide con los filtros."));
  cont.replaceChildren(...nodos);
}

// Tooltip compartido (ratón y foco) y apertura del detalle.
function mostrarTip(b, x, y) {
  const tip = $("mapa-tip");
  tip.textContent = b.dataset.tip;
  tip.hidden = false;
  const caja = $("mapa").getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  let left = x - caja.left + 12, top = y - caja.top + 14;
  if (left + t.width > caja.width) left = Math.max(0, x - caja.left - t.width - 12);
  tip.style.left = `${left}px`; tip.style.top = `${top}px`;
}
$("mapa-familias").addEventListener("pointermove", (ev) => {
  const b = ev.target.closest(".m-bloque");
  if (b) mostrarTip(b, ev.clientX, ev.clientY); else $("mapa-tip").hidden = true;
});
$("mapa-familias").addEventListener("pointerleave", () => { $("mapa-tip").hidden = true; });
$("mapa-familias").addEventListener("focusin", (ev) => {
  const b = ev.target.closest(".m-bloque");
  if (!b) return;
  const r = b.getBoundingClientRect();
  mostrarTip(b, r.left + r.width / 2, r.bottom);
});
$("mapa-familias").addEventListener("focusout", () => { $("mapa-tip").hidden = true; });
$("mapa-familias").addEventListener("click", (ev) => {
  const b = ev.target.closest(".m-bloque");
  if (!b) return;
  $("mapa-tip").hidden = true;
  if (b.dataset.grupo != null && mapaDatos?.ambito === "casa") {   // bajar un nivel
    if (mapaDatos.nivel === "clases") irNivelCasa(b.dataset.grupo);
    else irNivelCasa(mapaDatos.clase, b.dataset.grupo);
    return;
  }
  location.hash = `#/objeto/${b.dataset.id}`;
});
let temporizadorMapa = null;
new ResizeObserver(() => {
  if (vista !== "mapa") return;
  clearTimeout(temporizadorMapa);
  temporizadorMapa = setTimeout(pintarMapa, 120);
}).observe($("mapa"));

// ---------- barra lateral en el móvil ----------
const estrecho = () => window.matchMedia("(max-width: 900px)").matches;
const detalleSuperpuesto = () => window.matchMedia("(max-width: 1339px)").matches;
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
  objetoN++;   // una carga del detalle que aún estuviera en curso ya no se pinta
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
  if ($("buscador").closest(".combo").contains(document.activeElement)) return;   // Escape del buscador solo cierra sus listas
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
  const es = nombresEs.get(f.id);
  cab.append(iconoNodo(f.icono, es ?? f.nombre, f.calidad, true));
  const t = el("div");
  // Acciones discretas: copiar nombre o ID y abrir Wowhead.
  const copiar = (texto, valor, etiqueta) => {
    const b = el("button", "btn-mini");
    b.type = "button"; b.setAttribute("aria-label", etiqueta);
    b.innerHTML = '<svg aria-hidden="true"><use href="#i-copiar" /></svg>';
    b.append(texto);
    b.addEventListener("click", async () => {
      const ok = await copiarTexto(valor);
      avisar(ok ? `Copiado: ${valor}` : "No se pudo copiar: selecciónalo a mano", ok ? "" : "bad");
    });
    return b;
  };
  const acciones = el("div", "det-acciones");
  // Favorito: el mismo que la estrella de la fila (lista «Favoritos»).
  const fav = el("button", "btn-mini");
  fav.type = "button";
  const pintarFav = () => {
    const marcado = favoritos.has(f.id);
    fav.setAttribute("aria-pressed", String(marcado));
    fav.replaceChildren();
    fav.insertAdjacentHTML("afterbegin", '<svg aria-hidden="true"><use href="#i-estrella" /></svg>');
    fav.append("Favorito");
    fav.setAttribute("aria-label", marcado ? "Quitar de favoritos" : "Añadir a favoritos");
  };
  pintarFav();
  fav.addEventListener("click", async () => {
    fav.disabled = true;
    try { await alternarFavorito(f.id, nom(f.id, f.nombre)); pintarFav(); }
    catch (e) { avisar("No se pudo guardar el favorito: " + e.message, "bad"); }
    finally { fav.disabled = false; }
  });
  acciones.append(fav);
  if (!sinFicha(f.nombre)) acciones.append(copiar("Nombre", es ?? f.nombre, `Copiar el nombre: ${es ?? f.nombre}`));
  acciones.append(copiar(`#${f.id}`, String(f.id), `Copiar el ID ${f.id}`));
  if (f.wowhead_url) {
    const a = el("a", "btn-mini wowhead", "Wowhead ↗");
    a.href = f.wowhead_url; a.target = "_blank"; a.rel = "noopener";
    a.setAttribute("aria-label", "Abrir en Wowhead (pestaña nueva)");
    acciones.append(a);
  }
  t.append(sinFicha(f.nombre)
    ? el("div", "det-sub sin-ficha", `${TEXTO_SIN_FICHA}: ni AHledger ni TSM publican su nombre, calidad ni icono.`)
    : el("div", "det-sub", [NOMBRE_CALIDAD[f.calidad] ?? f.calidad, [nombreCat(f.clase ?? SIN_CATEGORIA), nombreSub(f.subclase)]
      .filter((x) => x && x !== nombreCat(SIN_CATEGORIA)).join(" › "), f.nivel ? `nivel ${f.nivel}` : null].filter(Boolean).join(" · ")),
    acciones);
  cab.append(t);
  return cab;
}

/** Pestaña del historial en el detalle: «grafico» o «precios» (tabla de precio por unidad). Se recuerda. */
let vistaHistorial = local.leer("mw_vista_historial", "grafico") === "precios" ? "precios" : "grafico";

function seccionGrafico(id) {
  const sec = el("section", "det-sec-fija");
  const graf = el("div", "det-grafico");
  // Pestañas «Gráfico | Precios» (mismos datos y mismo periodo).
  const pestanas = el("div", "pestanas");
  pestanas.setAttribute("role", "tablist");
  pestanas.setAttribute("aria-label", "Historial de precios");
  const botonesTab = [["grafico", "Gráfico"], ["precios", "Precios"]].map(([v, txt]) => {
    const b = el("button", "pestana", txt);
    b.type = "button"; b.dataset.vista = v; b.id = `tab-hist-${v}`;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-controls", "panel-historial");
    b.addEventListener("click", () => elegir(v, true));
    return b;
  });
  graf.id = "panel-historial";
  graf.setAttribute("role", "tabpanel");
  const elegir = (v, recargar) => {
    vistaHistorial = v;
    local.escribir("mw_vista_historial", v);
    for (const b of botonesTab) {
      const sel = b.dataset.vista === v;
      b.setAttribute("aria-selected", String(sel));
      b.tabIndex = sel ? 0 : -1;
    }
    graf.setAttribute("aria-labelledby", `tab-hist-${v}`);
    if (recargar) pintarHistorial(graf);
  };
  // Flechas para pasar de una pestaña a otra (patrón de pestañas accesible).
  pestanas.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
    ev.preventDefault();
    const otra = vistaHistorial === "grafico" ? "precios" : "grafico";
    elegir(otra, true);
    botonesTab.find((b) => b.dataset.vista === otra).focus();
  });
  pestanas.append(...botonesTab);
  elegir(vistaHistorial, false);

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
  const cab = el("div", "hist-cab");
  cab.append(pestanas, grupo);
  sec.append(cab, graf);
  cargarHistorialEn(graf, id, rangoHistorial);
  return sec;
}

/** Clave del mercado AHledger del mismo reino (región, tipo y facción) que el actual, si el actual no es AHledger. */
function mercadoCantidades() {
  const actual = ultimo?.mercado;
  if (!actual || /^ahledger:/.test(actual.clave)) return null;
  const p = partesMercado(actual);
  return (ultimo.mercados ?? []).map((m) => ({ ...m, ...partesMercado(m) }))
    .find((m) => /^ahledger:/.test(m.clave) && m.region === p.region && m.modo === p.modo && m.faccion === p.faccion)?.clave ?? null;
}

/** Dibuja la pestaña elegida con los últimos datos recibidos (sin volver a pedirlos). */
function pintarHistorial(cont) {
  const h = cont._historial;
  if (!h) return;
  if (!h.puntos?.some((p) => p[1] != null || p[2] != null)) {
    cont.replaceChildren(el("p", "muted small", "Sin observaciones en este periodo."));
    return;
  }
  if (vistaHistorial === "precios") { cont.replaceChildren(tablaPrecios(h, cont._cantRef)); return; }
  dibujarGrafico(cont, { puntos: h.puntos, nombres: h.nombres, cantidad: h.cantidad, med7: h.med7, med30: h.med30, pasoMs: h.paso_ms,
    unidadesRef: cont._cantRef });   // unidades de AHledger en el cuadro del gráfico (si el mercado no las publica)
  if (h.nota) cont.append(el("p", "muted small", h.nota));
}

/**
 * Tabla de precio por unidad, como la del juego pero con lo que publica la fuente: una fila por escaneo
 * (no por subasta: ninguna fuente pública da las subastas una a una), la más reciente arriba.
 */
function tablaPrecios(h, ref = null) {
  const [n1, n2] = h.nombres ?? ["Compra mínima", "Valor de mercado"];
  // Unidades: las del propio mercado si las publica; si no, las de AHledger en la misma hora (marcadas).
  const propias = (h.cantidad ?? []).some(([, q]) => q != null);
  const cant = new Map(((propias ? h.cantidad : ref?.cantidad) ?? []).map(([t, q]) => [t, q]));
  const fuenteCant = !propias && ref ? ref.proveedor : null;
  const filas = h.puntos.filter((p) => p[1] != null || p[2] != null).slice().reverse();
  const caja = el("div", "tabla-precios-wrap");
  const t = el("table", "tabla tabla-precios");
  const cap = el("caption", "sr-only", `${n1} por unidad, valor de mercado y unidades a la venta en cada escaneo, del más reciente al más antiguo`);
  const thead = el("thead"), trh = el("tr");
  for (const txt of ["Precio por unidad", n2, "Unidades"]) {
    const th = el("th", "num", txt); th.scope = "col"; trh.append(th);
  }
  const thU = trh.lastChild;
  thU.title = fuenteCant
    ? `Unidades del objeto a la venta en esa misma hora según ${fuenteCant} (todas, a cualquier precio: ninguna fuente publica cuántas hay a cada precio).`
    : "Unidades del objeto a la venta en ese escaneo (todas, a cualquier precio).";
  if (fuenteCant) thU.append(el("span", "th-fuente", fuenteCant));
  thead.append(trh);
  const tb = el("tbody");
  const fmt = (ms) => new Date(ms).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  for (const p of filas.slice(0, 300)) {
    const tr = el("tr");
    tr.title = fmt(p[0]);   // la hora del escaneo, al pasar el ratón
    const a = el("td", "num"); a.append(p[1] == null ? sinDato() : monedaNodo(p[1]));
    const b = el("td", "num"); b.append(p[2] == null ? sinDato() : monedaNodo(p[2]));
    const q = cant.get(p[0]);
    const c = el("td", "num"); c.append(q == null ? sinDato("Sin dato de unidades en esa hora") : document.createTextNode(q.toLocaleString("es")));
    tr.append(a, b, c);
    tb.append(tr);
  }
  t.append(cap, thead, tb);
  caja.append(t);
  return caja;
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
    cont._historial = h;   // la otra pestaña se dibuja con estos mismos datos
    cont._cantRef = null;
    const comp = mercadoCantidades();
    if (comp && !(h.cantidad ?? []).some(([, q]) => q != null)) {
      try {
        // Las unidades guardadas (las mismas que la tabla del Mercado), no el historial del servicio de AHledger.
        const r2 = await fetch(`/api/historial-fuente?mercado=${encodeURIComponent(comp)}&id=${id}&rango=${rango}&guardado=1`);
        const h2 = r2.ok ? await r2.json() : null;
        if (cont.dataset.token !== token || !cont.isConnected) return;
        if (h2?.cantidad?.some(([, q]) => q != null)) cont._cantRef = { proveedor: "AHledger", cantidad: h2.cantidad };
      } catch { /* sin unidades: la tabla las muestra como «—» */ }
    }
    pintarHistorial(cont);
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
    fetch(`/api/recetas?mercado=${urlMercado()}&objeto=${id}&base=tsm`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "HTTP " + r.status); return d; })
      .then((d) => {
        const nodos = [];
        // Relaciones con profesiones (de las recetas y de la clasificación oficial, no de los nombres).
        const rl = d.relaciones;
        if (rl) {
          const prof = (x) => `${nombreProf(x.profesion)} (${x.recetas} ${x.recetas === 1 ? "receta" : "recetas"}` +
            (x.nivel_min != null ? `, nivel ${x.nivel_min}+` : "") + ")";
          const resumen = kv([
            ["Familia", rl.es_material && rl.familia ? NOMBRE_FAMILIA[rl.familia] : null],
            ["Receta de", rl.receta_de ? nombreProf(rl.receta_de) : null],
            ["Lo usan", rl.consumen.length ? rl.consumen.map(prof).join(" · ") : null],
            ["Lo fabrican", rl.producen.length ? rl.producen.map(prof).join(" · ") : null],
          ]);
          if (resumen.children.length) nodos.push(resumen);
        }
        for (const r of d.fabricacion) {
          nodos.push(el("h4", "", `Se fabrica: ${r.nombre} · ${nombreProf(r.profesion)}${r.nivel != null ? " " + r.nivel : ""}`));
          const ul = el("ul", "det-lista");
          for (const x of r.reactivos) {
            const li = el("li");
            const b = el("button", "enlace" + (x.calidad ? ` q-${x.calidad}` : ""), `${x.cantidad} × ${nom(x.id, x.nombre)}`);
            b.type = "button"; b.addEventListener("click", () => { location.hash = `#/objeto/${x.id}`; });
            li.append(b, " ", x.precio == null ? el("span", "muted", "sin precio") : monedaNodo(x.coste));
            if (x.origen) {
              const o = el("span", "muted small", ` · ${ORIGEN_MATERIAL[x.origen]}${x.origen === "npc" && x.npc_tuyo ? " (introducido por ti)" : ""}`);
              o.title = [["Subasta", x.subasta], ["Fabricar", x.fabricar], ["NPC", x.npc]]
                .map(([k, v]) => `${k}: ${v == null ? "—" : formatearMoneda(v) + " c/u"}`).join(" · ");
              li.append(o);
            }
            ul.append(li);
          }
          nodos.push(ul);
          const vr = r.resultado ?? {};
          nodos.push(kv([
            ["Coste de materiales", r.completa ? monedaNodo(r.coste) : `incompleto (falta ${r.faltan.join(", ")})`],
            ["Valor neto fabricado", r.neto == null ? "sin precio del resultado" : monedaNodo(r.neto)],
            ["Valor usado", vr.fuente_valor == null ? null
              : (vr.fuente_valor === "compra_minima" ? "compra mínima" : "valor de mercado (sin ofertas)") +
                (vr.tope_aplicado ? ` · con tope del ${d.tope_valor_pct} % del valor de mercado` : "")],
            ["Margen", r.margen == null ? null : monedaNodo(r.margen), r.margen == null ? "" : r.margen >= 0 ? "sube" : "baja"],
          ]));
        }
        if (d.usos.length) {
          nodos.push(el("h4", "", `Se usa en ${d.usos.length} ${d.usos.length === 1 ? "receta" : "recetas"}`));
          const ul = el("ul", "det-lista");
          for (const u of d.usos.slice(0, 15)) {
            const li = el("li");
            const b = el("button", "enlace", nom(u.resultado_id, u.resultado_nombre));
            b.type = "button"; b.addEventListener("click", () => { location.hash = `#/objeto/${u.resultado_id}`; });
            li.append(b, el("span", "muted", ` · ${nombreProf(u.profesion)}${u.nivel != null ? " " + u.nivel : ""} · ×${u.cantidad}`));
            ul.append(li);
          }
          if (d.usos.length > 15) ul.append(el("li", "muted", `y ${d.usos.length - 15} más`));
          nodos.push(ul);
        }
        if (!nodos.length) nodos.push(el("p", "muted small", "Ninguna receta conocida lo fabrica ni lo usa."));
        else if (d.fabricacion.length) {
          nodos.push(el("p", "muted small",
            "Estimación al estilo TSM: cada material cuenta al más barato entre comprarlo en subasta (compra mínima o, " +
            "sin ofertas, valor de mercado), fabricarlo o comprarlo al NPC si has introducido ese precio. " +
            "Pasa el cursor por el origen para ver las tres alternativas."));
        }
        cuerpo.replaceChildren(...nodos);
      })
      .catch((e) => cuerpo.replaceChildren(el("p", "bad small", "No se pudieron cargar las recetas: " + e.message)));
  });
  return sec;
}

/**
 * Referencia regional (X3): datos de TODA la región según TSM. Van aparte porque no son de este reino
 * ni de esta facción, y no entran en las recomendaciones.
 */
function seccionRegion(f) {
  const est = f.region_estado;
  if (!est) return null;   // mercado de demostración o sin archivo regional importado
  const r = f.region;
  const sec = seccion(`Región ${est.region} (no es PvP Horda)`, false);
  if (!r) {
    sec.append(el("p", "muted small", "El archivo regional de TSM no trae este objeto."));
  } else {
    sec.append(kv([
      ["Venta media", r.venta_media == null ? "sin dato en la fuente" : monedaNodo(r.venta_media)],
      ["Tasa de venta", textoTasa(r.tasa_venta) ?? "sin dato"],
      ["Ventas por día", textoVentasDia(r.ventas_dia) ?? "sin dato"],
      ["Valor de mercado regional", r.valor_mercado == null ? null : monedaNodo(r.valor_mercado)],
      ["Histórico regional", r.historico == null ? null : monedaNodo(r.historico)],
    ]));
  }
  sec.append(el("p", "muted small",
    `Datos de todos los reinos de la región ${est.region} juntos, del archivo de TSM del ${fecha(est.actualizado)}. ` +
    "Sirven de referencia; no cambian las recomendaciones, que solo usan los precios de PvP Horda."));
  return sec;
}

const ORIGEN_MATERIAL = { subasta: "subasta", fabricar: "fabricado", npc: "NPC" };

function seccionPropiedades(f) {
  const sec = seccion("Propiedades");
  sec.append(kv([
    ["Compra al NPC", f.compra_npc == null ? null
      : el("span", "", formatearMoneda(f.compra_npc) + (f.compra_npc_origen === "usuario" ? " (introducido por ti)" : ""))],
    ["Clase", [f.clase ? nombreCat(f.clase) : null, nombreSub(f.subclase)].filter(Boolean).join(" › ") || "desconocida"],
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
/** Columna de la base de datos → campo de la ficha (cada métrica por separado, nunca sustituida por otra). */
const CAMPO_METRICA = { min_buyout: "precio", market_value: "valor_mercado", recent: "reciente", historical: "historico",
  median: "mediana", quantity: "cantidad", sales_per_day: "ventas_dia" };

/** A la vista: compra mínima, valor de mercado y cantidad. Las demás métricas, en «Más precios». */
const METRICAS_PRINCIPALES = new Set(["min_buyout", "market_value", "median", "quantity"]);

function bloquePrecios(f) {
  const completo = bloquePreciosCompleto(f);
  const principales = [...completo.children].filter((c) => c.dataset.principal === "1");
  const resto = [...completo.children].filter((c) => c.dataset.principal !== "1");
  const arriba = el("div", "det-precios");
  arriba.append(...principales);
  if (!resto.length) return arriba;
  const mas = el("details", "mas-precios");
  mas.append(el("summary", "", `Más precios (${resto.length})`));
  const g = el("div", "det-precios");
  g.append(...resto);
  mas.append(g);
  const caja = el("div");
  caja.append(arriba, mas);
  return caja;
}

function bloquePreciosCompleto(f) {
  const p = f.mercado, x = f.extremos_30d;
  const grid = el("div", "det-precios");
  const marcar = (nodo) => { nodo.dataset.principal = "1"; return nodo; };
  const prov = (f.proveedor ?? "").toUpperCase();
  const origen = p ? `${prov} · escaneo del ${fecha(p.observado ?? p.hora)}` +
    (p.importado ? ` · importado el ${fecha(p.importado)}` : "") : "";
  if (f.estado === "sin_datos" || !p) {
    grid.append(marcar(cifra("Compra mínima", el("span", "estado-txt sin_datos", ESTADO.sin_datos),
      "Nunca se ha visto en este mercado", "principal")));
  } else if (f.estado === "sin_ofertas") {
    const u = f.ultima_compra_minima;
    grid.append(marcar(cifra("Compra mínima", el("span", "estado-txt sin_ofertas", ESTADO.sin_ofertas),
      `Ningún anuncio en el último escaneo (${fecha(f.escaneo)})` +
        (u ? `. Última compra mínima vista: ${formatearMoneda(u.valor)} (${fecha(u.hora)})` : ""), "principal")));
  }
  // Cada métrica que publica la fuente, con su nombre y su significado (de la tabla «metricas»).
  for (const m of f.metricas ?? []) {
    const v = p?.[CAMPO_METRICA[m.columna]];
    if (m.columna === "min_buyout" && f.estado !== "con_ofertas") continue;   // ya está arriba
    if (v == null && m.columna !== "min_buyout") continue;
    const valor = m.columna === "quantity" ? v.toLocaleString("es")
      : m.columna === "sales_per_day" ? v.toLocaleString("es", { maximumFractionDigits: v >= 10 ? 0 : 1 })
      : monedaNodo(v);
    const c = cifra(m.nombre, valor, `${m.significado} (${m.clave_fuente} · ${origen})`,
      m.columna === "min_buyout" ? "principal" : m.columna === "market_value" || m.columna === "median" ? "precio-grande" : "");
    grid.append(METRICAS_PRINCIPALES.has(m.columna) ? marcar(c) : c);
  }
  // Cantidad de AHledger cuando la fuente del mercado no la publica (TSM): a la vista, con su origen.
  const cr = f.cantidad_ref;
  if (cr) {
    grid.append(marcar(cifra(`Disponible (${cr.proveedor})`, cr.cantidad.toLocaleString("es"),
      `Unidades a la venta según ${cr.proveedor}, escaneo del ${fecha(cr.escaneo)} (${hace(cr.escaneo)}). Los precios de arriba son de TSM.`)));
  }
  if (x) {
    grid.append(cifra("Mínimo 30 d", monedaNodo(x.minimo),
      `Compra mínima más baja guardada en 30 días: ${fecha(x.minimo_hora)} (${x.observaciones} escaneos)`));
  }
  if (f.venta_npc != null) {
    grid.append(cifra("Venta al NPC", monedaNodo(f.venta_npc), "Lo que paga un vendedor del juego (dato del catálogo, no de subasta)"));
  }
  return grid;
}

// ---------- X1 · «Qué hacer con este objeto» (lógica de Auctioning adaptada) ----------
let perfilSubasta = { ...PERFIL_POR_DEFECTO };
let fichaActual = null;   // última ficha pintada en el detalle
let reglasTasas = [];

async function cargarPerfilSubasta() {
  try {
    const [p, t] = await Promise.all([
      fetch("/api/perfil-subasta", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/tasas", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (p) perfilSubasta = { ...PERFIL_POR_DEFECTO, ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, k === "tipo_casa" ? v : Number(v)])) };
    if (t) reglasTasas = t;
  } catch { /* se queda con los valores por defecto */ }
  pintarFormBanda();
}

function reglaPerfil(perfil = perfilSubasta) {
  const r = reglasTasas.find((x) => x.tipo_casa === perfil.tipo_casa && Number(x.duracion_horas) === Number(perfil.duracion));
  return r ? { ...r, comision_pct: Number(r.comision_pct), deposito_pct: Number(r.deposito_pct), deposito_minimo: Number(r.deposito_minimo) } : null;
}

/** Banda que se está editando: la general o la de una lista (si no tiene propia, parte de la general). */
function perfilEnFormulario() {
  const l = misListas.find((x) => String(x.id) === $("b-ambito").value);
  return l?.perfil ? normalizarPerfil(l.perfil) : perfilSubasta;
}

function pintarFormBanda() {
  const perfil = perfilEnFormulario();
  for (const k of ["min_pct", "normal_pct", "max_pct", "npc_min_mult", "npc_max_mult", "puja_pct", "tipo_casa", "duracion"]) {
    $(`b-${k}`).value = String(perfil[k]);
  }
  $("b-undercut").value = formatearMoneda(perfil.undercut);
  const l = misListas.find((x) => String(x.id) === $("b-ambito").value);
  $("b-usar-general").hidden = !l?.perfil;
}
$("b-ambito").addEventListener("change", () => { $("banda-msg").hidden = true; pintarFormBanda(); });

/** Tras cambiar una banda, solo se recalcula «Qué hacer» con la ficha que ya está en pantalla. */
function recalcularQueHacer() {
  const viejo = $("det-cuerpo").querySelector(".que-hacer");
  if (viejo && fichaActual?.id === objetoActual) {
    const nuevo = bloqueQueHacer(fichaActual);
    if (nuevo) viejo.replaceWith(nuevo); else viejo.remove();
  }
}

/** Guarda la banda de una lista (null = usar la general) y actualiza las listas y la ficha abierta. */
async function guardarPerfilLista(id, perfil) {
  const d = await postJson("/api/listas", { accion: "perfil", id: Number(id), perfil });
  ponerListas(d.listas, d.favoritos);
  if (fichaActual) {
    for (const l of fichaActual.listas ?? []) if (String(l.id) === String(id)) l.perfil = misListas.find((x) => x.id === l.id)?.perfil ?? null;
  }
  pintarFormBanda();
  recalcularQueHacer();
}

$("form-banda").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const msg = $("banda-msg");
  msg.hidden = false;
  try {
    const ajustes = {};
    for (const k of ["min_pct", "normal_pct", "max_pct", "npc_min_mult", "npc_max_mult", "puja_pct", "duracion"]) ajustes[k] = Number($(`b-${k}`).value);
    ajustes.tipo_casa = $("b-tipo_casa").value;
    ajustes.undercut = parsearMoneda($("b-undercut").value) ?? 0;
    const lista = $("b-ambito").value;
    if (lista) {
      await guardarPerfilLista(lista, ajustes);
      msg.className = "small ok";
      msg.textContent = `Banda de la lista «${misListas.find((x) => String(x.id) === lista)?.nombre}» guardada.`;
      return;
    }
    const r = await fetch("/api/perfil-subasta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ajustes }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
    perfilSubasta = normalizarPerfil(d);
    pintarFormBanda();
    msg.className = "small ok"; msg.textContent = "Banda guardada.";
    recalcularQueHacer();
  } catch (e) {
    msg.className = "small bad"; msg.textContent = e.message;
  }
});
$("b-usar-general").addEventListener("click", async () => {
  const msg = $("banda-msg");
  msg.hidden = false;
  try {
    await guardarPerfilLista($("b-ambito").value, null);
    msg.className = "small ok"; msg.textContent = "La lista usa ahora la banda general.";
  } catch (e) {
    msg.className = "small bad"; msg.textContent = e.message;
  }
});

function bloqueQueHacer(f) {
  const p = f.mercado;
  const { perfil: perfilSubasta, lista: listaBanda } = perfilDeLista(f.listas, perfilGeneral());
  const reglaPerfil = () => reglaDe(perfilSubasta);
  const s = sugerencia({
    compraMinima: f.estado === "con_ofertas" ? p?.precio : null,
    mercado: p?.valor_mercado ?? null,
    ventaNpc: f.venta_npc ?? null,
  }, perfilSubasta, reglaPerfil());
  if (s.accion === "sin_datos") return null;
  const caja = el("section", "que-hacer");
  caja.setAttribute("aria-label", "Qué hacer con este objeto");
  // Sin evidencia suficiente (la recomendación dice «Sin datos suficientes»), no se presenta un precio
  // como si estuviera respaldado: solo el cálculo de la banda, marcado como orientativo.
  if (f.__sinEvidencia) {
    caja.classList.add("sin-evidencia");
    caja.append(el("p", "qh-accion", "Sin datos suficientes para sugerir un precio"),
      el("p", "qh-motivo", "Falta historial de este mercado. El cálculo con la banda es solo orientativo."));
  } else {
    const titulo = s.accion === "publicar" ? `Publicar a ${formatearMoneda(s.precio)}`
      : s.accion === "esperar" ? "Esperar"
      : `Vender al NPC: ${formatearMoneda(s.ventaNpc)}`;
    caja.append(el("p", `qh-accion ${s.accion}`, titulo), el("p", "qh-motivo", textoMotivo(s, formatearMoneda, perfilSubasta)));
  }
  if (f.__sinEvidencia) { /* sin explicaciones de una sugerencia que no se da */ }
  else if (s.accion === "npc" && s.accionSubasta === "publicar") {
    caja.append(el("p", "qh-motivo", `En subasta a ${formatearMoneda(s.precio)} recibirías ${formatearMoneda(s.neto)} tras la comisión: no supera al NPC.`));
  } else if (s.accion === "npc" && s.accionSubasta === "esperar") {
    caja.append(el("p", "qh-motivo", `Tu mínimo (${formatearMoneda(s.banda.min)}) no supera lo que paga el NPC: vender al NPC ya no es peor.`));
  }
  const regla = reglaPerfil();
  const casa = `${perfilSubasta.tipo_casa === "faccion" ? "casa de facción" : "casa neutral"}, ${perfilSubasta.duracion} h`;
  // Lo esencial a la vista; las cifras y las advertencias, en «Ver motivo».
  const detalle = el("details", "motivo");
  detalle.append(el("summary", "", f.__sinEvidencia ? "Ver cálculo orientativo" : "Ver cálculo"));
  caja.append(detalle);
  const conPrecio = !f.__sinEvidencia;   // puja, neto y depósito dependen del precio sugerido
  detalle.append(kv([
    ["Banda", s.banda ? `${formatearMoneda(s.banda.min)} · ${formatearMoneda(s.banda.normal)} · ${formatearMoneda(s.banda.max)}` : null],
    ["Puja", conPrecio && s.puja != null && s.precio != null ? formatearMoneda(s.puja) : null],
    ["Neto tras comisión", conPrecio && s.neto != null ? `${formatearMoneda(s.neto)} (comisión ${formatearMoneda(s.comision)}, ${casa})` : null],
    ["Depósito", conPrecio && s.deposito != null ? `${formatearMoneda(s.deposito)}: se devuelve si se vende, se pierde si caduca` : null],
    ["El NPC paga", s.ventaNpc != null ? formatearMoneda(s.ventaNpc) : null],
  ]));
  const nota = el("p", "muted small",
    "Sugerencia propia con la lógica de publicación de TSM (mínimo, normal y máximo; 1 rebaja por debajo de la compra mínima). " +
    "No se puede saber si la subasta más barata es tuya: si lo es, no hace falta bajar el precio." +
    (regla && !regla.verificado ? " La comisión y el depósito están sin verificar." : ""));
  detalle.append(nota);
  if (listaBanda) caja.insertBefore(el("p", "muted small", `Banda de tu lista «${listaBanda}»`), detalle);
  return caja;
}
const perfilGeneral = () => perfilSubasta;
const reglaDe = (perfil) => reglaPerfil(perfil);

// ---------- X6 · listas propias y alertas ----------
let misListas = [];

async function postJson(url, cuerpo) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
  return d;
}

/** Guarda las listas y rehace los dos desplegables (filtro y banda) sin perder lo elegido. */
function ponerListas(listas, favs) {
  misListas = listas ?? [];
  if (Array.isArray(favs)) {
    favoritos = new Set(favs);
    // Las estrellas de la tabla se actualizan sin volver a pedir la página.
    for (const b of $("tbody").querySelectorAll("[data-fav]")) {
      const id = Number(b.dataset.fav), es = favoritos.has(id);
      const nombre = nom(id, pagina?.filas.find((x) => x.id === id)?.nombre ?? `#${id}`);
      b.setAttribute("aria-pressed", String(es));
      b.setAttribute("aria-label", `${es ? "Quitar de" : "Añadir a"} favoritos: ${nombre}`);
      b.title = es ? "Quitar de favoritos" : "Añadir a favoritos";
    }
  }
  for (const [id, primera] of [["f-lista", "Todos los objetos"], ["b-ambito", "General (todos los objetos)"]]) {
    const s = $(id), antes = s.value;
    const op0 = el("option", "", primera); op0.value = "";
    s.replaceChildren(op0, ...misListas.map((l) => {
      const o = el("option", "", id === "f-lista" ? `${l.nombre} (${l.n})` : `Lista «${l.nombre}»${l.perfil ? "" : " (usa la general)"}`);
      o.value = String(l.id);
      return o;
    }));
    const quiere = id === "f-lista" && listaPendiente ? listaPendiente : antes;
    s.value = misListas.some((l) => String(l.id) === quiere) ? quiere : "";
    if (id === "f-lista" && antes && !s.value) repintar();   // la lista filtrada ya no existe
  }
  listaPendiente = "";
  $("btn-favoritos").setAttribute("aria-pressed", String(!!listaFavoritos() && $("f-lista").value === String(listaFavoritos()?.id)));
}
async function cargarNombresEs() {
  try {
    const r = await fetch(`/api/nombres-es?mercado=${urlMercado()}`, { cache: "no-store" });
    if (r.ok) nombresEs = new Map(Object.entries(await r.json()).map(([k, v]) => [Number(k), v]));
  } catch { /* sin nombres en español se muestran los de la fuente */ }
}

async function cargarListas() {
  try {
    const r = await fetch("/api/listas", { cache: "no-store" });
    if (r.ok) { const d = await r.json(); ponerListas(d.listas, d.favoritos); pintarFormBanda(); }
  } catch { /* las listas no bloquean la página */ }
}

/** Aviso al abrir la página: alertas que se han cumplido desde la última vez. */
function pintarAvisos(d) {
  const caja = $("avisos-alertas");
  const nuevos = (d?.avisos ?? []).filter((a) => !a.visto);
  caja.hidden = !nuevos.length;
  if (!nuevos.length) { caja.replaceChildren(); return; }
  const ul = el("ul");
  for (const a of nuevos.slice(0, 10)) {
    const li = el("li");
    const b = el("button", "enlace", nom(a.objeto, a.nombre));
    b.type = "button"; b.addEventListener("click", () => { location.hash = `#/objeto/${a.objeto}`; });
    li.append(b, ` ${textoAlerta(a, formatearMoneda)}: `, monedaNodo(a.precio), el("span", "muted", ` · escaneo del ${fecha(a.escaneo)}`));
    ul.append(li);
  }
  const visto = el("button", "btn btn-piedra btn-small", "Marcar como vistos");
  visto.type = "button";
  visto.addEventListener("click", async () => {
    try { pintarAvisos(await postJson(`/api/alertas?mercado=${urlMercado()}`, { accion: "visto", ids: "todos" })); }
    catch (e) { avisar("No se pudieron marcar: " + e.message, "bad"); }
  });
  const titulo = el("strong", "", nuevos.length === 1 ? "Se ha cumplido 1 alerta" : `Se han cumplido ${nuevos.length} alertas`);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ic-aviso"); svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#i-campana");
  svg.append(use);
  titulo.prepend(svg);
  caja.replaceChildren(titulo,
    ul, nuevos.length > 10 ? el("p", "muted small", `y ${nuevos.length - 10} más`) : "", visto);
}
async function cargarAvisos() {
  try {
    const r = await fetch(`/api/alertas?mercado=${urlMercado()}`, { cache: "no-store" });
    if (r.ok) pintarAvisos(await r.json());
  } catch { /* el aviso no bloquea la página */ }
}

/** Detalle: a qué listas pertenece el objeto y sus alertas. */
function seccionListasAlertas(f) {
  const sec = seccion("Listas y alertas");
  const id = f.id;
  const cuerpo = el("div");
  sec.append(cuerpo);
  const msg = el("p", "small", ""); msg.hidden = true;
  const error = (e) => { msg.hidden = false; msg.className = "small bad"; msg.textContent = e.message; };

  const pintar = (alertasObj) => {
    const nodos = [];
    // Listas: una casilla por lista.
    nodos.push(el("h4", "", "Listas"));
    const chips = el("div", "listas-chips");
    for (const l of misListas) {
      const lab = el("label", "check");
      const cb = el("input"); cb.type = "checkbox";
      cb.checked = (f.listas ?? []).some((x) => x.id === l.id);
      cb.addEventListener("change", async () => {
        try {
          const d = await postJson("/api/listas", { accion: "poner", id: l.id, objeto: id, dentro: cb.checked });
          ponerListas(d.listas, d.favoritos);
          f.listas = d.listas.filter((x) => x.contiene).map((x) => ({ id: x.id, nombre: x.nombre, perfil: x.perfil }));
          recalcularQueHacer();
        } catch (e) { cb.checked = !cb.checked; error(e); }
      });
      lab.append(cb, ` ${l.nombre}${l.perfil ? " · banda propia" : ""}`);
      chips.append(lab);
    }
    const nueva = el("form", "form-alerta");
    const nom = el("input"); nom.placeholder = "Nueva lista"; nom.maxLength = 40; nom.setAttribute("aria-label", "Nombre de la lista nueva");
    const bn = el("button", "btn btn-piedra btn-small", "Crear y añadir"); bn.type = "submit";
    nueva.append(nom, bn);
    nueva.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      try {
        const d = await postJson("/api/listas", { accion: "crear", nombre: nom.value, objeto: id });
        ponerListas(d.listas, d.favoritos);
        f.listas = d.listas.filter((x) => x.contiene).map((x) => ({ id: x.id, nombre: x.nombre, perfil: x.perfil }));
        pintar(alertasObj);
      } catch (e) { error(e); }
    });
    nodos.push(chips, nueva);

    // Alertas de este objeto en este mercado.
    nodos.push(el("h4", "", "Alertas (compra mínima)"));
    const ul = el("ul", "det-lista");
    for (const a of alertasObj?.alertas ?? []) {
      const li = el("li");
      li.append(`Avísame si ${textoAlerta(a, formatearMoneda)}`,
        el("span", "muted", a.cumplida ? " · se cumple ahora" : " · no se cumple ahora"));
      const borrar = el("button", "enlace", "quitar"); borrar.type = "button";
      borrar.addEventListener("click", async () => {
        try { await postJson(`/api/alertas?mercado=${urlMercado()}`, { accion: "borrar", id: a.id }); cargar(); }
        catch (e) { error(e); }
      });
      li.append(" ", borrar);
      ul.append(li);
    }
    if (!ul.children.length) ul.append(el("li", "muted", "Ninguna alerta para este objeto."));
    const fa = el("form", "form-alerta");
    const cond = el("select"); cond.setAttribute("aria-label", "Condición");
    for (const [v, t] of [["menor", "baja a"], ["mayor", "sube a"]]) { const o = el("option", "", t); o.value = v; cond.append(o); }
    const umb = el("input"); umb.placeholder = "1o 50p"; umb.setAttribute("aria-label", "Precio");
    const ba = el("button", "btn btn-piedra btn-small", "Crear alerta"); ba.type = "submit";
    fa.append("Avísame si", cond, umb, ba);
    fa.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      try {
        const umbral = parsearMoneda(umb.value);
        if (!umbral) throw new Error("Escribe un precio, p. ej. 1o 50p o 150 (cobre).");
        const d = await postJson(`/api/alertas?mercado=${urlMercado()}`, { accion: "crear", objeto: id, condicion: cond.value, umbral });
        pintar(d);
        msg.hidden = false; msg.className = "small ok";
        msg.textContent = d.cumple_ahora
          ? "Alerta creada. Ya se cumple con el último escaneo: avisará cuando vuelva a cumplirse tras dejar de hacerlo."
          : "Alerta creada. Se comprueba con cada escaneo nuevo y avisa en esta página al abrirla.";
      } catch (e) { error(e); }
    });
    nodos.push(ul, fa, msg, el("p", "muted small", "Se revisan con cada escaneo y se avisan al abrir la página."));
    cuerpo.replaceChildren(...nodos);
  };
  const cargar = () => fetch(`/api/alertas?mercado=${urlMercado()}&objeto=${id}`, { cache: "no-store" })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "HTTP " + r.status); return d; })
    .then(pintar)
    .catch((e) => cuerpo.replaceChildren(el("p", "bad small", "No se pudieron cargar las alertas: " + e.message)));
  cuerpo.append(el("p", "muted small", "Cargando…"));
  let pedido = false;
  sec.addEventListener("toggle", () => { if (sec.open && !pedido) { pedido = true; cargar(); } });
  return sec;
}

async function bloqueRecomendacion(id) {
  try {
    const r = await fetch(`/api/explicacion?mercado=${urlMercado()}&id=${id}`, { cache: "no-store" });
    if (!r.ok) return null;
    const d = await r.json();
    const l = d.lectura;
    const rec = el("div", "det-rec");
    rec.dataset.evidencia = l.evidencia === false ? "no" : "si";
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

let objetoN = 0;   // cada apertura tiene su número: una respuesta de una apertura anterior se descarta
/**
 * Abre (o refresca) el detalle de un objeto.
 * silencioso: refresco por datos nuevos; no muestra esqueleto, no mueve el foco y conserva los
 * apartados desplegados y la posición de desplazamiento del panel.
 */
async function abrirObjeto(id, { silencioso = false } = {}) {
  if (!ultimo) return;
  const n = ++objetoN;
  objetoActual = id;
  const cuerpo = $("det-cuerpo");
  const abiertos = silencioso ? new Set([...cuerpo.querySelectorAll("details[open] > summary")].map((s) => s.textContent)) : null;
  const scroll = $("panel-ficha").scrollTop;
  if (!silencioso) {
    const filaPagina = pagina?.filas.find((x) => x.id === id);
    $("det-titulo").textContent = nom(id, filaPagina?.nombre ?? `#${id}`);
    $("det-titulo").className = filaPagina?.calidad ? `q-${filaPagina.calidad}` : "";
    cuerpo.replaceChildren(el("div", "esq-grafico"));
    abrirPanel();
    $("det-titulo").focus({ preventScroll: true });
  }
  try {
    const r = await fetch(`/api/objeto?mercado=${urlMercado()}&id=${id}`, { cache: "no-store" });
    const f = await r.json();
    if (!r.ok) throw new Error(f.error || "HTTP " + r.status);
    if (n !== objetoN) return;
    const rec = f.estado === "sin_datos" ? null : await bloqueRecomendacion(id);
    if (n !== objetoN) return;
    $("det-titulo").textContent = nom(f.id, f.nombre);
    $("det-titulo").className = f.calidad ? `q-${f.calidad}` : "";
    $("det-titulo").title = nom(f.id, f.nombre) !== f.nombre ? `En inglés: ${f.nombre}` : "";
    // Sin recomendación respaldada (o sin poder pedirla), «Qué hacer» no da un precio como si lo estuviera.
    f.__sinEvidencia = !rec || rec.dataset.evidencia === "no";
    // Un solo aviso de «sin datos suficientes» (el de «Qué hacer»); la etiqueta repetida se quita y queda «Ver motivo».
    if (f.__sinEvidencia) rec?.querySelector(".etiqueta.sin-evidencia")?.remove();
    fichaActual = f;
    // Primero lo esencial: objeto, precio y disponibilidad, gráfico y una recomendación breve.
    // Detalle sencillo: objeto, precios, historial (gráfico o tabla) y, solo si hay datos que la respalden,
    // la sugerencia de publicación. Sin secciones plegables debajo.
    cuerpo.replaceChildren(...[cabeceraObjeto(f), bloquePrecios(f),
      f.estado === "sin_datos" ? null : seccionGrafico(id),
      f.__sinEvidencia ? null : bloqueQueHacer(f)].filter(Boolean));
    if (abiertos) {
      for (const d of cuerpo.querySelectorAll("details")) {
        if (abiertos.has(d.querySelector(":scope > summary")?.textContent)) d.open = true;
      }
      $("panel-ficha").scrollTop = scroll;
    }
  } catch (e) {
    if (n !== objetoN) return;
    if (silencioso) return;   // un refresco fallido no borra lo que ya se ve
    cuerpo.replaceChildren(el("p", "bad", "No se pudo cargar el objeto: " + e.message));
  }
}

// ---------- rutas: #/ (mercado) y #/objeto/ID ----------
function aplicarRuta() {
  if (!ultimo) return;
  const r = leerRuta(location.hash);
  if ($("vista-login").hidden) mostrar("mercado");
  if (r.vista === "fabricacion") { vistaFab.mostrar(); return; }
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

const vistaFab = crearVistaFabricacion({
  $, el, monedaNodo, iconoNodo, nom, nombreProf, fecha, hace, local, avisar, formatear: formatearMoneda,
  abrirObjeto: (id) => abrirObjeto(id),
  mercado: () => ultimo?.mercado?.clave ?? null,
});
window.matchMedia("(max-width: 1339px)").addEventListener("change", () => {
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
    const visible = nom(s.id, s.nombre);
    txt.append(el("span", s.calidad ? `q-${s.calidad}` : "", visible),
      el("span", "sug-sub", [NOMBRE_CALIDAD[s.calidad], nombreSub(s.subclase) || nombreCat(s.clase), s.en_mercado ? null : "sin precio aquí"]
        .filter(Boolean).join(" · ")));
    li.append(iconoNodo(s.icono, visible, s.calidad), txt);
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
  $("buscador").value = nom(s.id, s.nombre);     // el texto solo cambia al confirmar
  $("btn-borrar-busqueda").hidden = false;
  ac = { ...ac, abierto: false, activo: -1 };
  pintarSugerencias();
  guardarReciente({ id: s.id, nombre: s.nombre, icono: s.icono, calidad: s.calidad });
  location.hash = `#/objeto/${s.id}`;
  if (leerRuta(location.hash).id === objetoActual) abrirObjeto(s.id);
}

/** Enter sin sugerencia elegida: filtra la tabla por ese texto. */
function buscarEnMercado() {
  filtro.texto = $("buscador").value.trim();
  ac = { ...ac, abierto: false, activo: -1 };
  pintarSugerencias();
  ocultarRecientes();
  if (filtro.texto) guardarReciente({ texto: filtro.texto });
  repintar();
}

// ---------- búsquedas recientes (solo en este navegador) ----------
const leerRecientes = () => { const l = local.leer("mw_recientes", []); return Array.isArray(l) ? l : []; };
function guardarReciente(item) { local.escribir("mw_recientes", agregarReciente(leerRecientes(), item)); }
function ocultarRecientes() { $("recientes").hidden = true; }
function mostrarRecientes() {
  const lista = leerRecientes();
  if (!lista.length || $("buscador").value.trim() || !$("sugerencias").hidden) { ocultarRecientes(); return; }
  $("lista-recientes").replaceChildren(...lista.map((x, k) => {
    const li = el("li");
    const b = el("button", "reciente");
    b.type = "button"; b.dataset.reciente = k;
    if (x.id != null) b.append(iconoNodo(x.icono, nom(x.id, x.nombre), x.calidad), el("span", x.calidad ? `q-${x.calidad}` : "", nom(x.id, x.nombre)));
    else b.append(el("span", "muted", "Buscar: "), el("span", "", x.texto));
    li.append(b);
    return li;
  }));
  $("recientes").hidden = false;
}
$("lista-recientes").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-reciente]");
  if (!b) return;
  const x = leerRecientes()[Number(b.dataset.reciente)];
  if (!x) return;
  ocultarRecientes();
  if (x.id != null) {
    $("buscador").value = nom(x.id, x.nombre); $("btn-borrar-busqueda").hidden = false;
    guardarReciente(x);
    location.hash = `#/objeto/${x.id}`;
  } else {
    $("buscador").value = x.texto; $("btn-borrar-busqueda").hidden = false;
    buscarEnMercado();
  }
});
$("btn-borrar-recientes").addEventListener("click", () => {
  local.escribir("mw_recientes", []);
  ocultarRecientes();
  $("buscador").focus();
});
$("buscador").addEventListener("focus", mostrarRecientes);
// Al salir del buscador y de sus listas, se cierran (sin atrapar el foco).
$("buscador").closest(".combo").addEventListener("focusout", (ev) => {
  if (!ev.currentTarget.contains(ev.relatedTarget)) ocultarRecientes();
});
$("btn-borrar-busqueda").addEventListener("click", () => {
  $("buscador").value = "";
  $("btn-borrar-busqueda").hidden = true;
  sugerencias = []; ac = conSugerencias(ac, 0); pintarSugerencias();
  if (filtro.texto) { filtro.texto = ""; repintar(); }
  $("buscador").focus();
});
// «/» lleva al buscador cuando no se está escribiendo en otro campo.
document.addEventListener("keydown", (ev) => {
  if (!atajoBuscar(ev, document.activeElement) || $("barra").hidden) return;
  ev.preventDefault();
  if (estrecho()) cerrarLateral();
  $("buscador").focus();
  $("buscador").select();
});

$("buscador").addEventListener("input", () => {
  ac = alEscribir(ac);
  $("btn-borrar-busqueda").hidden = !$("buscador").value;
  if ($("buscador").value) ocultarRecientes();
  if (!$("buscador").value.trim() && filtro.texto) { filtro.texto = ""; repintar(); }
  clearTimeout(temporizadorAc);
  temporizadorAc = setTimeout(pedirSugerencias, 150);
});
$("buscador").addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !$("recientes").hidden) { ocultarRecientes(); ev.preventDefault(); return; }
  if (ev.key === "ArrowDown" && !$("recientes").hidden) {
    ev.preventDefault();
    $("lista-recientes").querySelector("button")?.focus();
    return;
  }
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
// Dentro de las búsquedas recientes: flechas para moverse y Escape para volver al buscador.
$("recientes").addEventListener("keydown", (ev) => {
  const botones = [...$("lista-recientes").querySelectorAll("button")];
  const k = botones.indexOf(document.activeElement);
  if (ev.key === "Escape") { ev.preventDefault(); ocultarRecientes(); $("buscador").focus(); }
  else if (ev.key === "ArrowDown" && k >= 0) { ev.preventDefault(); botones[Math.min(k + 1, botones.length - 1)].focus(); }
  else if (ev.key === "ArrowUp" && k >= 0) { ev.preventDefault(); (k === 0 ? $("buscador") : botones[k - 1]).focus(); }
});
$("sugerencias").addEventListener("pointerdown", (ev) => {
  const li = ev.target.closest("[data-k]");
  if (!li) return;
  ev.preventDefault();
  confirmarSugerencia(Number(li.dataset.k));
});

// ---------- ayuda contextual: un «?» abre una nota breve (clic, Enter o toque); Escape o clic fuera la cierra ----------
let ayudaBoton = null;
function cerrarAyuda({ devolverFoco = false } = {}) {
  if (!ayudaBoton) return;
  ayudaBoton.setAttribute("aria-expanded", "false");
  $("ayuda-pop").hidden = true;
  if (devolverFoco) ayudaBoton.focus();
  ayudaBoton = null;
}
function abrirAyuda(boton, texto) {
  if (ayudaBoton === boton) { cerrarAyuda(); return; }
  cerrarAyuda();
  ayudaBoton = boton;
  const pop = $("ayuda-pop");
  $("ayuda-txt").textContent = texto;
  pop.setAttribute("aria-label", boton.getAttribute("aria-label") ?? "Ayuda");
  pop.hidden = false;
  boton.setAttribute("aria-expanded", "true");
  boton.setAttribute("aria-controls", "ayuda-pop");
  // Debajo del botón, sin salirse de la pantalla.
  const r = boton.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  const top = r.bottom + 8 + h > window.innerHeight ? Math.max(8, r.top - h - 8) : r.bottom + 8;
  pop.style.left = `${left}px`; pop.style.top = `${top}px`;
}
document.addEventListener("click", (ev) => {
  const b = ev.target.closest(".ayuda");
  if (b) { ev.preventDefault(); abrirAyuda(b, b.dataset.ayuda ?? ""); return; }
  if (ev.target.closest("#estado-dato")) { abrirAyuda($("estado-dato"), $("estado-dato").title); return; }
  if (!ev.target.closest("#ayuda-pop")) cerrarAyuda();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && ayudaBoton) { ev.preventDefault(); cerrarAyuda({ devolverFoco: true }); }
  if ((ev.key === "Enter" || ev.key === " ") && document.activeElement === $("estado-dato")) {
    ev.preventDefault(); abrirAyuda($("estado-dato"), $("estado-dato").title);
  }
}, true);
window.addEventListener("resize", () => cerrarAyuda());
document.addEventListener("scroll", () => cerrarAyuda(), true);

// La cabecera de la tabla se fija justo debajo de la barra superior (su alto cambia con el zoom).
function ajustarAltoBarra() {
  const h = $("barra").offsetHeight;
  if (h > 0) document.documentElement.style.setProperty("--alto-barra", `${h}px`);
}
new ResizeObserver(ajustarAltoBarra).observe($("barra"));
window.addEventListener("resize", ajustarAltoBarra);

// Tras un fallo se conservan los datos y se puede reintentar al momento.
$("btn-reintentar").addEventListener("click", async () => {
  const b = $("btn-reintentar");
  b.disabled = true;
  try {
    if (!ultimo) await refrescar();
    else { await vigilar(); await cargarPagina({ silencioso: true }); }
  } finally { b.disabled = false; }
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
    if (!r.ok || d.ok === false) avisar(d.error || d.mensaje || "No se pudo actualizar", "bad");
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
  clearTimeout(temporizadorVigilar);
  if (document.visibilityState === "visible" && ultimo?.mercado?.clave && $("vista-login").hidden) {
    try {
      const r = await fetch("/api/version?mercado=" + urlMercado(), { cache: "no-store" });
      if (r.status === 401) await cargar();
      else if (!r.ok) marcarConexion(false, "Sin conexión con la base de datos");
      else {
        const firma = JSON.stringify(await r.json());
        const volvio = sinConexion;
        marcarConexion(true);
        if ((firmaVersion !== null && firma !== firmaVersion) || volvio) {
          await cargar();
          await cargarPagina({ silencioso: true });
          if (vista === "mapa") cargarMapa();
          if (objetoActual != null) abrirObjeto(objetoActual, { silencioso: true });
          if (enFab()) vistaFab.refrescar(); else vistaFab.invalidar();
        }
        firmaVersion = firma;
      }
    } catch {
      marcarConexion(false, "Sin conexión con el servidor");
    }
  }
  pintarEstadoDato();   // «hace N min» avanza aunque no haya datos nuevos
  // Sin conexión se reintenta antes; tras «Actualizar», cada 5 s durante 3 min; si no, cada 30 s.
  temporizadorVigilar = setTimeout(vigilar, sinConexion ? 15000 : Date.now() < rapidoHasta ? 5000 : 30000);
}
let temporizadorVigilar = null;

// ---------- conexión: un único aviso al perderla y otro al recuperarla; los datos se conservan ----------
let sinConexion = false;
function marcarConexion(ok, motivo = "Sin conexión") {
  if (ok !== sinConexion) return;          // sin cambios: no se repite el aviso
  sinConexion = !ok;
  if (sinConexion) avisar(`${motivo}: se muestran los últimos datos recibidos.`, "bad");
  else avisar("Conexión recuperada.");
  pintarEstadoDato();
}
window.addEventListener("offline", () => marcarConexion(false, "Sin conexión a internet"));
window.addEventListener("online", () => { if (sinConexion) vigilar(); });

async function refrescar() {
  if (!(await cargar())) return;
  await Promise.all([cargarPerfilSubasta(), cargarListas(), cargarNombresEs()]);   // antes de pintar la tabla o un objeto
  cargarAvisos();         // alertas cumplidas desde la última vez (sin bloquear la tabla)
  aplicarRuta();          // un objeto pedido en la dirección se abre sin esperar a la tabla
  await cargarPagina();
  if (vista === "mapa") cargarMapa();
  cargarCobertura();      // contador del panel «Catálogo» (sin bloquear la tabla)
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

restaurarEstado();   // filtros, orden y búsqueda de la última visita
ponerVista(vista);   // la vista elegida (Lista o Mapa) se recuerda en este navegador
refrescar();
vigilar();
