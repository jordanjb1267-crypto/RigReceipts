-- RigReceipts V2 — expense category seed.
-- Canon: the Master Build Prompt's 23 categories (docs/DECISIONS.md, decision 1).
-- Must stay in sync with src/domain/categories.ts (guarded by canon tests).

insert into expense_categories (slug, label, sort_order)
values
  ('fuel', 'Fuel', 10),
  ('def', 'DEF', 20),
  ('repairs', 'Repairs', 30),
  ('maintenance', 'Maintenance', 40),
  ('tires', 'Tires', 50),
  ('parts', 'Parts', 60),
  ('tolls', 'Tolls', 70),
  ('parking', 'Parking', 80),
  ('scales', 'Scales', 90),
  ('truck_wash', 'Truck Wash', 100),
  ('trailer_washout', 'Trailer Washout', 110),
  ('meals', 'Meals', 120),
  ('showers', 'Showers', 130),
  ('laundry', 'Laundry', 140),
  ('lodging', 'Lodging / Hotel', 150),
  ('phone_internet', 'Phone / Internet', 160),
  ('eld_software', 'ELD / Software Subscriptions', 170),
  ('insurance', 'Insurance', 180),
  ('permits_registration', 'Permits / Registration', 190),
  ('truck_supplies', 'Truck Supplies', 200),
  ('trailer_expenses', 'Trailer Expenses', 210),
  ('lumper', 'Lumper Fees', 220),
  ('misc', 'Miscellaneous', 230)
on conflict (slug) do update
  set label = excluded.label,
      sort_order = excluded.sort_order;
