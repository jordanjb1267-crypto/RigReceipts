import { buildExportBundle, EXPORT_TABLES } from '../account';

const NOW = new Date('2026-07-19T12:00:00.000Z');

describe('buildExportBundle', () => {
  it('wraps records with a versioned envelope and per-table counts', () => {
    const bundle = buildExportBundle(
      'user-1',
      {
        expenses: [{ id: 'e1' }, { id: 'e2' }],
        loads: [{ id: 'l1' }],
        rate_board_posts: [],
      },
      NOW,
    );
    expect(bundle).toEqual({
      format: 'rigreceipts.account_export',
      version: 1,
      exportedAt: '2026-07-19T12:00:00.000Z',
      userId: 'user-1',
      counts: { expenses: 2, loads: 1, rate_board_posts: 0 },
      records: {
        expenses: [{ id: 'e1' }, { id: 'e2' }],
        loads: [{ id: 'l1' }],
        rate_board_posts: [],
      },
    });
  });

  it('exports the owner-scoped tables including the freight ones', () => {
    for (const t of ['expenses', 'loads', 'rate_share_cards', 'rate_board_posts', 'profiles']) {
      expect(EXPORT_TABLES).toContain(t);
    }
    // No duplicates.
    expect(new Set(EXPORT_TABLES).size).toBe(EXPORT_TABLES.length);
  });
});
