import {
  isOpenLoad,
  LOAD_STATUSES,
  loadStatusLabel,
  loadStatusTone,
  nextLoadStatus,
  OPEN_LOAD_STATUSES,
} from '../loads';

describe('load statuses', () => {
  it('locks the four-state lifecycle', () => {
    expect(LOAD_STATUSES.map((s) => s.slug)).toEqual(['booked', 'in_transit', 'delivered', 'paid']);
  });

  it('treats everything before paid as open', () => {
    expect(OPEN_LOAD_STATUSES).toEqual(['booked', 'in_transit', 'delivered']);
    expect(isOpenLoad('in_transit')).toBe(true);
    expect(isOpenLoad('paid')).toBe(false);
  });

  it('maps labels and tones', () => {
    expect(loadStatusLabel('in_transit')).toBe('In transit');
    expect(loadStatusTone('paid')).toBe('green');
  });

  it('cycles through the lifecycle and wraps', () => {
    expect(nextLoadStatus('booked')).toBe('in_transit');
    expect(nextLoadStatus('delivered')).toBe('paid');
    expect(nextLoadStatus('paid')).toBe('booked');
  });
});
