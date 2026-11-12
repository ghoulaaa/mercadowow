// Fichas oficiales de Blizzard para el cuadro del icono: líneas al estilo del juego, importación y lectura.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { lineasTooltip } from "../../app/static/tooltip.js";
import { actualizarFichas, type Db } from "../../supabase/functions/actualizar-mercado/nucleo.ts";

const TSM = "tsm:forever:us:pvp-horde";

// Vista previa con la forma que publica Blizzard (textos de ejemplo, no de un objeto real).
const ANTORCHA = {
  item: { id: 99001 }, name: "Antorcha de prueba", quality: { type: "UNCOMMON", name: "Poco común" },
  level: { value: 1, display_string: "Nivel de objeto 1" },
  binding: { type: "ON_ACQUIRE", name: "Se liga al recogerlo" }, unique_equipped: "Único",
  inventory_type: { type: "NON_EQUIP", name: "No equipable" }, item_subclass: { name: "Misceláneo" }, is_subclass_hidden: true,
  spells: [{ spell: { id: 1 }, description: "Uso: Enciende la antorcha. (30 s de reutilización)" }],
  sell_price: { value: 125, display_strings: { header: "Precio de venta:", gold: "0", silver: "1", copper: "25" } },
};
const ESPADA = {
  name: "Espada de prueba", quality: { type: "RARE" }, level: { display_string: "Nivel de objeto 20" },
  inventory_type: { name: "Una mano" }, item_subclass: { name: "Espada" },
  weapon: { damage: { display_string: "15 - 28 Daño" }, attack_speed: { display_string: "Velocidad 2,60" }, dps: { display_string: "(8,3 daño por segundo)" } },
  stats: [{ display: { display_string: "+3 Fuerza", color: { r: 255, g: 255, b: 255 } } },
          { is_equip_bonus: true, display: { display_string: "Equipar: Mejora tu probabilidad de golpe crítico un 1 %." } }],
  requirements: { level: { display_string: "Necesitas ser de nivel 15" } }, durability: { display_string: "Durabilidad 75 / 75" },
  description: "Brilla un poco.",
};

test("líneas del cuadro: como en el juego, sin inventar nada", () => {
  const a = lineasTooltip(ANTORCHA);
  assert.deepEqual(a.map((x) => x.izq), ["Antorcha de prueba", "Nivel de objeto 1", "Se liga al recogerlo", "Único", "No equipable",
    "Uso: Enciende la antorcha. (30 s de reutilización)", "Precio de venta:"]);
  assert.match(a[0].clase, /q-UNCOMMON/);
  assert.equal(a.find((x) => x.izq.startsWith("Uso:")).clase, "tt-verde");
  assert.equal(a.at(-1).cobre, 125);
  const e = lineasTooltip(ESPADA);
  assert.deepEqual(e.find((x) => x.izq === "Una mano"), { izq: "Una mano", der: "Espada", clase: "tt-blanco" });
  assert.deepEqual(e.find((x) => x.izq === "15 - 28 Daño")?.der, "Velocidad 2,60");
  assert.equal(e.find((x) => x.izq === "+3 Fuerza").color, "rgb(255, 255, 255)");
  assert.equal(e.find((x) => x.izq.startsWith("Equipar:")).clase, "tt-verde");
  assert.equal(e.at(-1).izq, "«Brilla un poco.»");
  assert.deepEqual(lineasTooltip(null), []);
  assert.deepEqual(lineasTooltip({}), []);
});

describe("fichas oficiales (SQL e importación)", () => {
  let pg: PGlite;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
  const db: Db = { consulta: async (q, p) => (await pg.query<any>(q, p as unknown[])).rows };
  const ahora = () => new Date("2026-11-12T12:00:00Z");

  function blizzard(datos: Record<number, object>, mal?: number) {
    return (async (url: string) => {
      if (url.startsWith("https://oauth.battle.net/token")) return Response.json({ access_token: "t" });
      const id = Number(url.match(/\/item\/(\d+)\?/)![1]);
      if (id === mal) return Response.json({ id: id + 1, preview_item: ANTORCHA });   // otro objeto: no vale
      return datos[id] ? Response.json({ id, preview_item: { ...datos[id], _links: { self: "x" }, media: { key: "y" } } })
        : new Response("", { status: 404 });
    }) as unknown as typeof fetch;
  }

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec("create role anon; create role authenticated;");
    await pg.exec(leer("0001_esquema.sql"));
    await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
    for (const n of ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql", "0006_motor.sql", "0007_inventario.sql",
                     "0008_ventas.sql", "0009_ahledger.sql", "0010_catalogo.sql", "0012_busqueda_mercado.sql",
                     "0013_textos_fuente.sql", "0014_tasas.sql", "0015_recetas.sql", "0017_mercado_pagina.sql",
                     "0018_evidencia.sql", "0019_catalogo_ampliado.sql", "0020_precios_tsm.sql", "0023_catalogo_informe.sql",
                     "0033_nombres_es.sql", "0040_fichas_blizzard.sql"]) await pg.exec(leer(n));
    const cat = [[99001, "Test Torch"], [99002, "Test Sword"], [99003, "No Card"], [99004, "Wrong Id"], [99005, "No Spanish Name"]]
      .map(([id, name]) => ({ id, name, itemClass: "Miscellaneous", quality: "COMMON" }));
    await uno("select guardar_catalogo('forever', $1::jsonb)", [JSON.stringify(cat)]);
    await pg.exec(`update catalogo set nombre_es = 'x', nombre_es_fuente = 'blizzard:static-classic1x-us:es_MX' where item_id between 99001 and 99004`);
  });

  test("solo objetos con nombre comprobado en Blizzard; guarda la ficha sin enlaces internos", async () => {
    assert.deepEqual((await uno("select fichas_pendientes('forever', 10) as r")).r.map((x: any) => x.id), [99001, 99002, 99003, 99004]);
    const r: any = await actualizarFichas(db, { fetch: blizzard({ 99001: ANTORCHA, 99002: ESPADA }, 99004), clientId: "a", secreto: "b", ahora });
    assert.deepEqual([r.estado, r.guardadas, r.sin_ficha, r.parado], ["ok", 2, 2, null]);
    const f = (await uno("select ficha_blizzard($1, 99001) as r", [TSM])).r;
    assert.equal(f.datos.name, "Antorcha de prueba");
    assert.equal(f.datos._links, undefined);
    assert.equal(f.datos.media, undefined);
    assert.equal(f.fuente, "blizzard:static-classic1x-us:es_MX");
    assert.equal((await uno("select ficha_blizzard($1, 99003) as r", [TSM])).r, null);   // Blizzard no la tiene
    assert.equal((await uno("select ficha_blizzard($1, 99004) as r", [TSM])).r, null);   // devolvió otro ID: no se guarda
    // Al día; los que no tienen ficha se reintentan al día siguiente.
    assert.deepEqual((await uno("select fichas_pendientes('forever', 10, $1::timestamptz) as r", ["2026-11-12T18:00:00Z"])).r, []);
    assert.equal((await uno("select fichas_pendientes('forever', 10, $1::timestamptz) as r", ["2026-11-13T13:00:00Z"])).r.length, 2);
  });

  test("sin credenciales no pide nada y se pausa", async () => {
    let pedidas = 0;
    const f = (async () => { pedidas++; return new Response(""); }) as unknown as typeof fetch;
    assert.equal((await actualizarFichas(db, { fetch: f, ahora })).motivo, "sin_credenciales");
    assert.equal(pedidas, 0);
  });
});
