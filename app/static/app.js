"use strict";

const $ = (id) => document.getElementById(id);
const fecha = (iso) => iso ? new Date(iso).toLocaleString("es", { dateStyle: "short", timeStyle: "short" }) : "—";
const hace = (iso) => {
  if (!iso) return "";
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return " (ahora)";
  if (min < 120) return ` (hace ${min} min)`;
  return ` (hace ${Math.round(min / 60)} h)`;
};
const ESTADOS = {
  nuevo_dato: ["Dato nuevo", "ok"], sin_cambios: ["Sin cambios", "muted"],
  no_modificado: ["No modificado (304)", "muted"], error: ["Error", "bad"],
};

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

async function cargar() {
  let r, s;
  try {
    r = await fetch("/api/estado", { cache: "no-store" });
    s = await r.json();
  } catch (e) {
    s = { error: e.message };
  }

  if (r && r.status === 401) {
    $("market").textContent = "privado";
    mostrar("login");
    $("clave").focus();
    return;
  }
  mostrar("panel");

  if (!r || !r.ok) {
    $("market").textContent = "sin conexión";
    $("titulo").textContent = "Sin conexión con la base de datos";
    $("subtitulo").textContent = (s && s.error) || "Error desconocido";
    filas($("status"), [["Servidor", "sin acceso a Supabase", "bad"]]);
    return;
  }

  $("market").textContent = s.mercado.nombre;
  $("btn-salir").hidden = !s.autenticado;

  const pend = s.base_de_datos.migraciones_pendientes || [];
  if (pend.length) {
    $("titulo").textContent = "Falta configurar Supabase";
    $("subtitulo").textContent = "Ejecuta configurar.bat (migraciones pendientes: " + pend.join(", ") + ").";
    filas($("status"), [["Base de datos", "Supabase · proyecto " + s.base_de_datos.proyecto]]);
    return;
  }

  const a = s.actualizacion;
  const viejo = a.hora_dato_original && (Date.now() - new Date(a.hora_dato_original)) > 8 * 3600e3;
  $("titulo").textContent = a.versiones_guardadas ? "Recibiendo datos reales de TSM" : "Conectado, esperando el primer dato";
  $("subtitulo").textContent = "Hito 2 de 10: consulta automática. La tabla de precios y las recomendaciones llegan en los hitos 4 y 5.";

  const errorResuelto = a.ultimo_error && a.ultima_consulta_ok &&
    new Date(a.ultima_consulta_ok) > new Date(a.ultimo_error_hora);

  filas($("status"), [
    ["Proveedor", s.mercado.proveedor + " · archivo público"],
    ["Mercado", s.mercado.nombre + " (" + s.mercado.clave + ")"],
    ["Base de datos", "Supabase · proyecto " + s.base_de_datos.proyecto],
    ["Consulta automática", a.configurada ? (a.en_curso ? "en curso…" : "activa (en Supabase)") : "no activada — ejecuta configurar.bat", a.configurada ? "ok" : "bad"],
    ["Hora del dato original", fecha(a.hora_dato_original) + hace(a.hora_dato_original) + (viejo ? " · ANTIGUO" : ""), viejo ? "bad" : ""],
    ["Última consulta correcta", fecha(a.ultima_consulta_ok) + hace(a.ultima_consulta_ok)],
    ["Próxima actualización", a.proxima ? "hacia las " + fecha(a.proxima) + " (±5 min)" : (a.configurada ? "en cuanto se pueda" : "—")],
    ["Versiones guardadas", String(a.versiones_guardadas) + " · " + a.objetos + " objetos"],
    ["Fallos seguidos", String(a.fallos_seguidos), a.fallos_seguidos ? "bad" : ""],
    ["Último error", a.ultimo_error ? fecha(a.ultimo_error_hora) + " · " + a.ultimo_error + (errorResuelto ? " (resuelto)" : "") : "—"],
  ]);

  const ul = $("registro");
  ul.innerHTML = "";
  if (!s.registro.length) ul.innerHTML = '<li class="muted">Todavía no hay consultas.</li>';
  for (const x of s.registro) {
    const [txt, cls] = ESTADOS[x.estado] || [x.estado, ""];
    const li = document.createElement("li");
    li.innerHTML = '<span class="muted"></span> <strong></strong> <span class="muted"></span>';
    li.children[0].textContent = fecha(x.hora);
    li.children[1].textContent = txt;
    li.children[1].className = cls;
    li.children[2].textContent = [x.filas ? x.filas + " objetos" : "", x.mensaje || ""].filter(Boolean).join(" · ");
    ul.append(li);
  }
}

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
    await cargar();
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

$("btn-actualizar").addEventListener("click", async () => {
  const btn = $("btn-actualizar"), aviso = $("aviso-boton");
  btn.disabled = true;
  try {
    const r = await fetch("/api/actualizar", { method: "POST" });
    const d = await r.json();
    aviso.textContent = d.mensaje || d.error || d.detail || "Hecho";
    aviso.hidden = false;
    setTimeout(cargar, 8000);
  } catch (e) {
    aviso.textContent = "No se pudo pedir la actualización: " + e.message;
    aviso.hidden = false;
  } finally {
    setTimeout(() => { btn.disabled = false; }, 10000);
  }
});

cargar();
setInterval(() => { if (!$("vista-panel").hidden) cargar(); }, 60000);
