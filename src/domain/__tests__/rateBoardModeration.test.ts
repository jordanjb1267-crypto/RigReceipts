import {
  AUTO_FLAG_REPORT_THRESHOLD,
  isPubliclyVisible,
  moderationStatusFromReports,
  PublishCheckInput,
  validateRateBoardPost,
} from '../rateBoardModeration';

const base: PublishCheckInput = {
  verificationLevel: 'completed_load',
  allMileRpm: 2.63,
  laneKey: 'chicago|il|atlanta|ga|dry_van',
  loadDateBucket: 'Mid July 2026',
  grossRate: 2150,
};

describe('validateRateBoardPost', () => {
  it('passes a clean, verified card', () => {
    expect(validateRateBoardPost(base)).toEqual({ ok: true, blocks: [] });
  });

  it('blocks self-entered rates', () => {
    const r = validateRateBoardPost({ ...base, verificationLevel: 'self_entered' });
    expect(r.ok).toBe(false);
    expect(r.blocks.map((b) => b.type)).toContain('not_verified');
  });

  it('blocks abnormally high or low rates', () => {
    expect(validateRateBoardPost({ ...base, allMileRpm: 42 }).blocks.map((b) => b.type)).toContain(
      'abnormal_rate',
    );
    expect(validateRateBoardPost({ ...base, allMileRpm: 0.1 }).blocks.map((b) => b.type)).toContain(
      'abnormal_rate',
    );
  });

  it('blocks a duplicate of an existing post', () => {
    const r = validateRateBoardPost({
      ...base,
      existingPosts: [
        { laneKey: base.laneKey, loadDateBucket: base.loadDateBucket, grossRate: 2150 },
      ],
    });
    expect(r.blocks.map((b) => b.type)).toContain('duplicate');
  });

  it('does not treat a different date or rate as duplicate', () => {
    const r = validateRateBoardPost({
      ...base,
      existingPosts: [
        { laneKey: base.laneKey, loadDateBucket: 'Early July 2026', grossRate: 2150 },
      ],
    });
    expect(r.blocks.map((b) => b.type)).not.toContain('duplicate');
  });

  it('flags sensitive info and future dates in free text', () => {
    const r = validateRateBoardPost({
      ...base,
      freeText: 'Call 405-555-1212, pickup 2099-01-01',
      now: new Date('2026-07-14T00:00:00Z'),
    });
    const types = r.blocks.map((b) => b.type);
    expect(types).toContain('sensitive_info');
    expect(types).toContain('future_date');
  });

  it('accumulates multiple blocks', () => {
    const r = validateRateBoardPost({ ...base, verificationLevel: 'self_entered', allMileRpm: 99 });
    expect(r.blocks.length).toBeGreaterThanOrEqual(2);
    expect(r.ok).toBe(false);
  });
});

describe('moderationStatusFromReports', () => {
  it('flags once reports cross the threshold', () => {
    expect(moderationStatusFromReports(AUTO_FLAG_REPORT_THRESHOLD, 'none')).toBe('flagged');
    expect(moderationStatusFromReports(AUTO_FLAG_REPORT_THRESHOLD - 1, 'none')).toBe('none');
  });

  it('leaves removed / under_review decisions to a human', () => {
    expect(moderationStatusFromReports(99, 'removed')).toBe('removed');
    expect(moderationStatusFromReports(99, 'under_review')).toBe('under_review');
  });
});

describe('isPubliclyVisible', () => {
  it('hides only removed posts', () => {
    expect(isPubliclyVisible('removed')).toBe(false);
    expect(isPubliclyVisible('flagged')).toBe(true);
    expect(isPubliclyVisible('approved')).toBe(true);
    expect(isPubliclyVisible('none')).toBe(true);
  });
});
