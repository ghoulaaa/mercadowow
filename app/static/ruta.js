// Rutas de la aplicación. Desde V3 hay una sola vista, el Mercado: «#/» o «#/objeto/ID» (objeto abierto).
// Sin DOM, para probarlas en Node.

/** «#/objeto/7082» → {vista: "objeto", id: 7082}. Los enlaces antiguos a un objeto (historial, rentabilidad)
 *  abren ese objeto; cualquier otra ruta → el Mercado. */
export function leerRuta(hash) {
  const [vista, arg] = String(hash || "").replace(/^#\/?/, "").split("/").filter(Boolean);
  if (["objeto", "historial", "rentabilidad"].includes(vista) && /^\d{1,9}$/.test(arg ?? "")) {
    return { vista: "objeto", id: Number(arg) };
  }
  if (vista === "fabricacion" && arg === undefined) return { vista: "fabricacion", id: null };
  return { vista: "mercado", id: null };
}
