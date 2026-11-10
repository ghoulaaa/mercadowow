// X6 (plan V5): listas propias (con banda propia) y alertas por umbral revisadas con cada escaneo.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { perfilDeLista, textoAlerta } from "../../app/static/listas.js";
import { PERFIL_POR_DEFECTO } from "../../app/static/subasta.js";
import { formatearMoneda } from "../../app/static/moneda.js";

const TSM = "tsm:forever:us:pvp-horde";

test("la banda de la primera lista que tenga una propia; si no, la general", () => {
  const general = { ...PERFIL_POR_DEFECTO };
  assert.deepEqual(perfilDeLista([], general), { perfil: general, lista: null });
  const r = perfilDeLista([{ id: 1, nombre: "Favoritos", perfil: null }, { id: 2, nombre: "Equipo", perfil: { ...general, min_pct: "60" } }], general);
  assert.equal(r.lista, "Equipo");
  assert.equal(r.perfil.min_pct, 60);            // los números llegan como texto o número: siempre número
  assert.equal(r.perfil.tipo_casa, general.tipo_casa);
});

test("texto de una alerta", () => {
  assert.equal(textoAlerta({ condicion: "menor", umbral: 150 }, formatearMoneda), "baja a 1p 50c o menos");
  assert.equal(textoAlerta({ condicion: "mayor", umbral: 10000 }, formatearMoneda), "sube a 1o o más");
});

describe("listas y alertas (SQL)", () => {
  let pg: PGlite;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
  const lista = async (p: object) => (await uno("select gestionar_lista($1::jsonb) as r", [JSON.stringify(p)])).r;
  const alerta = async (p: object) => (await uno("select gestionar_alerta($1, $2::jsonb) as r", [TSM, JSON.stringify(p)])).r;
  const alertas = async () => (await uno("select leer_alertas($1) as r", [TSM])).r;
  const ids = async (p: object) => (await uno("select mercado_pagina($1, $2::jsonb) as r", [TSM, JSON.stringify(p)])).r
    .filas.map((f: any) => f.id).sort((a: number, b: number) => a - b);

  // Un escaneo en UNA transacción, como lo guarda la consulta horaria (las alertas se revisan al confirmar).
  async function escaneo(hora: string, filas: [number, number | null][]) {
    await pg.transaction(async (tx) => {
      await tx.query(`insert into snapshots (market_id, source_updated_at, row_count) select id, $2::timestamptz, 1 from markets where key = $1`, [TSM, hora]);
      for (const [id, min] of filas) {
        await tx.query(`insert into items (market_id, item_id, name) select id, $2::integer, 'x' from markets where key = $1 on conflict do nothing`, [TSM, id]);
        await tx.query(`insert into price_hourly (market_id, item_id, hour, min_buyout, market_value, snapshot_id)
                        select m.id, $2::integer, date_trunc('hour', $3::timestamptz, 'UTC'), $4::bigint, 100, s.id
                          from markets m join snapshots s on s.market_id = m.id and s.source_updated_at = $3::timestamptz
                         where m.key = $1`, [TSM, id, hora, min]);
      }
    });
  }

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec("create role anon; create role authenticated;");
    await pg.exec(leer("0001_esquema.sql"));
    await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
    for (const n of ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql", "0006_motor.sql", "0007_inventario.sql",
                     "0008_ventas.sql", "0009_ahledger.sql", "0010_catalogo.sql", "0013_textos_fuente.sql", "0014_tasas.sql",
                     "0015_recetas.sql", "0017_mercado_pagina.sql", "0018_evidencia.sql", "0019_catalogo_ampliado.sql",
                     "0020_precios_tsm.sql", "0021_materiales.sql", "0024_perfil_subasta.sql", "0025_oportunidades.sql",
                     "0026_region.sql", "0028_recetas_tsm.sql"]) await pg.exec(leer(n));
    const cat = [[2589, "Linen Cloth"], [2840, "Copper Bar"], [765, "Silverleaf"]]
      .map(([id, name]) => ({ id, name, itemClass: "Trade Goods", itemSubclass: "Cloth", quality: "COMMON" }));
    await uno("select guardar_catalogo('forever', $1::jsonb)", [JSON.stringify(cat)]);
    await pg.exec("insert into favorites (market_id, item_id) select id, 2840 from markets where key = 'tsm:forever:us:pvp-horde'");   // favorito de antes de las listas
    await pg.exec(leer("0030_listas_alertas.sql"));
    await escaneo("2026-11-10T10:00:00Z", [[2589, 200], [2840, 500], [765, 50]]);
  });

  test("los favoritos pasan a la lista «Favoritos»; crear, poner, filtrar, renombrar y borrar", async () => {
    let l = (await uno("select listar_listas(2840) as r")).r.listas;
    assert.deepEqual(l.map((x: any) => [x.nombre, x.n, x.contiene]), [["Favoritos", 1, true]]);
    await pg.exec(leer("0032_favoritos_ids.sql"));
    assert.deepEqual((await uno("select listar_listas() as r")).r.favoritos, [2840]);
    const c = await lista({ accion: "crear", nombre: "Hierbas", objeto: 765 });
    const idH = c.id;
    await lista({ accion: "poner", id: idH, objeto: 2589, dentro: true });
    assert.deepEqual(await ids({ lista: String(idH) }), [765, 2589]);
    await lista({ accion: "poner", id: idH, objeto: 2589, dentro: false });
    assert.deepEqual(await ids({ lista: String(idH) }), [765]);
    await assert.rejects(lista({ accion: "crear", nombre: " hierbas " }), /Ya hay una lista/);
    await assert.rejects(lista({ accion: "crear", nombre: "" }), /entre 1 y 40/);
    await lista({ accion: "renombrar", id: idH, nombre: "Plantas" });
    l = (await uno("select listar_listas() as r")).r.listas;
    assert.deepEqual(l.map((x: any) => x.nombre), ["Favoritos", "Plantas"]);
    await lista({ accion: "borrar", id: idH });
    assert.equal(Number((await uno("select count(*) as n from lista_objetos")).n), 1);
    await assert.rejects(ids({ lista: String(idH) }), /Lista desconocida/);
  });

  test("banda propia de una lista: validada como la general, y la ficha la trae", async () => {
    const idF = (await uno("select listar_listas() as r")).r.listas[0].id;
    await assert.rejects(lista({ accion: "perfil", id: idF, perfil: { min_pct: 200, normal_pct: 100 } }), /mínimo ≤ normal/);
    await assert.rejects(lista({ accion: "perfil", id: idF, perfil: { inventado: 1 } }), /Ajuste desconocido/);
    await lista({ accion: "perfil", id: idF, perfil: { min_pct: 60 } });
    const f = (await uno("select ficha_objeto($1, 2840) as r", [TSM])).r;
    assert.equal(f.listas[0].nombre, "Favoritos");
    assert.equal(Number(f.listas[0].perfil.min_pct), 60);
    assert.equal(Number(f.listas[0].perfil.max_pct), 300);   // el resto, de la general
    await lista({ accion: "perfil", id: idF, perfil: null });
    assert.equal((await uno("select ficha_objeto($1, 2840) as r", [TSM])).r.listas[0].perfil, null);
  });

  test("alertas: avisan al PASAR a cumplirse con un escaneo nuevo, una sola vez", async () => {
    const c = await alerta({ accion: "crear", objeto: 2589, condicion: "menor", umbral: 150 });
    assert.equal(c.cumple_ahora, false);
    const ya = await alerta({ accion: "crear", objeto: 765, condicion: "menor", umbral: 60 });
    assert.equal(ya.cumple_ahora, true);                       // ya se cumple: no crea aviso ahora
    assert.equal((await alertas()).sin_ver, 0);

    await escaneo("2026-11-10T11:00:00Z", [[2589, 140], [2840, 500], [765, 55]]);
    let a = await alertas();
    assert.equal(a.sin_ver, 1);
    assert.equal(a.avisos[0].nombre, "Linen Cloth");
    assert.equal(a.avisos[0].precio, 140);
    // Sigue por debajo: no repite el aviso.
    await escaneo("2026-11-10T12:00:00Z", [[2589, 130], [2840, 500], [765, 55]]);
    assert.equal((await alertas()).sin_ver, 1);
    // Sin ofertas deja de cumplirse; al volver a bajar, avisa otra vez.
    await escaneo("2026-11-10T13:00:00Z", [[2840, 500], [765, 55]]);
    await escaneo("2026-11-10T14:00:00Z", [[2589, 100], [2840, 500], [765, 55]]);
    a = await alertas();
    assert.equal(a.sin_ver, 2);
    const linen = a.alertas.find((x: any) => x.objeto === 2589);
    assert.equal(linen.precio_actual, 100);
    assert.equal(linen.cumplida, true);
    // Un escaneo antiguo que llega tarde no revisa nada.
    assert.equal((await uno("select revisar_alertas(1::smallint, '2026-11-10T09:00:00Z') as n")).n, 0);

    a = await alerta({ accion: "visto", ids: [a.avisos[0].id] });
    assert.equal(a.sin_ver, 1);
    a = await alerta({ accion: "visto", ids: "todos" });
    assert.equal(a.sin_ver, 0);
    assert.equal(a.avisos.length, 2);                          // los vistos siguen (los 20 últimos)
    await alerta({ accion: "borrar", id: linen.id });
    assert.equal((await alertas()).avisos.length, 0);
  });

  test("alertas: validación", async () => {
    await assert.rejects(alerta({ accion: "crear", objeto: 99999, condicion: "menor", umbral: 5 }), /desconocido/);
    await assert.rejects(alerta({ accion: "crear", objeto: 2589, condicion: "igual", umbral: 5 }), /Condición no válida/);
    await assert.rejects(alerta({ accion: "crear", objeto: 2589, condicion: "mayor", umbral: 0 }), /entero positivo/);
    await assert.rejects(alerta({ accion: "otra" }), /Acción no válida/);
    const m = await alerta({ accion: "crear", objeto: 2840, condicion: "mayor", umbral: 600 });
    assert.equal(m.cumple_ahora, false);
    await escaneo("2026-11-10T11:00:00Z", [[2589, 200], [2840, 650], [765, 50]]);
    assert.equal((await alertas()).sin_ver, 1);
  });
});
