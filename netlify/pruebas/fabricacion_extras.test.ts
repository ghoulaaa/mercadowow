// Etapa 6: favoritas, comparador y alertas de fabricación (app/static/fabricacion_extras.js).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { calcularFilas } from "../../app/static/fabricacion_tabla.js";
import {
  MAX_COMPARAR, alternar, anadirComparar, compararRecetas, crearAlerta, evaluarAlertas, normalizarExtras, validarAlerta,
} from "../../app/static/fabricacion_extras.js";

const rec = (s: number, p: string, r: number) => ({ s, n: `R${s}`, p, l: 1, r, mn: 1, mx: 1, m: [[1, 1]] });
const DATOS = {
  tope_pct: 150, comision_pct: 5,
  recetas: [rec(1, "Alchemy", 101), rec(2, "Alchemy", 102), rec(3, "Tailoring", 103), rec(4, "Tailoring", 104)],
  objetos: {
    1: { n: "M", s: 100, v: 100, h: 100, c: 1000 },
    101: { n: "A", s: 400, v: 400, h: 400, c: 2, d: 5 },      // neta 280, ROI 280 %
    102: { n: "B", s: 2000, v: 2000, h: 2000, c: 10, d: 1 },  // neta 1800, ROI 1800 %
    103: { n: "C", s: 5000, v: 5000, h: 5000, c: 1, d: 0 },   // gana mucho pero no se vende
    104: { n: "D", s: 90, v: 90, h: 90, c: 3, d: 2 },         // pierde
  },
};
const filas = calcularFilas(DATOS);

describe("favoritas y comparador", () => {
  test("alternar y normalizar lo guardado", () => {
    assert.deepEqual(alternar([1, 2], 2), [1]);
    assert.deepEqual(alternar([1], 2), [1, 2]);
    assert.deepEqual(normalizarExtras(null), { favoritas: [], comparar: [], alertas: [] });
    assert.deepEqual(normalizarExtras({ favoritas: [1, 1, "x", -3, 2], comparar: [1, 2, 3, 4, 5], alertas: [{ tipo: "raro" }] }),
                     { favoritas: [1, 2], comparar: [1, 2, 3], alertas: [] });   // el comparador admite 3 (rediseño V2)
  });
  test("comparador: sin duplicados y con máximo", () => {
    assert.deepEqual(anadirComparar([1], 2), { lista: [1, 2], error: null });
    assert.match(anadirComparar([1], 1).error!, /Ya está/);
    assert.match(anadirComparar(Array.from({ length: MAX_COMPARAR }, (_, i) => i + 1), 99).error!, /Como mucho/);
  });
  test("comparación lado a lado con la mejor columna marcada", () => {
    const c = compararRecetas(filas, [1, 2, 999], DATOS.objetos);
    assert.deepEqual(c.recetas.map((x: any) => x.spell), [1, 2]);
    const neta = c.metricas.find((m: any) => m.clave === "neta")!;
    assert.deepEqual(neta.valores, [280, 1800]);
    assert.deepEqual(neta.mejores, [false, true]);
    const coste = c.metricas.find((m: any) => m.clave === "coste")!;
    assert.deepEqual(coste.mejores, [true, true]);              // empate: las dos son la mejor
    const ventas = c.metricas.find((m: any) => m.clave === "ventas")!;
    assert.deepEqual([ventas.valores, ventas.mejores], [[5, 1], [true, false]]);
    const dias = c.metricas.find((m: any) => m.clave === "dias")!;
    assert.deepEqual([dias.valores, dias.mejores], [[0.4, 10], [true, false]]);
    // Una sola receta: nada que comparar, ninguna marcada.
    assert.ok(compararRecetas(filas, [1], DATOS.objetos).metricas.every((m: any) => m.mejores.every((b: boolean) => !b)));
  });
});

describe("alertas de fabricación", () => {
  test("validación", () => {
    assert.equal(validarAlerta({ tipo: "receta", spell: 1, campo: "neta", umbral: 100 }), null);
    assert.match(validarAlerta({ tipo: "receta", campo: "neta", umbral: 100 })!, /Receta/);
    assert.match(validarAlerta({ tipo: "general", campo: "neta", umbral: 1.5 })!, /cobre/);
    assert.match(validarAlerta({ tipo: "general", campo: "otra", umbral: 1 })!, /ganancia neta o ROI/);
    assert.equal(validarAlerta({ tipo: "general", campo: "roi", umbral: 50.5 }), null);
  });
  test("crear: con id y sin duplicados", () => {
    const l = crearAlerta([], { tipo: "general", campo: "neta", umbral: 1000 }, 1);
    assert.equal(l.length, 1);
    assert.ok(l[0].id);
    assert.throws(() => crearAlerta(l, { tipo: "general", campo: "neta", umbral: 1000 }), /Ya tienes/);
    assert.throws(() => crearAlerta(l, { tipo: "general", campo: "neta" }), /umbral/);
  });
  test("una receta concreta llega al umbral", () => {
    const r = evaluarAlertas(filas, [{ id: "a", tipo: "receta", spell: 1, campo: "neta", umbral: 250 },
                                     { id: "b", tipo: "receta", spell: 1, campo: "neta", umbral: 300 }], DATOS.objetos);
    assert.deepEqual(r.map((x: any) => [x.alerta.id, x.recetas.map((f: any) => f.spell)]), [["a", [1]]]);
  });
  test("alerta general: no avisa de lo que no se vende; respeta profesiones", () => {
    const r = evaluarAlertas(filas, [{ id: "g", tipo: "general", campo: "neta", umbral: 200 }], DATOS.objetos);
    assert.deepEqual(r[0].recetas.map((f: any) => f.spell), [2, 1]);   // la 3 gana más pero no se vende
    const t = evaluarAlertas(filas, [{ id: "t", tipo: "general", campo: "roi", umbral: 0, profesiones: ["Tailoring"] }], DATOS.objetos);
    assert.deepEqual(t, []);                                              // en Sastrería, nada recomendable
  });
});
