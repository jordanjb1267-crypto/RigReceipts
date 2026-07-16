/** Equipment types for rate cards and lane filters. */
export const EQUIPMENT_TYPES = [
  { slug: 'dry_van', label: 'Dry Van' },
  { slug: 'reefer', label: 'Reefer' },
  { slug: 'flatbed', label: 'Flatbed' },
  { slug: 'step_deck', label: 'Step Deck' },
  { slug: 'power_only', label: 'Power Only' },
  { slug: 'hotshot', label: 'Hotshot' },
  { slug: 'tanker', label: 'Tanker' },
  { slug: 'other', label: 'Other' },
] as const;

export type EquipmentType = (typeof EQUIPMENT_TYPES)[number]['slug'];

export const equipmentLabel = (slug: EquipmentType): string =>
  EQUIPMENT_TYPES.find((e) => e.slug === slug)?.label ?? slug;
