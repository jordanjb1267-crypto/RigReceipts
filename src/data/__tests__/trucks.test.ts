import { ownedTrucksFromRows, resolveTruckLabel } from '../trucks';

describe('owned trucks (Road Wallet truck association)', () => {
  const rows = [
    { id: 't1', owner_id: 'user-a', unit_name: 'Unit 12' },
    { id: 't2', owner_id: 'user-b', unit_name: 'Unit 99' },
    { id: 't3', owner_id: 'user-a', unit_name: '' },
  ];

  it('keeps only the signed-in owner’s trucks even if a row slipped through', () => {
    expect(ownedTrucksFromRows(rows, 'user-a')).toEqual([
      { id: 't1', ownerId: 'user-a', unitName: 'Unit 12' },
      { id: 't3', ownerId: 'user-a', unitName: 'Unit' },
    ]);
    expect(ownedTrucksFromRows(rows, 'user-c')).toEqual([]);
  });

  it('never displays another account’s truck metadata for an unresolved association', () => {
    const mine = ownedTrucksFromRows(rows, 'user-a');
    expect(resolveTruckLabel('t1', mine)).toBe('Unit 12');
    expect(resolveTruckLabel('t2', mine)).toBeNull(); // user-b's truck → unassigned/unresolved
    expect(resolveTruckLabel(null, mine)).toBeNull();
    expect(resolveTruckLabel('t1', undefined)).toBeNull();
  });
});
