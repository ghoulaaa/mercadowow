// Cuadro de objeto al estilo del juego, a partir de la «vista previa» oficial de Blizzard (texto en español).
// Sin DOM, para probarlo en Node: devuelve las líneas con su clase de color; la página las dibuja.

const texto = (x) => (typeof x === "string" && x.trim() ? x.trim() : null);
const color = (c) => (c && Number.isFinite(c.r) ? `rgb(${c.r}, ${c.g}, ${c.b})` : null);

/**
 * @param {object} p preview_item de la API de Blizzard (con locale es_MX: los textos ya vienen en español)
 * @returns {{izq: string, der?: string, clase: string, color?: string, cobre?: number}[]}
 */
export function lineasTooltip(p) {
  if (!p || typeof p !== "object") return [];
  const l = [];
  const pon = (izq, clase, extra = {}) => { if (texto(izq)) l.push({ izq: texto(izq), clase, ...extra }); };
  pon(p.name, `tt-nombre q-${p.quality?.type ?? "COMMON"}`);
  pon(p.level?.display_string, "tt-nivel");
  pon(p.binding?.name, "tt-blanco");
  pon(typeof p.unique_equipped === "string" ? p.unique_equipped : null, "tt-blanco");
  // Ranura y tipo, como en el juego: a la izquierda y a la derecha.
  const ranura = texto(p.inventory_type?.name);
  const tipo = p.is_subclass_hidden ? null : texto(p.item_subclass?.name);
  if (ranura || tipo) l.push({ izq: ranura ?? tipo, der: ranura ? tipo ?? undefined : undefined, clase: "tt-blanco" });
  // Armas: daño y velocidad en una línea; daño por segundo debajo.
  const dano = texto(p.weapon?.damage?.display_string), vel = texto(p.weapon?.attack_speed?.display_string);
  if (dano || vel) l.push({ izq: dano ?? vel, der: dano ? vel ?? undefined : undefined, clase: "tt-blanco" });
  pon(p.weapon?.dps?.display_string, "tt-blanco");
  pon(p.armor?.display?.display_string, "tt-blanco");
  pon(p.shield_block?.display?.display_string, "tt-blanco");
  for (const s of Array.isArray(p.stats) ? p.stats : []) {
    pon(s?.display?.display_string, s?.is_equip_bonus ? "tt-verde" : "tt-blanco", { color: color(s?.display?.color) ?? undefined });
  }
  for (const r of ["level", "skill", "ability", "reputation", "playable_classes"]) pon(p.requirements?.[r]?.display_string, "tt-blanco");
  pon(p.container_slots?.display_string, "tt-blanco");
  pon(p.durability?.display_string, "tt-blanco");
  for (const s of Array.isArray(p.spells) ? p.spells : []) pon(s?.description, "tt-verde");
  // Recetas: debajo, el objeto que enseñan a fabricar (sin su precio de venta) y los materiales.
  const producto = p.recipe?.item;
  if (producto && typeof producto === "object") {
    const sub = lineasTooltip(producto).filter((x) => x.cobre == null);
    if (sub.length) l.push({ izq: "", clase: "tt-separador" }, ...sub);
    pon(p.recipe.reagents_display_string ? `Requiere ${p.recipe.reagents_display_string}` : null, "tt-blanco");
  }
  pon(p.set?.display_string, "tt-oro");
  if (texto(p.description)) l.push({ izq: `«${texto(p.description)}»`, clase: "tt-oro" });
  const venta = p.sell_price;
  if (venta && Number.isSafeInteger(venta.value) && venta.value > 0) {
    l.push({ izq: texto(venta.display_strings?.header) ?? "Precio de venta:", clase: "tt-blanco tt-venta", cobre: venta.value });
  }
  return l;
}
