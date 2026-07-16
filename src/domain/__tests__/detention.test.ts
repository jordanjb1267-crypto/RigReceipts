import { calculateDetention, DETENTION_DISCLAIMER } from '../detention';

const HOUR = 60 * 60 * 1000;
const t0 = new Date('2026-07-11T09:00:00Z');

describe('calculateDetention', () => {
  it('matches the spec formula: 3h over free time at $50/h = $150', () => {
    // 5h dwell − 2h free = 3h billable
    const result = calculateDetention({
      arrivalTime: t0,
      departureTime: new Date(t0.getTime() + 5 * HOUR),
      freeTimeMinutes: 120,
      hourlyRateUsd: 50,
    });
    expect(result.billableMinutes).toBe(180);
    expect(result.estimatedUsd).toBe(150);
    expect(result.owedUsd).toBe(150);
    expect(result.isOverridden).toBe(false);
  });

  it('prorates partial hours to the minute', () => {
    // 3.5h dwell − 2h free = 90 min at $40/h = $60
    const result = calculateDetention({
      arrivalTime: t0,
      departureTime: new Date(t0.getTime() + 3.5 * HOUR),
      freeTimeMinutes: 120,
      hourlyRateUsd: 40,
    });
    expect(result.billableMinutes).toBe(90);
    expect(result.estimatedUsd).toBe(60);
  });

  it('rounds to cents', () => {
    // 50 min at $37/h = 30.8333... → 30.83
    const result = calculateDetention({
      arrivalTime: 0,
      departureTime: 50 * 60 * 1000,
      freeTimeMinutes: 0,
      hourlyRateUsd: 37,
    });
    expect(result.estimatedUsd).toBe(30.83);
  });

  it('clamps to zero when dwell is inside free time (never negative)', () => {
    const result = calculateDetention({
      arrivalTime: t0,
      departureTime: new Date(t0.getTime() + 1 * HOUR),
      freeTimeMinutes: 120,
      hourlyRateUsd: 50,
    });
    expect(result.billableMinutes).toBe(0);
    expect(result.estimatedUsd).toBe(0);
    expect(result.owedUsd).toBe(0);
  });

  it('clamps to zero when departure precedes arrival (bad input)', () => {
    const result = calculateDetention({
      arrivalTime: t0,
      departureTime: new Date(t0.getTime() - 2 * HOUR),
      freeTimeMinutes: 0,
      hourlyRateUsd: 50,
    });
    expect(result.estimatedUsd).toBe(0);
  });

  it('manual override wins over the estimate (spec: always allow adjustment)', () => {
    const result = calculateDetention({
      arrivalTime: t0,
      departureTime: new Date(t0.getTime() + 5 * HOUR),
      freeTimeMinutes: 120,
      hourlyRateUsd: 50,
      manualOverrideUsd: 200,
    });
    expect(result.estimatedUsd).toBe(150);
    expect(result.owedUsd).toBe(200);
    expect(result.isOverridden).toBe(true);
  });

  it('rejects negative rate or free time', () => {
    expect(() =>
      calculateDetention({
        arrivalTime: 0,
        departureTime: HOUR,
        freeTimeMinutes: 0,
        hourlyRateUsd: -1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculateDetention({
        arrivalTime: 0,
        departureTime: HOUR,
        freeTimeMinutes: -10,
        hourlyRateUsd: 50,
      }),
    ).toThrow(RangeError);
  });

  it('exposes the spec-mandated disclaimer copy', () => {
    expect(DETENTION_DISCLAIMER).toBe(
      'Estimated detention owed. Confirm with your carrier, broker, or rate confirmation.',
    );
  });
});
