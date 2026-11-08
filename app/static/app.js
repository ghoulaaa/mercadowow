import { leerCsvPrecios } from "./csv.js";
import { formatearMoneda } from "./moneda.js";
import { categorias, filtrar, formatearPct, ordenar, prepararFilas } from "./tabla.js";

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
    op.textContent = m.ficticio ? "DEMO (ficticio)" : (m.automatico ? "Real · TSM" : "Real · importación manual");
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
  if (demo) {
    $("titulo").textContent = a.versiones_guardadas ? "Datos FICTICIOS de demostración" : "Mercado de demostración vacío";
    $("subtitulo").textContent = "Todo lo que ves aquí es inventado y está separado de los datos reales.";
  } else if (manual) {
    $("titulo").textContent = a.versiones_guardadas ? "Precios importados a mano" : "Sin precios importados";
    $("subtitulo").textContent = "Plan B: precios del mercado PvP Horda cargados desde un CSV. Se guardan aparte de los de TSM.";
  } else {
    $("titulo").textContent = a.versiones_guardadas ? "Recibiendo datos reales de TSM" : "Conectado, esperando el primer dato";
    $("subtitulo").textContent = "Hito 3 de 10. La tabla de precios y las recomendaciones llegan en los hitos 4 y 5.";
  }

  const errorResuelto = a.ultimo_error && a.ultima_consulta_ok &&
    new Date(a.ultima_consulta_ok) > new Date(a.ultimo_error_hora);

  const comunes = [
    ["Mercado", m.nombre + " (" + m.clave + ")"],
    ["Origen de los datos", demo ? "FICTICIO (generado)" : (auto ? m.proveedor + " · archivo público" : "Importación manual (CSV)"), demo ? "bad" : ""],
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
    texto: $("f-texto").value, categoria: $("f-categoria").value,
    soloFavoritos: $("f-favoritos").checked, ocultarAusentes: $("f-ausentes").checked, clave, dir,
  };
};

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
  pintarTabla();
  pintarAlertas();
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
    const txt = document.createElement("div");
    const nom = document.createElement("div"); nom.className = "objeto-nombre"; nom.textContent = x.nombre;
    const sub = document.createElement("div"); sub.className = "objeto-id";
    sub.textContent = `#${x.id} · ${x.categoria}` + (x.ausente ? ` · ausente desde ${fecha(x.hora)}` : "");
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
    tdOferta.textContent = "sin dato"; tdOferta.title = "TSM no publica cantidades en venta";
    const tdRec = document.createElement("td"); tdRec.dataset.k = "Recomendación:";
    tdRec.innerHTML = '<span class="etiqueta">Pendiente</span>';
    tdRec.title = "El motor de recomendaciones llega en el Hito 5";
    const tdConf = document.createElement("td"); tdConf.dataset.k = "Confianza:"; tdConf.textContent = "—";

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

let temporizadorFiltro = null;
for (const id of ["f-texto", "f-categoria", "f-orden", "f-favoritos", "f-ausentes"]) {
  $(id).addEventListener(id === "f-texto" ? "input" : "change", () => {
    clearTimeout(temporizadorFiltro);
    temporizadorFiltro = setTimeout(() => { visibles = POR_PAGINA; pintarTabla(); }, id === "f-texto" ? 150 : 0);
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
}

// ---------- selector de mercado ----------
$("sel-mercado").addEventListener("change", async (ev) => {
  mercadoActual = ev.target.value;
  guardado.escribir(mercadoActual);
  filasTabla = []; firmaVersion = null; pintarTabla();
  await cargar();
  await cargarPrecios();
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
    const r = await fetch("/api/actualizar", { method: "POST" });
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
  await cargar();
  await cargarPrecios();
  setTimeout(vigilar, 30000);
})();
