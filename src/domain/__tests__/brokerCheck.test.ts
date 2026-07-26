import { BrokerExperience, summarizeBrokerHistory } from '../brokerCheck';

const exp = (paidOnTime: boolean, daysToPay: number | null): BrokerExperience => ({
  loadDate: '2026-07-01',
  paidOnTime,
  daysToPay,
  detentionHonored: null,
});

describe('summarizeBrokerHistory', () => {
  it('is unrated with no loads', () => {
    expect(summarizeBrokerHistory([])).toEqual({
      loadCount: 0,
      onTimeCount: 0,
      onTimeRate: null,
      avgDaysToPay: null,
      reliability: 'unrated',
    });
  });

  it('stays unrated below the minimum load count', () => {
    const s = summarizeBrokerHistory([exp(true, 20), exp(true, 25)]);
    expect(s.loadCount).toBe(2);
    expect(s.onTimeRate).toBe(1);
    expect(s.reliability).toBe('unrated');
  });

  it('rates a reliable, fast-paying broker excellent', () => {
    const s = summarizeBrokerHistory([exp(true, 20), exp(true, 30), exp(true, 25), exp(true, 28)]);
    expect(s.avgDaysToPay).toBe(25.8);
    expect(s.onTimeRate).toBe(1);
    expect(s.reliability).toBe('excellent');
  });

  it('flags slow or late payers as watch', () => {
    const s = summarizeBrokerHistory([exp(false, 70), exp(true, 65), exp(false, 80)]);
    expect(s.reliability).toBe('watch');
  });

  it('ignores null days-to-pay in the average', () => {
    const s = summarizeBrokerHistory([exp(true, 30), exp(true, null), exp(true, 40)]);
    expect(s.avgDaysToPay).toBe(35);
    expect(s.reliability).toBe('excellent');
  });
});
