// X3 (plan V5): referencia regional de TSM — lectura del archivo, guardado aparte, ficha y filtro.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { paramsMercado, textoTasa, textoVentasDia } from "../../app/static/mercado.js";
import { ErrorFormato, actualizarRegion, leerArchivoRegion, type Db } from "../../supabase/functions/actualizar-mercado/nucleo.ts";

const TSM = "tsm:forever:us:pvp-horde";
const DEMO = "demo:forever:us:demo";
const CAB = "itemId,name,marketValue,historical,avgSalePrice,saleRate,soldPerDay,updatedAt";
const F = "2026-11-09T08:25:55Z";
const ARCHIVO = [CAB,
  `2589,Linen Cloth,120,110,95,0.666,1520.5,${F}`,
  `2840,Copper Bar,400,380,0,0.1,0.25,${F}`,        // venta media 0 → sin dato
  `765,"Silverleaf, la hierba",30,28,25,0,0,${F}`,   // nunca se vende
].join("\n");

test("archivo regional: lee las columnas y convierte 0 en «sin dato» solo en precios", () => {
  const a = leerArchivoRegion(ARCHIVO);
  assert.equal(a.updatedAt, "2026-11-09T08:25:55.000Z");
  assert.equal(a.filas.length, 3);
  assert.deepEqual(a.filas[0], { item_id: 2589, market_value: 120, historical: 110, avg_sale_price: 95, sale_rate: 0.666, sold_per_day: 1520.5 });
  assert.equal(a.filas[1].avg_sale_price, null);
  assert.equal(a.filas[2].sale_rate, 0);          // una tasa 0 es un dato real (no se vende), no se borra
  assert.equal(a.filas[2].sold_per_day, 0);
});

test("archivo regional: un formato distinto falla en vez de guardar datos dudosos", () => {
  assert.throws(() => leerArchivoRegion("itemId,name,marketValue\n1,a,2"), ErrorFormato);
  assert.throws(() => leerArchivoRegion(`${CAB}\n2589,x,1,1,1,1.5,1,${F}`), /fuera de rango/);   // tasa > 100 %
  assert.throws(() => leerArchivoRegion(`${CAB}\n2589,x,1,1,1,-1,1,${F}`), /no es un número/);
  assert.throws(() => leerArchivoRegion(`${CAB}\n2589,x,1,1,1,0.5,1,${F}\n2840,y,1,1,1,0.5,1,2026-11-10T00:00:00Z`), /updatedAt distinto/);
  assert.throws(() => leerArchivoRegion(CAB), /no tiene filas/);
});

test("filtro: solo se envían los umbrales que ofrece la página", () => {
  assert.deepEqual(paramsMercado({ ventasRegion: "5" }), { ventas_region_min: "5" });
  assert.deepEqual(paramsMercado({ ventasRegion: "" }), {});
  assert.deepEqual(paramsMercado({ ventasRegion: "7" }), {});
  assert.equal(textoTasa(0.666), "66,6 %");
  assert.equal(textoTasa(null), null);
  assert.equal(textoVentasDia(0.25), "0,25");
  assert.equal(textoVentasDia(1520.5), "1521");
});

describe("referencia regional (SQL)", () => {
  let pg: PGlite;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
  const db: Db = { consulta: async (q, p) => (await pg.query<any>(q, p as unknown[])).rows };
  const pagina = async (p: object = {}, mk = TSM) => (await uno("select mercado_pagina($1, $2::jsonb) as r", [mk, JSON.stringify(p)])).r;
  const ids = async (p: object) => (await pagina(p)).filas.map((f: any) => f.id).sort((a: number, b: number) => a - b);
  const respuesta = (cuerpo: string, status = 200) => (async () => new Response(cuerpo, { status })) as unknown as typeof fetch;

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec("create role anon; create role authenticated;");
    await pg.exec(leer("0001_esquema.sql"));
    await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
    for (const n of ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql", "0006_motor.sql", "0007_inventario.sql",
                     "0008_ventas.sql", "0009_ahledger.sql", "0010_catalogo.sql", "0013_textos_fuente.sql", "0014_tasas.sql",
                     "0015_recetas.sql", "0017_mercado_pagina.sql", "0018_evidencia.sql", "0019_catalogo_ampliado.sql",
                     "0020_precios_tsm.sql", "0021_materiales.sql", "0025_oportunidades.sql", "0026_region.sql"]) await pg.exec(leer(n));
    const cat = [
      { id: 2589, name: "Linen Cloth", itemClass: "Trade Goods", itemSubclass: "Cloth" },
      { id: 2840, name: "Copper Bar", itemClass: "Trade Goods", itemSubclass: "Metal & Stone" },
      { id: 765, name: "Silverleaf", itemClass: "Trade Goods", itemSubclass: "Herb" },
      { id: 118, name: "Minor Healing Potion", itemClass: "Consumable", itemSubclass: "Potions" },
    ].map((x) => ({ ...x, quality: "COMMON" }));
    await uno("select guardar_catalogo('forever', $1::jsonb)", [JSON.stringify(cat)]);
  });

  test("sin archivo importado: la ficha y la página lo dicen (null), sin inventar nada", async () => {
    const f = (await uno("select ficha_objeto($1, 2589) as r", [TSM])).r;
    assert.equal(f.nombre, "Linen Cloth");      // la ficha de siempre sigue igual
    assert.equal(f.region, null);
    assert.equal(f.region_estado, null);
    assert.equal((await pagina()).region, null);
    assert.equal((await uno("select ficha_objeto($1, 99999) as r", [TSM])).r, null);
  });

  test("importación diaria: se guarda aparte, una vez al día, y alimenta ficha y filtro", async () => {
    const r = await actualizarRegion(db, { fetch: respuesta(ARCHIVO), ahora: () => new Date("2026-11-10T12:00:00Z") });
    assert.deepEqual(r, { estado: "ok", guardadas: 3, actualizado: "2026-11-09T08:25:55.000Z" });
    // Nunca toca los precios del reino.
    assert.equal(Number((await uno("select count(*) as n from price_hourly")).n), 0);
    // Al día: no vuelve a descargar.
    let pedidas = 0;
    const contar = (async () => { pedidas++; return new Response(ARCHIVO); }) as unknown as typeof fetch;
    assert.equal((await actualizarRegion(db, { fetch: contar, ahora: () => new Date("2026-11-11T08:00:00Z") })).motivo, "al_dia");
    assert.equal(pedidas, 0);
    // Pasado ~1 día, sí.
    assert.equal((await actualizarRegion(db, { fetch: contar, ahora: () => new Date("2026-11-11T12:30:00Z") })).estado, "ok");
    assert.equal(pedidas, 1);

    const f = (await uno("select ficha_objeto($1, 2589) as r", [TSM])).r;
    assert.equal(f.region.region, "US");
    assert.equal(f.region.venta_media, 95);
    assert.equal(Number(f.region.tasa_venta), 0.666);
    assert.equal(Number(f.region.ventas_dia), 1520.5);
    assert.equal((await uno("select ficha_objeto($1, 2840) as r", [TSM])).r.region.venta_media, null);
    assert.equal((await uno("select ficha_objeto($1, 118) as r", [TSM])).r.region, null);   // no viene en el archivo
    assert.ok((await uno("select ficha_objeto($1, 118) as r", [TSM])).r.region_estado);

    assert.deepEqual(await ids({ ventas_region_min: "1" }), [2589]);
    assert.deepEqual(await ids({ ventas_region_min: "0.25" }), [2589, 2840]);
    assert.equal((await pagina()).filas.find((x: any) => x.id === 765).ventas_region, 0);
    assert.equal((await pagina()).filas.find((x: any) => x.id === 118).ventas_region, null);
    await assert.rejects(pagina({ ventas_region_min: "mucho" }), /ventas_region_min no válido/);
  });

  test("errores de la fuente: no se borra lo que ya había", async () => {
    await actualizarRegion(db, { fetch: respuesta(ARCHIVO), ahora: () => new Date("2026-11-10T12:00:00Z") });
    const tarde = () => new Date("2026-11-12T12:00:00Z");
    assert.deepEqual(await actualizarRegion(db, { fetch: respuesta("", 503), ahora: tarde }), { estado: "error", motivo: "HTTP 503" });
    assert.equal((await actualizarRegion(db, { fetch: respuesta("a,b\n1,2"), ahora: tarde })).estado, "error");
    assert.equal(Number((await uno("select count(*) as n from region_items")).n), 3);
    // El turno se suelta siempre.
    assert.equal((await uno("select value from settings where key = 'region_turno_hasta'")).value, "-infinity");
    await assert.rejects(uno("select guardar_region('forever', 'us', '[]'::jsonb, now())"), /vacío/);
  });

  test("el mercado de demostración no muestra la referencia regional", async () => {
    await actualizarRegion(db, { fetch: respuesta(ARCHIVO), ahora: () => new Date("2026-11-10T12:00:00Z") });
    assert.equal((await pagina({}, DEMO)).region, null);
  });
});
