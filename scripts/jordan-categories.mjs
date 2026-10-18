/** Jordan's category names mapped onto this catalog's vocabulary. */
const aliases = {
  coffee_table: "coffee-table",
  side_table: "side-table",
  floor_lamp: "lamp",
  shelf: "bookshelf",
  cabinet: "sideboard",
  wall_art: "wall-art",
  small_plant: "plant",
  vase: "decor",
  bowl: "decor",
  tray: "decor",
  book: "decor",
  pillow: "textile",
  throw: "textile",
};
export const codexCategory = (category) => aliases[category] ?? category;
