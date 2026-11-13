// Fabricación V2 (rediseño): agrupación de variantes, filtros como etiquetas, columnas, oportunidades y lista
// de fabricación. Todo sin DOM; los cálculos vienen de calcularFilas/simularReceta sin cambios.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { calcularFilas, ordenarFilas, simularReceta } from "../../app/static/fabricacion_tabla.js";
import { oportunidades } from "../../app/static/oportunidades.js";
import {
  COLUMNAS_DEFECTO, actividad, agruparPorProducto, anadirALista, chipsFiltros, compararCompraFabricacion, consolidarLista,
  contarFiltrosPanel, diferenciasVariantes, estadoPrecio, etiquetaRiesgo, limpiarFiltros, motivosReferencia, motivosRevision, normalizarColumnas, normalizarLista,
  quitarFiltro, textoMateriales,
} from "../../app/static/fabricacion_ui.js";

// Dos recetas distintas fabrican el mismo objeto (3576): de fuego o de vida. Y un producto sin ofertas.
const DATOS = {
  mercado: "tsm:forever:us:pvp-horde", escaneo: "2026-11-12T15:00:00Z", tope_pct: 150, comision_pct: 5,
  recetas: [
    { s: 10, n: "Transmute: Fire to Earth", p: "Alchemy", l: 235, r: 3576, mn: 1, mx: 1, m: [[7078, 1]] },
    { s: 11, n: "Transmute: Life to Earth", p: "Alchemy", l: 235, r: 3576, mn: 1, mx: 1, m: [[12803, 1]] },
    { s: 20, n: "Linen Bandage", p: "First Aid", l: 1, r: 1251, mn: 1, mx: 1, m: [[2589, 2]] },
    { s: 30, n: "Iron Bar", p: "Mining", l: 125, r: 3575, mn: 1, mx: 1, m: [[2772, 1]] },
    { s: 31, n: "Gold Bar", p: "Mining", l: 155, r: 3577, mn: 1, mx: 1, m: [[3575, 2]] },
  ],
  objetos: {
    7078: { n: "Essence of Fire", s: 900, v: 900 },
    12803: { n: "Living Essence", s: 700, v: 700 },
    3576: { n: "Essence of Earth", s: 2000, v: 2000, dg: 4 },
    2589: { n: "Linen Cloth", s: 200, v: 210, c: 500 },
    1251: { n: "Linen Bandage", s: 600, v: 580, c: 40, d: 12 },
    2772: { n: "Iron Ore", s: 400, v: 400 },
    3575: { n: "Iron Bar", s: 500, v: 500 },
    3577: { n: "Gold Bar", v: 3000 },                       // sin ofertas ahora: referencia
  },
};
const filas = calcularFilas(DATOS);
const por = (spell: number) => filas.find((x: any) => x.spell === spell);

describe("variantes del mismo objeto", () => {
  test("se agrupan por el objeto, sin perder recetas y con la mejor primero", () => {
    const orden = ordenarFilas(filas, "neta", "desc");
    const g = agruparPorProducto(orden);
    assert.equal(g.reduce((s: number, x: any) => s + x.variantes.length, 0), filas.length);   // ninguna receta se pierde
    const tierra = g.find((x: any) => x.id === 3576);
    assert.deepEqual(tierra.variantes.map((v: any) => v.spell), [11, 10]);    // la de vida (más barata) es la recomendada
    assert.equal(tierra.principal.spell, 11);
    // El grupo aparece donde aparece su mejor receta.
    assert.equal(g.findIndex((x: any) => x.id === 3576), orden.findIndex((x: any) => x.id === 3576));
  });
  test("qué cambia entre variantes: ingredientes", () => {
    const d = diferenciasVariantes([por(10), por(11)], (id: number) => DATOS.objetos[id as keyof typeof DATOS.objetos].n);
    assert.deepEqual(d, [{ spell: 10, cambios: ["1 Essence of Fire"] }, { spell: 11, cambios: ["1 Living Essence"] }]);
    assert.deepEqual(diferenciasVariantes([por(20)]), [{ spell: 20, cambios: [] }]);
  });
});

describe("filtros como etiquetas", () => {
  const f = { ...limpiarFiltros({}), profesiones: ["Alchemy", "Mining"], netaMin: 150, roiMin: 20, nivelMin: 100, soloFavoritas: true, soloRentables: true };
  test("una etiqueta por filtro (el interruptor «Solo rentables» ya se ve)", () => {
    const c = chipsFiltros(f, { nombreProf: (p: string) => ({ Alchemy: "Alquimia", Mining: "Minería" } as any)[p], formatear: (v: number) => `${v}c` });
    assert.deepEqual(c.map((x: any) => x.texto), ["Alquimia", "Minería", "Ganancia ≥ 150c", "Retorno ≥ 20 %", "Nivel ≥ 100", "Favoritas"]);
    assert.equal(contarFiltrosPanel(f), 4);        // sin contar las profesiones
  });
  test("se quitan de uno en uno y «Limpiar» deja el texto buscado", () => {
    assert.deepEqual(quitarFiltro(f, "prof:Alchemy").profesiones, ["Mining"]);
    const sinNivel = quitarFiltro({ ...f, nivelMax: 200 }, "nivel");
    assert.deepEqual([sinNivel.nivelMin, sinNivel.nivelMax], [null, null]);
    assert.equal(quitarFiltro(f, "netaMin").netaMin, null);
    const l = limpiarFiltros({ ...f, texto: "barra" });
    assert.equal(l.texto, "barra");
    assert.deepEqual([l.profesiones, l.soloRentables, l.soloFavoritas], [[], false, false]);
    assert.equal(f.profesiones.length, 2);          // no muta el original
  });
});

describe("columnas, actividad y marcas", () => {
  test("columnas guardadas: solo conocidas, en su orden; vacío = por defecto", () => {
    assert.deepEqual(COLUMNAS_DEFECTO, ["coste", "venta", "neta", "roi", "ventas"]);
    assert.deepEqual(normalizarColumnas(["ventas", "neta", "xx", "neta"]), ["neta", "ventas"]);
    assert.deepEqual(normalizarColumnas([]), COLUMNAS_DEFECTO);
    assert.deepEqual(normalizarColumnas(null), COLUMNAS_DEFECTO);
  });
  test("ventas: del reino, de la región (marcada) o sin datos (nunca 0)", () => {
    assert.deepEqual(actividad(por(20)), { valor: 12, regional: false });
    assert.deepEqual(actividad(por(11)), { valor: 4, regional: true });
    assert.equal(actividad(por(30)), null);
  });
  test("precio de referencia y revisión: se explica, el cálculo no cambia", () => {
    assert.match(motivosReferencia(por(31)).join(), /no tiene ofertas ahora/);
    assert.deepEqual(motivosReferencia(por(20)), []);
    const extremo = { ...por(20), roi: 5000 };
    assert.match(motivosRevision(extremo, { motivosSospecha: [] }).join(), /Retorno de más del 1\.?000 %/);
    assert.deepEqual(motivosRevision(por(20), { motivosSospecha: [] }), []);
    assert.equal(por(31).neta, calcularFilas(DATOS).find((x: any) => x.spell === 31).neta);
  });
});

describe("oportunidades: una lista por criterio", () => {
  test("cada criterio reordena las mismas recetas recomendables, sin duplicar objetos", () => {
    const o = oportunidades(filas, DATOS.objetos, { limite: 60 });
    for (const k of ["equilibrio", "ganancia", "roi"]) {
      const g = agruparPorProducto(o[k]);
      assert.equal(new Set(g.map((x: any) => x.id)).size, g.length);
    }
    const r = etiquetaRiesgo({ riesgo: "medio", motivosRiesgo: ["Se vende poco"] });
    assert.deepEqual(r, { nivel: "medio", texto: "Riesgo medio", motivos: ["Se vende poco"] });
  });
  test("sin ventas registradas no se presenta como «no se vende»", () => {
    const o = oportunidades(filas, DATOS.objetos, { limite: 60 });
    const textos = JSON.stringify(o);
    assert.equal(textos.includes("No se vende"), false);
  });
});

describe("precios de los materiales (mismos datos que Mercado)", () => {
  // Bolsa de tela lunar: 4 Madejas de paño rúnico (subasta), 1 Tela lunar (fabricada), 1 tinte sin ofertas
  // (valor de mercado) y 1 material sin precio. Precios de un mismo escaneo, en cobre entero.
  const D = {
    escaneo: "2026-11-13T00:22:40Z", tope_pct: 150, comision_pct: 5,
    recetas: [
      { s: 18445, n: "Mooncloth Bag", p: "Tailoring", l: 230, r: 14155, mn: 1, mx: 1, m: [[14048, 4], [14342, 1], [6261, 1], [7777, 1]] },
      { s: 18560, n: "Mooncloth", p: "Tailoring", l: 230, r: 14342, mn: 1, mx: 1, m: [[14256, 2]] },
    ],
    objetos: {
      14048: { n: "Bolt of Runecloth", s: 3828, v: 3854 },   // 38p 28c, como la compra mínima del Mercado
      14342: { n: "Mooncloth", s: 230000, v: 230000 },
      14256: { n: "Felcloth", s: 7191, v: 7200 },
      6261: { n: "Orange Dye", v: 1200 },                     // sin ofertas: valor de mercado (estimado)
      7777: { n: "Sin precio" },
      14155: { n: "Mooncloth Bag", s: 690000, v: 690000 },
    },
  };
  test("Madeja: 38p 28c por unidad y 1o 53p 12c por cuatro (estimado: solo hay mínimo por unidad)", async () => {
    const { formatearMoneda } = await import("../../app/static/moneda.js");
    const r = simularReceta(D, 18445)!;
    const madeja = r.desglose.materiales.find((m: any) => m.id === 14048);
    assert.equal(madeja.precioUnitario, 3828);
    assert.equal(formatearMoneda(madeja.precioUnitario), "38p 28c");
    assert.equal(madeja.costeTotal, 15312);
    assert.equal(formatearMoneda(madeja.costeTotal), "1o 53p 12c");
    assert.deepEqual([estadoPrecio(madeja).texto, estadoPrecio(madeja).estimado], ["Subasta · Compra mínima", true]);
    assert.equal(estadoPrecio({ ...madeja, cantidad: 1 }).estimado, false);   // una unidad: precio exacto
  });
  test("Tela lunar fabricada: coste fabricado y precio de compra por separado; ahorro comparable", () => {
    const tela = simularReceta(D, 18445)!.desglose.materiales.find((m: any) => m.id === 14342);
    assert.equal(tela.origen, "fabricar");
    assert.equal(tela.precioUnitario, 2 * 7191);
    assert.deepEqual(compararCompraFabricacion(tela), { comprar: 230000, fabricar: 14382, ahorro: 230000 - 14382 });
    assert.equal(tela.hijos[0].id, 14256);
    assert.equal(estadoPrecio(tela).texto, "Fabricado");
    assert.deepEqual(compararCompraFabricacion({ comprar: null, fabricar: 10 }), { comprar: null, fabricar: 10, ahorro: null });
  });
  test("sin ofertas (valor de mercado) y sin precio: estimado e incompleto", () => {
    const r = simularReceta(D, 18445)!;
    const tinte = r.desglose.materiales.find((m: any) => m.id === 6261);
    assert.deepEqual([estadoPrecio(tinte).texto, estadoPrecio(tinte).estimado], ["Estimado · Valor de mercado", true]);
    const sin = r.desglose.materiales.find((m: any) => m.id === 7777);
    assert.deepEqual([estadoPrecio(sin).texto, estadoPrecio(sin).incompleto], ["Sin precio", true]);
    assert.equal(r.a.completo, false);
    assert.equal(r.a.costeFabricacion, null);
  });
  test("precio manual: solo cambia este cálculo y se marca", () => {
    const m = simularReceta(D, 18445, { manual: { 14048: 3000 } })!;
    const madeja = m.desglose.materiales.find((x: any) => x.id === 14048);
    assert.deepEqual([madeja.origen, madeja.costeTotal, estadoPrecio(madeja).texto], ["manual", 12000, "Precio manual"]);
    assert.equal(simularReceta(D, 18445)!.desglose.materiales.find((x: any) => x.id === 14048).precioUnitario, 3828);
  });
  test("escaneo nuevo: con los precios nuevos, todo se recalcula a la vez (también los fabricados)", () => {
    const nuevo = { ...D, objetos: { ...D.objetos, 14048: { ...D.objetos[14048], s: 4000 }, 14256: { ...D.objetos[14256], s: 7000 } } };
    const a = simularReceta(nuevo, 18445)!;
    const madeja = a.desglose.materiales.find((m: any) => m.id === 14048);
    const tela = a.desglose.materiales.find((m: any) => m.id === 14342);
    assert.deepEqual([madeja.precioUnitario, madeja.costeTotal, tela.precioUnitario, tela.hijos[0].precioUnitario], [4000, 16000, 14000, 7000]);
  });
});

describe("lista de fabricación", () => {
  const simular = (spell: number, veces: number) => simularReceta(DATOS, spell, { fabricaciones: veces });
  test("normaliza lo guardado y suma veces al añadir otra vez", () => {
    const l = normalizarLista({ items: [{ spell: 20, veces: 2 }, { spell: 20, veces: 9 }, { spell: -1 }, { spell: 31, veces: 0 }], tengo: { 2589: 3, x: 1, 7: -2 } });
    assert.deepEqual(l, { items: [{ spell: 20, veces: 2 }, { spell: 31, veces: 1 }], tengo: { 2589: 3 } });
    assert.deepEqual(anadirALista(l, 20, 3).items[0], { spell: 20, veces: 5 });
    assert.deepEqual(anadirALista(l, 30).items.at(-1), { spell: 30, veces: 1 });
  });
  test("consolida materiales compartidos y lo fabricado se cambia por sus materiales", () => {
    // 2 × venda (4 telas) + 1 barra de oro (2 barras de hierro fabricadas → 2 menas).
    const c = consolidarLista({ items: [{ spell: 20, veces: 2 }, { spell: 31, veces: 1 }], tengo: { 2589: 3 } }, simular);
    const m = Object.fromEntries(c.materiales.map((x: any) => [x.id, x]));
    assert.deepEqual([m[2589].necesito, m[2589].tengo, m[2589].falta, m[2589].pendiente], [4, 3, 1, 200]);
    assert.equal(m[3575], undefined);                  // la barra de hierro se fabrica: no se compra
    assert.equal(m[2772].necesito, 2);
    // Lo que ya tienes no es gratis: el coste económico es el de todo; el gasto pendiente, solo lo que falta.
    assert.equal(c.costeTotal, 4 * 200 + 2 * 400);
    assert.equal(c.pendiente, 1 * 200 + 2 * 400);
    assert.equal(c.neta, simular(20, 2)!.a.gananciaNeta + simular(31, 1)!.a.gananciaNeta);
  });
  test("una receta que ya no existe no rompe la lista; texto para copiar", () => {
    const c = consolidarLista({ items: [{ spell: 999, veces: 1 }], tengo: {} }, (s: number, v: number) => (s === 999 ? null : simular(s, v)));
    assert.deepEqual([c.recetas[0].existe, c.materiales.length, c.costeTotal], [false, 0, 0]);
    assert.equal(textoMateriales([{ cantidad: 3, nombre: "Hierro" }, { cantidad: 1.5, nombre: "Lino" }]), "3 × Hierro\n1.50 × Lino");
  });
});
