// Pestaña «Sniper» de Fabricación: estado del Crafting Sniper, ranking del último análisis del servidor,
// plan con presupuesto, historial de avisos y el panel «Alertas Discord».
// La página nunca ve ni envía a Discord: guarda la configuración por /api/sniper y pide a la Edge Function
// las pruebas y los envíos. La URL del webhook solo viaja una vez (al darla de alta) y no se vuelve a mostrar.

import { CLASES, claseDe, planConPresupuesto } from "./sniper.js";
import { parsearMoneda } from "./moneda.js";

const RIESGO = { bajo: "Bajo", medio: "Medio", alto: "Alto", desconocido: "Desconocido" };
const ORDEN_CLASES = ["rentable", "ganga", "epica", "legendaria", "excepcional"];

/**
 * @param {object} d  utilidades de app.js: {$, el, monedaNodo, iconoNodo, nom, nombreProf, fecha, hace, avisar, formatear,
 *                    abrirReceta(spell), profesiones(): string[]}
 */
export function crearVistaSniper(d) {
  const { $, el } = d;
  let estado = null, cargando = null, sondeo = null;
  const raiz = $("fab-sniper");
  const filtro = { texto: "", profesion: "" };

  const boton = (texto, cls = "btn btn-piedra btn-small", datos = {}) => {
    const b = el("button", cls, texto); b.type = "button"; Object.assign(b.dataset, datos); return b;
  };
  const pct = (v) => (v == null ? "—" : `${v.toLocaleString("es", { maximumFractionDigits: v !== 0 && Math.abs(v) < 10 ? 1 : 0 })} %`);
  const moneda = (v) => d.monedaNodo(v);
  const pildora = (clave) => {
    const c = claseDe(clave);
    const s = el("span", `sn-clase sn-${c.clave}`, `${c.emoji} ${c.nombre}`);
    return s;
  };

  async function pedir(metodo = "GET", cuerpo = null) {
    const r = await fetch("/api/sniper", {
      method: metodo, cache: "no-store",
      ...(cuerpo ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) } : {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    return j;
  }

  async function cargar() {
    if (cargando) return cargando;
    cargando = (async () => {
      try { estado = await pedir(); pintar(); }
      catch (e) {
        raiz.replaceChildren(el("p", "bad", /Faltan migraciones/.test(e.message)
          ? "El Crafting Sniper aún no está instalado en Supabase (faltan las migraciones 0045 y 0046)."
          : `No se pudo cargar el Crafting Sniper: ${e.message}`));
      } finally { cargando = null; }
    })();
    return cargando;
  }

  /** Tras pedir algo al servidor: vuelve a leer cada 3 s (máx. 45 s) hasta que cambie el análisis o el historial. */
  function esperarCambio() {
    clearInterval(sondeo);
    const antes = JSON.stringify([estado?.config?.ultimo_analisis, estado?.avisos?.[0]?.id]);
    let vueltas = 0;
    sondeo = setInterval(async () => {
      vueltas++;
      try {
        const nuevo = await pedir();
        if (JSON.stringify([nuevo.config?.ultimo_analisis, nuevo.avisos?.[0]?.id]) !== antes || vueltas > 15) {
          clearInterval(sondeo);
          estado = nuevo; pintar();
          const a = nuevo.avisos?.[0];
          if (a && a.id !== JSON.parse(antes)[1]) d.avisar(a.estado === "enviado" ? `Enviado a Discord (${a.webhook ?? "webhook"}).` : `Discord: ${a.error ?? a.motivo ?? a.estado}`, a.estado === "enviado" ? "" : "bad");
        }
      } catch { if (vueltas > 15) clearInterval(sondeo); }
    }, 3000);
  }

  async function solicitar(cuerpo, mensaje) {
    try { await pedir("POST", cuerpo); d.avisar(mensaje); esperarCambio(); }
    catch (e) { d.avisar(e.message, "bad"); }
  }

  // ---------- pintado ----------
  function pintar() {
    if (!estado) return;
    const c = estado.config, res = c.ultimo_resultado;
    const webhooks = estado.webhooks.filter((w) => w.activo);
    const mercado = estado.mercados.find((m) => m.key === c.market_key)?.nombre ?? c.market_key;

    // Estado y acciones.
    const cab = el("div", "sn-estado");
    const pill = el("span", `sn-pill ${c.activo && webhooks.length ? "on" : "off"}`,
      c.activo && webhooks.length ? "Activo" : !webhooks.length ? "Sin webhook" : "Pausado");
    const info = el("div", "sn-info");
    info.append(el("strong", "", "Crafting Sniper"), el("span", "muted small",
      `${mercado} · ${webhooks.length === 1 ? "1 webhook" : `${webhooks.length} webhooks`} de Discord`
      + (c.ultimo_analisis ? ` · análisis ${d.hace(c.ultimo_analisis)}` : " · aún sin analizar")
      + (res?.escaneo ? ` · precios ${d.hace(res.escaneo)}` : "")));
    const acc = el("div", "sn-acciones");
    acc.append(boton("Analizar ahora", "btn btn-piedra btn-small", { snAnalizar: "1" }),
      boton("Alertas Discord", "btn btn-rojo btn-small", { snConfig: "1" }));
    cab.append(pill, info, acc);

    const nodos = [cab];
    if (!estado.vault) nodos.push(el("p", "fab-error", "Esta base de datos no tiene Supabase Vault: los webhooks se guardarían sin cifrar."));

    // Cifras del último análisis.
    if (res) {
      const k = el("dl", "sn-kpis");
      const kpi = (t, v) => { const dv = el("div"); dv.append(el("dt", "", t), el("dd", "", v)); k.append(dv); };
      kpi("Recetas analizadas", res.recetas.toLocaleString("es"));
      kpi("Oportunidades", res.oportunidades.toLocaleString("es"));
      kpi("Enviadas (última ronda)", res.activo ? res.enviados.toLocaleString("es") : "— (pausado)");
      kpi("Errores de envío", res.errores.toLocaleString("es"));
      nodos.push(k);
      if (res.limite) nodos.push(el("p", "fab-error", "Discord limitó los envíos en la última ronda: el resto se intentará en la siguiente."));
    }

    // Ranking.
    const rk = el("section", "sn-sec");
    const rcab = el("div", "sn-sec-cab");
    rcab.append(el("h2", "", "Oportunidades detectadas"));
    const fl = el("div", "sn-filtros");
    const bus = el("input"); bus.type = "search"; bus.placeholder = "Buscar"; bus.value = filtro.texto; bus.dataset.snBuscar = "1";
    bus.setAttribute("aria-label", "Buscar en las oportunidades");
    const sel = el("select"); sel.dataset.snProf = "1"; sel.setAttribute("aria-label", "Profesión");
    sel.append(new Option("Todas las profesiones", ""));
    for (const p of [...new Set((res?.top ?? []).map((o) => o.profesion))].sort()) sel.append(new Option(d.nombreProf(p), p));
    sel.value = filtro.profesion;
    fl.append(bus, sel);
    rcab.append(fl);
    rk.append(rcab);
    const t = (filtro.texto || "").toLowerCase();
    const lista = (res?.top ?? []).filter((o) => (!filtro.profesion || o.profesion === filtro.profesion)
      && (!t || d.nom(o.id, o.nombre).toLowerCase().includes(t) || o.nombre.toLowerCase().includes(t)));
    if (!res) rk.append(el("p", "muted", "Aún no hay análisis. Pulsa «Analizar ahora» o activa el sniper en «Alertas Discord»."));
    else if (!lista.length) rk.append(el("p", "muted", res.oportunidades ? "Ninguna coincide con la búsqueda." : "Ninguna receta cumple ahora tu configuración. Revisa los mínimos en «Alertas Discord»."));
    else {
      const ol = el("ol", "sn-lista");
      for (const o of lista) ol.append(filaOportunidad(o));
      rk.append(ol);
    }
    rk.append(el("p", "small muted", "Cifras del último análisis del servidor, con los mismos cálculos que «Recetas». Estimaciones: no garantizan la venta ni el plazo."));
    nodos.push(rk);

    // Para revisar (las que más ganarían pero no se avisan).
    if (res?.revisar?.length) {
      const rv = el("details", "sn-sec sn-revisar");
      rv.append(el("summary", "", `Para revisar a mano (${res.revisar.length})`));
      const ul = el("ul", "sn-lista");
      for (const o of res.revisar) ul.append(filaOportunidad(o, true));
      rv.append(ul);
      nodos.push(rv);
    }

    // Plan con presupuesto.
    nodos.push(seccionPresupuesto(res?.top ?? []));
    // Historial.
    nodos.push(seccionHistorial());
    raiz.replaceChildren(...nodos);
  }

  function filaOportunidad(o, revisar = false) {
    const li = el("li", "sn-op");
    li.dataset.id = o.id;
    const nombre = d.nom(o.id, o.nombre);
    const cab = el("div", "sn-op-cab");
    const n = el("div", "sn-op-nombre");
    n.append(el("span", "objeto-nombre" + (o.calidad ? ` q-${o.calidad}` : ""), nombre),
      el("span", "muted small", `${d.nombreProf(o.profesion)}${o.nivel != null ? ` · ${o.nivel}` : ""}`));
    cab.append(d.iconoNodo(o.icono, nombre, o.calidad), n, pildora(o.clase));
    const cifras = el("div", "sn-op-cifras");
    const neta = el("span", "sn-neta"); neta.append("+", moneda(o.neta));
    cifras.append(neta, el("span", "", `ROI ${pct(o.roi)}`));
    const sc = el("span", "sn-score");
    const barra = el("span", "sn-barra"); const relleno = el("span"); relleno.style.width = `${Math.max(0, Math.min(100, o.score))}%`; barra.append(relleno);
    sc.append(el("span", "", `Score ${o.score}`), barra);
    sc.title = `Rentabilidad ${o.partes?.rentabilidad} · Demanda ${o.partes?.demanda} · Estabilidad ${o.partes?.estabilidad} · Materiales ${o.partes?.materiales} · Competencia ${o.partes?.competencia} · Actualidad ${o.partes?.actualidad}`;
    cifras.append(sc, el("span", `sn-riesgo r-${o.riesgo}`, `Riesgo ${RIESGO[o.riesgo]?.toLowerCase() ?? o.riesgo}`),
      el("span", "muted small", `confianza ${o.confianza}`));
    const sec = el("p", "sn-op-sec small");
    sec.append("Coste ", moneda(o.coste), " · venta ", moneda(o.ingresoBruto),
      ` · ${o.ventas == null ? "sin datos de ventas" : `${o.ventas.toLocaleString("es", { maximumFractionDigits: 1 })}/día${o.regional ? " (región)" : ""}`}`,
      o.conservador?.neta != null ? " · conservador " : "", o.conservador?.neta != null ? moneda(o.conservador.neta) : "");
    li.append(cab, cifras, sec);
    const motivos = revisar ? [o.motivoDescarte, ...(o.bloquea ?? [])].filter(Boolean) : o.avisos ?? [];
    if (motivos.length) li.append(el("p", "sn-motivos small", motivos.join(" · ")));
    const acc = el("div", "sn-op-acc");
    acc.append(boton("Ver materiales", "btn btn-piedra btn-small", { snReceta: o.spell }));
    if (!revisar) acc.append(boton("Enviar a Discord", "btn btn-piedra btn-small", { snEnviar: o.spell }));
    li.append(acc);
    return li;
  }

  let presupuesto = "";
  function seccionPresupuesto(top) {
    const sec = el("section", "sn-sec");
    sec.append(el("h2", "", "¿Qué fabrico con mi oro?"));
    const f = el("div", "sn-presu");
    const lbl = el("label", "fab-campo", "Presupuesto");
    const i = el("input"); i.type = "text"; i.placeholder = "p. ej. 500o"; i.value = presupuesto; i.dataset.snPresu = "1";
    lbl.append(i);
    f.append(lbl, boton("Calcular", "btn btn-piedra btn-small", { snCalcular: "1" }));
    sec.append(f);
    let cobre = null;
    try { cobre = presupuesto ? parsearMoneda(presupuesto) : null; } catch { cobre = null; }
    if (cobre) {
      const p = planConPresupuesto(top, cobre);
      if (!p.lineas.length) sec.append(el("p", "muted", "Con ese presupuesto no alcanza para ninguna de las oportunidades actuales."));
      else {
        const ul = el("ul", "sn-plan");
        for (const l of p.lineas) {
          const li = el("li");
          li.append(el("span", "", `${l.veces.toLocaleString("es")} × ${d.nom(l.id, l.nombre)}`), el("span", "muted small", ` (${l.unidades.toLocaleString("es")} u.)`));
          const c = el("span", "sn-plan-c"); c.append(moneda(l.coste), " → +", moneda(l.neta)); li.append(c);
          ul.append(li);
        }
        const tot = el("p", "sn-plan-tot");
        tot.append("Inviertes ", moneda(p.invertido), " · ganancia estimada +", moneda(p.neta), " · te sobra ", moneda(p.sobra));
        sec.append(ul, tot, el("p", "small muted", "Por score. Cada receta, como mucho: lo que permiten los materiales publicados y dos días de ventas estimadas (para no saturar el mercado). Comprar muchas unidades puede salir más caro: la fuente solo publica el precio mínimo."));
      }
    }
    return sec;
  }

  function seccionHistorial() {
    const sec = el("details", "sn-sec sn-hist");
    sec.append(el("summary", "", `Historial de avisos (${estado.avisos.length})`));
    if (!estado.avisos.length) { sec.append(el("p", "muted", "Todavía no se ha enviado nada.")); return sec; }
    const ul = el("ul", "sn-hist-lista");
    for (const a of estado.avisos) {
      const li = el("li", `sn-h-${a.estado}`);
      const quien = a.tipo === "prueba" ? "Notificación de prueba" : d.nom(a.item_id, a.nombre ?? `Receta ${a.spell}`);
      li.append(el("span", "sn-h-fecha small muted", d.fecha(a.enviado)), el("span", "sn-h-obj", quien));
      if (a.clase) li.append(pildora(a.clase));
      if (a.neta != null) { const n = el("span", "small"); n.append("+", moneda(a.neta)); li.append(n); }
      li.append(el("span", "small muted", [a.tipo === "auto" ? null : a.tipo, a.webhook, a.motivo].filter(Boolean).join(" · ")));
      if (a.estado !== "enviado") li.append(el("span", "small bad", a.error ?? a.estado));
      ul.append(li);
    }
    sec.append(ul);
    return sec;
  }

  raiz.addEventListener("input", (ev) => {
    if (ev.target.dataset.snBuscar) { filtro.texto = ev.target.value; const pos = ev.target.selectionStart; pintar(); const b = raiz.querySelector("[data-sn-buscar]"); b.focus(); b.setSelectionRange(pos, pos); }
  });
  raiz.addEventListener("change", (ev) => {
    if (ev.target.dataset.snProf !== undefined) { filtro.profesion = ev.target.value; pintar(); raiz.querySelector("[data-sn-prof]")?.focus(); }
  });
  raiz.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && ev.target.dataset.snPresu) { presupuesto = ev.target.value; pintar(); raiz.querySelector("[data-sn-presu]")?.focus(); }
  });
  raiz.addEventListener("click", (ev) => {
    const t = ev.target;
    if (t.closest("[data-sn-analizar]")) return solicitar({ accion: "analizar" }, "Análisis pedido: los resultados llegan en unos segundos.");
    if (t.closest("[data-sn-config]")) return abrirConfig(t.closest("button"));
    const r = t.closest("[data-sn-receta]");
    if (r) return d.abrirReceta(Number(r.dataset.snReceta), r);
    const e = t.closest("[data-sn-enviar]");
    if (e) return solicitar({ accion: "manual", spell: Number(e.dataset.snEnviar) }, "Envío pedido a Discord.");
    if (t.closest("[data-sn-calcular]")) {
      presupuesto = raiz.querySelector("[data-sn-presu]").value;
      try { if (presupuesto) parsearMoneda(presupuesto); } catch (er) { d.avisar(er.message, "bad"); return; }
      pintar();
    }
  });

  // ---------- panel «Alertas Discord» ----------
  const panel = $("fab-sniper-cfg");
  let opener = null;
  function abrirConfig(desde) {
    opener = desde;
    pintarConfig();
    panel.hidden = false; $("fab-velo").hidden = false;
    document.body.classList.add("fab-con-panel");
    requestAnimationFrame(() => panel.querySelector("h2")?.focus());
  }
  function cerrarConfig() {
    panel.hidden = true; $("fab-velo").hidden = true;
    document.body.classList.remove("fab-con-panel");
    opener?.focus();
  }
  panel.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.preventDefault(); cerrarConfig(); } });
  $("fab-velo").addEventListener("click", () => { if (!panel.hidden) cerrarConfig(); });

  function campo(etiqueta, input, ayuda = null) {
    const l = el("label", "fab-campo", etiqueta);
    l.append(input);
    if (ayuda) l.append(el("span", "sn-ayuda", ayuda));
    return l;
  }
  function numero(nombre, valor, { min, max, paso = 1 } = {}) {
    const i = el("input"); i.type = "number"; i.name = nombre; i.value = valor ?? ""; i.inputMode = "decimal";
    if (min != null) i.min = String(min); if (max != null) i.max = String(max); i.step = String(paso);
    return i;
  }

  function pintarConfig() {
    const c = estado.config;
    const cab = el("div", "fab-drawer-cab");
    const h = el("h2", "", "Alertas Discord"); h.id = "sn-cfg-tit"; h.tabIndex = -1;
    const x = boton("", "btn-icono", { snCerrar: "1" }); x.setAttribute("aria-label", "Cerrar"); x.innerHTML = '<svg aria-hidden="true"><use href="#i-cerrar" /></svg>';
    cab.append(h, x);
    const cuerpo = el("div", "fab-drawer-cuerpo");

    // Webhooks.
    const wh = el("fieldset", "fab-grupo");
    wh.append(el("legend", "", "Webhooks"));
    if (!estado.webhooks.length) wh.append(el("p", "small muted", "Aún no hay ninguno. En Discord: Ajustes del servidor → Integraciones → Webhooks → Nuevo webhook → Copiar URL."));
    for (const w of estado.webhooks) {
      const fila = el("div", "sn-wh");
      const txt = el("div", "sn-wh-txt");
      txt.append(el("strong", "", w.nombre), el("span", "small muted", `${w.pista}${w.cifrado ? " · cifrada" : ""}`),
        el("span", "small muted", w.profesiones.length ? w.profesiones.map(d.nombreProf).join(", ") : "Todas las profesiones"));
      const act = el("label", "check small");
      const cb = el("input"); cb.type = "checkbox"; cb.checked = w.activo; cb.dataset.snWhActivo = w.id;
      act.append(cb, " Activo");
      fila.append(txt, act, boton("Probar", "btn btn-piedra btn-small", { snProbar: w.id }), boton("Borrar", "enlace small", { snBorrar: w.id }));
      wh.append(fila);
    }
    const alta = el("div", "sn-alta");
    const nombre = el("input"); nombre.type = "text"; nombre.name = "wh_nombre"; nombre.placeholder = "Nombre (p. ej. Alquimia)"; nombre.maxLength = 60;
    const url = el("input"); url.type = "password"; url.name = "wh_url"; url.autocomplete = "off"; url.spellcheck = false;
    url.placeholder = "https://discord.com/api/webhooks/…";
    const profs = el("select"); profs.name = "wh_profs"; profs.multiple = true; profs.size = 4;
    for (const p of d.profesiones()) profs.append(new Option(d.nombreProf(p), p));
    alta.append(campo("Nombre", nombre), campo("URL del webhook", url, "Se guarda cifrada en Supabase Vault y no se vuelve a mostrar."),
      campo("Profesiones (ninguna = todas)", profs), boton("Añadir webhook", "btn btn-piedra btn-small", { snAlta: "1" }));
    wh.append(alta);

    // Qué avisar.
    const q = el("fieldset", "fab-grupo");
    q.append(el("legend", "", "Qué avisar"));
    const activo = el("label", "fab-switch");
    const ca = el("input"); ca.type = "checkbox"; ca.setAttribute("role", "switch"); ca.name = "activo"; ca.checked = c.activo;
    activo.append(ca, el("span", "fab-switch-pista"), "Avisos automáticos");
    const merc = el("select"); merc.name = "market_key";
    for (const m of estado.mercados) merc.append(new Option(m.nombre, m.key));
    merc.value = c.market_key;
    const riesgo = el("select"); riesgo.name = "riesgo_max";
    for (const r of ["bajo", "medio", "alto"]) riesgo.append(new Option(RIESGO[r], r));
    riesgo.value = c.riesgo_max;
    const neta = el("input"); neta.type = "text"; neta.name = "neta_min"; neta.value = d.formatear(Number(c.neta_min));
    const profsCfg = el("select"); profsCfg.name = "profesiones"; profsCfg.multiple = true; profsCfg.size = 5;
    for (const p of d.profesiones()) { const o = new Option(d.nombreProf(p), p); o.selected = c.profesiones.includes(p); profsCfg.append(o); }
    const inc = el("textarea"); inc.name = "incluir"; inc.rows = 2; inc.value = c.incluir.join(", "); inc.placeholder = "IDs separados por comas";
    const exc = el("textarea"); exc.name = "excluir"; exc.rows = 2; exc.value = c.excluir.join(", "); exc.placeholder = "IDs separados por comas";
    q.append(activo, campo("Mercado", merc),
      campo("ROI mínimo (%)", numero("roi_min", c.roi_min, { min: -100, max: 100000 })),
      campo("Beneficio mínimo por fabricación", neta), campo("Score mínimo (0–100)", numero("score_min", c.score_min, { min: 0, max: 100 })),
      campo("Riesgo máximo", riesgo), campo("Profesiones (ninguna = todas)", profsCfg),
      campo("Solo estos objetos", inc), campo("Excluir objetos", exc));

    // Frecuencia y repeticiones.
    const fr = el("fieldset", "fab-grupo");
    fr.append(el("legend", "", "Frecuencia"));
    fr.append(campo("Analizar como mínimo cada (min)", numero("intervalo_min", c.intervalo_min, { min: 5, max: 1440 }), "Además, se analiza en cuanto llega un escaneo nuevo."),
      campo("No repetir la misma antes de (min)", numero("espera_repetir_min", c.espera_repetir_min, { min: 10, max: 43200 })),
      campo("…salvo que la ganancia suba (%)", numero("mejora_pct", c.mejora_pct, { min: 1, max: 1000 })),
      campo("…o el coste baje (%)", numero("bajada_coste_pct", c.bajada_coste_pct, { min: 1, max: 99 })),
      campo("Máximo de avisos por análisis", numero("max_por_ronda", c.max_por_ronda, { min: 1, max: 25 })),
      campo("No avisar si el escaneo tiene más de (min)", numero("edad_max_min", c.edad_max_min, { min: 15, max: 2880 })));

    // Cálculo y clasificación.
    const cl = el("fieldset", "fab-grupo");
    cl.append(el("legend", "", "Cálculo y clasificación"));
    cl.append(campo("Comisión de la subasta (%)", numero("comision_pct", c.comision_pct, { min: 0, max: 50, paso: 0.5 }), "En Classic: 5 % en la casa de facción. Sin verificar en Forever."),
      campo("Escenario conservador: vender más barato (%)", numero("recorte_pct", c.recorte_pct, { min: 0, max: 50 })));
    const um = el("div", "sn-umbrales");
    for (const k of ORDEN_CLASES) {
      const cc = claseDe(k);
      um.append(campo(`${cc.emoji} ${cc.nombre} desde (% ROI)`, numero(`u_${k}`, c.umbrales[k], { min: 0, max: 100000 })));
    }
    cl.append(um);

    // Menciones y enlaces.
    const mn = el("fieldset", "fab-grupo");
    mn.append(el("legend", "", "Menciones y enlaces"));
    const rol = el("input"); rol.type = "text"; rol.name = "mencion_rol"; rol.value = c.mencion_rol ?? ""; rol.inputMode = "numeric"; rol.placeholder = "ID del rol (opcional)";
    const desde = el("select"); desde.name = "mencion_desde";
    for (const k of ORDEN_CLASES) desde.append(new Option(claseDe(k).nombre, k));
    desde.value = c.mencion_desde;
    const sitio = el("input"); sitio.type = "url"; sitio.name = "sitio_url"; sitio.value = c.sitio_url;
    mn.append(campo("Mencionar a un rol", rol, "Solo el rol indicado (Discord: activa el modo desarrollador y copia el ID del rol). Nunca @everyone."),
      campo("…desde la clase", desde), campo("Dirección de MercadoWoW (para los enlaces)", sitio));

    cuerpo.append(wh, q, fr, cl, mn);
    const pie = el("div", "fab-drawer-pie");
    pie.append(boton("Cerrar", "btn btn-piedra", { snCerrar: "1" }), boton("Guardar", "btn btn-rojo", { snGuardar: "1" }));
    panel.replaceChildren(cab, cuerpo, pie);
  }

  const ids = (t) => [...new Set(String(t).split(/[\s,;]+/).filter(Boolean).map(Number))];
  async function guardarConfig() {
    const v = (n) => panel.querySelector(`[name="${n}"]`);
    let neta;
    try { neta = parsearMoneda(v("neta_min").value); } catch (e) { d.avisar(e.message, "bad"); v("neta_min").focus(); return; }
    const malos = [...ids(v("incluir").value), ...ids(v("excluir").value)].filter((n) => !Number.isInteger(n) || n <= 0);
    if (malos.length) { d.avisar("Los objetos van por su ID numérico, separados por comas.", "bad"); return; }
    const num = (n) => Number(v(n).value);
    const cambios = {
      activo: v("activo").checked, market_key: v("market_key").value, roi_min: num("roi_min"), neta_min: neta ?? 0,
      score_min: num("score_min"), riesgo_max: v("riesgo_max").value,
      profesiones: [...v("profesiones").selectedOptions].map((o) => o.value),
      incluir: ids(v("incluir").value), excluir: ids(v("excluir").value),
      intervalo_min: num("intervalo_min"), espera_repetir_min: num("espera_repetir_min"), mejora_pct: num("mejora_pct"),
      bajada_coste_pct: num("bajada_coste_pct"), max_por_ronda: num("max_por_ronda"), edad_max_min: num("edad_max_min"),
      comision_pct: num("comision_pct"), recorte_pct: num("recorte_pct"),
      umbrales: Object.fromEntries(ORDEN_CLASES.map((k) => [k, num(`u_${k}`)])),
      mencion_rol: v("mencion_rol").value.trim(), mencion_desde: v("mencion_desde").value, sitio_url: v("sitio_url").value.trim(),
    };
    try { estado = await pedir("POST", { accion: "config", cambios }); pintar(); pintarConfig(); d.avisar("Configuración guardada."); }
    catch (e) { d.avisar(e.message, "bad"); }
  }

  panel.addEventListener("click", async (ev) => {
    const t = ev.target;
    if (t.closest("[data-sn-cerrar]")) return cerrarConfig();
    if (t.closest("[data-sn-guardar]")) return guardarConfig();
    if (t.closest("[data-sn-alta]")) {
      const v = (n) => panel.querySelector(`[name="${n}"]`);
      const url = v("wh_url").value.trim();
      if (!url) { d.avisar("Pega la URL del webhook de Discord.", "bad"); v("wh_url").focus(); return; }
      try {
        estado = await pedir("POST", { accion: "webhook_alta", nombre: v("wh_nombre").value.trim(), url,
                                       profesiones: [...v("wh_profs").selectedOptions].map((o) => o.value) });
        pintar(); pintarConfig(); d.avisar("Webhook guardado. Pulsa «Probar» para comprobarlo.");
      } catch (e) { d.avisar(e.message, "bad"); }
      return;
    }
    const pr = t.closest("[data-sn-probar]");
    if (pr) return solicitar({ accion: "prueba", webhook: Number(pr.dataset.snProbar) }, "Prueba pedida: mira el canal de Discord.");
    const br = t.closest("[data-sn-borrar]");
    if (br) {
      const w = estado.webhooks.find((x) => x.id === Number(br.dataset.snBorrar));
      if (!confirm(`¿Borrar el webhook «${w?.nombre}»? Dejará de recibir avisos.`)) return;
      try { estado = await pedir("POST", { accion: "webhook_borrar", id: Number(br.dataset.snBorrar) }); pintar(); pintarConfig(); d.avisar("Webhook borrado."); }
      catch (e) { d.avisar(e.message, "bad"); }
    }
  });
  panel.addEventListener("change", async (ev) => {
    const a = ev.target.closest("[data-sn-wh-activo]");
    if (!a) return;
    try { estado = await pedir("POST", { accion: "webhook_editar", id: Number(a.dataset.snWhActivo), activo: a.checked }); pintar(); }
    catch (e) { d.avisar(e.message, "bad"); a.checked = !a.checked; }
  });

  return {
    mostrar: () => cargar(),
    /** Desde el detalle de una receta: enviarla a Discord ahora. */
    enviar: (spell) => solicitar({ accion: "manual", spell }, "Envío pedido a Discord."),
  };
}

export { CLASES };
