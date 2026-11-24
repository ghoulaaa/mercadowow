// Motor del Crafting Sniper (app/static/sniper.js): clasificación, Score, escenario conservador, protección contra
// falsas gangas, decisión de envío, mensaje de Discord y plan con presupuesto. Sin red ni base de datos.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { calcularFilas } from "../../app/static/fabricacion_tabla.js";
import { indicadores } from "../../app/static/oportunidades.js";
import {
  CLASES, PESOS, clasificar, decidirEnvio, escenarioConservador, evaluar, mencionPara, mensajeDiscord, mensajePrueba,
  planConPresupuesto, puntuar, revisarOportunidad,
} from "../../app/static/sniper.js";

const ESCANEO = "2026-11-24T14:00:00Z";
const AHORA = new Date("2026-11-24T14:20:00Z").getTime();
const DATOS = {
  mercado: "tsm:forever:us:pvp-horde", escaneo: ESCANEO, tope_pct: 150, comision_pct: 5,
  recetas: [
    { s: 1, n: "Elixir", p: "Alchemy", l: 130, r: 3389, mn: 1, mx: 1, m: [[2453, 2]] },
    { s: 2, n: "Venda", p: "First Aid", l: 1, r: 1251, mn: 1, mx: 1, m: [[2589, 2]] },
    { s: 3, n: "Sin ventas", p: "Tailoring", l: 10, r: 5000, mn: 1, mx: 1, m: [[2589, 1]] },
  ],
  objetos: {
    2453: { n: "Bruiseweed", s: 400, v: 400, c: 300 },
    3389: { n: "Elixir of Defense", s: 2000, v: 2000, c: 20, d: 6 },
    2589: { n: "Linen Cloth", s: 100, v: 100, c: 1000 },
    1251: { n: "Linen Bandage", s: 600, v: 600, c: 40, d: 12 },
    5000: { n: "Cloak", s: 900, v: 900 },               // sin datos de ventas
  },
};
const HIST = { 3389: { m24: 2000, m7: 2000, m30: 1980, n7: 6, n30: 20 }, 1251: { m24: 600, m7: 610, m30: 600, n7: 5, n30: 18 } };

describe("clasificación por ROI", () => {
  test("límites de la tabla (configurables)", () => {
    const k = (roi: number | null) => clasificar(roi).clave;
    assert.deepEqual([k(null), k(-5), k(0), k(0.1), k(14.9), k(15), k(29.9), k(30), k(59.9), k(60), k(99.9), k(100), k(199.9), k(200), k(5000)],
      ["no_rentable", "no_rentable", "no_rentable", "baja", "baja", "rentable", "rentable", "ganga", "ganga", "epica", "epica", "legendaria", "legendaria", "excepcional", "excepcional"]);
    assert.equal(clasificar(40, { rentable: 10, ganga: 50, epica: 70, legendaria: 90, excepcional: 120 }).clave, "rentable");
    assert.equal(CLASES.find((c) => c.clave === "excepcional")!.emoji, "🔥");
  });
});

describe("Score, riesgo y falsas gangas", () => {
  const filas = calcularFilas(DATOS);
  const x = filas.find((f: any) => f.spell === 1);
  const i = indicadores(x, DATOS.objetos);
  test("los pesos suman 100 y lo desconocido puntúa 0 (y se dice)", () => {
    assert.equal(Object.values(PESOS).reduce((s, v) => s + v, 0), 100);
    const cons = escenarioConservador(x, HIST[3389]);
    const conTodo = puntuar(x, i, HIST[3389], cons, { escaneo: ESCANEO, ahora: AHORA });
    const sinHist = puntuar(x, i, null, escenarioConservador(x, null), { escaneo: ESCANEO, ahora: AHORA });
    assert.ok(conTodo.score > sinHist.score);
    assert.equal(sinHist.partes.estabilidad, 0);
    assert.ok(sinHist.desconocido.includes("estabilidad"));
    assert.ok(conTodo.score >= 0 && conTodo.score <= 100);
  });
  test("escenario conservador: el menor precio de referencia y un 5 % más barato", () => {
    const c = escenarioConservador(x, { m7: 1800, m30: 1900 });
    assert.equal(c.precio, Math.floor(1800 * 0.95));
    assert.equal(c.neta, 1710 - Math.floor(1710 * 0.05) - 800);
    assert.ok(c.neta < x.neta);
  });
  test("bloquea precios disparados, escaneos viejos y productos sin ventas; baja la confianza sin historial", () => {
    assert.match(revisarOportunidad({ ...x, precioVenta: 5000 }, i, HIST[3389], { escaneo: ESCANEO, ahora: AHORA }).bloquea.join(), /2,5 veces|2.5 veces/);
    assert.match(revisarOportunidad(x, i, HIST[3389], { escaneo: ESCANEO, ahora: AHORA + 5 * 3600e3 }).bloquea.join(), /último escaneo/);
    const ok = revisarOportunidad(x, i, HIST[3389], { escaneo: ESCANEO, ahora: AHORA });
    assert.deepEqual([ok.bloquea, ok.confianza], [[], "alta"]);
    assert.equal(revisarOportunidad(x, i, null, { escaneo: ESCANEO, ahora: AHORA }).confianza, "baja");
  });
  test("evaluar: solo pasan las que tienen datos que las respaldan", () => {
    const ev = evaluar(DATOS, HIST, { roi_min: 0, neta_min: 0, score_min: 0, riesgo_max: "alto" }, AHORA);
    assert.deepEqual(ev.oportunidades.map((o: any) => o.spell).sort(), [1, 2]);
    const capa = ev.todas.find((o: any) => o.spell === 3);
    assert.equal(capa.alertable, false);               // sin ventas ni historial: no se avisa
    assert.equal(capa.motivoDescarte, "Datos poco fiables o precio sospechoso");
    const filtrada = evaluar(DATOS, HIST, { roi_min: 0, neta_min: 0, score_min: 0, profesiones: ["First Aid"] }, AHORA);
    assert.deepEqual(filtrada.oportunidades.map((o: any) => o.spell), [2]);
    assert.equal(evaluar(DATOS, HIST, { roi_min: 0, neta_min: 0, score_min: 0, excluir: [1251] }, AHORA).oportunidades.some((o: any) => o.id === 1251), false);
  });
});

describe("no repetir avisos", () => {
  const o = { clase: "legendaria", neta: 1100, coste: 800 };
  const previo = { enviado: new Date(AHORA - 3600e3).toISOString(), neta: 1100, coste: 800, clase: "legendaria", desaparecida: false };
  test("nueva, vuelve, mejora, sube, baja coste, intervalo… o ya avisada", () => {
    const m = (p: any, x: any = o) => decidirEnvio(x, p, {}, AHORA).motivo;
    assert.equal(m(null), "Oportunidad nueva");
    assert.equal(m({ ...previo, desaparecida: true }), "Vuelve a estar disponible");
    assert.equal(m(previo, { ...o, clase: "excepcional" }), "Mejora su clasificación");
    assert.equal(m(previo, { ...o, neta: 1320 }), "Sube la ganancia");
    assert.equal(m(previo, { ...o, coste: 680 }), "Baja el coste de fabricación");
    assert.equal(m({ ...previo, enviado: new Date(AHORA - 7 * 3600e3).toISOString() }), "Pasó el intervalo de repetición");
    assert.equal(decidirEnvio(o, previo, {}, AHORA).enviar, false);
    assert.equal(decidirEnvio({ ...o, neta: 1200 }, previo, {}, AHORA).enviar, false);   // +9 %: no basta (20 %)
  });
});

describe("mensaje de Discord", () => {
  const ev = evaluar(DATOS, HIST, { roi_min: 0, neta_min: 0, score_min: 0 }, AHORA);
  const o = ev.oportunidades.find((x: any) => x.spell === 1);
  test("respeta los límites de Discord y no menciona a nadie salvo que se configure", () => {
    const largo = { ...o, nombre: "X".repeat(400), materiales: Array.from({ length: 30 }, (_, k) => ({ ...o.materiales[0], id: k + 1, nombre: "Y".repeat(80) })) };
    const msg = mensajeDiscord(largo, { sitio: "https://mercadowow.vercel.app", mercado: "TSM", ahora: AHORA });
    const e = msg.embeds[0];
    assert.ok(e.title.length <= 256 && e.fields.length <= 25);
    assert.ok(e.fields.every((f: any) => f.value.length <= 1024 && f.name.length <= 256));
    assert.ok(JSON.stringify(e).length < 6000);
    assert.equal(e.url, "https://mercadowow.vercel.app/#/objeto/3389");
    assert.deepEqual(msg.allowed_mentions, { parse: [] });
    assert.equal(msg.content, undefined);
  });
  test("mención de rol solo desde la clase configurada; la prueba no lleva cifras", () => {
    assert.equal(mencionPara({ clase: "legendaria" }, { mencion_rol: "123456789012", mencion_desde: "excepcional" }), null);
    assert.equal(mencionPara({ clase: "excepcional" }, { mencion_rol: "123456789012" }), "123456789012");
    assert.equal(mencionPara({ clase: "excepcional" }, { mencion_rol: "@everyone" }), null);
    const msg = mensajeDiscord(o, { mercado: "TSM", mencion: "123456789012" });
    assert.deepEqual([msg.content, msg.allowed_mentions], ["<@&123456789012>", { roles: ["123456789012"] }]);
    assert.equal(JSON.stringify(mensajePrueba({})).match(/\d+[opc]\b/), null);
  });
});

describe("plan con presupuesto", () => {
  test("no supera el presupuesto, ni lo publicado, ni 2 días de ventas", () => {
    const ops = [
      { spell: 1, id: 1, nombre: "A", coste: 1000, neta: 500, unidades: 1, ventas: 3, maxFabricable: 100, riesgo: "bajo" },
      { spell: 2, id: 2, nombre: "B", coste: 300, neta: 100, unidades: 1, ventas: null, maxFabricable: null, riesgo: "medio" },
      { spell: 3, id: 3, nombre: "C", coste: 200, neta: 90, unidades: 2, ventas: 100, maxFabricable: 2, riesgo: "bajo" },
    ];
    const p = planConPresupuesto(ops, 7000);
    assert.deepEqual(p.lineas.map((l: any) => [l.spell, l.veces]), [[1, 6], [2, 1], [3, 2]]);   // 6 = 3/día × 2 días
    assert.equal(p.invertido, 6000 + 300 + 400);
    assert.equal(p.sobra, 7000 - p.invertido);
    assert.equal(p.neta, 6 * 500 + 100 + 2 * 90);
    assert.deepEqual(planConPresupuesto(ops, 100).lineas, []);
  });
});
