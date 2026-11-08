// Proveedor AHledger: lector de la tabla AHL1, nombres por /v1/tooltip y flujo completo contra PGlite.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  ejecutar, ejecutarTodos, leerTablaAhledger, slugAhledger, ErrorFormato, type Db,
} from "../functions/actualizar-mercado/nucleo.ts";

const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
const AHL = "ahledger:forever:us:pvp-horde", TSM = "tsm:forever:us:pvp-horde";
const T = 1794115895;   // cabecera real del 08/11/2026 05:31:35 UTC
const tabla = (filas: string[], slug = "forever/pvp/horde/us", n = filas.length, t = T) =>
  [`AHL1|${slug}|${t}|${n}`, ...filas].join("\n") + "\n";
const FILAS = ["2589:28:13:19756:30:30:2:35:138931", "2592:150:119:6449:194:194:23:323:108224", "7082::::::::"];

describe("tabla AHL1", () => {
  test("slug del mercado", () => assert.equal(slugAhledger(AHL), "forever/pvp/horde/us"));

  test("lee filas reales con campos vacíos como null", () => {
    const a = leerTablaAhledger(tabla(FILAS), "forever/pvp/horde/us");
    assert.equal(a.updatedAt, "2026-11-08T05:31:35.000Z");
    const lino = a.filas.find((f) => f.item_id === 2589)!;
    assert.deepEqual(lino, { item_id: 2589, median: 28, market_value: 28, min_buyout: 13, quantity: 19756,
      historical: 30, recent: null, auctions: null, sales_per_day: 13893.1 });
    const esencia = a.filas.find((f) => f.item_id === 7082)!;
    assert.equal(esencia.min_buyout, null);
    assert.equal(esencia.sales_per_day, null);
  });

  for (const [nombre, texto, patron] of [
    ["otro mercado (Alianza)", tabla(FILAS, "forever/pvp/alliance/us"), /mercado forever\/pvp\/alliance\/us/],
    ["otra región", tabla(FILAS, "forever/pvp/horde/eu"), /no de forever\/pvp\/horde\/us/],
    ["descarga cortada", tabla(FILAS, undefined, 5), /anuncia 5 filas/],
    ["cabecera rara", "XYZ|a|b|c\n1:1:1:1:1:1:1:1:1\n", /Cabecera inesperada/],
    ["campos de menos", tabla(["1:2:3"]), /3 campos en vez de 9/],
    ["decimal", tabla(["1:2.5:3:4:5:6:7:8:9"]), /no es un entero/],
    ["vacía", tabla([], undefined, 0), /no tiene filas/],
  ] as const) {
    test(`rechaza: ${nombre}`, () => assert.throws(() => leerTablaAhledger(texto, "forever/pvp/horde/us"), ErrorFormato));
    test(`mensaje: ${nombre}`, () => assert.throws(() => leerTablaAhledger(texto, "forever/pvp/horde/us"), patron));
  }
});

describe("flujo AHledger contra Postgres", () => {
  let pg: PGlite;
  let db: Db;
  let pedidas: string[];
  let reloj: Date;
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];

  // Respuestas: la tabla y el tooltip (que no conoce el 7082, para probar el nombre pendiente).
  const fetchFalso = (opciones: { tabla?: string; status?: number; tooltipFalla?: boolean; etag?: string } = {}) =>
    (async (url: string, init?: RequestInit) => {
      pedidas.push(url);
      if (url.includes("/tooltip/")) {
        if (opciones.tooltipFalla) return new Response("x", { status: 503 });
        const ids = new URL(url).searchParams.get("items")!.split(",").map(Number);
        const conocidos: Record<number, object> = {
          2589: { id: 2589, name: "Linen Cloth", quality: "COMMON", itemClass: "Trade Goods", level: 5,
                  icon: "https://render.worldofwarcraft.com/classic1x-us/icons/56/inv_fabric_linen_01.jpg" },
          2592: { id: 2592, name: "Wool Cloth", quality: "COMMON", itemClass: "Trade Goods", level: 15,
                  icon: "https://evil.example.com/x.jpg" },
        };
        return Response.json({ items: ids.filter((i) => conocidos[i]).map((i) => conocidos[i]) });
      }
      const h = (init?.headers ?? {}) as Record<string, string>;
      const etag = opciones.etag ?? '"t1"';
      if (h["If-None-Match"] === etag) return new Response(null, { status: 304 });
      return new Response(opciones.tabla ?? tabla(FILAS), { status: opciones.status ?? 200, headers: { ETag: etag } });
    }) as typeof fetch;

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec("create role anon; create role authenticated;");
    await pg.exec(leer("0001_esquema.sql"));
    await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
    for (const n of ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql", "0006_motor.sql",
                     "0007_inventario.sql", "0008_ventas.sql", "0009_ahledger.sql"]) await pg.exec(leer(n));
    db = { consulta: async (s, p) => (await pg.query<Record<string, unknown>>(s, p)).rows };
    pedidas = [];
    reloj = new Date("2026-11-08T06:00:00Z");
  });

  const correr = (f = fetchFalso()) => ejecutar(db, { mercado: AHL, fetch: f, ahora: () => new Date(reloj) });

  test("primera descarga: precios con mediana, cantidad y ventas estimadas; nombres del tooltip", async () => {
    const r = await correr();
    assert.equal(r.estado, "nuevo_dato");
    assert.equal(pedidas[0], "https://api.ahledger.com/v1/pricetable/forever.pvp.horde.us");
    assert.ok(pedidas.some((u) => u.startsWith("https://api.ahledger.com/v1/tooltip/forever.pvp.horde.us?items=")));
    const p = await uno(`select p.*, i.name, i.quality, i.item_class, i.level, i.icon_url, s.origen
                           from price_hourly p join items i using (market_id, item_id) join snapshots s on s.id = p.snapshot_id
                          where p.item_id = 2589`);
    assert.equal(p.name, "Linen Cloth");
    assert.equal(Number(p.min_buyout), 13);
    assert.equal(Number(p.median), 28);
    assert.equal(p.quantity, 19756);
    assert.equal(Number(p.sales_per_day), 13893.1);
    assert.equal(Number(p.historical), 30);
    assert.equal(p.origen, "ahledger");
    assert.equal(new Date(p.hour).toISOString(), "2026-11-08T05:00:00.000Z");
    assert.equal(p.quality, "COMMON");
    assert.match(p.icon_url, /^https:\/\/render\.worldofwarcraft\.com\//);
  });

  test("icono de un dominio no oficial: se guarda el objeto pero sin ese icono", async () => {
    await correr();
    const lana = await uno("select name, icon_url, metadata_source from items where item_id = 2592");
    assert.equal(lana.name, "Wool Cloth");
    assert.equal(lana.icon_url, null);
    assert.equal(lana.metadata_source, "ahledger");
  });

  test("objeto sin datos en el tooltip: nombre pendiente y se reintenta en la siguiente versión", async () => {
    await correr();
    assert.equal((await uno("select name, metadata_source from items where item_id = 7082")).metadata_source, "pendiente");
    reloj = new Date(reloj.getTime() + 61 * 60_000);
    pedidas = [];
    await correr(fetchFalso({ tabla: tabla(FILAS, undefined, 3, T + 3600), etag: '"t2"' }));
    const tooltip = pedidas.find((u) => u.includes("/tooltip/"))!;
    assert.match(tooltip, /items=7082$/);    // solo el pendiente, no los ya conocidos
  });

  test("304: no hay observación nueva ni llamadas al tooltip", async () => {
    await correr();
    reloj = new Date(reloj.getTime() + 61 * 60_000);
    pedidas = [];
    assert.equal((await correr()).estado, "no_modificado");
    assert.equal(pedidas.length, 1);
    assert.equal(Number((await uno("select count(*) n from snapshots")).n), 1);
  });

  test("si el tooltip falla, los precios se guardan igual con nombre pendiente", async () => {
    const r = await correr(fetchFalso({ tooltipFalla: true }));
    assert.equal(r.estado, "nuevo_dato");
    assert.equal(Number((await uno("select count(*) n from price_hourly")).n), 3);
    assert.equal((await uno("select name from items where item_id = 2589")).name, "Objeto #2589");
  });

  test("tabla de otro mercado: error y nada guardado", async () => {
    const r = await correr(fetchFalso({ tabla: tabla(FILAS, "forever/pvp/alliance/us") }));
    assert.equal(r.estado, "error");
    assert.match(String(r.detalle.mensaje), /alliance/);
    assert.equal(Number((await uno("select count(*) n from price_hourly")).n), 0);
  });

  test("los precios de AHledger quedan solo en su mercado (TSM no se toca)", async () => {
    await correr();
    const r = await uno(`select count(*) filter (where m.key = $1)::int ahl, count(*)::int total
                           from price_hourly p join markets m on m.id = p.market_id`, [AHL]);
    assert.equal(r.ahl, 3);
    assert.equal(r.total, 3);
    await assert.rejects(pg.query(
      `insert into snapshots (market_id, origen, source_updated_at, row_count) select id, 'ahledger', now(), 1 from markets where key = $1`,
      [TSM]), /no corresponde/);
  });

  test("ejecutarTodos recorre TSM y AHledger, y un fallo no frena al otro", async () => {
    const f = (async (url: string, init?: RequestInit) => {
      pedidas.push(url);
      if (url.includes("tradeskillmaster")) return new Response("caído", { status: 503 });
      return fetchFalso()(url, init);
    }) as typeof fetch;
    const r = await ejecutarTodos(db, { fetch: f, ahora: () => new Date(reloj) });
    assert.equal(r[AHL].estado, "nuevo_dato");
    assert.equal(r[TSM].estado, "error");
  });

  test("tabla de precios y estado muestran cantidad, mediana, calidad, icono y atribución", async () => {
    await correr();
    await uno("select recalcular_recomendaciones($1)", [AHL]);
    const t = (await uno("select tabla_precios($1) as r", [AHL])).r;
    const lino = t.find((x: any) => x.id === 2589);
    assert.equal(lino.cantidad, 19756);
    assert.equal(lino.mediana, 28);
    assert.equal(lino.ventas_dia, 13893.1);
    assert.equal(lino.calidad, "COMMON");
    assert.equal(lino.nivel_objeto, 5);
    assert.equal(lino.nivel, "Baja");        // sigue siendo el nivel de CONFIANZA
    const e = (await uno("select estado_mercado($1) as r", [AHL])).r;
    assert.deepEqual(e.mercado.atribucion, { texto: "Prices from AHledger", url: "https://ahledger.com" });
    const lista = (await uno("select listar_mercados() as r")).r;
    assert.equal(lista[0].clave, AHL);
  });

  test("TSM sigue funcionando con la función de registro nueva", async () => {
    const csv = "itemId,name,marketValue,minBuyout,recent,historical,updatedAt\n1,X,10,9,9,11,2026-11-07T22:16:24Z\n";
    const r = await ejecutar(db, { mercado: TSM, ahora: () => new Date(reloj),
      fetch: (async () => new Response(csv, { status: 200, headers: { ETag: '"a"' } })) as typeof fetch });
    assert.equal(r.estado, "nuevo_dato");
    const p = await uno("select median, quantity, market_value from price_hourly where item_id = 1");
    assert.equal(p.median, null);
    assert.equal(p.quantity, null);
    assert.equal(Number(p.market_value), 10);
  });
});
