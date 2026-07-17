import {
  analyzeRateCheck,
  approximateDateBucket,
  canComputeLaneAggregate,
  computeLaneAggregate,
  DEFAULT_CARD_VISIBILITY,
  detectSensitiveText,
  EligiblePost,
  estimateAllMileTargets,
  isEligibleForPublicBoard,
  laneConfidence,
  QUICK_ESTIMATE_PROFILE,
  RateCardSource,
  sanitizeRateShareCard,
} from '../freight';

describe('analyzeRateCheck (all-mile basis)', () => {
  const base = { breakEvenAllMileRpm: 1.91, targetAllMileRpm: 2.58, variableCostPerMile: 0.65 };

  it('a strong loaded rate can still miss target once deadhead is counted (Section 30)', () => {
    // 2150 / 720 = 2.99 loaded; 2150 / 862 = 2.494 all-mile < 2.58 target
    const r = analyzeRateCheck({ ...base, offeredPay: 2150, loadedMiles: 720, deadheadMiles: 142 });
    expect(r.loadedRpm).toBe(2.99);
    expect(r.allMileRpm).toBe(2.49);
    expect(r.totalMiles).toBe(862);
    expect(r.verdict).toBe('below_target');
    expect(r.allMileRpmVsTarget).toBeCloseTo(-0.09, 2);
  });

  it('flags below_break_even when the all-mile rate cannot cover costs', () => {
    const r = analyzeRateCheck({ ...base, offeredPay: 900, loadedMiles: 400, deadheadMiles: 200 });
    expect(r.verdict).toBe('below_break_even');
  });

  it('flags above_target when all-mile clears the target band', () => {
    const r = analyzeRateCheck({ ...base, offeredPay: 2600, loadedMiles: 900, deadheadMiles: 50 });
    expect(r.verdict).toBe('above_target');
  });

  it('estimates contribution after variable costs', () => {
    // 2150 - 0.65 * 862 = 1589.70
    const r = analyzeRateCheck({ ...base, offeredPay: 2150, loadedMiles: 720, deadheadMiles: 142 });
    expect(r.contributionUsd).toBeCloseTo(1589.7, 2);
  });

  it('returns null contribution when variable cost is unknown', () => {
    const r = analyzeRateCheck({
      offeredPay: 2150,
      loadedMiles: 720,
      deadheadMiles: 142,
      breakEvenAllMileRpm: 1.91,
      targetAllMileRpm: 2.58,
    });
    expect(r.contributionUsd).toBeNull();
  });

  it('rejects nonpositive loaded miles', () => {
    expect(() =>
      analyzeRateCheck({ ...base, offeredPay: 2150, loadedMiles: 0, deadheadMiles: 10 }),
    ).toThrow(RangeError);
  });
});

describe('estimateAllMileTargets', () => {
  it('derives break-even and target from a cost profile', () => {
    // fixed 1100, var 1.05, miles 2600 → break-even (1100 + 2730)/2600 = 1.473
    // target adds pay 1400 + profit 400 → (3830 + 1800)/2600 = 2.165
    const t = estimateAllMileTargets(QUICK_ESTIMATE_PROFILE);
    expect(t).not.toBeNull();
    expect(t!.breakEvenAllMileRpm).toBeCloseTo(1.47, 2);
    expect(t!.targetAllMileRpm).toBeCloseTo(2.17, 2);
    expect(t!.targetAllMileRpm).toBeGreaterThan(t!.breakEvenAllMileRpm);
  });

  it('returns null when no miles are projected', () => {
    expect(
      estimateAllMileTargets({ ...QUICK_ESTIMATE_PROFILE, projectedTotalMiles: 0 }),
    ).toBeNull();
  });
});

describe('approximateDateBucket', () => {
  it('buckets into early/mid/late', () => {
    expect(approximateDateBucket('2026-07-05')).toBe('Early July 2026');
    expect(approximateDateBucket('2026-07-14')).toBe('Mid July 2026');
    expect(approximateDateBucket('2026-07-28')).toBe('Late July 2026');
  });
  it('rejects malformed dates', () => {
    expect(approximateDateBucket('07/14/2026')).toBeNull();
    expect(approximateDateBucket('2026-13-01')).toBeNull();
  });
});

describe('sanitizeRateShareCard privacy', () => {
  const source: RateCardSource = {
    originMetro: 'Chicago',
    originState: 'IL',
    destinationMetro: 'Atlanta',
    destinationState: 'GA',
    equipmentType: 'dry_van',
    rateStatus: 'completed',
    verificationLevel: 'completed_load',
    grossRate: 2150,
    fuelSurchargeIncluded: true,
    loadedMiles: 720,
    deadheadMiles: 98,
    loadedRpm: 2.99,
    allMileRpm: 2.63,
    loadDate: '2026-07-14',
    // private fields that must never appear on a card
    driverName: 'Jordan B',
    carrierName: 'JB Trucking LLC',
    loadNumber: '48291',
    pickupAddress: '1201 W Reno Ave, Oklahoma City, OK',
    brokerName: 'MegaBroker Inc',
    brokerRep: 'Dana',
    phone: '405-555-1212',
    email: 'dispatch@megabroker.com',
    bolNumber: 'BOL-9931',
    commodity: 'Auto parts',
    notes: 'Call broker before pickup',
  };

  it('emits only allow-listed fields — no private data leaks', () => {
    const card = sanitizeRateShareCard(source);
    const allowed = new Set([
      'originMetro',
      'originState',
      'destinationMetro',
      'destinationState',
      'equipmentType',
      'rateStatus',
      'verificationLevel',
      'fuelSurchargeIncluded',
      'grossRate',
      'loadedMiles',
      'deadheadMiles',
      'loadedRpm',
      'allMileRpm',
      'loadDateBucket',
    ]);
    for (const key of Object.keys(card)) expect(allowed.has(key)).toBe(true);
  });

  it('never carries driver, broker, load number, address, or contact fields', () => {
    const card = sanitizeRateShareCard(source) as unknown as Record<string, unknown>;
    for (const leaked of [
      'driverName',
      'carrierName',
      'loadNumber',
      'pickupAddress',
      'brokerName',
      'brokerRep',
      'phone',
      'email',
      'bolNumber',
      'commodity',
      'notes',
    ]) {
      expect(card[leaked]).toBeUndefined();
    }
  });

  it('buckets the date instead of exposing it', () => {
    const card = sanitizeRateShareCard(source);
    expect(card.loadDateBucket).toBe('Mid July 2026');
    expect(JSON.stringify(card)).not.toContain('2026-07-14');
  });

  it('honors the default visibility (deadhead OFF)', () => {
    const card = sanitizeRateShareCard(source, DEFAULT_CARD_VISIBILITY);
    expect(card.deadheadMiles).toBeNull();
    expect(card.grossRate).toBe(2150);
    expect(card.loadedRpm).toBe(2.99);
  });

  it('hides gross rate and RPM when toggled off', () => {
    const card = sanitizeRateShareCard(source, {
      showGrossRate: false,
      showLoadedMiles: false,
      showDeadhead: false,
      showLoadedRpm: false,
      showAllMileRpm: false,
      showApproxDate: false,
    });
    expect(card.grossRate).toBeNull();
    expect(card.loadedRpm).toBeNull();
    expect(card.allMileRpm).toBeNull();
    expect(card.loadedMiles).toBeNull();
    expect(card.loadDateBucket).toBeNull();
  });
});

describe('detectSensitiveText', () => {
  it('flags phone numbers and emails', () => {
    const f = detectSensitiveText('Call 405-555-1212 or dispatch@x.com');
    expect(f.some((x) => x.type === 'phone')).toBe(true);
    expect(f.some((x) => x.type === 'email')).toBe(true);
  });
  it('flags street addresses', () => {
    const f = detectSensitiveText('Pickup at 1201 W Reno Ave');
    expect(f.some((x) => x.type === 'address')).toBe(true);
  });
  it('flags active-load language', () => {
    const f = detectSensitiveText('Available load, book it now');
    expect(f.some((x) => x.type === 'active_load_language')).toBe(true);
  });
  it('flags future dates', () => {
    const f = detectSensitiveText('Pickup 2026-07-20', new Date('2026-07-14T00:00:00Z'));
    expect(f.some((x) => x.type === 'future_date')).toBe(true);
  });
  it('passes clean historical text', () => {
    expect(detectSensitiveText('Chicago to Atlanta, dry van, completed')).toEqual([]);
  });
});

describe('verification eligibility', () => {
  it('blocks self-entered from the public board', () => {
    expect(isEligibleForPublicBoard('self_entered')).toBe(false);
    expect(isEligibleForPublicBoard('document_verified')).toBe(true);
    expect(isEligibleForPublicBoard('completed_load')).toBe(true);
  });
});

describe('lane aggregates', () => {
  const post = (contributorId: string, allMileRpm: number): EligiblePost => ({
    contributorId,
    loadedRpm: allMileRpm + 0.3,
    allMileRpm,
    deadheadMiles: 90,
    verificationLevel: 'completed_load',
  });

  it('requires 7 posts and 3 contributors', () => {
    const few = [post('a', 2.5), post('b', 2.6), post('c', 2.7)];
    expect(canComputeLaneAggregate(few)).toBe(false);
    expect(computeLaneAggregate(few)).toBeNull();

    const oneContributor = Array.from({ length: 8 }, (_, i) => post('a', 2.5 + i * 0.01));
    expect(canComputeLaneAggregate(oneContributor)).toBe(false);
  });

  it('excludes self-entered posts from the threshold', () => {
    const posts: EligiblePost[] = [
      ...Array.from({ length: 6 }, (_, i) => post(`c${i}`, 2.5)),
      {
        contributorId: 'x',
        loadedRpm: 3,
        allMileRpm: 2.9,
        deadheadMiles: 50,
        verificationLevel: 'self_entered',
      },
    ];
    // 6 eligible + 1 self-entered → only 6 eligible, below threshold
    expect(canComputeLaneAggregate(posts)).toBe(false);
  });

  it('computes a median once thresholds are met', () => {
    const posts = [
      post('a', 2.4),
      post('b', 2.5),
      post('c', 2.6),
      post('d', 2.7),
      post('e', 2.8),
      post('f', 2.9),
      post('g', 3.0),
    ];
    const agg = computeLaneAggregate(posts);
    expect(agg).not.toBeNull();
    expect(agg!.contributorCount).toBe(7);
    expect(agg!.medianAllMileRpm).toBe(2.7);
    expect(agg!.lowAllMileRpm).toBe(2.4);
    expect(agg!.highAllMileRpm).toBe(3.0);
  });

  it('caps one account from dominating the median', () => {
    // 'spam' has 20 low posts; 6 other contributors have realistic rates.
    const spam = Array.from({ length: 20 }, () => post('spam', 1.0));
    const real = [
      post('a', 2.5),
      post('b', 2.6),
      post('c', 2.7),
      post('d', 2.8),
      post('e', 2.9),
      post('f', 3.0),
    ];
    const agg = computeLaneAggregate([...spam, ...real]);
    // 7 contributors → each reduced to one representative, so spam is 1 of 7,
    // not 20 of 26. Median stays realistic rather than collapsing to 1.0.
    expect(agg).not.toBeNull();
    expect(agg!.medianAllMileRpm).toBeGreaterThan(2.0);
  });

  it('labels confidence by sample size', () => {
    expect(laneConfidence(2, 5)).toBe('limited');
    expect(laneConfidence(3, 7)).toBe('developing');
    expect(laneConfidence(5, 12)).toBe('moderate');
    expect(laneConfidence(8, 20)).toBe('strong');
  });
});
