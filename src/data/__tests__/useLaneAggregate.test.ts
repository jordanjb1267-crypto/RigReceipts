import { mapLaneAggregateRow, LaneAggregateRow } from '../useLaneAggregate';

describe('mapLaneAggregateRow', () => {
  it('maps a lane_rate_aggregates row and coerces numeric strings', () => {
    const row: LaneAggregateRow = {
      post_count: 9,
      contributor_count: '4',
      median_loaded_rpm: '2.99',
      median_all_mile_rpm: 2.73,
      median_deadhead_miles: '98',
      low_all_mile_rpm: '2.49',
      high_all_mile_rpm: '2.90',
      confidence: 'moderate',
    };
    expect(mapLaneAggregateRow(row)).toEqual({
      postCount: 9,
      contributorCount: 4,
      medianLoadedRpm: 2.99,
      medianAllMileRpm: 2.73,
      medianDeadheadMiles: 98,
      lowAllMileRpm: 2.49,
      highAllMileRpm: 2.9,
      confidence: 'moderate',
    });
  });
});
