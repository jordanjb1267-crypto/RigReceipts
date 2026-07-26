import { parseRateCon } from '../parseRateCon';
import { RATE_CON_FIXTURES } from '../rateConFixtures';

describe('parseRateCon — standard rate confirmation', () => {
  const r = parseRateCon(RATE_CON_FIXTURES.standard);

  it('reads the broker, not the carrier', () => {
    expect(r.broker).toBe('MEGA FREIGHT BROKERS, INC');
  });
  it('reads the load number', () => {
    expect(r.loadNumber).toBe('48291');
  });
  it('reads origin and destination city/state', () => {
    expect(r.originCity).toBe('Chicago');
    expect(r.originState).toBe('IL');
    expect(r.destinationCity).toBe('Atlanta');
    expect(r.destinationState).toBe('GA');
  });
  it('prefers Total Rate over Line Haul and excludes the fuel surcharge', () => {
    expect(r.offerUsd).toBe(2150.0);
    expect(r.fuelSurchargeUsd).toBe(200.0);
  });
  it('reads loaded miles', () => {
    expect(r.loadedMiles).toBe(720);
  });
  it('reads pickup and delivery dates as ISO', () => {
    expect(r.pickupDate).toBe('2026-07-12');
    expect(r.deliveryDate).toBe('2026-07-14');
  });
});

describe('parseRateCon — terse format', () => {
  const r = parseRateCon(RATE_CON_FIXTURES.terse);

  it('handles PU/DEL abbreviations and inline dates', () => {
    expect(r.originCity).toBe('Dallas');
    expect(r.originState).toBe('TX');
    expect(r.destinationCity).toBe('Memphis');
    expect(r.destinationState).toBe('TN');
    expect(r.pickupDate).toBe('2026-06-30');
    expect(r.deliveryDate).toBe('2026-07-01');
  });
  it('reads the agreed rate and miles', () => {
    expect(r.offerUsd).toBe(1480.0);
    expect(r.loadedMiles).toBe(452);
  });
  it('reads the order number', () => {
    expect(r.loadNumber).toBe('A-5567');
  });
});

describe('parseRateCon — resilience', () => {
  it('returns all-null (never throws) on empty input', () => {
    const r = parseRateCon('');
    expect(r.offerUsd).toBeNull();
    expect(r.originCity).toBeNull();
    expect(r.loadNumber).toBeNull();
  });
});
