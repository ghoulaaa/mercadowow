// Pestaña «Informes» de Fabricación: «Informes y Webhooks» del informe diario del mercado.
// Estado y próximo envío, vista previa (el MISMO dibujo que la imagen que llega a Discord), configuración,
// historial y botones (generar, enviar, probar, descargar PNG). La página nunca envía a Discord ni ve la URL
// del webhook: guarda la configuración por /api/informes y pide a la Edge Function lo demás.

import { CONFIG_INFORME, SECCIONES, TITULOS_PAGINA, informeSVG, paginasInforme } from "./informe.js";
import { parsearMoneda } from "./moneda.js";

const ESTADOS = { enviado: "Enviado", parcial: "Enviado a medias", error: "Error", generado: "Vista previa" };
const TIPOS = { auto: "Automático", manual: "Manual", vista: "Vista previa" };

/** @param {object} d  utilidades de app.js: {$, el, avisar, formatear, fecha, hace} */
export function crearVistaInformes(d) {
  const { $, el } = d;
  const raiz = $("fab-informes");
  let estado = null, cargando = null, sondeo = null, visto = null;   // visto: {id, datos} en la vista previa

  async function pedir(metodo = "GET", cuerpo = null, q = "") {
    const r = await fetch(`/api/informes${q}`, {
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
      try {
        estado = await pedir();
        if (!visto && estado.ultimo) visto = estado.ultimo;
        pintar();
      } catch (e) {
        raiz.replaceChildren(el("p", "bad", /Faltan migraciones|informe_estado/.test(e.message)
          ? "El informe diario aún no está instalado en Supabase (faltan las migraciones 0049 y 0050)."
          : `No se pudo cargar el informe diario: ${e.message}`));
      } finally { cargando = null; }
    })();
    return cargando;
  }

  /** Tras pedir algo: vuelve a leer cada 4 s (máx. 2 min) hasta que aparezca un informe nuevo en el historial. */
  function esperarInforme() {
    clearInterval(sondeo);
    const antes = estado?.historial?.[0]?.id ?? null;
    let vueltas = 0;
    sondeo = setInterval(async () => {
      vueltas++;
      try {
        const nuevo = await pedir();
        const h = nuevo.historial?.[0];
        if ((h && h.id !== antes) || vueltas > 30) {
          clearInterval(sondeo);
          estado = nuevo;
          if (h && h.id !== antes) {
            if (nuevo.ultimo?.id === h.id) visto = nuevo.ultimo;
            d.avisar(h.estado === "enviado" ? "Informe enviado a Discord." : h.estado === "generado" ? "Informe generado: mira la vista previa."
              : `Informe: ${ESTADOS[h.estado] ?? h.estado}${h.error ? ` (${h.error})` : ""}`, h.estado === "error" ? "bad" : "");
          } else d.avisar("El informe tarda más de lo normal: vuelve a mirar en un momento.", "bad");
          pintar();
        }
      } catch { if (vueltas > 30) clearInterval(sondeo); }
    }, 4000);
  }
  async function solicitar(cuerpo, mensaje) {
    try { await pedir("POST", cuerpo); d.avisar(mensaje); if (cuerpo.accion !== "prueba") esperarInforme(); }
    catch (e) { d.avisar(e.message, "bad"); }
  }

  const boton = (texto, cls = "btn btn-piedra btn-small", datos = {}) => {
    const b = el("button", cls, texto); b.type = "button"; Object.assign(b.dataset, datos); return b;
  };
  const campo = (etiqueta, control, ayuda = null) => {
    const l = el("label", "inf-campo"); l.append(el("span", "", etiqueta), control);
    if (ayuda) l.append(el("small", "muted", ayuda));
    return l;
  };
  const entrada = (name, valor, attrs = {}) => {
    const i = el("input"); i.name = name; i.value = valor ?? ""; Object.assign(i, attrs); return i;
  };
  const selector = (name, opciones, valor) => {
    const s = el("select"); s.name = name;
    for (const [v, t] of opciones) { const o = el("option", "", t); o.value = String(v); if (String(v) === String(valor)) o.selected = true; s.append(o); }
    return s;
  };
  const casilla = (name, marcada, texto, datos = {}) => {
    const l = el("label", "inf-casilla"); const c = el("input"); c.type = "checkbox"; c.name = name; c.checked = !!marcada;
    Object.assign(c.dataset, datos); l.append(c, el("span", "", texto)); return l;
  };
  const fechaHora = (v, zona) => {
    try { return new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short", timeZone: zona }).format(new Date(v)); }
    catch { return d.fecha(v); }
  };

  // ---------- pintado ----------
  function pintar() {
    if (!estado) return;
    const c = estado.config;
    const activos = estado.webhooks.filter((w) => w.activo && (!c.webhooks.length || c.webhooks.includes(w.id)));
    const ult = estado.historial.find((h) => h.tipo !== "vista");

    // Estado y acciones.
    const cab = el("div", "sn-estado");
    cab.append(el("span", `sn-pill ${c.activo && activos.length ? "on" : "off"}`, c.activo && activos.length ? "Activo" : !activos.length ? "Sin webhook" : "Pausado"));
    const info = el("div", "sn-info");
    info.append(el("strong", "", "Informe diario del mercado"), el("span", "muted small",
      (estado.proximo ? `Próximo informe: ${fechaHora(estado.proximo, c.zona)} (${c.zona})` : "Informes automáticos desactivados")
      + (ult ? ` · último envío: ${ESTADOS[ult.estado] ?? ult.estado} ${d.hace(ult.creado)}` : " · aún sin envíos")));
    const acc = el("div", "sn-acciones");
    acc.append(boton("Generar informe ahora", "btn btn-piedra btn-small", { infGenerar: "1" }),
      boton("Enviar informe a Discord", "btn btn-rojo btn-small", { infEnviar: "1" }));
    cab.append(info, acc);
    const nodos = [cab];
    if (ult?.estado === "error" && ult.error) nodos.push(el("p", "fab-error", `Último envío con error: ${ult.error}`));

    // Vista previa.
    const prev = el("section", "sn-sec inf-previa");
    const pc = el("div", "sn-sec-cab");
    pc.append(el("h2", "", "Vista previa"));
    if (visto?.datos) {
      const h = estado.historial.find((x) => x.id === visto.id);
      pc.append(el("span", "muted small", h ? `${TIPOS[h.tipo] ?? h.tipo} · ${d.fecha(h.creado)}` : `Informe ${visto.id}`));
    }
    prev.append(pc);
    if (!visto?.datos) prev.append(el("p", "muted", "Aún no hay informes. Pulsa «Generar informe ahora» para ver uno con los datos actuales (no se envía)."));
    else {
      prev.append(el("p", "muted small", "Así llega a Discord: una imagen por página, cada una en su embed (al tamaño que la muestra Discord)."));
      const rejilla = el("div", "inf-paginas");
      try {
        if (visto.datos.version !== 2) throw new Error("este informe es de la versión anterior (una sola imagen); genera uno nuevo");
        for (const pagina of paginasInforme(visto.datos)) {
          const { svg } = informeSVG(visto.datos, { pagina, sitio: visto.datos.sitio ?? estado.sitio_url });
          const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
          const nodo = document.importNode(doc.documentElement, true);
          nodo.removeAttribute("width"); nodo.removeAttribute("height");
          nodo.setAttribute("role", "img"); nodo.setAttribute("aria-label", TITULOS_PAGINA[pagina] ?? pagina);
          const fig = el("figure", "inf-pagina");
          const marco = el("div", "inf-lienzo"); marco.append(nodo);
          const a = el("a", "small", `Descargar PNG · ${TITULOS_PAGINA[pagina] ?? pagina}`);
          a.href = `/api/informes?png=${encodeURIComponent(visto.id)}&pagina=${pagina}`; a.download = `mercadowow-informe-${visto.id}-${pagina}.png`;
          const cap = el("figcaption"); cap.append(a);
          fig.append(marco, cap); rejilla.append(fig);
        }
        prev.append(rejilla);
      } catch (e) { prev.append(el("p", "bad", `No se pudo dibujar la vista previa: ${e.message}`)); }
    }

    nodos.push(formulario(c), prev, historial());
    raiz.replaceChildren(...nodos);
  }

  function formulario(c) {
    const f = el("form", "sn-sec inf-config"); f.noValidate = true;
    const t = el("div", "sn-sec-cab"); t.append(el("h2", "", "Informes y Webhooks")); f.append(t);
    const g = el("div", "inf-grid");
    const zonas = (() => { try { return Intl.supportedValuesOf("timeZone"); } catch { return []; } })();
    if (!zonas.includes(c.zona)) zonas.unshift(c.zona);
    const zonaNavegador = Intl.DateTimeFormat().resolvedOptions().timeZone;
    g.append(
      casilla("activo", c.activo, "Enviar el informe automáticamente cada día"),
      campo("Mercado", selector("market_key", estado.mercados.map((m) => [m.key, m.nombre]), c.market_key),
        "AHledger tiene escaneos cada hora y estimación de ventas; TSM, cada pocas horas y sin ventas."),
      campo("Hora de envío", selector("hora", Array.from({ length: 24 }, (_, h) => [h, `${String(h).padStart(2, "0")}:00`]), c.hora)),
      campo("Zona horaria", selector("zona", zonas.map((z) => [z, z]), c.zona),
        c.zona !== zonaNavegador && zonaNavegador ? `La de este navegador: ${zonaNavegador}` : null),
      campo("Descuento mínimo de las gangas (%)", entrada("gangas_desc_min", c.gangas_desc_min, { type: "number", min: 5, max: 95, step: 1 })),
      campo("ROI mínimo de los crafteos (%)", entrada("craft_roi_min", c.craft_roi_min, { type: "number", min: 0, max: 100000, step: 1 })),
      campo("Beneficio mínimo (gangas y crafteos)", entrada("neta_min", d.formatear(c.neta_min), { type: "text", inputMode: "text" }), "Ej.: 1g 50s"),
      campo("Liquidez mínima (ventas al día)", entrada("liquidez_min", c.liquidez_min, { type: "number", min: 0, max: 10000, step: 0.1 })),
      campo("Objetos por sección", selector("por_seccion", [[3, "3"], [4, "4"], [5, "5"]], c.por_seccion)),
      campo("Nombre del webhook", entrada("nombre", c.nombre, { maxLength: 80 }), "Discord no admite «discord» ni «clyde»."),
      campo("Avatar (dirección https de una imagen, opcional)", entrada("avatar", c.avatar ?? "", { type: "url", placeholder: "https://…" })),
    );
    f.append(g);

    // Webhooks: los mismos del Crafting Sniper (la URL se da de alta allí, cifrada).
    const wh = el("fieldset", "inf-fs"); wh.append(el("legend", "", "Webhooks de Discord"));
    if (!estado.webhooks.length) {
      const p = el("p", "muted small", "Aún no hay webhooks. Añádelos en ");
      const a = el("a", "", "Sniper → Alertas Discord"); a.href = "#/sniper"; p.append(a, " (la URL se guarda cifrada y no se vuelve a mostrar).");
      wh.append(p);
    } else {
      wh.append(el("p", "muted small", "Sin ninguno marcado, el informe va a todos los webhooks activos. Se añaden o borran en Sniper → Alertas Discord."));
      for (const w of estado.webhooks) {
        const fila = el("div", "inf-wh");
        fila.append(casilla("webhook", c.webhooks.includes(w.id), `${w.nombre}${w.activo ? "" : " (pausado)"} · ${w.pista}`, { id: String(w.id) }),
          boton("Probar webhook", "btn btn-piedra btn-small", { infProbar: String(w.id) }));
        wh.append(fila);
      }
    }
    f.append(wh);

    const sec = el("fieldset", "inf-fs"); sec.append(el("legend", "", "Secciones visibles"));
    const cs = el("div", "inf-casillas");
    for (const [k, t] of SECCIONES) cs.append(casilla("seccion", c.secciones?.[k] !== false, t, { clave: k }));
    sec.append(cs); f.append(sec);

    const pie = el("div", "inf-pie");
    pie.append(boton("Guardar configuración", "btn btn-rojo", { infGuardar: "1" }),
      el("span", "muted small", "Los cambios se aplican al próximo informe. «Generar informe ahora» los muestra en la vista previa."));
    f.append(pie);
    return f;
  }

  function historial() {
    const s = el("section", "sn-sec");
    const cab = el("div", "sn-sec-cab"); cab.append(el("h2", "", `Historial de informes (${estado.historial.length})`)); s.append(cab);
    if (!estado.historial.length) { s.append(el("p", "muted", "Todavía no se ha generado ningún informe.")); return s; }
    const t = el("table", "sn-tabla");
    const th = el("tr"); for (const x of ["Fecha", "Tipo", "Estado", "Webhooks", "", ""]) th.append(el("th", "", x));
    t.append(th);
    for (const h of estado.historial) {
      const tr = el("tr");
      const est = el("td", h.estado === "error" ? "bad" : "", ESTADOS[h.estado] ?? h.estado);
      if (h.error) est.title = h.error;
      const ver = el("td"); if (h.estado !== "error" || h.id === estado.ultimo?.id) ver.append(boton(visto?.id === h.id ? "Viendo" : "Ver", "btn btn-piedra btn-small", { infVer: String(h.id) }));
      const png = el("td");
      const a = el("a", "", "PNG"); a.href = `/api/informes?png=${encodeURIComponent(h.id)}&pagina=resumen`; a.download = `mercadowow-informe-${h.id}.png`;
      if (h.estado !== "error") png.append(a);
      tr.append(el("td", "", d.fecha(h.creado)), el("td", "", TIPOS[h.tipo] ?? h.tipo), est,
        el("td", "", h.tipo === "vista" ? "—" : String(h.enviados)), ver, png);
      if (h.error) { const e = el("tr", "inf-error"); const td = el("td", "muted small", h.error); td.colSpan = 6; e.append(td); t.append(tr, e); }
      else t.append(tr);
    }
    const w = el("div", "sn-tabla-wrap"); w.append(t); s.append(w);
    return s;
  }

  function leerFormulario(f) {
    const v = (n) => f.elements.namedItem(n)?.value;
    const neta = parsearMoneda(v("neta_min") ?? "");
    if (neta == null) throw new Error("El beneficio mínimo no es un importe válido (ej.: 1g 50s).");
    const secciones = {};
    for (const c of f.querySelectorAll('input[name="seccion"]')) if (!c.checked) secciones[c.dataset.clave] = false;
    return {
      activo: f.elements.namedItem("activo").checked,
      market_key: v("market_key"), hora: Number(v("hora")), zona: v("zona"),
      gangas_desc_min: Number(v("gangas_desc_min")), craft_roi_min: Number(v("craft_roi_min")), neta_min: neta,
      liquidez_min: Number(v("liquidez_min")), por_seccion: Number(v("por_seccion")),
      nombre: v("nombre"), avatar: v("avatar") || null,
      webhooks: [...f.querySelectorAll('input[name="webhook"]:checked')].map((c) => Number(c.dataset.id)),
      secciones,
    };
  }

  raiz.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.infGenerar) solicitar({ accion: "generar" }, "Generando el informe con los datos actuales…");
    else if (b.dataset.infEnviar) {
      if (confirm("¿Enviar ahora el informe a los webhooks elegidos?")) solicitar({ accion: "enviar" }, "Generando y enviando el informe…");
    } else if (b.dataset.infProbar) solicitar({ accion: "prueba", webhook: Number(b.dataset.infProbar) }, "Mensaje de prueba enviado a Discord.");
    else if (b.dataset.infVer) {
      try { visto = { id: Number(b.dataset.infVer), datos: await pedir("GET", null, `?id=${encodeURIComponent(b.dataset.infVer)}`) }; pintar(); }
      catch (e) { d.avisar(e.message, "bad"); }
    } else if (b.dataset.infGuardar) {
      try {
        const cambios = leerFormulario(b.closest("form"));
        estado = await pedir("POST", { accion: "config", cambios });
        d.avisar("Configuración del informe guardada.");
        pintar();
      } catch (e) { d.avisar(e.message, "bad"); }
    }
  });

  return {
    mostrar() { cargar(); },
    defectos: CONFIG_INFORME,
  };
}
