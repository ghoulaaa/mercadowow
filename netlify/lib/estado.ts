// Estado público del mercado para la web en Netlify (solo lectura).
// Misma forma de respuesta que /api/estado del servidor local (app/main.py),
// más `solo_lectura: true` para que la página oculte el botón de actualizar.
// Nunca incluye credenciales.

export type Db = { consulta: (q: string, p?: unknown[]) => Promise<Record<string, unknown>[]> };

const iso = (v: unknown): string | null =>
  v == null ? null : new Date(v as string | Date).toISOString().replace(".000Z", "Z");

const SQL_MERCADO = `
  select m.key, m.label, m.provider, m.is_demo, m.source_url,
         s.last_source_updated_at, s.last_success_at, s.last_attempt_at,
         s.last_new_data_at, s.last_error, s.last_error_at,
         s.consecutive_failures,
         case when isfinite(s.next_attempt_at) then s.next_attempt_at end as next_attempt_at,
         coalesce(s.lease_expires_at > now(), false) as en_curso,
         (select count(*)::int from snapshots x where x.market_id = m.id) as versiones,
         (select count(*)::int from items i where i.market_id = m.id) as objetos,
         (select value from settings where key = 'url_funcion') is not null as programada,
         now() as hora_bd
    from markets m
    left join fetch_state s on s.market_id = m.id
   where m.key = $1`;

const SQL_REGISTRO = `
  select l.finished_at, l.status, l.http_status, l.rows_received, l.message
    from fetch_log l join markets m on m.id = l.market_id
   where m.key = $1
   order by l.finished_at desc
   limit 8`;

export async function leerEstado(db: Db, mercado: string, proyecto: string) {
  const base: Record<string, unknown> = {
    solo_lectura: true,
    base_de_datos: { proveedor: "Supabase", proyecto, migraciones_pendientes: [] },
  };
  const [row] = await db.consulta(SQL_MERCADO, [mercado]);
  if (!row) {
    base.mercado = { clave: mercado, nombre: mercado };
    base.actualizacion = { configurada: false };
    base.registro = [];
    return base;
  }
  const registro = await db.consulta(SQL_REGISTRO, [mercado]);
  base.hora_servidor = iso(row.hora_bd);
  base.mercado = {
    clave: row.key, nombre: row.label,
    proveedor: String(row.provider).toUpperCase(), ficticio: row.is_demo,
    fuente: row.source_url,
  };
  base.actualizacion = {
    configurada: Boolean(row.programada),
    en_curso: Boolean(row.en_curso),
    hora_dato_original: iso(row.last_source_updated_at),
    ultima_consulta_ok: iso(row.last_success_at),
    ultimo_dato_nuevo: iso(row.last_new_data_at),
    ultimo_intento: iso(row.last_attempt_at),
    proxima: iso(row.next_attempt_at),
    fallos_seguidos: Number(row.consecutive_failures ?? 0),
    ultimo_error: row.last_error ?? null,
    ultimo_error_hora: iso(row.last_error_at),
    versiones_guardadas: Number(row.versiones),
    objetos: Number(row.objetos),
  };
  base.registro = registro.map((r) => ({
    hora: iso(r.finished_at), estado: r.status, http: r.http_status,
    filas: r.rows_received, mensaje: r.message,
  }));
  return base;
}

/** "https://abcd.supabase.co" → "abcd" */
export const refDeProyecto = (supabaseUrl: string) => {
  try { return new URL(supabaseUrl).hostname.split(".")[0]; } catch { return ""; }
};
