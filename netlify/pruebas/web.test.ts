// Pruebas del código que corre en el navegador: monedas y lectura de CSV.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatearMoneda, parsearMoneda } from "../../app/static/moneda.js";
import { leerCsvPrecios, parsearCsv } from "../../app/static/csv.js";

describe("oro, plata y cobre", () => {
  for (const [cobre, texto] of [
    [0, "0c"], [1, "1c"], [99, "99c"], [100, "1p"], [10_000, "1o"], [10_001, "1o 1c"],
    [123_456, "12o 34p 56c"], [-123_456, "−12o 34p 56c"], [35_298_271_696, "3.529.827o 16p 96c"],
  ] as const) {
    test(`${cobre} → ${texto}`, () => assert.equal(formatearMoneda(cobre), texto));
  }

  test("sin valor → —", () => {
    for (const v of [null, undefined, NaN, Infinity]) assert.equal(formatearMoneda(v as any), "—");
  });

  test("lee cobre entero y 12o 34p 56c / 12g34s56c", () => {
    assert.equal(parsearMoneda("123456"), 123_456);
    assert.equal(parsearMoneda("12o 34p 56c"), 123_456);
    assert.equal(parsearMoneda("12G 34S 56C"), 123_456);
    assert.equal(parsearMoneda("12o"), 120_000);
    assert.equal(parsearMoneda("5p"), 500);
    assert.equal(parsearMoneda(" "), null);
    assert.equal(parsearMoneda(null), null);
  });

  test("ida y vuelta", () => {
    for (const n of [1, 99, 100, 10_000, 123_456, 987_654_321]) {
      assert.equal(parsearMoneda(formatearMoneda(n).replace(/\./g, "")), n);
    }
  });

  for (const malo of ["12.5", "12,5", "-5", "1o 120p", "5p 100c", "abc", "12x"]) {
    test(`rechaza ${JSON.stringify(malo)}`, () => assert.throws(() => parsearMoneda(malo)));
  }
});

describe("CSV de precios", () => {
  const HORA = "2026-11-07T22:16:24Z";

  test("formato TSM tal cual", () => {
    const r = leerCsvPrecios(
      "itemId,name,marketValue,minBuyout,recent,historical,updatedAt\n" +
      `7287,"Red Whelp Scale, big",8050,7500,7500,9900,${HORA}\n`);
    assert.deepEqual(r.errores, []);
    assert.equal(r.horaDato, "2026-11-07T22:16:24.000Z");
    assert.deepEqual(r.filas[0], { item_id: 7287, name: "Red Whelp Scale, big", min_buyout: 7500,
      market_value: 8050, recent: 7500, historical: 9900 });
  });

  test("formato sencillo en español, con ; (Excel) y precios en oro", () => {
    const r = leerCsvPrecios("id;nombre;precio\n2770;Mena de cobre;12p 50c\n2772;Mena de hierro;1o 5p\n",
      "2026-11-08T03:00:00Z");
    assert.deepEqual(r.errores, []);
    assert.equal(r.filas.length, 2);
    assert.equal(r.filas[0].min_buyout, 1250);
    assert.equal(r.filas[1].min_buyout, 10_500);
    assert.equal(r.filas[0].market_value, null);
    assert.equal(r.horaDato, "2026-11-08T03:00:00.000Z");
  });

  test("sin columna de fecha ni hora manual: no se importa", () => {
    const r = leerCsvPrecios("itemId,name,minBuyout\n1,X,5\n");
    assert.equal(r.filas.length, 0);
    assert.match(r.errores[0], /hora del dato/);
  });

  test("un solo error bloquea todo el archivo", () => {
    const r = leerCsvPrecios(`itemId,name,minBuyout,updatedAt\n1,A,5,${HORA}\n2,B,12.5,${HORA}\n3,C,7,${HORA}\n`);
    assert.equal(r.filas.length, 0);
    assert.equal(r.horaDato, null);
    assert.equal(r.errores.length, 1);
    assert.match(r.errores[0], /Línea 3/);
  });

  for (const [nombre, texto, patron] of [
    ["sin columna de id", "name,minBuyout,updatedAt\nX,5," + HORA, /itemId/],
    ["sin precio", "itemId,name,updatedAt\n1,X," + HORA, /precio/],
    ["id no numérico", `itemId,name,minBuyout,updatedAt\nabc,X,5,${HORA}`, /itemId no válido/],
    ["fila sin precios", `itemId,name,minBuyout,updatedAt\n1,X,,${HORA}`, /sin ningún precio/],
    ["fechas mezcladas", `itemId,name,minBuyout,updatedAt\n1,X,5,${HORA}\n2,Y,5,2026-11-08T00:00:00Z`, /fecha distinta/],
    ["fecha futura", "itemId,name,minBuyout,updatedAt\n1,X,5,2099-01-01T00:00:00Z", /futuro/],
    ["columnas desiguales", `itemId,name,minBuyout,updatedAt\n1,X,5`, /columnas/],
    ["comillas sin cerrar", `itemId,name,minBuyout,updatedAt\n1,"X,5,${HORA}`, /comillas/],
    ["vacío", "", /no tiene filas/],
  ] as const) {
    test(`rechaza: ${nombre}`, () => {
      const r = leerCsvPrecios(texto);
      assert.equal(r.filas.length, 0);
      assert.match(r.errores.join(" | "), patron);
    });
  }

  test("objeto repetido: aviso y se queda la última fila", () => {
    const r = leerCsvPrecios(`itemId,name,minBuyout,updatedAt\n1,X,5,${HORA}\n1,X,9,${HORA}\n`);
    assert.equal(r.filas.length, 1);
    assert.equal(r.filas[0].min_buyout, 9);
    assert.equal(r.avisos.length, 1);
  });

  test("parser CSV: comillas dobles y saltos de línea dentro de campos", () => {
    assert.deepEqual(parsearCsv('a,b\n"x ""y""","línea1\nlínea2"\n'), [["a", "b"], ['x "y"', "línea1\nlínea2"]]);
  });
});
