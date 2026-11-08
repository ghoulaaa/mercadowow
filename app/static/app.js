import { leerCsvInventario, leerCsvPrecios } from "./csv.js";
import { dibujarGrafico } from "./grafico.js";
import { formatearMoneda, parsearMoneda } from "./moneda.js";
import { ESTADO_INICIAL, alEscribir, conSugerencias, teclado } from "./autocompletar.js";
import { leerRuta } from "./ruta.js";
import {
  NOMBRE_CALIDAD, NOMBRE_REC, categorias, filtrar, formatearPct, ordenar, prepararFilas, subcategorias,
} from "./tabla.js";

const $ = (id) => document.getElementById(id);
const fecha = (iso) => iso ? new Date(iso).toLocaleString("es", { dateStyle: "short", timeStyle: "short" }) : "—";
const hace = (iso) => {
  if (!iso) return "";
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return " (ahora)";
  if (min < 120) return ` (hace ${min} min)`;
  if (min < 48 * 60) return ` (hace ${Math.round(min / 60)} h)`;
  return ` (hace ${Math.round(min / 1440)} días)`;
};
const ESTADOS = {
  nuevo_dato: ["Dato nuevo", "ok"], sin_cambios: ["Sin cambios", "muted"],
  no_modificado: ["No modificado (304)", "muted"], error: ["Error", "bad"],
};

// Mercado elegido en este navegador (comodidad: si falla el almacenamiento, se usa el principal).
const guardado = {
  leer() { try { return localStorage.getItem("mw_mercado"); } catch { return null; } },
  escribir(v) { try { localStorage.setItem("mw_mercado", v); } catch { /* sin almacenamiento */ } },
};
let mercadoActual = guardado.leer();
let ultimo = null;   // último estado recibido

function mostrar(vista) {
  $("vista-login").hidden = vista !== "login";
  $("vista-panel").hidden = vista !== "panel";
  // La cabecera completa y la navegación solo con sesión iniciada.
  for (const id of ["zona-busqueda", "cab-estado", "nav-secciones", "accesos"]) $(id).hidden = vista !== "panel";
}

function filas(dl, rows) {
  dl.innerHTML = "";
  for (const [k, v, cls] of rows) {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    if (cls) dd.className = cls;
    dl.append(dt, dd);
  }
}

function pintarSelector(s) {
  const sel = $("sel-mercado");
  const lista = s.mercados || [];
  if (lista.length < 2) { sel.hidden = true; return; }
  sel.innerHTML = "";
  for (const m of lista) {
    const op = document.createElement("option");
    op.value = m.clave;
    op.textContent = m.ficticio ? "DEMO (ficticio)"
      : m.automatico ? `Real · ${m.proveedor === "ahledger" ? "AHledger" : m.proveedor.toUpperCase()}`
      : "Real · importación manual";
    sel.append(op);
  }
  sel.value = s.mercado.clave;
  sel.hidden = false;
}

async function cargar() {
  let r, s;
  const q = mercadoActual ? "?mercado=" + encodeURIComponent(mercadoActual) : "";
  try {
    r = await fetch("/api/estado" + q, { cache: "no-store" });
    s = await r.json();
  } catch (e) {
    s = { error: e.message };
  }

  if (r && r.status === 401) {
    $("market").textContent = "privado";
    $("sel-mercado").hidden = true;
    mostrar("login");
    $("clave").focus();
    return;
  }
  if (r && r.status === 404 && mercadoActual) {   // mercado guardado que ya no existe
    mercadoActual = null;
    return cargar();
  }
  mostrar("panel");

  if (!r || !r.ok) {
    $("market").textContent = "sin conexión";
    $("hdr-conexion").textContent = "sin conexión";
    $("hdr-conexion").className = "bad";
    $("titulo").textContent = "Sin conexión con la base de datos";
    $("subtitulo").textContent = (s && s.error) || "Error desconocido";
    filas($("status"), [["Servidor", "sin acceso a Supabase", "bad"]]);
    return;
  }
  ultimo = s;

  $("btn-salir").hidden = !s.autenticado;
  const pend = s.base_de_datos.migraciones_pendientes || [];
  if (pend.length) {
    $("market").textContent = s.mercado.nombre;
    $("titulo").textContent = "Falta configurar Supabase";
    $("subtitulo").textContent = "Ejecuta configurar.bat (migraciones pendientes: " + pend.join(", ") + ").";
    filas($("status"), [["Base de datos", "Supabase · proyecto " + s.base_de_datos.proyecto]]);
    return;
  }

  const m = s.mercado, a = s.actualizacion;
  const demo = !!m.ficticio, auto = !!m.automatico, manual = !demo && !auto;
  pintarSelector(s);
  $("market").hidden = !$("sel-mercado").hidden;
  $("market").textContent = m.nombre;
  $("banda-demo").hidden = !demo;
  document.body.classList.toggle("modo-demo", demo);
  $("btn-actualizar").hidden = !auto;
  $("card-importar").hidden = !manual;
  $("card-demo").hidden = !demo;

  const viejo = a.hora_dato_original && (Date.now() - new Date(a.hora_dato_original)) > 8 * 3600e3;
  // Cabecera: conexión, hora del dato original, última consulta y próxima actualización.
  $("hdr-conexion").textContent = auto ? (a.fallos_seguidos ? `con fallos (${a.fallos_seguidos})` : "conectado") : (demo ? "demo" : "manual");
  $("hdr-conexion").className = a.fallos_seguidos ? "bad" : "ok";
  $("hdr-dato").textContent = a.hora_dato_original ? fecha(a.hora_dato_original) + hace(a.hora_dato_original) : "—";
  $("hdr-dato").className = viejo && !demo ? "bad" : "";
  $("hdr-consulta").textContent = auto ? (a.ultima_consulta_ok ? fecha(a.ultima_consulta_ok) : "—") : "no automática";
  $("hdr-proxima").textContent = auto ? (a.proxima ? fecha(a.proxima) : "en cuanto se pueda") : "—";
  if (demo) {
    $("titulo").textContent = a.versiones_guardadas ? "Datos FICTICIOS de demostración" : "Mercado de demostración vacío";
    $("subtitulo").textContent = "Todo lo que ves aquí es inventado y está separado de los datos reales.";
  } else if (manual) {
    $("titulo").textContent = a.versiones_guardadas ? "Precios importados a mano" : "Sin precios importados";
    $("subtitulo").textContent = "Plan B: precios del mercado PvP Horda cargados desde un CSV. Se guardan aparte de los de TSM.";
  } else {
    const fuente = m.proveedor === "AHLEDGER" ? "AHledger" : m.proveedor;
    $("titulo").textContent = a.versiones_guardadas ? `Recibiendo datos reales de ${fuente}` : "Conectado, esperando el primer dato";
    $("subtitulo").textContent = m.proveedor === "AHLEDGER"
      ? "Escaneos de jugadores con el addon de AHledger: incluye unidades publicadas y una estimación de ventas por día."
      : "Archivo público de TSM: precio mínimo, valor de mercado y valor histórico (sin cantidades).";
  }

  const errorResuelto = a.ultimo_error && a.ultima_consulta_ok &&
    new Date(a.ultima_consulta_ok) > new Date(a.ultimo_error_hora);

  const comunes = [
    ["Mercado", m.nombre + " (" + m.clave + ")"],
    ["Origen de los datos", demo ? "FICTICIO (generado)" : (auto ? (m.proveedor === "AHLEDGER" ? "AHledger · API pública (escaneos de jugadores con su addon)" : m.proveedor + " · archivo público") : "Importación manual (CSV)"), demo ? "bad" : ""],
    ["Hora del dato original", fecha(a.hora_dato_original) + hace(a.hora_dato_original) + (viejo && !demo ? " · ANTIGUO" : ""), viejo && !demo ? "bad" : ""],
    ["Versiones guardadas", String(a.versiones_guardadas) + " · " + a.objetos + " objetos"],
  ];
  const automaticas = auto ? [
    ["Consulta automática", a.configurada ? (a.en_curso ? "en curso…" : "activa (en Supabase)") : "no activada — ejecuta configurar.bat", a.configurada ? "ok" : "bad"],
    ["Última consulta correcta", fecha(a.ultima_consulta_ok) + hace(a.ultima_consulta_ok)],
    ["Próxima actualización", a.proxima ? "hacia las " + fecha(a.proxima) + " (±5 min)" : (a.configurada ? "en cuanto se pueda" : "—")],
    ["Fallos seguidos", String(a.fallos_seguidos), a.fallos_seguidos ? "bad" : ""],
    ["Último error", a.ultimo_error ? fecha(a.ultimo_error_hora) + " · " + a.ultimo_error + (errorResuelto ? " (resuelto)" : "") : "—"],
  ] : [["Actualización automática", "no (este mercado no se descarga solo)"]];
  filas($("status"), [...comunes, ...automaticas,
    ["Base de datos", "Supabase · proyecto " + s.base_de_datos.proyecto]]);

  // Resumen: dato del mercado y alertas.
  $("tile-dato").textContent = a.hora_dato_original ? hace(a.hora_dato_original).replace(/[()]/g, "").trim() : "sin datos";
  $("tile-dato").className = "tile-v" + (viejo && !demo ? " bad" : "");
  $("tile-dato-n").textContent = demo ? "FICTICIO" : (a.hora_dato_original ? "escaneo de " + fecha(a.hora_dato_original) : "");
  pintarAlertas();

  const ul = $("registro");
  ul.innerHTML = "";
  if (!s.registro.length) ul.innerHTML = '<li class="muted">Todavía no hay registros.</li>';
  for (const x of s.registro) {
    const [txt, cls] = ESTADOS[x.estado] || [x.estado, ""];
    const li = document.createElement("li");
    li.innerHTML = '<span class="muted"></span> <strong></strong> <span class="muted"></span>';
    li.children[0].textContent = fecha(x.hora);
    li.children[1].textContent = txt;
    li.children[1].className = cls;
    li.children[2].textContent = [x.filas ? x.filas.toLocaleString("es") + " filas" : "", x.mensaje || ""].filter(Boolean).join(" · ");
    ul.append(li);
  }
}

// ---------- alertas ----------
function pintarAlertas() {
  if (!ultimo) return;
  const a = ultimo.actualizacion, m = ultimo.mercado, avisos = [];
  const viejo = a.hora_dato_original && (Date.now() - new Date(a.hora_dato_original)) > 8 * 3600e3;
  if (!m.ficticio && viejo) avisos.push("dato con más de 8 h");
  if (a.fallos_seguidos) avisos.push(`${a.fallos_seguidos} fallo(s) seguidos al consultar`);
  if (m.automatico && !a.configurada) avisos.push("consulta automática sin activar");
  const ausentes = filasTabla.filter((f) => f.ausente).length;
  if (ausentes) avisos.push(`${ausentes} objetos no aparecen en el último escaneo`);
  $("tile-alertas").textContent = String(avisos.length);
  $("tile-alertas").className = "tile-v" + (avisos.length ? " bad" : " ok");
  $("tile-alertas-n").textContent = avisos.length ? avisos.join(" · ") : "sin alertas";
}

// ---------- tabla de precios ----------
const POR_PAGINA = 100;
let filasTabla = [];        // filas preparadas del mercado actual
let mercadoTabla = null;    // mercado al que pertenecen
let visibles = POR_PAGINA;

const leerFiltros = () => {
  const [clave, dir] = $("f-orden").value.split(":");
  return {
    texto: $("f-texto").value, categoria: $("f-categoria").value, recomendacion: $("f-recomendacion").value,
    subcategoria: $("f-subcategoria").value, calidad: $("f-calidad").value,
    soloFavoritos: $("f-favoritos").checked, ocultarAusentes: $("f-ausentes").checked, clave, dir,
    nivelMin: numeroONull($("f-nivel-min").value), nivelMax: numeroONull($("f-nivel-max").value),
    ...preciosFiltro(),
  };
};

function numeroONull(v) {
  const n = Number(v);
  return v === "" || !Number.isFinite(n) ? null : n;
}

/** Precio mínimo/máximo escritos en cobre o como «1o 50p». Un valor no válido se avisa y se ignora. */
function preciosFiltro() {
  const errores = [], res = { precioMin: null, precioMax: null };
  for (const [id, k] of [["f-precio-min", "precioMin"], ["f-precio-max", "precioMax"]]) {
    try { res[k] = parsearMoneda($(id).value); } catch (e) { errores.push(e.message); }
  }
  $("f-precio-error").hidden = errores.length === 0;
  $("f-precio-error").textContent = errores.join(" · ");
  return res;
}

async function cargarPrecios() {
  const clave = ultimo?.mercado?.clave;
  if (!clave) return;
  let r, d;
  try {
    r = await fetch("/api/precios?mercado=" + encodeURIComponent(clave), { cache: "no-store" });
    d = await r.json();
  } catch { return; }
  if (!r.ok || d.mercado !== clave) return;     // respuesta de otro mercado: se descarta
  filasTabla = prepararFilas(d.objetos);
  if (mercadoTabla !== clave) { visibles = POR_PAGINA; mercadoTabla = clave; }
  firmaVersion = JSON.stringify(d.version);

  const sel = $("f-categoria"), previa = sel.value;
  sel.innerHTML = '<option value="">Todas las categorías</option>';
  for (const c of categorias(filasTabla)) {
    const op = document.createElement("option"); op.value = op.textContent = c; sel.append(op);
  }
  sel.value = [...sel.options].some((o) => o.value === previa) ? previa : "";
  rellenarSubcategorias();
  pintarAtribucion();

  const res = d.resumen || {};
  $("tile-vender-v").textContent = res.vender ?? "—";
  $("tile-guardar-v").textContent = res.guardar ?? "—";
  const top = (rec) => filasTabla.filter((f) => f.rec === rec).sort((a, b) => (b.puntos ?? 0) - (a.puntos ?? 0))
    .slice(0, 3).map((f) => f.nombre).join(", ");
  $("tile-vender-n").textContent = res.vender ? top("VENDER") : "Ninguna con las reglas actuales";
  $("tile-guardar-n").textContent = res.guardar ? top("GUARDAR") : "Ninguno con las reglas actuales";
  pintarTabla();
  pintarAlertas();
  pintarArbol();
  marcarFilaActiva(objetoActual);
  if (leerRuta(location.hash).vista === "oportunidades") pintarOportunidades();
}

function celdaMoneda(td, cobre) {
  td.textContent = "";
  const span = document.createElement("span");
  span.className = "moneda";
  const txt = formatearMoneda(cobre);
  for (const parte of txt.split(" ")) {
    const s = document.createElement("span");
    const u = parte.slice(-1);
    s.className = { o: "o", p: "p", c: "c" }[u] || "";
    s.textContent = parte;
    span.append(s, " ");
  }
  td.append(span);
}

function celdaPct(td, p, precioAnterior, horaAnterior) {
  td.textContent = formatearPct(p);
  td.className = "num" + (p > 0.05 ? " sube" : p < -0.05 ? " baja" : "");
  if (precioAnterior != null) td.title = `Antes: ${formatearMoneda(precioAnterior)} (${fecha(horaAnterior)})`;
  else td.title = "Todavía no hay una observación propia en ese momento";
}

function pintarTabla() {
  const f = leerFiltros();
  const lista = ordenar(filtrar(filasTabla, f), f.clave, f.dir);
  const tbody = $("tbody");
  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const x of lista.slice(0, visibles)) {
    const tr = document.createElement("tr");
    if (x.ausente) tr.className = "ausente";

    const tdFav = document.createElement("td"); tdFav.className = "c-fav";
    const b = document.createElement("button");
    b.type = "button"; b.className = "estrella"; b.dataset.id = x.id;
    b.setAttribute("aria-pressed", String(!!x.favorito));
    b.setAttribute("aria-label", (x.favorito ? "Quitar de favoritos: " : "Añadir a favoritos: ") + x.nombre);
    b.textContent = x.favorito ? "★" : "☆";
    tdFav.append(b);

    const tdObj = document.createElement("td"); tdObj.className = "c-obj";
    const div = document.createElement("div"); div.className = "objeto";
    const ic = document.createElement("span"); ic.className = "icono"; ic.setAttribute("aria-hidden", "true");
    ic.textContent = x.nombre.replace(/^\[FICTICIO\]\s*/, "").charAt(0).toUpperCase();
    ic.style.background = colorCategoria(x.categoria);
    if (x.icono) {
      // Icono oficial (CDN de Blizzard). Si no carga, queda la inicial como marcador neutro.
      const img = document.createElement("img");
      img.src = x.icono; img.alt = ""; img.loading = "lazy"; img.width = 26; img.height = 26;
      img.addEventListener("error", () => img.remove());
      ic.append(img);
    }
    if (x.calidad) ic.dataset.calidad = x.calidad;
    const txt = document.createElement("div");
    const nom = document.createElement("button");
    nom.type = "button"; nom.className = "objeto-nombre enlace" + (x.calidad ? ` q-${x.calidad}` : "");
    nom.dataset.detalle = x.id; nom.textContent = x.nombre;
    nom.title = "Ver por qué se recomienda";
    const sub = document.createElement("div"); sub.className = "objeto-id";
    sub.textContent = `#${x.id} · ${x.categoria}` + (x.subcategoria ? ` › ${x.subcategoria}` : "")
      + (x.nivel_objeto ? ` · nivel ${x.nivel_objeto}` : "") + (x.ausente ? ` · ausente desde ${fecha(x.hora)}` : "");
    txt.append(nom, sub); div.append(ic, txt); tdObj.append(div);

    const tdPrecio = document.createElement("td"); tdPrecio.className = "num"; tdPrecio.dataset.k = "Precio:";
    celdaMoneda(tdPrecio, x.precio_ref);
    if (x.precio == null && x.valor_mercado != null) tdPrecio.title = "Sin compra inmediata: se muestra el valor de mercado";
    const tdHist = document.createElement("td"); tdHist.className = "num"; tdHist.dataset.k = "Histórico:";
    celdaMoneda(tdHist, x.historico);
    const td24 = document.createElement("td"); td24.dataset.k = "24 h:";
    celdaPct(td24, x.var24, x.precio_24h, x.hora_24h);
    const td7 = document.createElement("td"); td7.dataset.k = "7 días:";
    celdaPct(td7, x.var7, x.precio_7d, x.hora_7d);
    const tdOferta = document.createElement("td"); tdOferta.className = "num"; tdOferta.dataset.k = "Oferta:";
    if (x.cantidad != null) {
      tdOferta.textContent = `${x.cantidad.toLocaleString("es")} uds.`;
      tdOferta.title = "Unidades publicadas en el último escaneo"
        + (x.ventas_dia != null ? ` · ventas estimadas por AHledger: ${x.ventas_dia.toLocaleString("es")} al día (estimación, no ventas confirmadas)` : "");
    } else {
      tdOferta.textContent = "sin dato"; tdOferta.title = "Esta fuente no publica cantidades en venta";
    }
    const tdRec = document.createElement("td"); tdRec.dataset.k = "Recomendación:";
    const et = document.createElement("span");
    et.className = "etiqueta " + ({ VENDER: "rec-vender", GUARDAR: "rec-guardar", OBSERVACION: "rec-obs" }[x.rec] || "");
    et.textContent = NOMBRE_REC[x.rec] || "—";
    tdRec.append(et);
    if (x.resumen) {
      const rs = document.createElement("div"); rs.className = "objeto-id"; rs.textContent = x.resumen; tdRec.append(rs);
    }
    const tdConf = document.createElement("td"); tdConf.dataset.k = "Confianza:";
    tdConf.textContent = x.nivel ? `${x.nivel} · ${x.puntos}` : "—";
    tdConf.title = "Índice de calidad de los datos (0–100), no una probabilidad";

    tr.append(tdFav, tdObj, tdPrecio, tdHist, td24, td7, tdOferta, tdRec, tdConf);
    frag.append(tr);
  }
  tbody.append(frag);
  $("sin-resultados").hidden = lista.length > 0 || filasTabla.length === 0;
  $("btn-mas").hidden = lista.length <= visibles;
  $("btn-mas").textContent = `Mostrar ${Math.min(POR_PAGINA, lista.length - visibles)} más`;
  $("contador").textContent = `${Math.min(visibles, lista.length).toLocaleString("es")} de ${lista.length.toLocaleString("es")}`
    + (lista.length !== filasTabla.length ? ` (filtrados de ${filasTabla.length.toLocaleString("es")})` : "");
}

const COLORES = ["#f2c94c", "#5aa9e6", "#4cc38a", "#e0b04a", "#c7783e", "#b48ead", "#88c0d0", "#e5534b", "#a3be8c"];
function colorCategoria(c) {
  let h = 0;
  for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return c === "Sin clasificar" ? "#c0c6cf" : COLORES[h % COLORES.length];
}

function rellenarSubcategorias() {
  const sel = $("f-subcategoria"), previa = sel.value;
  const lista = subcategorias(filasTabla, $("f-categoria").value);
  sel.replaceChildren(el("option", "", "Todas las subcategorías"));
  sel.firstChild.value = "";
  for (const s of lista) { const op = el("option", "", s); op.value = s; sel.append(op); }
  sel.disabled = lista.length === 0;
  sel.value = lista.includes(previa) ? previa : "";
}
$("f-categoria").addEventListener("change", rellenarSubcategorias);

let temporizadorFiltro = null;
const FILTROS_TEXTO = ["f-texto", "f-nivel-min", "f-nivel-max", "f-precio-min", "f-precio-max"];
for (const id of [...FILTROS_TEXTO, "f-categoria", "f-subcategoria", "f-calidad", "f-recomendacion", "f-orden", "f-favoritos", "f-ausentes"]) {
  const texto = FILTROS_TEXTO.includes(id);
  $(id).addEventListener(texto ? "input" : "change", () => {
    clearTimeout(temporizadorFiltro);
    temporizadorFiltro = setTimeout(() => { visibles = POR_PAGINA; pintarTabla(); pintarArbol(); }, texto ? 200 : 0);
  });
}
$("btn-mas").addEventListener("click", () => { visibles += POR_PAGINA; pintarTabla(); });

// Favoritos: se marca al instante y se deshace si el servidor falla.
$("tbody").addEventListener("click", async (ev) => {
  const b = ev.target.closest(".estrella");
  if (!b || !ultimo) return;
  const id = Number(b.dataset.id);
  const fila = filasTabla.find((f) => f.id === id);
  if (!fila) return;
  const nuevo = !fila.favorito;
  fila.favorito = nuevo;
  pintarTabla();
  try {
    const r = await fetch("/api/favorito", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mercado: ultimo.mercado.clave, id, favorito: nuevo }),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
  } catch {
    fila.favorito = !nuevo;
    pintarTabla();
  }
});

// ---------- catálogo: búsqueda y ficha ----------
function iconoNodo(url, nombre, grande = false) {
  const ic = el("span", "icono" + (grande ? " grande" : ""));
  ic.setAttribute("aria-hidden", "true");
  ic.textContent = (nombre || "?").replace(/^\[FICTICIO\]\s*/, "").charAt(0).toUpperCase();
  if (url) {
    const img = document.createElement("img");
    img.src = url; img.alt = ""; img.loading = "lazy";
    img.addEventListener("error", () => img.remove());
    ic.append(img);
  }
  return ic;
}

function fichaNodo(f, conBotonDetalle = true) {
  const cont = el("div", "cat-ficha");
  const cab = el("div", "cat-ficha-cab");
  cab.append(iconoNodo(f.icono, f.nombre, true));
  const t = el("div");
  t.append(el("h4", f.calidad ? `q-${f.calidad}` : "", f.nombre));
  const sub = [NOMBRE_CALIDAD[f.calidad] || f.calidad, [f.clase, f.subclase].filter(Boolean).join(" › ")].filter(Boolean).join(" · ");
  t.append(el("div", "muted small", sub || "—"));
  cab.append(t);
  cont.append(cab);
  const dl = el("dl", "kv");
  const fila = (k, v) => dl.append(el("dt", "", k), el("dd", "", v));
  const idDd = el("dd");
  const idBtn = el("button", "btn-mini", `${f.id} · copiar`);
  idBtn.type = "button";
  idBtn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(String(f.id)); idBtn.textContent = `${f.id} · copiado`; }
    catch { idBtn.textContent = String(f.id); }
  });
  idDd.append(idBtn);
  dl.append(el("dt", "", "ID"), idDd);
  fila("Nivel del objeto", f.nivel ?? "desconocido");
  fila("Nivel requerido", f.nivel_requerido ?? "desconocido / ninguno");
  fila("Venta al NPC", f.venta_npc == null ? "desconocido" : `${formatearMoneda(f.venta_npc)} (precio del vendedor, no de subasta)`);
  if (f.nombre_es) fila("Nombre en español", f.nombre_es);
  fila("Descripción, pila, obtención", "no disponibles desde fuentes autorizadas: consulta Wowhead");
  if (f.mercado) {
    fila("En este mercado", `${formatearMoneda(f.mercado.precio)} compra mínima` +
      (f.mercado.cantidad != null ? ` · ${f.mercado.cantidad.toLocaleString("es")} uds.` : "") + ` · escaneo ${fecha(f.mercado.hora)}`);
  } else {
    fila("En este mercado", "Sin datos disponibles (nadie lo tiene a la venta en los escaneos guardados)");
  }
  if (f.verificado_en) fila("Verificado", `${fecha(f.verificado_en)} · fuente ${f.fuente}`);
  cont.append(dl);
  const enl = el("div", "enlaces");
  const a = (texto, url) => { const x = el("a", "", texto); x.href = url; x.target = "_blank"; x.rel = "noopener"; enl.append(x); };
  if (f.wowhead_url) a("Ver en Wowhead", f.wowhead_url);
  if (f.fuente_url) a("Ver en AHledger", f.fuente_url);
  if (f.en_mercado && conBotonDetalle) {
    const b = el("button", "btn btn-small", "Ver precio, historial y recomendación");
    b.type = "button";
    b.addEventListener("click", () => { location.hash = `#/objeto/${f.id}`; });
    enl.append(b);
  }
  cont.append(enl);
  return cont;
}

let busquedaN = 0;
async function buscarCatalogo() {
  const q = $("cat-q").value.trim();
  const n = ++busquedaN;   // se descartan las respuestas de búsquedas anteriores
  const ul = $("cat-resultados");
  if (!q || !ultimo) { ul.replaceChildren(); $("cat-estado").textContent = ""; return; }
  $("cat-estado").textContent = "buscando…";
  let d;
  try {
    const r = await fetch(`/api/catalogo?mercado=${encodeURIComponent(ultimo.mercado.clave)}&q=${encodeURIComponent(q)}`, { cache: "no-store" });
    d = await r.json();
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
  } catch (e) {
    if (n === busquedaN) $("cat-estado").textContent = "error: " + e.message;
    return;
  }
  if (n !== busquedaN) return;
  $("cat-estado").textContent = d.resultados.length ? `${d.resultados.length} resultado(s)` : "sin resultados";
  ul.replaceChildren();
  for (const x of d.resultados) {
    const li = el("li");
    const b = el("button");
    b.type = "button";
    b.dataset.id = x.id;
    const txt = el("span");
    txt.append(el("span", x.calidad ? `q-${x.calidad}` : "", x.nombre), " ",
      el("span", "cat-sub", `#${x.id} · ${[x.clase, x.subclase].filter(Boolean).join(" › ")}` +
        (x.nivel ? ` · nivel ${x.nivel}` : "") + (x.en_mercado ? "" : " · sin precio en este mercado")));
    b.append(iconoNodo(x.icono, x.nombre), txt);
    li.append(b);
    ul.append(li);
  }
}

let temporizadorCat = null;
$("cat-q").addEventListener("input", () => { clearTimeout(temporizadorCat); temporizadorCat = setTimeout(buscarCatalogo, 250); });
$("cat-resultados").addEventListener("click", async (ev) => {
  const b = ev.target.closest("button[data-id]");
  if (!b) return;
  const caja = $("cat-ficha");
  caja.hidden = false;
  caja.replaceChildren(el("p", "muted small", "Cargando ficha…"));
  try {
    const r = await fetch(`/api/objeto?mercado=${encodeURIComponent(ultimo.mercado.clave)}&id=${b.dataset.id}`, { cache: "no-store" });
    const f = await r.json();
    if (!r.ok) throw new Error(f.error || "HTTP " + r.status);
    caja.replaceChildren(fichaNodo(f));
  } catch (e) {
    caja.replaceChildren(el("p", "bad small", "No se pudo cargar la ficha: " + e.message));
  }
});

// ---------- atribución de la fuente (obligatoria para AHledger) ----------
function atribucion() {
  const a = ultimo?.mercado?.atribucion;
  if (!a) return null;
  const p = el("p", "atribucion small");
  const link = el("a", "", a.texto);
  link.href = a.url; link.target = "_blank"; link.rel = "noopener";
  p.append(link);
  return p;
}

function pintarAtribucion() {
  const cont = $("atribucion-tabla");
  cont.replaceChildren();
  const cita = atribucion();
  if (cita) cont.append(cita);
}

// ---------- tarjetas de resumen → filtro ----------
for (const id of ["tile-vender", "tile-guardar"]) {
  $(id).addEventListener("click", () => {
    $("f-recomendacion").value = $(id).dataset.rec;
    $("f-ausentes").checked = true;
    visibles = POR_PAGINA;
    pintarTabla();
    location.hash = "#/mercado";
  });
}

// ---------- detalle: por qué se recomienda ----------
const el = (tag, cls, texto) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto !== undefined) e.textContent = texto;
  return e;
};

function lista(titulo, items, cls) {
  const sec = el("section", "det-sec");
  sec.append(el("h3", "", titulo));
  const ul = el("ul", "det-lista " + (cls || ""));
  for (const t of items) ul.append(el("li", "", t));
  sec.append(ul);
  return sec;
}

async function abrirDetalle(id) {
  const cuerpo = $("det-cuerpo");
  const fila = filasTabla.find((f) => f.id === id);
  objetoActual = id;
  $("det-titulo").textContent = fila ? fila.nombre : `#${id}`;
  $("det-titulo").className = fila?.calidad ? `q-${fila.calidad}` : "";
  cuerpo.replaceChildren(el("p", "muted", "Cargando explicación…"));
  mostrarFicha(id);
  marcarFilaActiva(id);
  let d;
  try {
    const r = await fetch(`/api/explicacion?mercado=${encodeURIComponent(ultimo.mercado.clave)}&id=${id}`, { cache: "no-store" });
    d = await r.json();
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
  } catch (e) {
    cuerpo.replaceChildren(el("p", "bad", "No se pudo cargar: " + e.message));
    return;
  }
  const l = d.lectura, c = d.cifras;
  const nodos = [];
  if (d.ficticio) nodos.push(el("p", "banda-mini", "DATOS FICTICIOS"));

  const cab = el("div", "det-rec");
  const et = el("span", "etiqueta grande " + ({ VENDER: "rec-vender", GUARDAR: "rec-guardar", OBSERVACION: "rec-obs" }[l.rec] || ""), NOMBRE_REC[l.rec]);
  cab.append(et, el("span", "", " " + l.resumen));
  nodos.push(cab);
  if (fila && (fila.mediana != null || fila.cantidad != null)) {
    const sec = el("section", "det-sec");
    sec.append(el("h3", "", "Mercado ahora"));
    const dlm = el("dl", "kv");
    const f = (k, v) => dlm.append(el("dt", "", k), el("dd", "", v));
    f("Compra mínima", formatearMoneda(fila.precio));
    if (fila.mediana != null) f("Mediana", formatearMoneda(fila.mediana));
    if (fila.historico != null) f("Mediana de 30 días (fuente)", formatearMoneda(fila.historico));
    if (fila.cantidad != null) f("Unidades publicadas", fila.cantidad.toLocaleString("es"));
    if (fila.ventas_dia != null) f("Ventas por día", `${fila.ventas_dia.toLocaleString("es")} (estimación de la fuente: un escaneo no distingue una venta de una cancelación)`);
    f("Escaneo", fecha(fila.hora));
    sec.append(dlm);
    nodos.push(sec);
  }
  if (d.en_inventario) nodos.push(el("p", "small", `Tienes ${d.en_inventario} unidades en tu inventario.`));
  nodos.push(accionesObjeto(id, fila));
  const fichaCont = el("div");
  if (!d.ficticio) {
    const secFicha = el("section", "det-sec");
    secFicha.append(el("h3", "", "Ficha del objeto"), fichaCont);
    fichaCont.append(el("p", "muted small", "Cargando ficha…"));
    nodos.push(secFicha);
  }
  const secGraf = el("section", "det-sec");
  const graf = el("div", "");
  graf.id = "det-grafico";
  secGraf.append(cabeceraHistorial(graf, id), graf);
  nodos.push(secGraf);
  if (l.antiguo && d.recomendacion_motor !== "OBSERVACION") {
    nodos.push(el("p", "bad small", `Con datos recientes el motor diría «${NOMBRE_REC[d.recomendacion_motor]}», pero el último escaneo tiene ${l.horas_dato} h.`));
  }
  nodos.push(lista("Por qué", d.motivos));
  if (d.horizonte) nodos.push(lista("Horizonte orientativo", [d.horizonte]));
  nodos.push(lista("Riesgos", d.riesgos, "riesgos"));

  const dinero = el("section", "det-sec");
  dinero.append(el("h3", "", "Dinero (por unidad)"));
  const dl = el("dl", "kv");
  const fila2 = (k, v) => dl.append(el("dt", "", k), el("dd", "", v));
  fila2("Precio actual", formatearMoneda(c.precio));
  fila2(`Comisión (${String(d.comision_pct).replace(".", ",")} %, asumida)`, "−" + formatearMoneda(Math.round(c.precio * d.comision_pct / 100)));
  fila2("Ingreso neto estimado", formatearMoneda(d.ingreso_neto_unidad));
  fila2("Depósito por publicación", `mín. ${formatearMoneda(d.deposito_minimo)} · se recupera si se vende, se pierde si expira · no incluido arriba`);
  fila2("Beneficio y margen", "se calculan en «Mi inventario» si indicas el coste de compra");
  dinero.append(dl);
  nodos.push(dinero);

  const conf = el("section", "det-sec");
  conf.append(el("h3", "", `Confianza: ${l.nivel} · ${l.puntos}/100`));
  conf.append(el("p", "muted small", "Índice de calidad de los datos, no una probabilidad de acierto. Sin datos de liquidez el nivel no pasa de «Media»."));
  const tb = el("table", "tabla mini");
  for (const p of [...d.desglose, { k: "Antigüedad del dato", puntos: l.p_edad, max: 20, detalle: l.horas_dato != null ? `${String(l.horas_dato).replace(".", ",")} h` : "—" }]) {
    const tr = el("tr");
    const detalle = p.k.startsWith("Liquidez") && fila?.ventas_dia != null
      ? "la fuente publica una estimación; el motor todavía no la usa"
      : p.detalle;
    tr.append(el("td", "", p.k), el("td", "num", `${p.puntos}/${p.max}`), el("td", "muted", detalle));
    tb.append(tr);
  }
  conf.append(tb);
  nodos.push(conf);
  nodos.push(el("p", "muted small", `Calculado ${fecha(d.calculado_en)} con el escaneo de ${fecha(d.hora_dato)}. No es una garantía de subida ni de venta.`));
  const cita = atribucion();
  if (cita) nodos.push(cita);
  cuerpo.replaceChildren(...nodos);

  if (!d.ficticio) {
    fetch(`/api/objeto?mercado=${encodeURIComponent(ultimo.mercado.clave)}&id=${id}`, { cache: "no-store" })
      .then(async (r) => { const f = await r.json(); if (!r.ok) throw new Error(f.error || "HTTP " + r.status); return f; })
      .then((f) => { if (fichaCont.isConnected) fichaCont.replaceChildren(fichaNodo(f, false)); })
      .catch((e) => fichaCont.replaceChildren(el("p", "bad small", "No se pudo cargar la ficha: " + e.message)));
  }
  try {
    await cargarHistorialEn(graf, id, "7d");
  } catch (e) {
    graf.replaceChildren(el("p", "bad small", "No se pudo cargar el historial: " + e.message));
  }
}

// ---------- inventario ----------
let inventario = null;

async function cargarInventario() {
  const clave = ultimo?.mercado?.clave;
  if (!clave) return;
  try {
    const r = await fetch("/api/inventario?mercado=" + encodeURIComponent(clave), { cache: "no-store" });
    const d = await r.json();
    if (!r.ok || ultimo?.mercado?.clave !== clave) return;
    inventario = d;
  } catch { return; }
  pintarInventario();
}

function celdaTexto(tr, texto, cls, k) {
  const td = el("td", cls || "", texto);
  if (k) td.dataset.k = k;
  tr.append(td);
  return td;
}

function pintarInventario() {
  const inv = inventario;
  if (!inv) return;
  const t = inv.totales, s = inv.supuestos;
  $("inv-neto").textContent = t.lotes ? formatearMoneda(t.neto) : "—";
  if (t.con_coste) {
    $("inv-benef").textContent = formatearMoneda(t.beneficio_con_coste);
    $("inv-benef").className = "tile-v " + (t.beneficio_con_coste >= 0 ? "ok" : "bad");
    const margen = t.coste_con_coste > 0 ? ` · margen ${formatearPct(100 * t.beneficio_con_coste / t.coste_con_coste)}` : "";
    $("inv-benef-n").textContent = `${t.con_coste} lote(s) con coste${margen}`
      + (t.sin_coste ? ` · ${t.sin_coste} sin coste: no se incluyen` : "");
  } else {
    $("inv-benef").textContent = "sin calcular";
    $("inv-benef").className = "tile-v muted";
    $("inv-benef-n").textContent = t.lotes ? "Ningún lote tiene coste de compra: no se puede calcular beneficio" : "";
  }
  $("inv-recs").textContent = t.lotes ? `${t.vender} / ${t.guardar}` : "—";
  $("inv-contador").textContent = t.lotes ? `${t.lotes} lotes · ${t.unidades} unidades` : "";
  $("inv-supuestos").textContent =
    `Supuestos (editables en «Reglas del motor»): comisión ${String(s.comision_pct).replace(".", ",")} % (coste definitivo); ` +
    `depósito mínimo ${formatearMoneda(s.deposito_minimo)} por publicación de ${s.unidades_por_publicacion} unidades ` +
    `(se recupera si se vende); se descuenta como pérdida esperada el ${s.prob_no_venta_pct} % del depósito, ` +
    `suponiendo que esa parte de las subastas caduca. Sin coste de compra no se muestra beneficio.`;

  const tbody = $("inv-tbody");
  tbody.replaceChildren();
  $("inv-vacio").hidden = inv.filas.length > 0;
  for (const f of inv.filas) {
    const tr = el("tr");
    tr.dataset.lote = f.id;
    if (f.ausente) tr.className = "ausente";
    const tdObj = el("td", "c-obj");
    const b = el("button", "objeto-nombre enlace", f.nombre);
    b.type = "button"; b.dataset.detalle = f.item_id;
    tdObj.append(b, el("div", "objeto-id", `#${f.item_id}` + (f.ausente ? ` · ausente desde ${fecha(f.hora)}` : "")));
    tr.append(tdObj);
    celdaTexto(tr, f.cantidad.toLocaleString("es"), "num", "Cantidad:");
    const tdCoste = celdaTexto(tr, f.coste_unitario == null ? "desconocido" : formatearMoneda(f.coste_unitario),
      "num" + (f.coste_unitario == null ? " desconocido" : ""), "Coste:");
    tdCoste.dataset.campo = "coste";
    celdaTexto(tr, formatearMoneda(f.precio), "num", "Precio:");
    const tdNeto = celdaTexto(tr, formatearMoneda(f.neto), "num", "Neto:");
    if (f.bruto != null) {
      tdNeto.title = `Bruto ${formatearMoneda(f.bruto)} − comisión ${formatearMoneda(f.comision)} − pérdida esperada de depósito ` +
        `${formatearMoneda(f.perdida_deposito)} (depósito total ${formatearMoneda(f.deposito)} en ${f.publicaciones} publicación/es, recuperable si se vende)`;
    }
    // Sin coste: el beneficio NO se calcula ni se muestra como 0.
    const tdB = celdaTexto(tr, f.beneficio == null ? "—" : formatearMoneda(f.beneficio),
      "num" + (f.beneficio == null ? " desconocido" : f.beneficio >= 0 ? " sube" : " baja"), "Beneficio:");
    if (f.beneficio == null) tdB.title = f.coste_unitario == null ? "Sin coste de compra: beneficio sin calcular" : "Sin precio actual";
    celdaTexto(tr, f.margen == null ? "—" : formatearPct(100 * f.margen), "num" + (f.margen == null ? " desconocido" : ""), "Margen:");
    const tdRec = el("td");
    tdRec.dataset.k = "Recomendación:";
    const et = el("span", "etiqueta " + ({ VENDER: "rec-vender", GUARDAR: "rec-guardar", OBSERVACION: "rec-obs" }[f.rec] || ""),
      NOMBRE_REC[f.rec] || "—");
    tdRec.append(et);
    if (f.resumen) tdRec.append(el("div", "objeto-id", f.resumen));
    tr.append(tdRec);
    const tdAcc = el("td");
    const acc = el("div", "acciones-lote");
    const be = el("button", "btn-mini", "Editar"); be.type = "button"; be.dataset.editar = f.id;
    const bb = el("button", "btn-mini peligro", "Borrar"); bb.type = "button"; bb.dataset.borrar = f.id;
    acc.append(be, bb); tdAcc.append(acc); tr.append(tdAcc);
    tbody.append(tr);
  }
}

async function accionInventario(cuerpo) {
  const r = await fetch("/api/inventario", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mercado: ultimo.mercado.clave, ...cuerpo }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
  await cargarInventario();
  return d;
}

function rellenarListaObjetos() {
  const dl = $("lista-objetos");
  dl.replaceChildren();
  for (const f of [...filasTabla].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).slice(0, 5000)) {
    const op = document.createElement("option");
    op.value = `${f.nombre} #${f.id}`;
    dl.append(op);
  }
}

function resolverObjeto(texto) {
  const t = texto.trim();
  const m = t.match(/#(\d+)\s*$/) || t.match(/^(\d+)$/);
  if (m) return filasTabla.find((f) => f.id === Number(m[1])) || null;
  const iguales = filasTabla.filter((f) => f.nombre.toLowerCase() === t.toLowerCase());
  return iguales.length === 1 ? iguales[0] : null;
}

$("form-inv").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const msg = $("inv-msg");
  msg.hidden = false;
  try {
    const obj = resolverObjeto($("inv-objeto").value);
    if (!obj) throw new Error("No encuentro ese objeto en este mercado. Elígelo de la lista.");
    const cantidad = Number($("inv-cantidad").value);
    if (!Number.isInteger(cantidad) || cantidad <= 0) throw new Error("La cantidad debe ser un entero mayor que 0");
    const coste = parsearMoneda($("inv-coste").value);   // vacío → null (desconocido)
    await accionInventario({ accion: "agregar", item_id: obj.id, cantidad, coste });
    msg.className = "small ok";
    msg.textContent = `Añadido: ${cantidad} × ${obj.nombre}` + (coste == null ? " (coste desconocido)" : "");
    $("form-inv").reset();
  } catch (e) {
    msg.className = "small bad";
    msg.textContent = e.message;
  }
});

$("inv-tbody").addEventListener("click", async (ev) => {
  const ver = ev.target.closest("[data-detalle]");
  if (ver) { abrirDetalle(Number(ver.dataset.detalle)); return; }
  const bor = ev.target.closest("[data-borrar]");
  if (bor) {
    const f = inventario.filas.find((x) => x.id === Number(bor.dataset.borrar));
    if (!confirm(`¿Borrar ${f.cantidad} × ${f.nombre} de tu inventario?`)) return;
    try { await accionInventario({ accion: "borrar", id: f.id }); } catch (e) { alert(e.message); }
    return;
  }
  const ed = ev.target.closest("[data-editar]");
  if (ed) {
    const f = inventario.filas.find((x) => x.id === Number(ed.dataset.editar));
    const cant = prompt(`Cantidad de ${f.nombre}:`, String(f.cantidad));
    if (cant === null) return;
    const coste = prompt("Coste por unidad (vacío = desconocido; cobre o 12o 34p 56c):",
      f.coste_unitario == null ? "" : formatearMoneda(f.coste_unitario));
    if (coste === null) return;
    try {
      await accionInventario({ accion: "editar", id: f.id, cantidad: Number(cant), coste: parsearMoneda(coste) });
    } catch (e) { alert(e.message); }
  }
});

// ---------- ventas y aciertos ----------
let ventas = null;

const ahoraLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

async function cargarVentas() {
  const clave = ultimo?.mercado?.clave;
  if (!clave) return;
  try {
    const r = await fetch("/api/ventas?mercado=" + encodeURIComponent(clave), { cache: "no-store" });
    const d = await r.json();
    if (!r.ok || ultimo?.mercado?.clave !== clave) return;
    ventas = d;
  } catch { return; }
  pintarVentas();
}

function pctCelda(tr, p, k, titulo) {
  const td = celdaTexto(tr, p == null ? "—" : formatearPct(100 * p),
    "num" + (p == null ? " desconocido" : p > 0.0005 ? " sube" : p < -0.0005 ? " baja" : ""), k);
  if (titulo) td.title = titulo;
  return td;
}

function pintarVentas() {
  const v = ventas;
  if (!v) return;
  const t = v.totales;
  $("ven-contador").textContent = t.ventas ? `${t.ventas} ventas · ${t.unidades} unidades` : "";
  $("ven-neto").textContent = t.ventas ? formatearMoneda(t.neto) : "—";
  $("ven-neto-n").textContent = t.comisiones_estimadas
    ? `${t.comisiones_estimadas} con comisión estimada (no registraste la pagada)` : (t.ventas ? "con las comisiones que registraste" : "");
  if (t.con_coste) {
    $("ven-benef").textContent = formatearMoneda(t.beneficio_con_coste);
    $("ven-benef").className = "tile-v " + (t.beneficio_con_coste >= 0 ? "ok" : "bad");
    $("ven-benef-n").textContent = `${t.con_coste} venta(s) con coste` + (t.sin_coste ? ` · ${t.sin_coste} sin coste: no se incluyen` : "");
  } else {
    $("ven-benef").textContent = t.ventas ? "sin calcular" : "—";
    $("ven-benef").className = "tile-v muted";
    $("ven-benef-n").textContent = t.ventas ? "Ninguna venta tiene coste de compra (elige el lote del inventario al registrarla)" : "";
  }

  const ev = v.evaluacion;
  const v7 = ev.resumen.find((x) => x.horizonte === 7 && x.rec === "VENDER");
  const g7 = ev.resumen.find((x) => x.horizonte === 7 && x.rec === "GUARDAR");
  const casos = (v7?.n || 0) + (g7?.n || 0);
  if (casos) {
    const aciertos = (v7?.aciertos || 0) + (g7?.aciertos || 0);
    $("ven-acierto").textContent = formatearPct(100 * aciertos / casos).replace("+", "");
    $("ven-acierto").className = "tile-v";
    $("ven-acierto-n").textContent = `${aciertos} de ${casos} casos · vender ${v7?.n ? formatearPct(100 * v7.tasa).replace("+", "") : "—"}`
      + ` · guardar ${g7?.n ? formatearPct(100 * g7.tasa).replace("+", "") : "—"}`;
  } else {
    $("ven-acierto").textContent = "aún no";
    $("ven-acierto").className = "tile-v muted";
    const pend = (v7?.pendientes || 0) + (g7?.pendientes || 0);
    $("ven-acierto-n").textContent = pend
      ? `${pend} recomendaciones esperando a cumplir 7 días`
      : "Todavía no hay recomendaciones de VENDER o GUARDAR registradas";
  }

  const tbody = $("ven-tbody");
  tbody.replaceChildren();
  $("ven-vacio").hidden = v.ventas.length > 0;
  for (const s of v.ventas) {
    const tr = el("tr");
    celdaTexto(tr, fecha(s.vendido_en), "", "Fecha:");
    const tdObj = el("td", "c-obj");
    const b = el("button", "objeto-nombre enlace", s.nombre); b.type = "button"; b.dataset.detalle = s.item_id;
    tdObj.append(b);
    if (s.nota) tdObj.append(el("div", "objeto-id", s.nota));
    tr.append(tdObj);
    celdaTexto(tr, s.cantidad.toLocaleString("es"), "num", "Cantidad:");
    celdaTexto(tr, formatearMoneda(s.precio), "num", "Precio:");
    const tdNeto = celdaTexto(tr, formatearMoneda(s.neto), "num", "Neto:");
    tdNeto.title = `Bruto ${formatearMoneda(s.bruto)} − comisión ${formatearMoneda(s.comision)}`
      + (s.comision_estimada ? " (estimada)" : " (pagada)")
      + (s.deposito_perdido ? ` − depósitos perdidos ${formatearMoneda(s.deposito_perdido)}` : "");
    const tdB = celdaTexto(tr, s.beneficio == null ? "—" : formatearMoneda(s.beneficio),
      "num" + (s.beneficio == null ? " desconocido" : s.beneficio >= 0 ? " sube" : " baja"), "Beneficio:");
    if (s.beneficio == null) tdB.title = "Sin coste de compra: beneficio sin calcular";
    pctCelda(tr, s.vs_mercado, "vs mercado:", s.precio_mercado != null
      ? `Precio de mercado observado entonces: ${formatearMoneda(s.precio_mercado)}` : "No hay un precio observado en las 24 h anteriores");
    pctCelda(tr, s.vs_7d, "7 días después:", s.precio_7d != null
      ? `7 días después estaba a ${formatearMoneda(s.precio_7d)}: ${s.vs_7d > 0 ? "esperar habría dado más" : "vender entonces fue mejor o igual"}`
      : "Todavía no han pasado 7 días o no hay dato");
    const tdRec = el("td"); tdRec.dataset.k = "Recomendación:";
    tdRec.append(el("span", "etiqueta " + ({ VENDER: "rec-vender", GUARDAR: "rec-guardar", OBSERVACION: "rec-obs" }[s.rec_ese_dia] || ""),
      s.rec_ese_dia ? NOMBRE_REC[s.rec_ese_dia] : "sin registro"));
    if (!s.rec_ese_dia) tdRec.title = "Solo se registran a diario las de VENDER/GUARDAR y los favoritos";
    tr.append(tdRec);
    const tdAcc = el("td");
    const bb = el("button", "btn-mini peligro", "Borrar"); bb.type = "button"; bb.dataset.borrarVenta = s.id;
    tdAcc.append(bb); tr.append(tdAcc);
    tbody.append(tr);
  }

  const eb = $("eval-tbody");
  eb.replaceChildren();
  for (const x of ev.resumen) {
    const tr = el("tr");
    tr.append(el("td", "", `${x.horizonte} días`), el("td", "", NOMBRE_REC[x.rec]),
      el("td", "num", String(x.n)), el("td", "num", String(x.aciertos)),
      el("td", "num", x.tasa == null ? "—" : formatearPct(100 * x.tasa).replace("+", "")),
      el("td", "num", x.cambio_medio == null ? "—" : formatearPct(100 * x.cambio_medio)),
      el("td", "num", String(x.pendientes)));
    eb.append(tr);
  }
  $("eval-nota").textContent = ev.dias_registrados
    ? `Registro desde el ${ev.primer_registro} (${ev.dias_registrados} días). Con pocos casos, la tasa de acierto no es fiable todavía.`
    : "Aún no hay ningún día registrado en este mercado.";
  const ul = $("eval-ultimos");
  ul.replaceChildren();
  for (const c of ev.ultimos.slice(0, 15)) {
    ul.append(el("li", c.acierto ? "ok" : "bad",
      `${c.dia} · ${c.nombre} · ${NOMBRE_REC[c.rec]} a ${formatearMoneda(c.precio_rec)} → ${c.horizonte} días después ` +
      `${formatearMoneda(c.precio_despues)} (${formatearPct(100 * c.cambio)}) · ${c.acierto ? "acierto" : "fallo"}`));
  }
}

function rellenarLotes() {
  const sel = $("ven-lote"), obj = resolverObjeto($("ven-objeto").value);
  sel.replaceChildren(el("option", "", "— ninguno —"));
  sel.firstChild.value = "";
  if (!obj || !inventario) return;
  for (const f of inventario.filas.filter((x) => x.item_id === obj.id)) {
    const op = el("option", "", `${f.cantidad} uds.` + (f.coste_unitario != null ? ` a ${formatearMoneda(f.coste_unitario)}` : " (coste desconocido)"));
    op.value = f.id;
    sel.append(op);
  }
  if (sel.options.length === 2) sel.selectedIndex = 1;
}
$("ven-objeto").addEventListener("change", rellenarLotes);
$("ven-registrar").addEventListener("toggle", () => {
  if ($("ven-registrar").open && !$("ven-fecha").value) $("ven-fecha").value = ahoraLocal();
});

$("form-venta").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const msg = $("ven-msg");
  msg.hidden = false;
  try {
    const obj = resolverObjeto($("ven-objeto").value);
    if (!obj) throw new Error("No encuentro ese objeto en este mercado. Elígelo de la lista.");
    const cantidad = Number($("ven-cantidad").value);
    if (!Number.isInteger(cantidad) || cantidad <= 0) throw new Error("La cantidad debe ser un entero mayor que 0");
    const precio = parsearMoneda($("ven-precio").value);
    if (precio == null) throw new Error("Falta el precio por unidad");
    const fechaVenta = new Date($("ven-fecha").value);
    if (Number.isNaN(fechaVenta.getTime())) throw new Error("Fecha no válida");
    const lote = $("ven-lote").value ? Number($("ven-lote").value) : null;
    const r = await fetch("/api/ventas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mercado: ultimo.mercado.clave, accion: "registrar", item_id: obj.id, cantidad, precio,
        vendido_en: fechaVenta.toISOString(), comision: parsearMoneda($("ven-comision").value),
        deposito: parsearMoneda($("ven-deposito").value), lote_id: lote,
        descontar: lote != null && $("ven-descontar").checked,
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
    msg.className = "small ok";
    msg.textContent = `Venta registrada: ${cantidad} × ${obj.nombre} a ${formatearMoneda(precio)}` + (d.descontado ? " (descontada del inventario)" : "");
    $("form-venta").reset();
    $("ven-fecha").value = ahoraLocal();
    await Promise.all([cargarVentas(), cargarInventario()]);
  } catch (e) {
    msg.className = "small bad";
    msg.textContent = e.message;
  }
});

$("ven-tbody").addEventListener("click", async (ev) => {
  const ver = ev.target.closest("[data-detalle]");
  if (ver) { abrirDetalle(Number(ver.dataset.detalle)); return; }
  const b = ev.target.closest("[data-borrar-venta]");
  if (!b) return;
  const s = ventas.ventas.find((x) => x.id === Number(b.dataset.borrarVenta));
  if (!confirm(`¿Borrar la venta de ${s.cantidad} × ${s.nombre}? Las unidades NO vuelven al inventario.`)) return;
  try {
    const r = await fetch("/api/ventas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mercado: ultimo.mercado.clave, accion: "borrar", id: s.id }),
    });
    if (!r.ok) throw new Error((await r.json()).error || "HTTP " + r.status);
    await cargarVentas();
  } catch (e) { alert(e.message); }
});

let lecturaInv = null;
$("inv-archivo").addEventListener("change", async () => {
  const a = $("inv-archivo").files[0], lista = $("inv-errores"), msg = $("inv-imp-msg");
  $("inv-importar").disabled = true;
  lista.replaceChildren(); lista.hidden = true; msg.hidden = true; lecturaInv = null;
  if (!a) return;
  lecturaInv = leerCsvInventario(await a.text());
  for (const e of lecturaInv.errores) lista.append(el("li", "", e));
  lista.hidden = lecturaInv.errores.length === 0;
  msg.hidden = false;
  if (lecturaInv.errores.length) {
    msg.className = "small bad"; msg.textContent = `${lecturaInv.errores.length} error(es): corrígelos para importar.`;
  } else {
    const sinCoste = lecturaInv.filas.filter((f) => f.coste == null).length;
    msg.className = "small ok";
    msg.textContent = `${lecturaInv.filas.length} lotes listos` + (sinCoste ? ` (${sinCoste} sin coste)` : "") + ".";
    $("inv-importar").disabled = false;
  }
});

$("inv-importar").addEventListener("click", async () => {
  if (!lecturaInv || lecturaInv.errores.length) return;
  const reemplazar = $("inv-reemplazar").checked;
  if (reemplazar && !confirm("Se borrará TODO el inventario de este mercado y se sustituirá por el archivo. ¿Seguir?")) return;
  const msg = $("inv-imp-msg");
  try {
    const d = await accionInventario({ accion: "importar", filas: lecturaInv.filas, reemplazar });
    msg.className = "small ok"; msg.textContent = `Importados ${d.importados} lotes.`;
    $("inv-archivo").value = ""; $("inv-importar").disabled = true; lecturaInv = null;
  } catch (e) {
    msg.className = "small bad"; msg.textContent = e.message;
  }
});

$("tbody").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-detalle]");
  if (b) abrirDetalle(Number(b.dataset.detalle));
});
$("det-cerrar").addEventListener("click", () => { location.hash = "#/mercado"; });

// ---------- reglas editables ----------
const AJUSTES = [
  ["motor.vender_sobre_med7_pct", "Vender: % sobre la mediana de 7 días", "%"],
  ["motor.vender_sobre_med30_pct", "Vender: % sobre la mediana de 30 días", "%"],
  ["motor.vender_persistencia_obs", "Vender: observaciones (de las 3 últimas) que deben superar el umbral", ""],
  ["motor.guardar_bajo_med30_pct", "Guardar: % bajo la mediana de 30 días", "%"],
  ["motor.guardar_min_recuperaciones", "Guardar: días de caídas anteriores que se recuperaron (mínimo)", "días"],
  ["motor.caida_fuerte_pct_dia", "Caída previa que se considera estructural", "%/día"],
  ["motor.subida_fuerte_pct_dia", "Subida que avisa «podría seguir subiendo»", "%/día"],
  ["motor.min_dias_historial", "Historial propio mínimo", "días"],
  ["motor.min_observaciones", "Observaciones mínimas en 30 días", ""],
  ["motor.dato_antiguo_horas", "Dato antiguo a partir de", "horas"],
  ["motor.extremo_factor", "Precio extremo: veces por encima o por debajo de la mediana", "×"],
  ["motor.comision_pct", "Comisión de la casa de subastas (asumida, compruébala en el juego)", "%"],
  ["motor.deposito_minimo_cobre", "Depósito mínimo por publicación (en cobre)", "c"],
  ["motor.unidades_por_publicacion", "Unidades que pones en cada subasta (para contar depósitos)", "uds."],
  ["motor.prob_no_venta_pct", "Supuesto: % de subastas que caducan sin venderse (pérdida de depósito)", "%"],
];

async function cargarAjustes() {
  let v;
  try {
    const r = await fetch("/api/ajustes", { cache: "no-store" });
    if (!r.ok) return;
    v = await r.json();
  } catch { return; }
  const form = $("form-ajustes");
  form.replaceChildren();
  for (const [k, texto, unidad] of AJUSTES) {
    const lab = el("label", "", texto);
    lab.htmlFor = "aj-" + k;
    const wrap = el("span", "aj-valor");
    const inp = el("input");
    inp.type = "number"; inp.step = "any"; inp.id = "aj-" + k; inp.name = k; inp.value = v[k] ?? "";
    wrap.append(inp, el("span", "muted small", unidad));
    form.append(lab, wrap);
  }
}

$("btn-ajustes").addEventListener("click", async () => {
  const out = $("resultado-ajustes"), cuerpo = {};
  for (const inp of $("form-ajustes").querySelectorAll("input")) cuerpo[inp.name] = Number(inp.value);
  out.hidden = false; out.className = "small muted"; out.textContent = "Guardando…";
  try {
    const r = await fetch("/api/ajustes", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
    out.className = "small ok"; out.textContent = "Reglas guardadas. Recalculando…";
    await cargarPrecios();
    await cargarInventario();
    out.textContent = "Reglas guardadas y recomendaciones recalculadas.";
  } catch (e) {
    out.className = "small bad"; out.textContent = e.message;
  }
});

// =====================================================================
// R3 · Navegación por secciones, panel de ficha, historial, oportunidades,
//      árbol de categorías y buscador con autocompletado accesible.
// =====================================================================

let objetoActual = null;          // objeto abierto en la ficha (se mantiene al cambiar de sección)
let rangoHistorial = "7d";
const estrecho = () => window.matchMedia("(max-width: 1100px)").matches;

let favoritosPorRuta = false;
function aplicarRuta() {
  if ($("vista-panel").hidden) return;
  const r = leerRuta(location.hash);
  const real = r.vista === "objeto" || r.vista === "favoritos" ? "mercado" : r.vista;
  for (const s of document.querySelectorAll(".vista")) s.hidden = s.dataset.vista !== real;
  const activa = r.vista === "objeto" ? "mercado" : r.vista;
  for (const a of document.querySelectorAll("[data-ruta]")) {
    if (a.dataset.ruta === activa) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  // Favoritos = la vista de mercado filtrada; al salir se quita el filtro que puso la ruta.
  if (r.vista === "favoritos" && !$("f-favoritos").checked) { $("f-favoritos").checked = true; favoritosPorRuta = true; pintarTabla(); }
  if (r.vista !== "favoritos" && favoritosPorRuta) { $("f-favoritos").checked = false; favoritosPorRuta = false; pintarTabla(); }
  $("titulo-resultados").textContent = r.vista === "favoritos" ? "Favoritos" : "Mercado";
  // En pantallas estrechas la ficha es una vista propia.
  const vm = document.querySelector('[data-vista="mercado"]');
  vm.classList.toggle("solo-ficha", r.vista === "objeto" && estrecho());
  $("det-cerrar").hidden = !(r.vista === "objeto" && estrecho());
  if (r.vista === "objeto" && r.id !== objetoActual) abrirObjeto(r.id);
  if (r.vista === "historial") { if (r.id) objetoActual = r.id; pintarHistorial(); }
  if (r.vista === "oportunidades") pintarOportunidades();
}
window.addEventListener("hashchange", aplicarRuta);

function mostrarFicha(id) {
  const destino = `#/objeto/${id}`;
  if (location.hash !== destino) history.replaceState(null, "", destino);
  aplicarRuta();
  if (estrecho()) $("panel-ficha").scrollIntoView({ block: "start" });
}

function marcarFilaActiva(id) {
  for (const tr of $("tbody").querySelectorAll("tr")) {
    tr.classList.toggle("activa", tr.querySelector(`[data-detalle="${id}"]`) != null);
  }
}

/** Objeto con precio en este mercado → ficha completa; sin precio → ficha de catálogo. */
async function abrirObjeto(id) {
  if (filasTabla.some((f) => f.id === id)) return abrirDetalle(id);
  objetoActual = id;
  $("det-titulo").textContent = `#${id}`;
  $("det-titulo").className = "";
  $("det-cuerpo").replaceChildren(el("p", "muted", "Cargando ficha…"));
  mostrarFicha(id);
  try {
    const r = await fetch(`/api/objeto?mercado=${encodeURIComponent(ultimo.mercado.clave)}&id=${id}`, { cache: "no-store" });
    const f = await r.json();
    if (!r.ok) throw new Error(f.error || "HTTP " + r.status);
    if (objetoActual !== id) return;
    $("det-titulo").textContent = f.nombre;
    $("det-titulo").className = f.calidad ? `q-${f.calidad}` : "";
    const graf = el("div");
    const sec = el("section", "det-sec");
    sec.append(cabeceraHistorial(graf, id), graf);
    $("det-cuerpo").replaceChildren(
      el("p", "small", "Sin precio en este mercado en el último escaneo guardado: no hay recomendación."),
      accionesObjeto(id, null), fichaNodo(f, false), sec);
    const cita = atribucion();
    if (cita) $("det-cuerpo").append(cita);
    cargarHistorialEn(graf, id, rangoHistorial).catch((e) => graf.replaceChildren(el("p", "bad small", e.message)));
  } catch (e) {
    $("det-cuerpo").replaceChildren(el("p", "bad", "No se pudo cargar la ficha: " + e.message));
  }
}

function accionesObjeto(id, fila) {
  const cont = el("div", "acciones-objeto");
  const inv = el("button", "btn btn-small btn-rojo", "Añadir al inventario");
  inv.type = "button";
  inv.addEventListener("click", () => {
    location.hash = "#/inventario";
    $("inv-agregar").open = true;
    const nombre = fila?.nombre ?? $("det-titulo").textContent;
    $("inv-objeto").value = `${nombre} #${id}`;
    $("inv-cantidad").focus();
  });
  const hist = el("button", "btn btn-small btn-piedra", "Historial completo");
  hist.type = "button";
  hist.addEventListener("click", () => { location.hash = `#/historial/${id}`; });
  cont.append(inv, hist);
  if (fila) {
    const fav = el("button", "btn btn-small btn-piedra", fila.favorito ? "★ Quitar de favoritos" : "☆ Añadir a favoritos");
    fav.type = "button";
    fav.addEventListener("click", async () => {
      await cambiarFavorito(id);
      const f = filasTabla.find((x) => x.id === id);
      fav.textContent = f?.favorito ? "★ Quitar de favoritos" : "☆ Añadir a favoritos";
    });
    cont.append(fav);
  }
  return cont;
}

async function cambiarFavorito(id) {
  const fila = filasTabla.find((f) => f.id === id);
  if (!fila || !ultimo) return;
  const nuevo = !fila.favorito;
  fila.favorito = nuevo;
  pintarTabla();
  try {
    const r = await fetch("/api/favorito", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mercado: ultimo.mercado.clave, id, favorito: nuevo }),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
  } catch {
    fila.favorito = !nuevo;
    pintarTabla();
  }
}

// ---------- historial (panel y sección) ----------
function cabeceraHistorial(graf, id) {
  const cab = el("div", "card-head");
  cab.append(el("h3", "", "Historial"));
  const grupo = el("div", "periodos");
  grupo.setAttribute("role", "group");
  grupo.setAttribute("aria-label", "Periodo del historial");
  for (const [rango, txt] of [["24h", "24 h"], ["7d", "7 días"], ["30d", "30 días"], ["90d", "90 días"]]) {
    const b = el("button", "btn btn-small btn-piedra", txt);
    b.type = "button";
    b.dataset.rango = rango;
    b.setAttribute("aria-pressed", String(rango === rangoHistorial));
    b.addEventListener("click", () => {
      rangoHistorial = rango;
      for (const x of grupo.children) x.setAttribute("aria-pressed", String(x.dataset.rango === rango));
      cargarHistorialEn(graf, id, rango).catch((e) => graf.replaceChildren(el("p", "bad small", e.message)));
    });
    grupo.append(b);
  }
  cab.append(grupo);
  return cab;
}

async function cargarHistorialEn(cont, id, rango, resumen = null) {
  // Cada contenedor recuerda su última petición: una respuesta antigua no pisa a una nueva.
  const token = String(Math.random());
  cont.dataset.token = token;
  cont.replaceChildren(el("p", "muted small", "Cargando historial…"));
  const r = await fetch(`/api/historial-fuente?mercado=${encodeURIComponent(ultimo.mercado.clave)}&id=${id}&rango=${rango}`);
  const h = await r.json();
  if (!r.ok) throw new Error(h.error || "HTTP " + r.status);
  if (cont.dataset.token !== token || !cont.isConnected) return h;
  dibujarGrafico(cont, { puntos: h.puntos, nombres: h.nombres, cantidad: h.cantidad, med7: h.med7, med30: h.med30, pasoMs: h.paso_ms });
  if (h.nota) cont.append(el("p", "muted small", h.nota));
  const variacion = variacionPeriodo(h.puntos);
  if (variacion) cont.append(el("p", "small " + (variacion.cambio > 0 ? "sube" : variacion.cambio < 0 ? "baja" : ""), variacion.texto));
  if (h.atribucion) {
    const p = el("p", "atribucion small");
    const a = el("a", "", h.atribucion.texto);
    a.href = h.atribucion.url; a.target = "_blank"; a.rel = "noopener";
    p.append(a);
    cont.append(p);
  }
  if (resumen) pintarResumenHistorial(resumen, h);
  return h;
}

/** Variación del periodo con la primera y la última observación de la compra mínima (o la otra serie). */
function variacionPeriodo(puntos) {
  const validos = (puntos || []).filter((p) => p[1] != null);
  const serie = validos.length >= 2 ? 1 : 2;
  const v = (puntos || []).filter((p) => p[serie] != null);
  if (v.length < 2 || !v[0][serie]) return null;
  const cambio = v[v.length - 1][serie] / v[0][serie] - 1;
  const nombre = serie === 1 ? "compra mínima" : "segunda serie";
  return {
    cambio,
    texto: `En el periodo, la ${nombre} pasó de ${formatearMoneda(v[0][serie])} a ${formatearMoneda(v[v.length - 1][serie])} (${formatearPct(100 * cambio)}), ` +
      `entre ${fecha(new Date(v[0][0]).toISOString())} y ${fecha(new Date(v[v.length - 1][0]).toISOString())}.`,
  };
}

function pintarResumenHistorial(dl, h) {
  dl.replaceChildren();
  const u = h.ultimo;
  const f = (k, v) => { if (v != null && v !== "—") dl.append(el("dt", "", k), el("dd", "", v)); };
  if (u) {
    f("Compra mínima (actual)", formatearMoneda(u.precio));
    f("Mediana (actual)", formatearMoneda(u.mediana));
    f("Unidades publicadas", u.cantidad?.toLocaleString("es"));
    f("Subastas", u.subastas?.toLocaleString("es"));
    f("Mediana 7 días", u.mediana7d != null ? formatearMoneda(u.mediana7d) : null);
    f("Mediana 30 días", u.mediana30d != null ? formatearMoneda(u.mediana30d) : null);
    f("Mediana 90 días", u.mediana90d != null ? formatearMoneda(u.mediana90d) : "sin historial suficiente");
    f("Escaneo", u.hora ? fecha(u.hora) + hace(u.hora) : null);
  }
  const pts = h.puntos.filter((p) => p[1] != null);
  if (pts.length) {
    const minimo = pts.reduce((a, p) => (p[1] < a[1] ? p : a));
    const maximo = pts.reduce((a, p) => (p[1] > a[1] ? p : a));
    // Son extremos de la serie de COMPRA MÍNIMA (la fuente no publica el máximo de los anuncios).
    f(`Compra mínima más baja (${h.rango})`, `${formatearMoneda(minimo[1])} · ${fecha(new Date(minimo[0]).toISOString())}`);
    f(`Compra mínima más alta (${h.rango})`, `${formatearMoneda(maximo[1])} · ${fecha(new Date(maximo[0]).toISOString())}`);
  }
  if (h.ventas) f("Ventas estimadas por día", `${h.ventas.por_dia.toLocaleString("es")} (estimación de AHledger, no ventas confirmadas)`);
  if (!dl.children.length) f("Sin datos", "Esta fuente no tiene observaciones de este objeto en el periodo.");
  f("Promedio", "no publicado por la fuente (no se calcula a partir de la mediana)");
}

async function pintarHistorial() {
  const id = objetoActual;
  $("hist-ayuda").hidden = id != null;
  for (const b of $("periodos").children) b.setAttribute("aria-pressed", String(b.dataset.rango === rangoHistorial));
  if (id == null) { $("hist-grafico").replaceChildren(); $("hist-resumen").replaceChildren(); return; }
  const fila = filasTabla.find((f) => f.id === id);
  $("hist-titulo").textContent = `Historial de precios · ${fila?.nombre ?? "#" + id}`;
  try {
    await cargarHistorialEn($("hist-grafico"), id, rangoHistorial, $("hist-resumen"));
  } catch (e) {
    $("hist-grafico").replaceChildren(el("p", "bad small", "No se pudo cargar el historial: " + e.message));
  }
}
for (const b of $("periodos").children) {
  b.addEventListener("click", () => { rangoHistorial = b.dataset.rango; pintarHistorial(); });
}

// ---------- oportunidades ----------
function pintarOportunidades() {
  const enInv = new Set((inventario?.filas ?? []).map((f) => f.item_id));
  for (const [rec, id] of [["VENDER", "op-vender"], ["GUARDAR", "op-guardar"]]) {
    const ol = $(id);
    ol.replaceChildren();
    const lista = filasTabla.filter((f) => f.rec === rec)
      .sort((a, b) => (enInv.has(b.id) - enInv.has(a.id)) || ((b.puntos ?? 0) - (a.puntos ?? 0)) || ((b.neto ?? 0) - (a.neto ?? 0)));
    if (!lista.length) ol.append(el("li", "muted", "Ninguno con las reglas actuales."));
    for (const f of lista.slice(0, 50)) {
      const li = el("li");
      const b = el("button", "objeto-nombre enlace" + (f.calidad ? ` q-${f.calidad}` : ""), f.nombre);
      b.type = "button";
      b.addEventListener("click", () => { location.hash = `#/objeto/${f.id}`; });
      li.append(b, el("div", "objeto-id",
        `${enInv.has(f.id) ? "En tu inventario · " : ""}${f.resumen ?? ""} · ${formatearMoneda(f.precio_ref)} · confianza ${f.nivel ?? "—"} ${f.puntos ?? ""}`));
      ol.append(li);
    }
  }
}

// ---------- árbol de categorías (columna izquierda) ----------
function pintarArbol() {
  const ul = $("arbol-cat");
  ul.replaceChildren();
  const cuenta = new Map();
  for (const f of filasTabla) {
    const c = cuenta.get(f.categoria) ?? { n: 0, subs: new Map() };
    c.n++;
    if (f.subcategoria) c.subs.set(f.subcategoria, (c.subs.get(f.subcategoria) ?? 0) + 1);
    cuenta.set(f.categoria, c);
  }
  const catSel = $("f-categoria").value, subSel = $("f-subcategoria").value;
  const boton = (texto, n, activo, alPulsar) => {
    const b = el("button", "arbol-btn", "");
    b.type = "button";
    b.append(el("span", "", texto), el("span", "arbol-n", String(n)));
    if (activo) b.setAttribute("aria-current", "true");
    b.addEventListener("click", alPulsar);
    return b;
  };
  const todas = el("li");
  todas.append(boton("Todas", filasTabla.length, !catSel, () => elegirCategoria("", "")));
  ul.append(todas);
  for (const c of categorias(filasTabla)) {
    const info = cuenta.get(c);
    const li = el("li");
    li.append(boton(c, info.n, catSel === c && !subSel, () => elegirCategoria(c, "")));
    if (catSel === c && info.subs.size) {
      const sub = el("ul");
      for (const [s, n] of [...info.subs].sort((a, b) => a[0].localeCompare(b[0], "es"))) {
        const li2 = el("li");
        li2.append(boton(s, n, subSel === s, () => elegirCategoria(c, s)));
        sub.append(li2);
      }
      li.append(sub);
    }
    ul.append(li);
  }
}

function elegirCategoria(cat, sub) {
  $("f-categoria").value = cat;
  rellenarSubcategorias();
  $("f-subcategoria").value = sub;
  visibles = POR_PAGINA;
  pintarTabla();
  pintarArbol();
}

// ---------- buscador principal con autocompletado (patrón combobox) ----------
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
    const txt = el("span");
    txt.append(el("span", s.calidad ? `q-${s.calidad}` : "", s.nombre), " ",
      el("span", "cat-sub", `#${s.id} · ${NOMBRE_CALIDAD[s.calidad] ?? "calidad desconocida"}` +
        (s.clase ? ` · ${[s.clase, s.subclase].filter(Boolean).join(" › ")}` : "") + (s.en_mercado ? "" : " · sin precio aquí")));
    li.append(iconoNodo(s.icono, s.nombre), txt);
    lista.append(li);
  });
  lista.hidden = !ac.abierto || sugerencias.length === 0;
  input.setAttribute("aria-expanded", String(!lista.hidden));
  if (ac.activo >= 0) {
    input.setAttribute("aria-activedescendant", `sug-${ac.activo}`);
    $(`sug-${ac.activo}`)?.scrollIntoView({ block: "nearest" });
  } else input.removeAttribute("aria-activedescendant");
}

async function pedirSugerencias() {
  const q = $("buscador").value.trim();
  const n = ++sugerenciasN;   // descarta respuestas de búsquedas anteriores
  if (!q || !ultimo) { sugerencias = []; ac = conSugerencias(ac, 0); pintarSugerencias(); $("anuncio").textContent = ""; return; }
  try {
    const r = await fetch(`/api/catalogo?mercado=${encodeURIComponent(ultimo.mercado.clave)}&q=${encodeURIComponent(q)}`, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok || n !== sugerenciasN) return;
    sugerencias = d.resultados.slice(0, 10);
  } catch { return; }
  ac = conSugerencias(ac, sugerencias.length);
  pintarSugerencias();
  $("anuncio").textContent = sugerencias.length ? `${sugerencias.length} sugerencias. Tab o flechas para recorrerlas.` : "Sin coincidencias.";
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

function buscarEnMercado() {
  const q = $("buscador").value.trim();
  $("f-texto").value = q;
  visibles = POR_PAGINA;
  pintarTabla();
  location.hash = "#/mercado";
}

$("buscador").addEventListener("input", () => {
  ac = alEscribir(ac);
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
// Ratón o toque: pointerdown para que el clic llegue antes de que el campo pierda el foco.
$("sugerencias").addEventListener("pointerdown", (ev) => {
  const li = ev.target.closest("[data-k]");
  if (!li) return;
  ev.preventDefault();
  confirmarSugerencia(Number(li.dataset.k));
});

$("btn-buscar").addEventListener("click", () => {
  if (ac.abierto && ac.activo >= 0) confirmarSugerencia(ac.activo);
  else buscarEnMercado();
});

$("btn-restablecer").addEventListener("click", () => {
  $("buscador").value = "";
  sugerencias = []; ac = { ...ESTADO_INICIAL }; pintarSugerencias();
  for (const id of ["f-texto", "f-nivel-min", "f-nivel-max", "f-precio-min", "f-precio-max"]) $(id).value = "";
  for (const id of ["f-categoria", "f-calidad", "f-recomendacion"]) $(id).value = "";
  rellenarSubcategorias();
  $("f-orden").value = "nombre:asc";
  $("f-favoritos").checked = false;
  $("f-ausentes").checked = true;
  visibles = POR_PAGINA;
  pintarTabla();
  pintarArbol();
});

// ---------- actualización en vivo ----------
// Cada 30 s (o cada 5 s justo después de pulsar «Actualizar») se consulta una huella mínima
// del mercado; si cambió, se recargan el estado y la tabla sin recargar la página.
let firmaVersion = null;
let rapidoHasta = 0;

async function vigilar() {
  if (document.visibilityState === "visible" && !$("vista-panel").hidden && ultimo?.mercado?.clave) {
    try {
      const r = await fetch("/api/version?mercado=" + encodeURIComponent(ultimo.mercado.clave), { cache: "no-store" });
      if (r.status === 401) { await cargar(); }
      else if (r.ok) {
        const firma = JSON.stringify(await r.json());
        if (firmaVersion !== null && firma !== firmaVersion) {
          await cargar();
          await cargarPrecios();
          cargarInventario();
          cargarVentas();
        }
        firmaVersion = firma;
      }
    } catch { /* sin red: se reintenta en la próxima vuelta */ }
  }
  setTimeout(vigilar, Date.now() < rapidoHasta ? 5000 : 30000);
}
async function refrescar() {
  await cargar();
  await cargarPrecios();
  rellenarListaObjetos();
  pintarArbol();
  cargarInventario();
  cargarVentas();
  cargarAjustes();
  aplicarRuta();
}

// ---------- selector de mercado ----------
$("sel-mercado").addEventListener("change", async (ev) => {
  mercadoActual = ev.target.value;
  guardado.escribir(mercadoActual);
  filasTabla = []; firmaVersion = null; inventario = null; ventas = null; pintarTabla();
  // Al cambiar de mercado la ficha abierta deja de valer (otro mercado = otros datos).
  objetoActual = null;
  $("det-titulo").textContent = "Ficha del objeto";
  $("det-titulo").className = "";
  $("det-cuerpo").replaceChildren(el("p", "muted", "Elige un objeto de la lista o búscalo arriba."));
  if (leerRuta(location.hash).vista === "objeto") history.replaceState(null, "", "#/mercado");
  await refrescar();
});

// ---------- acceso ----------
$("form-login").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const err = $("error-login");
  err.hidden = true;
  try {
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
  $("btn-salir").hidden = true;
  cargar();
});

// ---------- actualizar (solo mercado TSM) ----------
$("btn-actualizar").addEventListener("click", async () => {
  const btn = $("btn-actualizar"), aviso = $("aviso-boton");
  btn.disabled = true;
  try {
    const r = await fetch("/api/actualizar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mercado: ultimo?.mercado?.clave }),
    });
    const d = await r.json();
    aviso.textContent = d.mensaje || d.error || "Hecho";
    aviso.hidden = false;
    rapidoHasta = Date.now() + 3 * 60_000;   // vigilar cada 5 s durante 3 min
  } catch (e) {
    aviso.textContent = "No se pudo pedir la actualización: " + e.message;
    aviso.hidden = false;
  } finally {
    setTimeout(() => { btn.disabled = false; }, 10000);
  }
});

// ---------- importación CSV ----------
let lectura = null, nombreArchivo = "";

async function revisarCsv() {
  const archivo = $("archivo-csv").files[0];
  const resumen = $("resumen-csv"), lista = $("errores-csv");
  $("btn-importar").disabled = true;
  $("resultado-importar").hidden = true;
  lectura = null;
  if (!archivo) { resumen.hidden = lista.hidden = true; return; }
  nombreArchivo = archivo.name;
  const horaManual = $("hora-manual").value ? new Date($("hora-manual").value).toISOString() : null;
  lectura = leerCsvPrecios(await archivo.text(), horaManual);

  lista.innerHTML = "";
  for (const e of lectura.errores) {
    const li = document.createElement("li"); li.textContent = e; lista.append(li);
  }
  lista.hidden = lectura.errores.length === 0;

  if (lectura.errores.length) {
    resumen.textContent = `${archivo.name}: ${lectura.errores.length} error(es). Corrígelos para poder importar.`;
    resumen.className = "small bad";
  } else {
    const ej = lectura.filas[0];
    resumen.textContent = `${archivo.name}: ${lectura.filas.length} objetos listos · hora del dato ${fecha(lectura.horaDato)}`
      + ` · ejemplo: ${ej.name} = ${formatearMoneda(ej.min_buyout ?? ej.market_value)}`
      + (lectura.avisos.length ? ` · avisos: ${lectura.avisos.join("; ")}` : "");
    resumen.className = "small ok";
    $("btn-importar").disabled = false;
  }
  resumen.hidden = false;
}

$("archivo-csv").addEventListener("change", revisarCsv);
$("hora-manual").addEventListener("change", revisarCsv);

$("btn-importar").addEventListener("click", async () => {
  if (!lectura || lectura.errores.length || !ultimo) return;
  const btn = $("btn-importar"), out = $("resultado-importar");
  btn.disabled = true;
  try {
    const r = await fetch("/api/importar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mercado: ultimo.mercado.clave, hora_dato: lectura.horaDato,
        nombre_archivo: nombreArchivo, filas: lectura.filas,
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
    out.textContent = d.estado === "nuevo_dato"
      ? `Importados ${d.filas} objetos.`
      : `No se guardó nada: ${d.mensaje || d.estado}.`;
    out.className = "small " + (d.estado === "nuevo_dato" ? "ok" : "muted");
    $("archivo-csv").value = "";
    lectura = null;
    refrescar();
  } catch (e) {
    out.textContent = "Error al importar: " + e.message;
    out.className = "small bad";
    btn.disabled = false;
  }
  out.hidden = false;
});

// ---------- demo ----------
$("btn-demo").addEventListener("click", async () => {
  const btn = $("btn-demo"), out = $("resultado-demo");
  btn.disabled = true;
  out.textContent = "Generando…"; out.className = "small muted"; out.hidden = false;
  try {
    const r = await fetch("/api/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dias: Number($("dias-demo").value) }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
    out.textContent = `Generados ${d.filas} precios FICTICIOS (${d.objetos} objetos, ${d.dias} días).`;
    out.className = "small ok";
    refrescar();
  } catch (e) {
    out.textContent = "Error: " + e.message;
    out.className = "small bad";
  } finally {
    btn.disabled = false;
  }
});

(async () => {
  await refrescar();
  setTimeout(vigilar, 30000);
})();
