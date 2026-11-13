// Rutas de la aplicación: tres secciones (Mercado, Fabricación, Oportunidades) y el objeto abierto.
// «#/», «#/fabricacion», «#/oportunidades» y «#/objeto/ID». Sin DOM, para probarlas en Node.

export const SECCIONES = ["mercado", "fabricacion", "oportunidades"];

/** Dirección de una sección: «#/» para el Mercado, «#/fabricacion»… para las demás. */
export const hashSeccion = (s) => (s === "mercado" || !SECCIONES.includes(s) ? "#/" : `#/${s}`);

/** «#/objeto/7082» → {vista: "objeto", id: 7082}. Los enlaces antiguos a un objeto (historial, rentabilidad)
 *  abren ese objeto; «#/recetas» (V2) es Fabricación; cualquier otra ruta → el Mercado. */
export function leerRuta(hash) {
  const [vista, arg] = String(hash || "").replace(/^#\/?/, "").split("/").filter(Boolean);
  if (["objeto", "historial", "rentabilidad"].includes(vista) && /^\d{1,9}$/.test(arg ?? "")) {
    return { vista: "objeto", id: Number(arg) };
  }
  if (vista === "fabricacion" || vista === "recetas") return { vista: "fabricacion", id: null };
  if (vista === "oportunidades") return { vista: "oportunidades", id: null };
  return { vista: "mercado", id: null };
}
