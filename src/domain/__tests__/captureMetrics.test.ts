import {
  effectiveDateMs,
  ExpenseLike,
  expensesInRange,
  last7dRange,
  monthRange,
  summarizeRange,
  summarizeSpend,
} from '../captureMetrics';

const cap = (over: Partial<ExpenseLike>): ExpenseLike => ({
  scanType: 'fuel',
  totalUsd: 100,
  gallons: null,
  date: null,
  createdAt: Date.UTC(2026, 6, 15),
  ...over,
});

describe('effectiveDateMs', () => {
  it('prefers the receipt date over createdAt', () => {
    const e = cap({ date: '2026-07-04', createdAt: Date.UTC(2026, 0, 1) });
    expect(effectiveDateMs(e)).toBe(new Date(2026, 6, 4).getTime());
  });

  it('falls back to createdAt when there is no date', () => {
    const ms = Date.UTC(2026, 5, 2);
    expect(effectiveDateMs(cap({ date: null, createdAt: ms }))).toBe(ms);
  });
});

describe('summarizeSpend', () => {
  it('is empty for no captures', () => {
    expect(summarizeSpend([])).toEqual({
      totalUsd: 0,
      expenseCount: 0,
      documentCount: 0,
      fuelGallons: 0,
      byCategory: [],
      topCategory: null,
    });
  });

  it('sums money-type captures and counts documents separately', () => {
    const s = summarizeSpend([
      cap({ scanType: 'fuel', totalUsd: 420.5, gallons: 120 }),
      cap({ scanType: 'meal', totalUsd: 18.25 }),
      cap({ scanType: 'bol', totalUsd: null }), // pure document
      cap({ scanType: 'pod', totalUsd: null }), // pure document
    ]);
    expect(s.totalUsd).toBe(438.75);
    expect(s.expenseCount).toBe(2);
    expect(s.documentCount).toBe(2);
    expect(s.fuelGallons).toBe(120);
  });

  it('treats a missing amount as zero without dropping the record', () => {
    const s = summarizeSpend([
      cap({ scanType: 'fuel', totalUsd: null }),
      cap({ scanType: 'fuel', totalUsd: 200 }),
    ]);
    expect(s.expenseCount).toBe(2);
    expect(s.totalUsd).toBe(200);
  });

  it('groups by category, highest spend first', () => {
    const s = summarizeSpend([
      cap({ scanType: 'meal', totalUsd: 20 }),
      cap({ scanType: 'fuel', totalUsd: 500 }),
      cap({ scanType: 'meal', totalUsd: 30 }),
      cap({ scanType: 'toll', totalUsd: 12 }),
    ]);
    expect(s.byCategory.map((c) => c.category)).toEqual(['fuel', 'meals', 'tolls']);
    expect(s.topCategory?.category).toBe('fuel');
    const meals = s.byCategory.find((c) => c.category === 'meals');
    expect(meals).toMatchObject({ totalUsd: 50, count: 2, label: 'Meals' });
  });
});

describe('ranges', () => {
  it('monthRange spans the calendar month and labels it', () => {
    const r = monthRange(new Date(2026, 6, 19));
    expect(r.startMs).toBe(new Date(2026, 6, 1).getTime());
    expect(r.endMs).toBe(new Date(2026, 7, 1).getTime());
    expect(r.label).toBe('July 2026');
  });

  it('expensesInRange keeps only in-window captures (end exclusive)', () => {
    const now = new Date(2026, 6, 19);
    const range = monthRange(now);
    const kept = expensesInRange(
      [
        cap({ date: '2026-07-01' }), // start, inclusive
        cap({ date: '2026-07-31' }), // in month
        cap({ date: '2026-08-01' }), // next month, excluded
        cap({ date: '2026-06-30' }), // prev month, excluded
      ],
      range,
    );
    expect(kept).toHaveLength(2);
  });

  it('summarizeRange composes filtering + aggregation', () => {
    const now = new Date(2026, 6, 19);
    const s = summarizeRange(
      [
        cap({ scanType: 'fuel', totalUsd: 300, date: '2026-07-10' }),
        cap({ scanType: 'fuel', totalUsd: 999, date: '2026-05-10' }), // out of month
      ],
      monthRange(now),
    );
    expect(s.totalUsd).toBe(300);
    expect(s.expenseCount).toBe(1);
  });

  it('last7dRange is a trailing week', () => {
    const now = new Date(2026, 6, 19, 12);
    const r = last7dRange(now);
    expect(r.endMs).toBe(now.getTime());
    expect(r.startMs).toBe(now.getTime() - 7 * 86400000);
  });
});
