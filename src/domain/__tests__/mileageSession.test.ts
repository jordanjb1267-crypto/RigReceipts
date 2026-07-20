import {
  activeSegment,
  effectiveMiles,
  loadMileage,
  MileageSegment,
  NEXT_CHOICES,
  START_CHOICES,
  summarizeSegments,
  unclassifiedMiles,
} from '../mileageSession';

let n = 0;
const seg = (over: Partial<MileageSegment>): MileageSegment => {
  n += 1;
  return {
    id: `seg_${n}`,
    sessionId: 's1',
    loadId: null,
    startedAt: n * 1000,
    endedAt: n * 1000 + 500,
    startLocation: null,
    endLocation: null,
    calculatedMiles: 0,
    adjustedMiles: null,
    accountingCategory: 'unclassified',
    businessSubtype: null,
    trailerConfiguration: 'unknown',
    classificationSource: 'user',
    classificationConfidence: null,
    userConfirmed: true,
    note: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
};

describe('effectiveMiles', () => {
  it('prefers the user adjustment over the tracked value', () => {
    expect(effectiveMiles({ calculatedMiles: 100, adjustedMiles: 88 })).toBe(88);
    expect(effectiveMiles({ calculatedMiles: 100, adjustedMiles: null })).toBe(100);
  });
});

describe('activeSegment', () => {
  it('finds the open segment', () => {
    const open = seg({ endedAt: null, accountingCategory: 'loaded' });
    expect(activeSegment([seg({}), open])?.id).toBe(open.id);
    expect(activeSegment([seg({})])).toBeNull();
  });
});

describe('summarizeSegments', () => {
  it('keeps categories mutually exclusive and computes business totals', () => {
    const b = summarizeSegments([
      seg({ accountingCategory: 'loaded', calculatedMiles: 384.7 }),
      seg({ accountingCategory: 'deadhead', calculatedMiles: 52.3 }),
      seg({ accountingCategory: 'deadhead', calculatedMiles: 74.2 }),
      seg({ accountingCategory: 'business_empty', calculatedMiles: 11.4 }),
      seg({ accountingCategory: 'personal', calculatedMiles: 20 }),
      seg({ accountingCategory: 'unclassified', calculatedMiles: 42 }),
    ]);
    expect(b.loaded).toBe(384.7);
    expect(b.deadhead).toBe(126.5);
    expect(b.businessEmpty).toBe(11.4);
    expect(b.personal).toBe(20);
    expect(b.unclassified).toBe(42);
    // Total empty business = deadhead + other business empty.
    expect(b.totalEmptyBusiness).toBe(137.9);
    // Total business = loaded + deadhead + business empty (no personal/unclassified).
    expect(b.totalBusiness).toBe(522.6);
    expect(b.total).toBe(584.6);
  });

  it('deadhead rate excludes personal and unclassified from the denominator', () => {
    const b = summarizeSegments([
      seg({ accountingCategory: 'loaded', calculatedMiles: 800 }),
      seg({ accountingCategory: 'deadhead', calculatedMiles: 180 }),
      seg({ accountingCategory: 'business_empty', calculatedMiles: 20 }),
      seg({ accountingCategory: 'personal', calculatedMiles: 500 }), // ignored
      seg({ accountingCategory: 'unclassified', calculatedMiles: 500 }), // ignored
    ]);
    // 180 / (800 + 180 + 20) = 0.18
    expect(b.deadheadRate).toBeCloseTo(0.18, 5);
  });

  it('has a null deadhead rate with no business miles', () => {
    expect(
      summarizeSegments([seg({ accountingCategory: 'personal', calculatedMiles: 30 })])
        .deadheadRate,
    ).toBeNull();
  });

  it('uses adjusted miles when a segment was corrected', () => {
    const b = summarizeSegments([
      seg({ accountingCategory: 'loaded', calculatedMiles: 100, adjustedMiles: 90 }),
    ]);
    expect(b.loaded).toBe(90);
  });
});

describe('loadMileage', () => {
  it('attributes loaded, deadhead, and other business miles to a load', () => {
    const m = loadMileage(
      [
        seg({ loadId: 'L1', accountingCategory: 'deadhead', calculatedMiles: 62.4 }),
        seg({ loadId: 'L1', accountingCategory: 'loaded', calculatedMiles: 301.8 }),
        seg({ loadId: 'L1', accountingCategory: 'business_empty', calculatedMiles: 10 }),
        seg({ loadId: 'L2', accountingCategory: 'loaded', calculatedMiles: 999 }), // other load
        seg({ loadId: 'L1', accountingCategory: 'personal', calculatedMiles: 50 }), // not business
      ],
      'L1',
    );
    expect(m.loadedMiles).toBe(301.8);
    expect(m.deadheadMiles).toBe(62.4);
    expect(m.otherBusinessMiles).toBe(10);
    expect(m.totalMiles).toBe(374.2);
  });
});

describe('unclassifiedMiles', () => {
  it('sums only unclassified segments', () => {
    expect(
      unclassifiedMiles([
        seg({ accountingCategory: 'unclassified', calculatedMiles: 42 }),
        seg({ accountingCategory: 'loaded', calculatedMiles: 100 }),
      ]),
    ).toBe(42);
  });
});

describe('classification choices', () => {
  it('maps the start menu to the right categories', () => {
    const byKey = Object.fromEntries(START_CHOICES.map((c) => [c.key, c]));
    expect(byKey.hauling_load).toMatchObject({ category: 'loaded', needsLoad: true });
    expect(byKey.going_to_pickup).toMatchObject({
      category: 'deadhead',
      subtype: 'to_pickup',
      needsLoad: true,
    });
    expect(byKey.empty_repositioning).toMatchObject({
      category: 'business_empty',
      subtype: 'repositioning',
    });
    expect(byKey.maintenance.subtype).toBe('maintenance');
    expect(byKey.not_sure.category).toBe('unclassified');
  });

  it('never auto-deadheads post-delivery — Decide Later is unclassified', () => {
    const decideLater = NEXT_CHOICES.find((c) => c.key === 'decide_later')!;
    expect(decideLater.category).toBe('unclassified');
    // Next pickup is deadhead only when the driver explicitly picks it + a load.
    const nextPickup = NEXT_CHOICES.find((c) => c.key === 'next_pickup')!;
    expect(nextPickup).toMatchObject({
      category: 'deadhead',
      subtype: 'to_pickup',
      needsLoad: true,
    });
  });
});
