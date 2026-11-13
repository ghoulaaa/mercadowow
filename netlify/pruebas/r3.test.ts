// R3: teclado del autocompletado, rutas, huecos del gráfico, filtros e historial de AHledger.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ESTADO_INICIAL, alEscribir, conSugerencias, teclado } from "../../app/static/autocompletar.js";
import { leerRuta } from "../../app/static/ruta.js";
import { pasoTipico, tramos } from "../../app/static/grafico.js";
import { filtrar, ordenar, prepararFilas } from "../../app/static/tabla.js";
import { historialAhledger, ErrorFuente } from "../lib/api.ts";

const T = (tecla: string, extra: object = {}) => ({ tecla, hayTexto: true, ...extra });

describe("autocompletado por teclado", () => {
  const conTres = () => conSugerencias(alEscribir(ESTADO_INICIAL), 3);

  test("al escribir aparecen sugerencias sin ninguna resaltada", () => {
    const e = conTres();
    assert.deepEqual([e.abierto, e.activo, e.n], [true, -1, 3]);
  });

  test("Tab resalta la primera, recorre y en la última deja salir del buscador", () => {
    let r = teclado(conTres(), T("Tab"));
    assert.deepEqual([r.estado.activo, r.prevenir], [0, true]);
    r = teclado(r.estado, T("Tab"));
    assert.deepEqual([r.estado.activo, r.prevenir], [1, true]);
    r = teclado(r.estado, T("Tab"));
    assert.deepEqual([r.estado.activo, r.prevenir], [2, true]);
    r = teclado(r.estado, T("Tab"));
    assert.equal(r.prevenir, false);              // no atrapa: el foco pasa al siguiente control
    assert.equal(r.estado.abierto, false);
  });

  test("Tab con la lista cerrada (pero con sugerencias) la abre y resalta la primera", () => {
    const cerrada = { ...conTres(), abierto: false };
    const r = teclado(cerrada, T("Tab"));
    assert.deepEqual([r.estado.abierto, r.estado.activo, r.prevenir], [true, 0, true]);
  });

  test("Shift+Tab recorre hacia atrás y desde la primera deja salir", () => {
    let r = teclado(conTres(), T("Tab", { shift: true }));
    assert.deepEqual([r.estado.activo, r.prevenir], [2, true]);   // sin resaltada: empieza por la última
    r = teclado({ ...r.estado, activo: 0 }, T("Tab", { shift: true }));
    assert.equal(r.prevenir, false);
    assert.equal(r.estado.abierto, false);
  });

  test("flechas recorren sin salirse; Enter confirma la resaltada", () => {
    let r = teclado(conTres(), T("ArrowDown"));
    r = teclado(r.estado, T("ArrowDown"));
    r = teclado(r.estado, T("ArrowDown"));
    r = teclado(r.estado, T("ArrowDown"));
    assert.equal(r.estado.activo, 2);
    r = teclado(r.estado, T("ArrowUp"));
    assert.equal(r.estado.activo, 1);
    r = teclado(r.estado, T("Enter"));
    assert.deepEqual([r.accion, r.prevenir, r.estado.abierto], ["confirmar", true, false]);
  });

  test("Enter sin resaltada = buscar en el mercado", () => {
    assert.equal(teclado(conTres(), T("Enter")).accion, "buscar");
  });

  test("Esc cierra sin tocar nada y después Tab vuelve a ser normal hasta que se escriba", () => {
    let r = teclado({ ...conTres(), activo: 1 }, T("Escape"));
    assert.deepEqual([r.estado.abierto, r.prevenir], [false, true]);
    r = teclado(r.estado, T("Tab"));
    assert.equal(r.prevenir, false);
    const tras = conSugerencias(alEscribir(r.estado), 3);
    assert.equal(teclado(tras, T("Tab")).prevenir, true);
  });

  test("sin texto o sin sugerencias, Tab es el Tab normal", () => {
    assert.equal(teclado(conTres(), T("Tab", { hayTexto: false })).prevenir, false);
    assert.equal(teclado(conSugerencias(ESTADO_INICIAL, 0), T("Tab")).prevenir, false);
    assert.equal(teclado(conSugerencias(ESTADO_INICIAL, 0), T("ArrowDown")).prevenir, false);
  });

  test("otras teclas no hacen nada especial", () => {
    assert.equal(teclado(conTres(), T("a")).prevenir, false);
  });
});

describe("rutas", () => {
  for (const [hash, esperado] of [
    ["#/objeto/7082", { vista: "objeto", id: 7082 }],
    // Enlaces antiguos (V3: una sola vista): un objeto se abre; una sección retirada → Mercado.
    ["#/historial/2589", { vista: "objeto", id: 2589 }],
    ["#/rentabilidad/2589", { vista: "objeto", id: 2589 }],
    ["#/historial", { vista: "mercado", id: null }],
    ["#/inventario", { vista: "mercado", id: null }],
    ["#/objeto/abc", { vista: "mercado", id: null }],
    // Secciones (V8): Fabricación y Oportunidades; «#/recetas» de V2 lleva a Fabricación.
    ["#/fabricacion", { vista: "fabricacion", id: null }],
    ["#/recetas", { vista: "fabricacion", id: null }],
    ["#/oportunidades", { vista: "oportunidades", id: null }],
    ["#/no-existe", { vista: "mercado", id: null }],
    ["", { vista: "mercado", id: null }],
  ] as const) {
    test(`${hash || "(vacío)"}`, () => assert.deepEqual(leerRuta(hash), esperado));
  }
});

describe("gráfico: periodos sin escaneos", () => {
  const h = 3600e3;
  test("corta la línea donde faltan escaneos y no une los tramos", () => {
    const pts = [[0, 10, 1], [h, 11, 1], [2 * h, 12, 1], [8 * h, 20, 1], [9 * h, 21, 1]] as [number, number, number][];
    const r = tramos(pts, 1, h);
    assert.deepEqual(r.tramos, [[[0, 10], [h, 11], [2 * h, 12]], [[8 * h, 20], [9 * h, 21]]]);
    assert.deepEqual(r.huecos, [[2 * h, 8 * h]]);
  });

  test("un valor ausente también corta (sin interpolar)", () => {
    const r = tramos([[0, 1, 0], [h, null, 0], [2 * h, 3, 0]] as any, 1, h);
    assert.deepEqual(r.tramos, [[[0, 1]], [[2 * h, 3]]]);
    assert.deepEqual(r.huecos, []);
  });

  test("paso típico = mediana de las diferencias", () => {
    assert.equal(pasoTipico([0, 10, 20, 30, 100]), 10);
    assert.equal(pasoTipico([5]), null);
  });
});

describe("filtros de nivel y precio", () => {
  const filas = prepararFilas([
    { id: 1, nombre: "A", nivel_objeto: 10, precio: 500 },
    { id: 2, nombre: "B", nivel_objeto: 55, precio: 40000 },
    { id: 3, nombre: "C", nivel_objeto: null, precio: null, valor_mercado: null },
  ]);
  test("rango de nivel (sin nivel conocido queda fuera)", () => {
    assert.deepEqual(filtrar(filas, { nivelMin: 20 }).map((f) => f.id), [2]);
    assert.deepEqual(filtrar(filas, { nivelMax: 20 }).map((f) => f.id), [1]);
  });
  test("rango de precio en cobre", () => {
    assert.deepEqual(filtrar(filas, { precioMin: 1000 }).map((f) => f.id), [2]);
    assert.deepEqual(filtrar(filas, { precioMax: 1000 }).map((f) => f.id), [1]);
  });
  test("orden por nivel, vacíos al final", () => {
    assert.deepEqual(ordenar(filas, "nivel", "desc").map((f) => f.id), [2, 1, 3]);
  });
});

describe("historial de AHledger", () => {
  const URL_TABLA = "https://api.ahledger.com/v1/pricetable/forever.pvp.horde.us";
  // Forma documentada en ahledger.com/developers (valores de ejemplo de esa página).
  const RESPUESTA = {
    market: "forever.pvp.horde.us",
    item: { id: 2589, name: "Linen Cloth", quality: "COMMON" },
    latest: { observedAt: "2026-11-08T05:31:35.000Z", source: "Addon scan", minBuyout: 13, median: 28,
              quantity: 19756, auctions: 511, median7d: 30, median30d: 30, median90d: null },
    range: "7d",
    series: [
      { t: "2026-11-08T04:00:00.000Z", min: 14, median: 29, p25: 25, p75: 33, quantity: 19000, auctions: 500 },
      { t: "2026-11-08T05:00:00.000Z", min: 13, median: 28, p25: 25, p75: 33, quantity: 19400, auctions: 507 },
    ],
    sales: { estimatedPerDay: 13893.1, windowDays: 7, coveredHours: 37.7 },
  };
  const f = (cuerpo: unknown, status = 200, pedidas: string[] = []) =>
    (async (url: string) => { pedidas.push(url); return new Response(JSON.stringify(cuerpo), { status }); }) as typeof fetch;

  test("pide la URL documentada y pasa las series tal cual, con atribución", async () => {
    const pedidas: string[] = [];
    const h = await historialAhledger(f(RESPUESTA, 200, pedidas), URL_TABLA, 2589, "7d");
    assert.deepEqual(pedidas, ["https://api.ahledger.com/v1/prices/forever.pvp.horde.us/2589?range=7d"]);
    assert.deepEqual(h.puntos, [[Date.parse("2026-11-08T04:00:00.000Z"), 14, 29], [Date.parse("2026-11-08T05:00:00.000Z"), 13, 28]]);
    assert.deepEqual(h.cantidad!.map((c) => c[1]), [19000, 19400]);
    assert.equal(h.paso_ms, 3600e3);
    assert.deepEqual(h.nombres, ["Compra mínima", "Mediana"]);
    assert.equal(h.ultimo!.mediana90d, null);         // sin historial: se dice, no se inventa
    assert.equal(h.ventas!.por_dia, 13893.1);
    assert.equal(h.atribucion.texto, "Prices from AHledger");
  });

  test("30 y 90 días van por días", async () => {
    assert.equal((await historialAhledger(f(RESPUESTA), URL_TABLA, 2589, "90d")).paso_ms, 86400e3);
  });

  test("objeto sin datos (404): series vacías", async () => {
    const h = await historialAhledger(f({}, 404), URL_TABLA, 7082, "7d");
    assert.deepEqual([h.puntos, h.ultimo], [[], null]);
  });

  test("otro mercado en la respuesta o error del servicio: ErrorFuente", async () => {
    await assert.rejects(historialAhledger(f({ ...RESPUESTA, market: "forever.pvp.alliance.us" }), URL_TABLA, 1, "7d"), ErrorFuente);
    await assert.rejects(historialAhledger(f({}, 503), URL_TABLA, 1, "7d"), /HTTP 503/);
    await assert.rejects(historialAhledger(f({}), "https://x/otro", 1, "7d"), /mal configurado/);
  });
});
