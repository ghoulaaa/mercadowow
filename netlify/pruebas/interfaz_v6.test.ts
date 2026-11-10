// Interfaz V6: etiquetas de filtros, búsquedas recientes, actualización sin reordenar y atajo «/».

import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_RECIENTES, agregarReciente, atajoBuscar, chipsFiltros, fusionarSinReordenar } from "../../app/static/interfaz.js";

const N = {
  categoria: (c: string) => ({ Weapon: "Armas" } as any)[c] ?? c, profesion: (p: string) => p, rol: (r: string) => r,
  familia: (f: string) => f, calidad: (q: string) => ({ RARE: "Raro" } as any)[q] ?? q, oportunidad: (o: string) => o,
  lista: (id: string) => `Lista ${id}`, moneda: (c: number) => `${c}c`,
};

test("etiquetas: una por filtro activo, en el orden de la barra lateral", () => {
  assert.deepEqual(chipsFiltros({}, N), []);
  const c = chipsFiltros({ texto: "linen", categoria: "Weapon", subcategoria: "Sword", calidad: "RARE",
    nivel_min: 10, nivel_max: null, precio_min: null, precio_max: 500, soloOfertas: true, ventasRegion: "5", lista: "3" }, N);
  assert.deepEqual(c.map((x) => x.clave), ["texto", "categoria", "calidad", "nivel", "precio", "ofertas", "region", "lista"]);
  assert.equal(c[1].texto, "Armas › Sword");
  assert.equal(c[3].texto, "Nivel 10–…");
  assert.equal(c[4].texto, "Precio 0–500c");
  assert.equal(c[6].texto, "Región ≥ 5/día");
  // Un nivel mínimo de 0 también es un filtro (no se confunde con «sin filtro»).
  assert.equal(chipsFiltros({ nivel_min: 0 }, N)[0].texto, "Nivel 0–…");
});

test("recientes: lo último primero, sin repetir, con límite", () => {
  let l = agregarReciente([], { texto: "Linen" });
  l = agregarReciente(l, { id: 2589, nombre: "Linen Cloth" });
  l = agregarReciente(l, { texto: " linen " });
  assert.deepEqual(l.map((x: any) => x.id ?? x.texto), [" linen ", 2589]);
  assert.deepEqual(agregarReciente(l, { texto: "   " }), l);   // vacío: no se guarda
  for (let i = 0; i < 20; i++) l = agregarReciente(l, { id: i, nombre: `x${i}` });
  assert.equal(l.length, MAX_RECIENTES);
  assert.equal(l[0].id, 19);
});

test("actualización: mismas filas en su sitio con datos nuevos; avisa si el orden cambió", () => {
  const viejas = [{ id: 1, precio: 10 }, { id: 2, precio: 20 }, { id: 3, precio: 30 }];
  const igual = fusionarSinReordenar(viejas, [{ id: 1, precio: 11 }, { id: 2, precio: 21 }, { id: 3, precio: 31 }]);
  assert.equal(igual.cambioOrden, false);
  assert.equal(igual.filas[0].precio, 11);
  const otro = fusionarSinReordenar(viejas, [{ id: 2, precio: 5 }, { id: 1, precio: 11 }, { id: 4, precio: 40 }]);
  assert.equal(otro.cambioOrden, true);
  assert.deepEqual(otro.filas.map((x: any) => [x.id, x.precio]), [[1, 11], [2, 5], [3, 30]]);   // 3 conserva su último dato
});

test("«/» enfoca el buscador salvo si se escribe en otro campo", () => {
  assert.equal(atajoBuscar({ key: "/" }, { tagName: "BODY" }), true);
  assert.equal(atajoBuscar({ key: "/" }, { tagName: "INPUT" }), false);
  assert.equal(atajoBuscar({ key: "/" }, { tagName: "TEXTAREA" }), false);
  assert.equal(atajoBuscar({ key: "/", ctrlKey: true }, { tagName: "BODY" }), false);
  assert.equal(atajoBuscar({ key: "a" }, { tagName: "BODY" }), false);
});
