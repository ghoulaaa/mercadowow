// Rutas de la aplicación (#/seccion o #/objeto/ID). Sin DOM, para probarlas en Node.

export const VISTAS = ["inicio", "basedatos", "mercado", "historial", "profesiones", "rentabilidad",
  "favoritos", "inventario", "oportunidades", "fuentes"];

/** «#/objeto/7082» → {vista: "objeto", id: 7082}. Una ruta desconocida → inicio. */
export function leerRuta(hash) {
  const partes = String(hash || "").replace(/^#\/?/, "").split("/").filter(Boolean);
  const [vista, arg] = partes;
  if ((vista === "objeto" || vista === "historial") && /^\d{1,9}$/.test(arg ?? "")) {
    return { vista, id: Number(arg) };
  }
  if (vista === "objeto") return { vista: "mercado", id: null };
  return { vista: VISTAS.includes(vista) ? vista : "inicio", id: null };
}
