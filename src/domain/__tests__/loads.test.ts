import {
  isCompletedLoad,
  isOpenLoad,
  LOAD_STATUSES,
  loadStatusLabel,
  loadStatusTone,
  nextLoadStatus,
  OPEN_LOAD_STATUSES,
} from '../loads';

describe('load statuses', () => {
  it('locks the five-state lifecycle (evaluated added in C3, ahead of booked)', () => {
    expect(LOAD_STATUSES.map((s) => s.slug)).toEqual([
      'evaluated',
      'booked',
      'in_transit',
      'delivered',
      'paid',
    ]);
  });

  it('treats everything before paid as open, including evaluated', () => {
    expect(OPEN_LOAD_STATUSES).toEqual(['evaluated', 'booked', 'in_transit', 'delivered']);
    expect(isOpenLoad('evaluated')).toBe(true);
    expect(isOpenLoad('in_transit')).toBe(true);
    expect(isOpenLoad('paid')).toBe(false);
  });

  it('maps labels and tones', () => {
    expect(loadStatusLabel('in_transit')).toBe('In transit');
    expect(loadStatusTone('paid')).toBe('green');
    expect(loadStatusLabel('evaluated')).toBe('Evaluated');
    expect(loadStatusTone('evaluated')).toBe('neutral');
    expect(loadStatusLabel('booked')).toBe('Booked');
    expect(loadStatusTone('booked')).toBe('blue');
  });

  it('never treats an evaluated offer as completed or accepted work', () => {
    expect(isCompletedLoad('evaluated')).toBe(false);
    expect(isCompletedLoad('booked')).toBe(false);
    expect(isCompletedLoad('in_transit')).toBe(false);
    expect(isCompletedLoad('delivered')).toBe(true);
    expect(isCompletedLoad('paid')).toBe(true);
  });

  it('cycles evaluated -> booked -> in_transit -> delivered -> paid', () => {
    expect(nextLoadStatus('evaluated')).toBe('booked');
    expect(nextLoadStatus('booked')).toBe('in_transit');
    expect(nextLoadStatus('in_transit')).toBe('delivered');
    expect(nextLoadStatus('delivered')).toBe('paid');
  });

  it('keeps the intentional paid -> booked wrap; paid never falls back to evaluated', () => {
    expect(nextLoadStatus('paid')).toBe('booked');
    expect(nextLoadStatus('paid')).not.toBe('evaluated');
  });
});
