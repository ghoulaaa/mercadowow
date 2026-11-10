// Casa de Subastas — WoW Forever. Una sola vista: Mercado (barra lateral, tabla y detalle del objeto).
// La tabla recorre TODO el catálogo y la pide por páginas al servidor (filtros, orden y paginación en SQL).
import { dibujarGrafico } from "./grafico.js";
import { formatearMoneda, parsearMoneda } from "./moneda.js";
import { ESTADO_INICIAL, alEscribir, conSugerencias, teclado } from "./autocompletar.js";
import { leerRuta } from "./ruta.js";
import { NOMBRE_PROFESION } from "./recetas.js";
import { abreviar, paramsMapaCasa, pesoBloque, pesoGrupo, squarify, textoVariacion, tonoVariacion } from "./treemap.js";
import { PERFIL_POR_DEFECTO, sugerencia, textoMotivo } from "./subasta.js";
import { NOMBRE_CALIDAD, NOMBRE_CATEGORIA, NOMBRE_REC, SIN_CATEGORIA, formatearPct } from "./tabla.js";
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
const filtro = { texto: "", categoria: "", subcategoria: "", calidad: "", profesion: "", rol: "", familia: "", pagina: 1 };
const profAbiertas = new Set();   // profesiones desplegadas en la barra lateral
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
    if (ultimo) { marcarConexion(false, r ? "Sin conexión con la base de datos" : "Sin conexión con el servidor"); return false; }
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
  e.replaceChildren(el("span", "", `${sinConexion ? "Sin conexión · " : ""}Datos: ${hace(a.hora_dato_original)}`));
  if (m.automatico && a.ultima_consulta_ok) e.append(el("span", "consulta", ` · consulta: ${hace(a.ultima_consulta_ok)}`));
  if (fallos) e.append(el("span", "", " · ⚠"));
  e.className = "estado-dato" + (viejo && !m.ficticio ? " viejo" : "") + (fallos || sinConexion ? " bad" : "");
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
  const cobertura = pagina ? ` · ${pagina.total_catalogo.toLocaleString("es")} objetos en el catálogo (no es el total del juego)` : "";
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
    profesion: filtro.profesion, rol: filtro.rol, materiales: $("f-materiales").checked, familia: filtro.familia,
    soloOfertas: $("f-ofertas").checked, oportunidad: $("f-oportunidad").value, ventasRegion: $("f-region").value, orden, dir, pagina: filtro.pagina,
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
    td.textContent = "—";
    td.title = x.estado === "con_ofertas" ? "La fuente no publica valor de mercado ni venta al NPC para este objeto" : "";
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
  p.replaceChildren(
    el("strong", "", "Comprueba el precio en el juego antes de comprar. "),
    `La compra mínima es la del último escaneo (${hace(pagina?.escaneo)}) y puede haberse vendido ya. ` +
    `El margen es una estimación por unidad: valor de mercado − ${r?.comision_pct ?? 5} % de comisión − compra mínima ` +
    "(o venta al NPC − compra mínima si el NPC paga más). No descuenta el depósito. ",
    el("span", "muted", textoReglaGanga(r, formatearMoneda)));
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
    txt.append(el("span", "objeto-nombre" + (x.calidad ? ` q-${x.calidad}` : ""), x.nombre),
      el("span", "objeto-id" + (sf ? " sin-ficha" : ""), sf ? TEXTO_SIN_FICHA
        : [x.subcategoria || nombreCat(x.categoria), x.nivel ? `nivel ${x.nivel}` : null].filter(Boolean).join(" · ")));
    if (x.ganga) txt.firstChild.append(el("span", "marca-op", "Ganga"));
    if (x.bajo_npc) txt.firstChild.append(el("span", "marca-op", "< NPC"));
    b.append(iconoNodo(x.icono, x.nombre, x.calidad), txt);
    b.title = sf ? `#${x.id} · ni AHledger ni TSM publican su nombre, calidad ni icono`
      : `#${x.id} · ${NOMBRE_CALIDAD[x.calidad] ?? "calidad desconocida"}`;
    tdObj.append(b);

    const tdCant = el("td", "num", x.cantidad == null ? "—" : x.cantidad.toLocaleString("es"));
    tr.append(tdObj, celdaPrecio(x), tdCant, celdaMargen(x), celdaVariacion(x), celdaSpark(x));
    frag.append(tr);
  }
  tbody.replaceChildren(frag);
  const total = d?.total ?? 0;
  $("sin-resultados").hidden = !d || total > 0;
  $("sin-resultados").textContent = "Ningún objeto coincide con los filtros.";
  $("contador").textContent = d ? `${total.toLocaleString("es")} objetos` : "";
  // Título: lo que se está viendo, en pocas palabras.
  const partes = [];
  if (filtro.profesion) partes.push(nombreProf(filtro.profesion) + (filtro.rol ? ` · ${NOMBRE_ROL[filtro.rol].toLowerCase()}` : ""));
  if ($("f-materiales").checked) partes.push(filtro.familia ? NOMBRE_FAMILIA[filtro.familia] : "Materiales");
  if (filtro.subcategoria) partes.push(filtro.subcategoria); else if (filtro.categoria) partes.push(nombreCat(filtro.categoria));
  if (filtro.texto) partes.push(`«${filtro.texto}»`);
  if ($("f-oportunidad").value) partes.unshift(NOMBRE_OPORTUNIDAD[$("f-oportunidad").value]);
  if ($("f-region").value) partes.push(`se vende en la región (≥ ${$("f-region").value}/día)`);
  const tit = partes.join(" · ");
  $("titulo-resultados").textContent = tit ? tit[0].toUpperCase() + tit.slice(1) : "Todos los objetos";
  // Oportunidades: cuántas hay con los demás filtros, y el aviso de que el dato puede ir con retraso.
  for (const o of $("f-oportunidad").options) {
    const n = d?.oportunidades?.[o.value];
    if (o.value) o.textContent = NOMBRE_OPORTUNIDAD[o.value] + (n == null ? "" : ` (${n.toLocaleString("es")})`);
  }
  pintarAvisoOportunidad();
  // Referencia regional: de cuándo es el archivo (o que todavía no hay ninguno).
  const reg = d?.region;
  $("f-region").disabled = !!d && !reg;
  $("nota-region").hidden = !d;
  $("nota-region").textContent = reg
    ? `Región ${reg.region}, todos los reinos · archivo de TSM del ${new Date(reg.actualizado).toLocaleDateString("es")}`
    : "Sin archivo regional importado para este mercado.";
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
  for (const th of document.querySelectorAll(".tabla-mercado th")) {
    const bo = th.querySelector("[data-orden]");
    th.setAttribute("aria-sort", bo?.dataset.orden === clave ? (dir === "asc" ? "ascending" : "descending") : "none");
  }
}

/** Cualquier cambio de filtro u orden vuelve a la página 1 (y rehace el mapa si está a la vista). */
function repintar() { filtro.pagina = 1; cargarPagina(); if (vista === "mapa") cargarMapa(); }

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
$("f-region").addEventListener("change", () => { repintar(); if (estrecho()) cerrarLateral(); });
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
  Object.assign(filtro, { texto: "", categoria: "", subcategoria: "", calidad: "", profesion: "", rol: "", familia: "", pagina: 1 });
  for (const id of ["f-nivel-min", "f-nivel-max", "f-precio-min", "f-precio-max"]) $(id).value = "";
  $("f-ofertas").checked = false;
  $("f-oportunidad").value = "";
  $("f-region").value = "";
  $("f-materiales").checked = false;
  $("f-orden").value = "nombre:asc";
  $("buscador").value = "";
  pintarCalidades();
  repintar();
});

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
    const b = el("button", "enlace", x.nombre);
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
    const ok = d.aceptadas.map((x) => `${x.nombre}: ${x.borrar ? "borrar" : formatearMoneda(x.precio)}`);
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
let vista = local.leer("mw_vista", "lista") === "mapa" ? "mapa" : "lista";
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
  if (d.subclase) pasos.push([d.subclase, d.clase, d.subclase]);
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
  for (const b of document.querySelectorAll(".btn-vista")) b.setAttribute("aria-pressed", String(b.dataset.modo === v));
  $("mapa").hidden = v !== "mapa";
  $("vista-lista").hidden = v === "mapa";
  document.querySelector(".res-cab .orden").hidden = v === "mapa";
  if (v === "mapa") { $("paginador").hidden = true; $("sin-resultados").hidden = true; cargarMapa(); }
  else pintarTabla();
}
for (const b of document.querySelectorAll(".btn-vista")) b.addEventListener("click", () => ponerVista(b.dataset.modo));
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
  const nombre = d.nivel === "clases" ? nombreCat(g.clave) : g.clave;
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
  const nombre = d.nivel === "clases" ? nombreCat(g.clave) : g.clave;
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
  $("titulo-resultados").textContent = "Mapa de la casa" + (d.clase ? ` · ${nombreCat(d.clase)}` : "") + (d.subclase ? ` · ${d.subclase}` : "");
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
  const partes = [o.nombre];
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
  if (r.w >= 30 && r.h >= 28) b.append(iconoNodo(o.icono, o.nombre, o.calidad));
  else if (o.variacion != null) b.append(el("span", "m-var", o.variacion > 0 ? "▲" : o.variacion < 0 ? "▼" : "▬"));
  if (r.w >= 64 && r.h >= 44) b.append(el("span", "m-nombre", abreviar(o.nombre, Math.floor((r.w - 8) / 6.2))));
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
  t.append(sinFicha(f.nombre)
    ? el("div", "det-sub sin-ficha", `${TEXTO_SIN_FICHA}: ni AHledger ni TSM publican su nombre, calidad ni icono.`)
    : el("div", "det-sub", [NOMBRE_CALIDAD[f.calidad] ?? f.calidad, [nombreCat(f.clase ?? SIN_CATEGORIA), f.subclase]
      .filter((x) => x && x !== nombreCat(SIN_CATEGORIA)).join(" › "), f.nivel ? `nivel ${f.nivel}` : null].filter(Boolean).join(" · ")),
    idBtn);
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
            const b = el("button", "enlace" + (x.calidad ? ` q-${x.calidad}` : ""), `${x.cantidad} × ${x.nombre}`);
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
            const b = el("button", "enlace", u.resultado_nombre);
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
/** Columna de la base de datos → campo de la ficha (cada métrica por separado, nunca sustituida por otra). */
const CAMPO_METRICA = { min_buyout: "precio", market_value: "valor_mercado", recent: "reciente", historical: "historico",
  median: "mediana", quantity: "cantidad", sales_per_day: "ventas_dia" };

function bloquePrecios(f) {
  const p = f.mercado, x = f.extremos_30d;
  const grid = el("div", "det-precios");
  const prov = (f.proveedor ?? "").toUpperCase();
  const origen = p ? `${prov} · escaneo del ${fecha(p.observado ?? p.hora)}` +
    (p.importado ? ` · importado el ${fecha(p.importado)}` : "") : "";
  if (f.estado === "sin_datos" || !p) {
    grid.append(cifra("Compra mínima", el("span", "estado-txt sin_datos", ESTADO.sin_datos),
      "Nunca se ha visto en este mercado", "principal"));
  } else if (f.estado === "sin_ofertas") {
    const u = f.ultima_compra_minima;
    grid.append(cifra("Compra mínima", el("span", "estado-txt sin_ofertas", ESTADO.sin_ofertas),
      `Ningún anuncio en el último escaneo (${fecha(f.escaneo)})` +
        (u ? `. Última compra mínima vista: ${formatearMoneda(u.valor)} (${fecha(u.hora)})` : ""), "principal"));
  }
  // Cada métrica que publica la fuente, con su nombre y su significado (de la tabla «metricas»).
  for (const m of f.metricas ?? []) {
    const v = p?.[CAMPO_METRICA[m.columna]];
    if (m.columna === "min_buyout" && f.estado !== "con_ofertas") continue;   // ya está arriba
    if (v == null && m.columna !== "min_buyout") continue;
    const valor = m.columna === "quantity" ? v.toLocaleString("es")
      : m.columna === "sales_per_day" ? v.toLocaleString("es", { maximumFractionDigits: v >= 10 ? 0 : 1 })
      : monedaNodo(v);
    grid.append(cifra(m.nombre, valor, `${m.significado} (${m.clave_fuente} · ${origen})`,
      m.columna === "min_buyout" ? "principal" : ""));
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

function reglaPerfil() {
  const r = reglasTasas.find((x) => x.tipo_casa === perfilSubasta.tipo_casa && Number(x.duracion_horas) === Number(perfilSubasta.duracion));
  return r ? { ...r, comision_pct: Number(r.comision_pct), deposito_pct: Number(r.deposito_pct), deposito_minimo: Number(r.deposito_minimo) } : null;
}

function pintarFormBanda() {
  for (const k of ["min_pct", "normal_pct", "max_pct", "npc_min_mult", "npc_max_mult", "puja_pct", "tipo_casa", "duracion"]) {
    $(`b-${k}`).value = String(perfilSubasta[k]);
  }
  $("b-undercut").value = formatearMoneda(perfilSubasta.undercut);
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
    const r = await fetch("/api/perfil-subasta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ajustes }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
    perfilSubasta = { ...PERFIL_POR_DEFECTO, ...Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k === "tipo_casa" ? v : Number(v)])) };
    pintarFormBanda();
    msg.className = "small ok"; msg.textContent = "Banda guardada.";
    // Solo se recalcula el bloque «Qué hacer» con la ficha que ya está en pantalla (sin pedir nada).
    const viejo = $("det-cuerpo").querySelector(".que-hacer");
    if (viejo && fichaActual?.id === objetoActual) {
      const nuevo = bloqueQueHacer(fichaActual);
      if (nuevo) viejo.replaceWith(nuevo); else viejo.remove();
    }
  } catch (e) {
    msg.className = "small bad"; msg.textContent = e.message;
  }
});

function bloqueQueHacer(f) {
  const p = f.mercado;
  const s = sugerencia({
    compraMinima: f.estado === "con_ofertas" ? p?.precio : null,
    mercado: p?.valor_mercado ?? null,
    ventaNpc: f.venta_npc ?? null,
  }, perfilSubasta, reglaPerfil());
  if (s.accion === "sin_datos") return null;
  const caja = el("section", "que-hacer");
  caja.setAttribute("aria-label", "Qué hacer con este objeto");
  const titulo = s.accion === "publicar" ? `Publicar a ${formatearMoneda(s.precio)}`
    : s.accion === "esperar" ? "Esperar"
    : `Vender al NPC: ${formatearMoneda(s.ventaNpc)}`;
  caja.append(el("p", `qh-accion ${s.accion}`, titulo), el("p", "qh-motivo", textoMotivo(s, formatearMoneda, perfilSubasta)));
  if (s.accion === "npc" && s.accionSubasta === "publicar") {
    caja.append(el("p", "qh-motivo", `En subasta a ${formatearMoneda(s.precio)} recibirías ${formatearMoneda(s.neto)} tras la comisión: no supera al NPC.`));
  } else if (s.accion === "npc" && s.accionSubasta === "esperar") {
    caja.append(el("p", "qh-motivo", `Tu mínimo (${formatearMoneda(s.banda.min)}) no supera lo que paga el NPC: vender al NPC ya no es peor.`));
  }
  const regla = reglaPerfil();
  const casa = `${perfilSubasta.tipo_casa === "faccion" ? "casa de facción" : "casa neutral"}, ${perfilSubasta.duracion} h`;
  caja.append(kv([
    ["Banda", s.banda ? `${formatearMoneda(s.banda.min)} · ${formatearMoneda(s.banda.normal)} · ${formatearMoneda(s.banda.max)}` : null],
    ["Puja", s.puja != null && s.precio != null ? formatearMoneda(s.puja) : null],
    ["Neto tras comisión", s.neto != null ? `${formatearMoneda(s.neto)} (comisión ${formatearMoneda(s.comision)}, ${casa})` : null],
    ["Depósito", s.deposito != null ? `${formatearMoneda(s.deposito)}: se devuelve si se vende, se pierde si caduca` : null],
    ["El NPC paga", s.ventaNpc != null ? formatearMoneda(s.ventaNpc) : null],
  ]));
  const nota = el("p", "muted small",
    "Sugerencia propia con la lógica de publicación de TSM (mínimo, normal y máximo; 1 rebaja por debajo de la compra mínima). " +
    "No se puede saber si la subasta más barata es tuya: si lo es, no hace falta bajar el precio." +
    (regla && !regla.verificado ? " La comisión y el depósito están sin verificar." : ""));
  caja.append(nota);
  caja.title = "Banda: mínimo, normal y máximo. Ajústala en «Banda de precios» (barra lateral).";
  return caja;
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
    $("det-titulo").textContent = filaPagina?.nombre ?? `#${id}`;
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
    $("det-titulo").textContent = f.nombre;
    $("det-titulo").className = f.calidad ? `q-${f.calidad}` : "";
    fichaActual = f;
    cuerpo.replaceChildren(...[cabeceraObjeto(f), bloquePrecios(f), bloqueQueHacer(f), rec,
      f.estado === "sin_datos" ? null : seccionGrafico(id), seccionRegion(f), seccionPropiedades(f), seccionRecetas(id)].filter(Boolean));
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
  await cargarPerfilSubasta();   // banda y comisiones (dos peticiones pequeñas) antes de abrir un objeto
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

ponerVista(vista);   // la vista elegida (Lista o Mapa) se recuerda en este navegador
refrescar();
vigilar();
