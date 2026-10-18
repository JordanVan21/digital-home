/** Muted per-category tints for placeholder boxes (desaturated so proxies read as "approximate"). */
const COLORS: Record<string, string> = {
  sofa: '#9a8f86', armchair: '#9a8f86', chair: '#8f9488',
  table: '#a08b72', coffee_table: '#a08b72', side_table: '#a08b72', desk: '#a08b72',
  shelf: '#8a8172', storage: '#8a8172', cabinet: '#8a8172', dresser: '#8a8172',
  bed: '#8e8a9c', rug: '#a8967c', lamp: '#b3a27a', floor_lamp: '#b3a27a',
  plant: '#7f9278', wall_art: '#8b8fa0', tv: '#6f7480', fireplace: '#9c7f78',
};

export const categoryColor = (category: string) => COLORS[category] ?? '#8c8c8c';

export const humanCategory = (category: string) => category.replace(/_/g, ' ');
