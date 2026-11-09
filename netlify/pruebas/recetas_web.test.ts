// R5: filtros, orden y comparador de la sección Profesiones (módulo sin DOM) y la API /api/recetas.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_COMPARAR, anadirComparar, costeUnidad, filtrarRecetas, mejorReceta, ordenarRecetas, pesosReactivos,
} from "../../app/static/recetas.js";
import { crearApi } from "../lib/api.ts";

const rec = (spell: number, o: any = {}) => ({
  spell, nombre: o.nombre ?? `Receta ${spell}`, nivel: o.nivel ?? 100, completa: o.coste != null, coste: o.coste ?? null,
  neto: o.neto ?? null, margen: o.coste != null && o.neto != null ? o.neto - o.coste : null,
  margen_pct: o.coste && o.neto != null ? (o.neto - o.coste) / o.coste : null, ganancia_dia: o.gd ?? null,
  resultado: { id: o.res ?? spell + 1000, nombre: o.resNombre ?? `Objeto ${spell}`, rendimiento: o.rend ?? 1, ventas_dia: o.ventas ?? null },
  reactivos: o.reactivos ?? [{ id: 1, nombre: "Hierro", cantidad: 2, coste: o.coste }],
});

const LISTA = [
  rec(1, { nombre: "Poción de maná", coste: 100, neto: 300, ventas: 2, nivel: 50 }),
  rec(2, { nombre: "Elixir", coste: 500, neto: 400, nivel: 150, reactivos: [{ id: 8831, nombre: "Loto púrpura", cantidad: 3, coste: 500 }] }),
  rec(3, { nombre: "Sin precio", nivel: 200 }),
  rec(4, { nombre: "Poción menor", coste: 50, neto: 250, ventas: 0, nivel: 10 }),
];

describe("filtros de recetas", () => {
  test("solo completas, rentables, que se venden y por habilidad", () => {
    assert.deepEqual(filtrarRecetas(LISTA, { soloCompletas: true }).map((r) => r.spell), [1, 2, 4]);
    assert.deepEqual(filtrarRecetas(LISTA, { soloRentables: true }).map((r) => r.spell), [1, 4]);
    assert.deepEqual(filtrarRecetas(LISTA, { soloConVentas: true }).map((r) => r.spell), [1]);
    assert.deepEqual(filtrarRecetas(LISTA, { nivelMin: 40, nivelMax: 160 }).map((r) => r.spell), [1, 2]);
  });
  test("texto sin tildes ni mayúsculas, en receta, resultado o reactivo; o por ID", () => {
    assert.deepEqual(filtrarRecetas(LISTA, { texto: "POCION" }).map((r) => r.spell), [1, 4]);
    assert.deepEqual(filtrarRecetas(LISTA, { texto: "loto purpura" }).map((r) => r.spell), [2]);
    assert.deepEqual(filtrarRecetas(LISTA, { texto: "8831" }).map((r) => r.spell), [2]);
    assert.deepEqual(filtrarRecetas(LISTA, { texto: "1003" }).map((r) => r.spell), [3]);   // ID del resultado
  });
});

describe("orden de recetas", () => {
  test("margen mayor primero; desconocidos siempre al final", () => {
    assert.deepEqual(ordenarRecetas(LISTA, "margen:desc").map((r) => r.spell), [1, 4, 2, 3]);
    assert.deepEqual(ordenarRecetas(LISTA, "margen:asc").map((r) => r.spell), [2, 1, 4, 3]);
    assert.deepEqual(ordenarRecetas(LISTA, "coste:asc").map((r) => r.spell), [4, 1, 2, 3]);
    assert.deepEqual(ordenarRecetas(LISTA, "nombre:asc").map((r) => r.nombre), ["Elixir", "Poción de maná", "Poción menor", "Sin precio"]);
  });
});

describe("reparto del coste y comparador", () => {
  test("peso de cada material en el coste; null si está incompleto", () => {
    const r = rec(9, { coste: 400, reactivos: [{ id: 1, nombre: "a", cantidad: 1, coste: 300 }, { id: 2, nombre: "b", cantidad: 1, coste: 100 }] });
    assert.deepEqual(pesosReactivos(r), [0.75, 0.25]);
    assert.deepEqual(pesosReactivos(LISTA[2]), [null]);
  });
  test("mejor receta: la más barata POR UNIDAD con coste completo", () => {
    const a = rec(1, { coste: 300, rend: 1 }), b = rec(2, { coste: 500, rend: 2 }), c = rec(3, {});
    assert.equal(mejorReceta([a, b, c])!.spell, 2);
    assert.equal(costeUnidad(mejorReceta([a, b, c])), 250);
    assert.equal(mejorReceta([c]), null);
    assert.equal(costeUnidad(null), null);
  });
  test("añadir al comparador: sin duplicados y con máximo", () => {
    assert.deepEqual(anadirComparar([1], 2), { lista: [1, 2], error: null });
    assert.match(anadirComparar([1], 1).error!, /Ya está/);
    assert.match(anadirComparar(Array.from({ length: MAX_COMPARAR }, (_, i) => i + 1), 99).error!, /Máximo/);
    assert.match(anadirComparar([], 0).error!, /no válido/);
  });
});

describe("API /api/recetas", () => {
  const CLAVE = "una-clave-larga-de-prueba";
  const llamadas: [string, unknown[]][] = [];
  const db = { consulta: async (s: string, p: unknown[]) => { llamadas.push([s, p]); return [{ r: { ok: true } }]; } };
  const api = crearApi(db as any, { clave: CLAVE, mercado: "ahledger:forever:us:pvp-horde", proyecto: "p" });
  const conSesion = async () => {
    const l = await api.login(new Request("https://x/api/login", { method: "POST", body: JSON.stringify({ clave: CLAVE }) }), "1.1.1.1");
    return l.headers.get("set-cookie")!.split(";")[0];
  };

  test("pide sesión, valida y llama a la función adecuada", async () => {
    assert.equal((await api.recetas(new Request("https://x/api/recetas"))).status, 401);
    const cookie = await conSesion();
    const get = (q: string) => api.recetas(new Request(`https://x/api/recetas${q}`, { headers: { cookie } }));
    assert.equal((await get("?base=media")).status, 400);
    assert.equal((await get("?objeto=abc")).status, 400);
    llamadas.length = 0;
    assert.equal((await get("")).status, 200);
    assert.equal((await get("?profesion=Alchemy&base=minimo")).status, 200);
    assert.equal((await get("?objeto=8925")).status, 200);
    assert.match(llamadas[0][0], /profesiones_recetas/);
    assert.match(llamadas[1][0], /recetas_profesion/);
    assert.deepEqual(llamadas[1][1], ["ahledger:forever:us:pvp-horde", "Alchemy", "minimo"]);
    assert.match(llamadas[2][0], /recetas_objeto/);
    assert.deepEqual(llamadas[2][1], ["ahledger:forever:us:pvp-horde", 8925, "mediana"]);
  });
});
