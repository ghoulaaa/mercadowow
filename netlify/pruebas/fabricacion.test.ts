// Etapa 1: motor de cálculo de fabricación (app/static/fabricacion.js). Todo en cobre entero.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ORIGEN, REGLA_POR_DEFECTO, analizarReceta, analizarTodas, comisionVenta, crearResolutor,
  depositoSubasta, desglosarMoneda, maxFabricable, precioEquilibrio, rendimiento,
} from "../../app/static/fabricacion.js";
import { formatearMoneda } from "../../app/static/moneda.js";

const FACCION = { ...REGLA_POR_DEFECTO };                       // 5 %, depósito 60 % (24 h), mínimo 1p
const NEUTRAL = { ...REGLA_POR_DEFECTO, comision_pct: 15 };

const receta = (spell: number, resultadoId: number, materiales: [number, number][], min = 1, max = min) =>
  ({ spell, resultadoId, cantidadMin: min, cantidadMax: max, materiales: materiales.map(([id, cantidad]) => ({ id, cantidad })) });

const analizar = (recetas: any[], precios: any, i = 0, opciones: any = {}) =>
  analizarReceta(recetas[i], crearResolutor(recetas, precios, opciones), opciones);

const casi = (a: number | null, b: number) => assert.ok(a != null && Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

describe("moneda", () => {
  test("desglose en oro, plata y cobre", () => {
    assert.deepEqual(desglosarMoneda(1_234_567), { signo: 1, oro: 123, plata: 45, cobre: 67 });
    assert.deepEqual(desglosarMoneda(-170), { signo: -1, oro: 0, plata: 1, cobre: 70 });
    assert.equal(desglosarMoneda(null), null);
    assert.equal(formatearMoneda(170), "1p 70c");
  });
});

describe("ejemplo de la especificación", () => {
  // Tela a 2p; receta 2 telas → 1 producto; producto a 6p; comisión 5 %.
  const recetas = [receta(1, 100, [[2589, 2]])];
  const precios = { 2589: { subasta: 200 }, 100: { subasta: 600 } };
  const r = analizar(recetas, precios);

  test("coste, ingreso, ganancias", () => {
    assert.equal(r.costeFabricacion, 400);
    assert.equal(r.ingresoBruto, 600);
    assert.equal(r.gananciaBruta, 200);
    assert.equal(r.comision, 30);
    assert.equal(r.gananciaNeta, 170);            // 1 plata y 70 cobres
    assert.equal(formatearMoneda(r.gananciaNeta), "1p 70c");
  });
  test("ROI bruto 50 %, ROI neto 42,5 %, margen neto 28,33 %", () => {
    casi(r.roiBruto, 50);
    casi(r.roi, 42.5);
    casi(r.margenNeto, (170 / 600) * 100);
  });
  test("el material dice de dónde sale su precio", () => {
    assert.equal(r.materiales[0].origen, ORIGEN.SUBASTA);
    assert.equal(r.materiales[0].costeTotal, 400);
    assert.equal(r.completo, true);
  });
});

describe("comisión y depósito", () => {
  test("comisión de facción (5 %) y neutral (15 %), redondeo hacia abajo", () => {
    assert.equal(comisionVenta(1000, FACCION), 50);
    assert.equal(comisionVenta(1000, NEUTRAL), 150);
    assert.equal(comisionVenta(19, FACCION), 0);
    assert.equal(comisionVenta(0, FACCION), 0);
  });
  test("casa neutral en el análisis", () => {
    const r = analizar([receta(1, 100, [[1, 1]])], { 1: { subasta: 500 }, 100: { subasta: 1000 } }, 0, { regla: NEUTRAL });
    assert.equal(r.comision, 150);
    assert.equal(r.gananciaNeta, 350);
  });
  test("depósito: % de la venta al NPC, con mínimo por subasta", () => {
    assert.equal(depositoSubasta(100, 1, FACCION), 100);      // 60c < mínimo 1p
    assert.equal(depositoSubasta(1000, 1, FACCION), 600);
    assert.equal(depositoSubasta(1000, 5, FACCION), 3000);
    assert.equal(depositoSubasta(null, 1, FACCION), 100);
  });
  test("el depósito se informa pero NO se resta de la ganancia", () => {
    const recetas = [receta(1, 100, [[1, 1]])];
    const con = analizar(recetas, { 1: { subasta: 500 }, 100: { subasta: 1000, ventaNpc: 1000 } });
    const sin = analizar(recetas, { 1: { subasta: 500 }, 100: { subasta: 1000 } });
    assert.equal(con.deposito, 600);
    assert.equal(sin.deposito, 100);
    assert.equal(con.gananciaNeta, sin.gananciaNeta);
    assert.equal(con.gananciaNeta, 1000 - 50 - 500);
  });
  test("otros costes (p. ej. depósitos que esperas perder) sí se restan", () => {
    const r = analizar([receta(1, 100, [[1, 1]])], { 1: { subasta: 500 }, 100: { subasta: 1000 } }, 0, { otrosCostes: 100 });
    assert.equal(r.gananciaNeta, 350);
    assert.equal(r.gananciaBruta, 500);
  });
});

describe("rendimientos", () => {
  test("receta de varias unidades fijas, lanzada varias veces", () => {
    // 2 materiales a 1p por tanda → 2 unidades; producto a 1p 50c; 5 tandas.
    const r = analizar([receta(1, 100, [[1, 2]], 2)], { 1: { subasta: 100 }, 100: { subasta: 150 } }, 0, { fabricaciones: 5 });
    assert.equal(r.unidadesProducidas, 10);
    assert.equal(r.costeFabricacion, 1000);
    assert.equal(r.ingresoBruto, 1500);
    assert.equal(r.comision, 75);
    assert.equal(r.gananciaNeta, 425);
    assert.equal(r.costeUnidad, 100);
    assert.equal(r.materiales[0].cantidad, 10);
  });
  test("rendimiento variable 1–3: media 2 y peor caso con 1", () => {
    const r = analizar([receta(1, 100, [[1, 1]], 1, 3)], { 1: { subasta: 300 }, 100: { subasta: 200 } });
    assert.deepEqual(r.rendimiento, { min: 1, max: 3, medio: 2 });
    assert.equal(r.ingresoBruto, 400);
    assert.equal(r.gananciaNeta, 400 - 20 - 300);
    assert.equal(r.gananciaNetaMinima, 200 - 10 - 300);
    assert.ok(r.avisos.some((a: string) => a.includes("Rendimiento variable")));
  });
  test("rendimiento no válido", () => {
    assert.throws(() => rendimiento({ spell: 1, cantidadMin: 0 }));
    assert.throws(() => rendimiento({ spell: 1, cantidadMin: 3, cantidadMax: 2 }));
    assert.throws(() => crearResolutor([receta(1, 100, [[1, 1]], 2, 1)], {}));
  });
});

describe("comprar o fabricar los materiales", () => {
  // Transmutación que usa Iron Bar (3575). La barra se funde de 1 Iron Ore (2772).
  const recetas = [
    receta(11479, 3577, [[3575, 1]]),        // Iron Bar → Gold Bar
    receta(3307, 3575, [[2772, 1]]),          // Iron Ore → Iron Bar
  ];
  const precios = { 3575: { subasta: 488 }, 2772: { subasta: 440 }, 3577: { subasta: 2000 } };

  test("B: fundir la barra sale más barato que comprarla", () => {
    const r = analizar(recetas, precios);
    const barra = r.materiales[0];
    assert.equal(barra.origen, ORIGEN.FABRICAR);
    assert.equal(barra.precioUnitario, 440);
    assert.equal(barra.comprar, 488);
    assert.equal(barra.fabricar, 440);
    assert.equal(barra.ahorroFabricando, 48);
    assert.equal(r.costeFabricacion, 440);
  });
  test("A: con fabricarMateriales = false se compra", () => {
    const r = analizar(recetas, precios, 0, { fabricarMateriales: false });
    assert.equal(r.materiales[0].origen, ORIGEN.SUBASTA);
    assert.equal(r.costeFabricacion, 488);
  });
  test("con fabricarIntermedios = false el resolutor nunca fabrica materiales", () => {
    const r = analizar(recetas, precios, 0, { fabricarIntermedios: false });
    assert.equal(r.materiales[0].origen, ORIGEN.SUBASTA);
    assert.equal(r.materiales[0].fabricar, null);
  });
  test("si comprar cuesta lo mismo que fabricar, se compra", () => {
    const r = analizar(recetas, { ...precios, 2772: { subasta: 488 } });
    assert.equal(r.materiales[0].origen, ORIGEN.SUBASTA);
  });
  test("el NPC gana si es más barato que la subasta", () => {
    const r = analizar([receta(1, 100, [[3371, 1]])], { 3371: { subasta: 50, npc: 4 }, 100: { subasta: 100 } });
    assert.equal(r.materiales[0].origen, ORIGEN.NPC);
    assert.equal(r.costeFabricacion, 4);
  });
  test("se elige la receta más barata cuando varias fabrican el mismo material", () => {
    const rs = [receta(1, 100, [[50, 1]]), receta(2, 50, [[60, 1]]), receta(3, 50, [[61, 1]], 2)];
    const r = analizar(rs, { 60: { subasta: 300 }, 61: { subasta: 500 }, 100: { subasta: 1000 } });
    assert.equal(r.materiales[0].origen, ORIGEN.FABRICAR);
    assert.equal(r.materiales[0].precioUnitario, 250);  // 500 / 2 unidades
  });
  test("cadena de 3 niveles con rendimientos: el coste unitario se redondea hacia arriba", () => {
    // Producto ← 1 C;  C (×3) ← 1 B;  B ← 2 A;  A a 10c.  B = 20, C = ceil(20/3) = 7.
    const rs = [receta(1, 100, [[3, 1]]), receta(2, 3, [[2, 1]], 3), receta(3, 2, [[1, 2]])];
    const r = analizar(rs, { 1: { subasta: 10 }, 100: { subasta: 100 } });
    assert.equal(r.costeFabricacion, 7);
  });
});

describe("dependencias: sin ciclos infinitos ni costes duplicados", () => {
  test("ciclo de esencias (3 menores ↔ 1 mayor) termina con costes correctos", () => {
    const L = 10, G = 11;
    const rs = [receta(1, G, [[L, 3]]), receta(2, L, [[G, 1]], 3)];
    const precios = { [L]: { subasta: 100 }, [G]: { subasta: 250 } };
    for (const orden of [[L, G], [G, L]]) {
      const res = crearResolutor(rs, precios);
      const [a, b] = orden.map((id) => res.coste(id));
      const porId = Object.fromEntries([a, b].map((c) => [c.id, c]));
      assert.equal(porId[L].coste, 84);               // ceil(250 / 3), mejor que 100 en subasta
      assert.equal(porId[L].origen, ORIGEN.FABRICAR);
      assert.equal(porId[G].coste, 250);              // 3 × 84 = 252 > 250
      assert.equal(porId[G].origen, ORIGEN.SUBASTA);
    }
  });
  test("una receta que se usa a sí misma no cuelga", () => {
    const r = analizar([receta(1, 5, [[5, 1], [6, 1]])], { 5: { subasta: 100 }, 6: { subasta: 10 } });
    assert.equal(r.costeFabricacion, 110);
  });
  test("ciclo sin ningún precio: coste incompleto, sin colgarse", () => {
    const r = analizar([receta(1, 100, [[7, 1]]), receta(2, 7, [[8, 1]]), receta(3, 8, [[7, 1]])], { 100: { subasta: 1 } });
    assert.equal(r.completo, false);
    assert.deepEqual(r.faltan, [7]);
  });
  test("rombo: un material compartido por dos ramas se cuenta una vez por rama, sin duplicar", () => {
    // P ← 1 B + 1 C;  B ← 2 A;  C ← 3 A;  A a 10c.  Coste = 20 + 30 = 50.
    const rs = [receta(1, 100, [[2, 1], [3, 1]]), receta(2, 2, [[1, 2]]), receta(3, 3, [[1, 3]])];
    const res = crearResolutor(rs, { 1: { subasta: 10 }, 100: { subasta: 100 } });
    const r = analizarReceta(rs[0], res);
    assert.equal(r.costeFabricacion, 50);
    const arbolB = res.arbol(2, 1);
    assert.equal(arbolB.hijos[0].id, 1);
    assert.equal(arbolB.hijos[0].cantidad, 2);
    assert.equal(arbolB.costeTotal, 20);
  });
  test("cadena larga: se resuelve entera y el orden de las consultas no cambia el resultado", () => {
    // I0 ← I1 ← … ← I11; solo I11 es barato; el resto vale 1000 en subasta.
    const rs = Array.from({ length: 11 }, (_, k) => receta(k + 1, k, [[k + 1, 1]]));
    const precios: any = Object.fromEntries(Array.from({ length: 11 }, (_, k) => [k, { subasta: 1000 }]));
    precios[11] = { subasta: 1 };
    assert.equal(crearResolutor(rs, precios).coste(0).coste, 1);
    const res = crearResolutor(rs, precios);
    for (let k = 10; k >= 1; k--) res.coste(k);
    assert.equal(res.coste(0).coste, 1);
  });
  test("con un límite de profundidad corto, lo que queda fuera se compra", () => {
    const rs = Array.from({ length: 5 }, (_, k) => receta(k + 1, k, [[k + 1, 1]]));
    const precios: any = Object.fromEntries(Array.from({ length: 5 }, (_, k) => [k, { subasta: 1000 }]));
    precios[5] = { subasta: 1 };
    assert.equal(crearResolutor(rs, precios, { profundidadMax: 3 }).coste(0).coste, 1000);
  });
});

describe("datos que faltan y precios simulados", () => {
  test("material sin precio: incompleto, sin ganancias ni ROI", () => {
    const r = analizar([receta(1, 100, [[1, 1], [2, 1]])], { 1: { subasta: 100 }, 100: { subasta: 500 } });
    assert.equal(r.completo, false);
    assert.deepEqual(r.faltan, [2]);
    assert.equal(r.costeFabricacion, null);
    assert.equal(r.gananciaNeta, null);
    assert.equal(r.roi, null);
    assert.equal(r.margenNeto, null);
  });
  test("producto sin precio de venta", () => {
    const r = analizar([receta(1, 100, [[1, 1]])], { 1: { subasta: 100 } });
    assert.equal(r.ingresoBruto, null);
    assert.equal(r.gananciaNeta, null);
    assert.equal(r.costeFabricacion, 100);
  });
  test("precio de venta: `venta` del mapa manda sobre `subasta`", () => {
    const r = analizar([receta(1, 100, [[1, 1]])], { 1: { subasta: 100 }, 100: { subasta: 500, venta: 400 } });
    assert.equal(r.precioVenta, 400);
  });
  test("precios manuales: mandan sobre la subasta y se marcan como manuales", () => {
    const recetas = [receta(1, 100, [[1, 2]])];
    const r = analizar(recetas, { 1: { subasta: 200 }, 100: { subasta: 600 } }, 0, { manual: { 1: 250 }, precioVenta: 700 });
    assert.equal(r.materiales[0].origen, ORIGEN.MANUAL);
    assert.equal(r.costeFabricacion, 500);
    assert.equal(r.ingresoBruto, 700);
    assert.equal(r.gananciaNeta, 700 - 35 - 500);
  });
  test("coste cero: ROI sin definir, margen sí", () => {
    const r = analizar([receta(1, 100, [[1, 1]])], { 100: { subasta: 1000 } }, 0, { manual: { 1: 0 } });
    assert.equal(r.costeFabricacion, 0);
    assert.equal(r.roi, null);
    casi(r.margenNeto, 95);
  });
  test("entradas no válidas", () => {
    const rs = [receta(1, 100, [[1, 1]])];
    const p = { 1: { subasta: 1 } };
    assert.throws(() => analizar(rs, p, 0, { fabricaciones: 0 }));
    assert.throws(() => analizar(rs, p, 0, { fabricaciones: 1.5 }));
    assert.throws(() => analizar(rs, p, 0, { otrosCostes: -1 }));
    assert.throws(() => analizar(rs, p, 0, { precioVenta: 1.5 }));
    assert.throws(() => analizar(rs, p, 0, { manual: { 1: -5 } }));
    assert.throws(() => crearResolutor([receta(1, 100, [[1, 0]])], p));
  });
  test("precios ignorados si no son enteros positivos (TSM usa 0 = sin dato)", () => {
    const r = analizar([receta(1, 100, [[1, 1]])], { 1: { subasta: 0, npc: 30 }, 100: { subasta: 100 } });
    assert.equal(r.materiales[0].origen, ORIGEN.NPC);
  });
});

describe("máximo fabricable con el stock publicado", () => {
  test("lo limita el material más escaso", () => {
    const r = analizar([receta(1, 100, [[1, 2], [2, 3], [3, 1]])], {
      1: { subasta: 10, disponible: 45 }, 2: { subasta: 10, disponible: 100 }, 3: { npc: 5 }, 100: { subasta: 500 },
    });
    assert.deepEqual(r.maxFabricable, { veces: 22, limitante: 1, ilimitado: false, limitadoPorIntermedios: false });
  });
  test("sin cantidad publicada conocida (TSM): no se sabe", () => {
    const r = analizar([receta(1, 100, [[1, 2]])], { 1: { subasta: 10 }, 100: { subasta: 500 } });
    assert.equal(r.maxFabricable.veces, null);
  });
  test("solo materiales del NPC: ilimitado", () => {
    assert.deepEqual(maxFabricable({}, [{ id: 1, cantidad: 1, origen: ORIGEN.NPC }]),
      { veces: null, limitante: null, ilimitado: true, limitadoPorIntermedios: false });
  });
});

describe("precio de equilibrio", () => {
  test("mínimo precio unitario que cubre coste y comisión", () => {
    assert.equal(precioEquilibrio(400, 1, FACCION), 421);   // 421 − 21 = 400; 420 − 21 = 399
    assert.equal(precioEquilibrio(0, 1, FACCION), 0);
    const r = analizar([receta(1, 100, [[1, 2]])], { 1: { subasta: 200 }, 100: { subasta: 600 } });
    assert.equal(r.precioEquilibrio, 421);
  });
});

describe("rendimiento con muchas recetas", () => {
  test("2.500 recetas encadenadas se analizan rápido y con cobre exacto", () => {
    const rs: any[] = [];
    const precios: any = {};
    for (let i = 0; i < 2500; i++) {
      const prod = 100_000 + i, mat = 200_000 + (i % 300), inter = 300_000 + (i % 50);
      rs.push(receta(i + 1, prod, [[mat, 3], [inter, 1]], 1, 2));
      precios[prod] = { subasta: 5_000 + i };
      precios[mat] = { subasta: 100 + (i % 300) };
    }
    for (let j = 0; j < 50; j++) rs.push(receta(10_000 + j, 300_000 + j, [[200_000 + j, 2]]));
    const t = performance.now();
    const todas = analizarTodas(rs, precios);
    const ms = performance.now() - t;
    assert.equal(todas.length, 2550);
    assert.ok(todas.every((r: any) => r.costeFabricacion == null || Number.isSafeInteger(r.costeFabricacion)));
    assert.ok(ms < 1000, `tardó ${ms} ms`);
  });
});
