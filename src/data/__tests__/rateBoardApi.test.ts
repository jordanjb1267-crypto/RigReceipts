import { contributorAliasFor, RATE_REPORT_CATEGORIES } from '@/domain';

import { mapPostRow, POST_COLUMNS, RateBoardPostRow } from '../rateBoardApi';

const row: RateBoardPostRow = {
  id: 'post-1',
  contributor_alias: 'driver-abc123',
  origin_market: 'Chicago',
  origin_state: 'IL',
  destination_market: 'Atlanta',
  destination_state: 'GA',
  equipment_type: 'dry_van',
  rate_status: 'completed',
  verification_level: 'completed_load',
  gross_rate: '2150.00',
  fuel_surcharge_included: false,
  loaded_miles: 720,
  deadhead_miles: null,
  loaded_rpm: '2.99',
  all_mile_rpm: 2.63,
  load_date_bucket: 'Mid July 2026',
  published_at: '2026-07-15T12:00:00Z',
  created_at: '2026-07-15T11:00:00Z',
};

describe('mapPostRow', () => {
  const now = new Date('2026-07-18T12:00:00Z');

  it('maps the snapshot and coerces numeric strings', () => {
    const post = mapPostRow(row, now);
    expect(post).toEqual({
      id: 'post-1',
      contributorId: 'driver-abc123',
      originMetro: 'Chicago',
      originState: 'IL',
      destinationMetro: 'Atlanta',
      destinationState: 'GA',
      equipmentType: 'dry_van',
      rateStatus: 'completed',
      verificationLevel: 'completed_load',
      grossRate: 2150,
      loadedMiles: 720,
      deadheadMiles: null,
      loadedRpm: 2.99,
      allMileRpm: 2.63,
      loadDateBucket: 'Mid July 2026',
      postedDaysAgo: 3,
    });
  });

  it('falls back to created_at and clamps future timestamps to 0 days', () => {
    const unpublished = { ...row, published_at: null, created_at: '2026-07-17T00:00:00Z' };
    expect(mapPostRow(unpublished, now).postedDaysAgo).toBe(1);
    const future = { ...row, published_at: '2026-07-19T00:00:00Z' };
    expect(mapPostRow(future, now).postedDaysAgo).toBe(0);
  });

  it('never selects user_id into the feed', () => {
    expect(POST_COLUMNS).not.toContain('user_id');
  });
});

describe('contributorAliasFor', () => {
  const lane = 'chicago|il|atlanta|ga|dry_van';
  const otherLane = 'dallas|tx|memphis|tn|reefer';
  const user = '4f9a2f66-1111-4222-8333-abcdefabcdef';

  it('is stable for the same user and lane', () => {
    expect(contributorAliasFor(user, lane)).toBe(contributorAliasFor(user, lane));
  });

  it('differs across lanes and across users', () => {
    expect(contributorAliasFor(user, lane)).not.toBe(contributorAliasFor(user, otherLane));
    expect(contributorAliasFor(user, lane)).not.toBe(
      contributorAliasFor('9b1c0000-2222-4333-8444-fedcbafedcba', lane),
    );
  });

  it('is an opaque driver handle, not the user id', () => {
    const alias = contributorAliasFor(user, lane);
    expect(alias).toMatch(/^driver-[0-9a-z]+$/);
    expect(alias).not.toContain(user.slice(0, 8));
  });
});

describe('RATE_REPORT_CATEGORIES', () => {
  it('matches the rate_report_category enum (Section 22)', () => {
    expect(RATE_REPORT_CATEGORIES.map((c) => c.slug)).toEqual([
      'incorrect_rate',
      'duplicate_post',
      'active_load_listing',
      'contact_information',
      'private_shipment_information',
      'misleading_verification',
      'broker_harassment',
      'spam',
      'other',
    ]);
  });
});
