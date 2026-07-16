/**
 * Canonical expense categories — the Master Build Prompt's 23 (Loop 4),
 * locked as canon in docs/DECISIONS.md (decision 1).
 * The slugs here must stay in sync with supabase/seed.sql.
 */
export const EXPENSE_CATEGORIES = [
  { slug: 'fuel', label: 'Fuel' },
  { slug: 'def', label: 'DEF' },
  { slug: 'repairs', label: 'Repairs' },
  { slug: 'maintenance', label: 'Maintenance' },
  { slug: 'tires', label: 'Tires' },
  { slug: 'parts', label: 'Parts' },
  { slug: 'tolls', label: 'Tolls' },
  { slug: 'parking', label: 'Parking' },
  { slug: 'scales', label: 'Scales' },
  { slug: 'truck_wash', label: 'Truck Wash' },
  { slug: 'trailer_washout', label: 'Trailer Washout' },
  { slug: 'meals', label: 'Meals' },
  { slug: 'showers', label: 'Showers' },
  { slug: 'laundry', label: 'Laundry' },
  { slug: 'lodging', label: 'Lodging / Hotel' },
  { slug: 'phone_internet', label: 'Phone / Internet' },
  { slug: 'eld_software', label: 'ELD / Software Subscriptions' },
  { slug: 'insurance', label: 'Insurance' },
  { slug: 'permits_registration', label: 'Permits / Registration' },
  { slug: 'truck_supplies', label: 'Truck Supplies' },
  { slug: 'trailer_expenses', label: 'Trailer Expenses' },
  { slug: 'lumper', label: 'Lumper Fees' },
  { slug: 'misc', label: 'Miscellaneous' },
] as const;

export type ExpenseCategorySlug = (typeof EXPENSE_CATEGORIES)[number]['slug'];

export const expenseCategoryLabel = (slug: ExpenseCategorySlug): string => {
  const found = EXPENSE_CATEGORIES.find((c) => c.slug === slug);
  return found ? found.label : slug;
};
