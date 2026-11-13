// Etapa 4: «Mejores oportunidades» (app/static/oportunidades.js).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { calcularFilas } from "../../app/static/fabricacion_tabla.js";
import { UMBRAL, indicadores, oportunidades, tieneEspera } from "../../app/static/oportunidades.js";

// Material común «M» a 1p (histórico 1p 50c). Cada receta: 1 M → 1 producto.
const rec = (s: number, n: string, p: string, r: number, extra: any = {}) =>
  ({ s, n, p, l: 100, r, mn: extra.mn ?? 1, mx: extra.mx ?? 1, m: extra.m ?? [[1, 1]] });
const DATOS = {
  tope_pct: 150, comision_pct: 5,
  recetas: [
    rec(1, "Equilibrada", "Alchemy", 101),          // gana 2p, se vende 6/día, poca competencia
    rec(2, "Mucho margen sin ventas", "Alchemy", 102), // gana 50o, 0 ventas
    rec(3, "Anuncio absurdo", "Cooking", 103),       // precio 100 veces su histórico
    rec(4, "Pierde", "Tailoring", 104),              // vende a 80c: pierde
    rec(5, "Transmute: Iron to Gold", "Alchemy", 105), // gana, pero tiene espera
    rec(6, "Mucha competencia", "Tailoring", 106),  // 500 publicadas, 2 ventas/día
    rec(7, "Barata hoy", "Tailoring", 107, { m: [[2, 1]] }), // material a la mitad de su histórico
    rec(8, "Gana poco", "Tailoring", 108),           // gana 5c: ROI alto en %, poco oro
  ],
  objetos: {
    1: { n: "M", s: 100, v: 100, h: 150, c: 1000 },
    2: { n: "M2", s: 100, v: 100, h: 200, c: 1000 },
    101: { n: "P1", s: 320, v: 330, h: 300, c: 3, d: 6 },
    102: { n: "P2", s: 500000, v: 500000, h: 500000, c: 1, d: 0 },
    103: { n: "P3", s: 30000, v: 30000, h: 300, c: 1, d: 2 },
    104: { n: "P4", s: 80, v: 80, h: 80, c: 10, d: 4 },
    105: { n: "P5", s: 2000, v: 2000, h: 2000, c: 1, d: 3 },
    106: { n: "P6", s: 400, v: 400, h: 400, c: 500, d: 2 },
    107: { n: "P7", s: 300, v: 300, h: 300, c: 2, d: 5 },
    108: { n: "P8", s: 112, v: 112, h: 112, c: 1, d: 8 },
  },
};
const filas = calcularFilas(DATOS);
const fila = (s: number) => filas.find((x: any) => x.spell === s);
const ind = (s: number) => indicadores(fila(s), DATOS.objetos);

describe("indicadores", () => {
  test("demanda, competencia y riesgo de una receta sana", () => {
    const i = ind(1);
    assert.deepEqual([i.demanda, i.competencia, i.riesgo, i.sospechoso], ["alta", "baja", "bajo", false]);
    assert.equal(i.dias, 0.5);
    assert.equal(i.netaUnidad, 320 - 16 - 100);
    assert.equal(i.puntuacion, 204 * 6);
  });
  test("sin ventas: riesgo alto aunque el margen sea enorme", () => {
    const i = ind(2);
    assert.deepEqual([i.demanda, i.riesgo], ["nula", "alto"]);
    assert.equal(i.puntuacion, null);
  });
  test("precio de venta sospechoso frente a su histórico", () => {
    const i = ind(3);
    assert.equal(i.sospechoso, true);
    assert.equal(i.riesgo, "alto");
    assert.match(i.motivosSospecha[0], /histórico/);
  });
  test("precio sospechoso sin histórico: comparado con lo que paga el NPC (caso Grilled Squid)", () => {
    const d = { recetas: [rec(9, "Grilled Squid", "Cooking", 109)], objetos: { 1: { s: 100 }, 109: { n: "Grilled Squid", s: 412450, v: 247470, vn: 8, d: 1 } }, tope_pct: 150 };
    const i = indicadores(calcularFilas(d)[0], d.objetos);
    assert.equal(i.sospechoso, true);
    assert.ok(i.motivosSospecha.some((m: string) => /NPC/.test(m)));
    assert.ok(i.motivosSospecha.some((m: string) => /tope/.test(m)));
  });
  test("tiempo de espera: transmutaciones y Mooncloth", () => {
    assert.equal(tieneEspera("Transmute: Arcanite", 17187), true);
    assert.equal(tieneEspera("Mooncloth", 18560), true);
    assert.equal(tieneEspera("Mooncloth Bag", 18445), false);
    assert.deepEqual([ind(5).espera, ind(5).riesgo], [true, "medio"]);
  });
  test("mucha competencia: riesgo medio y puntuación a la mitad", () => {
    const i = ind(6);
    assert.deepEqual([i.competencia, i.dias, i.riesgo], ["alta", 250, "medio"]);
    assert.equal(i.puntuacion, i.netaUnidad! * 2 * 0.5);
  });
  test("materiales baratos frente a su histórico", () => {
    assert.equal(ind(7).descuentoMateriales, 50);
    assert.ok(Math.abs(ind(1).descuentoMateriales! - 100 / 3) < 1e-9);
  });
});

describe("listas", () => {
  const o = oportunidades(filas, DATOS.objetos);
  const spells = (l: any[]) => l.map((x) => x.spell);

  test("nunca recomienda lo que no se vende ni precios sospechosos", () => {
    for (const lista of [o.equilibrio, o.ganancia, o.roi, o.demanda, o.materialesBaratos]) {
      assert.ok(!spells(lista).includes(2), "sin ventas");
      assert.ok(!spells(lista).includes(3), "sospechoso");
    }
    assert.deepEqual(spells(o.descartadas), [2, 3]);
  });
  test("mayor ganancia neta y mejor equilibrio", () => {
    assert.equal(o.ganancia[0].spell, 5);              // la transmutación gana más por fabricación…
    assert.equal(o.equilibrio[0].spell, 5);            // 1.795 × 3 × 0,5 > 204 × 6 × 1
    assert.ok(spells(o.equilibrio).indexOf(1) < spells(o.equilibrio).indexOf(6));
  });
  test("ROI: exige un mínimo de ganancia por unidad", () => {
    const f8 = indicadores(fila(8), DATOS.objetos);
    assert.ok(f8.netaUnidad! < UMBRAL.netaMinimaRoi);
    assert.ok(!spells(o.roi).includes(8));
  });
  test("buena demanda y poca competencia (y al menos 1 plata de ganancia por unidad)", () => {
    assert.deepEqual(spells(o.demanda).sort(), [1, 5, 7]);   // 6: mucha competencia; 8: gana 7 cobres
  });
  test("materiales baratos y pérdidas", () => {
    assert.deepEqual(spells(o.materialesBaratos), [7, 1, 5, 6, 8].filter((s) => spells(o.materialesBaratos).includes(s)));
    assert.equal(o.materialesBaratos[0].spell, 7);
    assert.deepEqual(spells(o.perdidas), [4]);
  });
  test("filtro por profesiones y resumen", () => {
    const t = oportunidades(filas, DATOS.objetos, { profesiones: ["Tailoring"] });
    assert.ok(t.ganancia.every((x: any) => x.profesion === "Tailoring"));
    assert.deepEqual(o.resumen, { recetas: 8, conGanancia: 7, recomendables: 5, sospechosas: 1, sinDemanda: 1 });
  });
});
