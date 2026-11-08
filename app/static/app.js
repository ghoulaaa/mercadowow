import { leerCsvInventario, leerCsvPrecios } from "./csv.js";
import { dibujarGrafico } from "./grafico.js";
import { formatearMoneda, parsearMoneda } from "./moneda.js";
import { NOMBRE_REC, categorias, filtrar, formatearPct, ordenar, prepararFilas } from "./tabla.js";

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
    texto: $("f-texto").value, categoria: $("f-categoria").value, recomendacion: $("f-recomendacion").value,
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

  const res = d.resumen || {};
  $("tile-vender-v").textContent = res.vender ?? "—";
  $("tile-guardar-v").textContent = res.guardar ?? "—";
  const top = (rec) => filasTabla.filter((f) => f.rec === rec).sort((a, b) => (b.puntos ?? 0) - (a.puntos ?? 0))
    .slice(0, 3).map((f) => f.nombre).join(", ");
  $("tile-vender-n").textContent = res.vender ? top("VENDER") : "Ninguna con las reglas actuales";
  $("tile-guardar-n").textContent = res.guardar ? top("GUARDAR") : "Ninguno con las reglas actuales";
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
    const nom = document.createElement("button");
    nom.type = "button"; nom.className = "objeto-nombre enlace"; nom.dataset.detalle = x.id; nom.textContent = x.nombre;
    nom.title = "Ver por qué se recomienda";
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

let temporizadorFiltro = null;
for (const id of ["f-texto", "f-categoria", "f-recomendacion", "f-orden", "f-favoritos", "f-ausentes"]) {
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

// ---------- tarjetas de resumen → filtro ----------
for (const id of ["tile-vender", "tile-guardar"]) {
  $(id).addEventListener("click", () => {
    $("f-recomendacion").value = $(id).dataset.rec;
    $("f-ausentes").checked = true;
    visibles = POR_PAGINA;
    pintarTabla();
    $("card-tabla").scrollIntoView({ behavior: "smooth", block: "start" });
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
  const dlg = $("detalle"), cuerpo = $("det-cuerpo");
  const fila = filasTabla.find((f) => f.id === id);
  $("det-titulo").textContent = fila ? fila.nombre : `#${id}`;
  cuerpo.replaceChildren(el("p", "muted", "Cargando explicación…"));
  if (!dlg.open) dlg.showModal();
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
  if (d.en_inventario) nodos.push(el("p", "small", `Tienes ${d.en_inventario} unidades en tu inventario.`));
  const secGraf = el("section", "det-sec");
  secGraf.append(el("h3", "", "Historial de 30 días"));
  const graf = el("div", "");
  graf.id = "det-grafico";
  graf.append(el("p", "muted small", "Cargando gráfico…"));
  secGraf.append(graf);
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
  fila2("Beneficio y margen", "necesitan el coste de compra: llegan con el inventario (Hito 6)");
  dinero.append(dl);
  nodos.push(dinero);

  const conf = el("section", "det-sec");
  conf.append(el("h3", "", `Confianza: ${l.nivel} · ${l.puntos}/100`));
  conf.append(el("p", "muted small", "Índice de calidad de los datos, no una probabilidad de acierto. Sin datos de liquidez el nivel no pasa de «Media»."));
  const tb = el("table", "tabla mini");
  for (const p of [...d.desglose, { k: "Antigüedad del dato", puntos: l.p_edad, max: 20, detalle: l.horas_dato != null ? `${String(l.horas_dato).replace(".", ",")} h` : "—" }]) {
    const tr = el("tr");
    tr.append(el("td", "", p.k), el("td", "num", `${p.puntos}/${p.max}`), el("td", "muted", p.detalle));
    tb.append(tr);
  }
  conf.append(tb);
  nodos.push(conf);
  nodos.push(el("p", "muted small", `Calculado ${fecha(d.calculado_en)} con el escaneo de ${fecha(d.hora_dato)}. No es una garantía de subida ni de venta.`));
  cuerpo.replaceChildren(...nodos);

  try {
    const r = await fetch(`/api/historial?mercado=${encodeURIComponent(ultimo.mercado.clave)}&id=${id}&dias=30`, { cache: "no-store" });
    const h = await r.json();
    if (!r.ok) throw new Error(h.error || "HTTP " + r.status);
    if ($("detalle").open && graf.isConnected) dibujarGrafico(graf, h);
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
$("det-cerrar").addEventListener("click", () => $("detalle").close());
$("detalle").addEventListener("click", (ev) => { if (ev.target === $("detalle")) $("detalle").close(); });

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
  cargarInventario();
  cargarAjustes();
}

// ---------- selector de mercado ----------
$("sel-mercado").addEventListener("change", async (ev) => {
  mercadoActual = ev.target.value;
  guardado.escribir(mercadoActual);
  filasTabla = []; firmaVersion = null; inventario = null; pintarTabla();
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
  await refrescar();
  setTimeout(vigilar, 30000);
})();
