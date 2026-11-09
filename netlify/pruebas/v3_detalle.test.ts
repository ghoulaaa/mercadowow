// V3 (plan V3): «Esperar» solo con evidencia y mínimo/máximo observados en la ficha.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { NOMBRE_REC } from "../../app/static/tabla.js";

const AHL = "ahledger:forever:us:pvp-horde";

test("en la página, OBSERVACION se llama «Esperar»", () => {
  assert.deepEqual(NOMBRE_REC, { VENDER: "Vender", GUARDAR: "Guardar", OBSERVACION: "Esperar" });
});

describe("evidencia y extremos (SQL)", () => {
  let pg: PGlite;
  const leer = (n: string) => readFileSync(new URL(`../../db/migraciones/${n}`, import.meta.url), "utf8");
  const uno = async (s: string, p: unknown[] = []) => (await pg.query<any>(s, p)).rows[0];
  const lectura = async (rec: string, resumen: string, horas = 1) =>
    (await uno(`select _rec_al_leer($1, $2, 30, '2026-11-09T12:00:00Z'::timestamptz,
                '2026-11-09T12:00:00Z'::timestamptz + make_interval(hours => $3::integer)) as r`, [rec, resumen, horas])).r;

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec("create role anon; create role authenticated;");
    await pg.exec(leer("0001_esquema.sql"));
    await pg.exec("create function disparar_si_corresponde() returns void language sql as $$ select $$;");
    for (const n of ["0003_web.sql", "0004_demo_csv.sql", "0005_tabla.sql", "0006_motor.sql", "0007_inventario.sql",
                     "0008_ventas.sql", "0009_ahledger.sql", "0010_catalogo.sql", "0013_textos_fuente.sql",
                     "0014_tasas.sql", "0015_recetas.sql", "0017_mercado_pagina.sql", "0018_evidencia.sql"]) {
      await pg.exec(leer(n));
    }
  });

  for (const resumen of ["Sin precios en los últimos 30 días", "No aparece en el último escaneo",
                         "Historial insuficiente (2 días, 30 observaciones)", "Precio extremo: posible error o muy poca oferta"]) {
    test(`sin evidencia: «${resumen}»`, async () => assert.equal((await lectura("OBSERVACION", resumen)).evidencia, false));
  }

  for (const resumen of ["Señales contradictorias", "Precio dentro de lo habitual", "Subida reciente todavía sin confirmar",
                         "Precio bajo en caída continuada"]) {
    test(`hay datos pero no se cumple ninguna regla → «Esperar»: «${resumen}»`, async () => {
      const l = await lectura("OBSERVACION", resumen);
      assert.deepEqual([l.rec, l.evidencia], ["OBSERVACION", true]);
    });
  }

  test("VENDER y GUARDAR con evidencia; un dato antiguo la quita", async () => {
    assert.equal((await lectura("VENDER", "+20,0 % sobre la mediana de 30 días")).evidencia, true);
    assert.equal((await lectura("GUARDAR", "−25,0 % bajo la mediana; antes se recuperó")).evidencia, true);
    const viejo = await lectura("VENDER", "+20,0 % sobre la mediana de 30 días", 10);
    assert.deepEqual([viejo.rec, viejo.antiguo, viejo.evidencia], ["OBSERVACION", true, false]);
  });

  test("ficha: mínimo y máximo de la compra mínima en 30 días, con su hora", async () => {
    await uno(`insert into items (market_id, item_id, name) select id, 2589, 'Linen Cloth' from markets where key = $1`, [AHL]);
    for (const [hora, precio] of [["2026-10-01T10:00:00Z", 1], ["2026-11-08T10:00:00Z", 13], ["2026-11-09T09:00:00Z", 27],
                                  ["2026-11-09T18:00:00Z", 20]] as const) {
      await pg.query(`insert into snapshots (market_id, source_updated_at, row_count) select id, $2::timestamptz, 1 from markets where key = $1`, [AHL, hora]);
      await pg.query(`insert into price_hourly (market_id, item_id, hour, min_buyout, snapshot_id)
                      select m.id, 2589, date_trunc('hour', $2::timestamptz, 'UTC'), $3::bigint, s.id
                        from markets m join snapshots s on s.market_id = m.id and s.source_updated_at = $2::timestamptz
                       where m.key = $1`, [AHL, hora, precio]);
    }
    const x = (await uno("select ficha_objeto($1, 2589) as r", [AHL])).r.extremos_30d;
    // El de octubre (1c) queda fuera de los 30 días.
    assert.deepEqual([x.minimo, x.maximo, x.observaciones], [13, 27, 3]);
    assert.equal(new Date(x.minimo_hora).toISOString(), "2026-11-08T10:00:00.000Z");
    await uno(`insert into items (market_id, item_id, name) select id, 2592, 'Wool Cloth' from markets where key = $1`, [AHL]);
    assert.equal((await uno("select ficha_objeto($1, 2592) as r", [AHL])).r.extremos_30d, null);
  });
});
