import { CarrierPacketRemoteConflictError, supabaseCarrierRemote } from '../carrierPacketSync';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require('node:fs') as { readFileSync(path: string, enc: string): string };

type Op = {
  method: string;
  table?: string;
  row?: Record<string, unknown>;
  col?: string;
  val?: unknown;
  cols?: string;
  onConflict?: string;
};

const mockState: {
  ops: Op[];
  insertResult: { data: unknown; error: unknown };
  updateResult: { data: unknown; error: unknown };
} = {
  ops: [],
  insertResult: { data: [{ id: 'pkt', status: 'DRAFT' }], error: null },
  updateResult: { data: [{ id: 'pkt', status: 'READY' }], error: null },
};

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({
    from: (table: string) => {
      mockState.ops.push({ method: 'from', table });
      return {
        insert: (row: Record<string, unknown>) => {
          mockState.ops.push({ method: 'insert', table, row });
          return {
            select: (cols: string) => {
              mockState.ops.push({ method: 'select', cols });
              return Promise.resolve(mockState.insertResult);
            },
          };
        },
        update: (row: Record<string, unknown>) => {
          mockState.ops.push({ method: 'update', table, row });
          const chain = {
            eq: (col: string, val: unknown) => {
              mockState.ops.push({ method: 'eq', col, val });
              return chain;
            },
            select: (cols: string) => {
              mockState.ops.push({ method: 'select', cols });
              return Promise.resolve(mockState.updateResult);
            },
          };
          return chain;
        },
        upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => {
          mockState.ops.push({ method: 'upsert', table, row, onConflict: opts?.onConflict });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  }),
}));

const draftRow = {
  id: 'pkt',
  owner_id: 'user-a',
  status: 'DRAFT',
  name: 'Pack',
};

beforeEach(() => {
  mockState.ops.length = 0;
  mockState.insertResult = { data: [{ id: 'pkt', status: 'DRAFT' }], error: null };
  mockState.updateResult = { data: [{ id: 'pkt', status: 'READY' }], error: null };
});

describe('supabaseCarrierRemote packet write shape', () => {
  it('CREATE uses insert + select and never upserts carrier_packets', async () => {
    await supabaseCarrierRemote.insertPacketDraft(draftRow);
    expect(mockState.ops.filter((o) => o.method === 'from' && o.table === 'carrier_packets').length).toBeGreaterThan(0);
    expect(mockState.ops.some((o) => o.method === 'insert' && o.table === 'carrier_packets')).toBe(true);
    expect(mockState.ops.some((o) => o.method === 'select' && o.cols === 'id,status')).toBe(true);
    expect(mockState.ops.some((o) => o.method === 'upsert' && o.table === 'carrier_packets')).toBe(false);
    expect(mockState.ops.some((o) => o.method === 'update')).toBe(false);
  });

  it('refuses INSERT of READY before touching Supabase', async () => {
    await expect(
      supabaseCarrierRemote.insertPacketDraft({ ...draftRow, status: 'READY' }),
    ).rejects.toMatchObject({ reason: 'invalid_insert_status' });
    expect(mockState.ops).toHaveLength(0);
  });

  it('transition uses update filtered by id, owner_id, and expected status', async () => {
    await supabaseCarrierRemote.updatePacket({ ...draftRow, status: 'READY' }, 'DRAFT');
    expect(mockState.ops.some((o) => o.method === 'update' && o.table === 'carrier_packets')).toBe(true);
    expect(mockState.ops.filter((o) => o.method === 'eq')).toEqual([
      { method: 'eq', col: 'id', val: 'pkt' },
      { method: 'eq', col: 'owner_id', val: 'user-a' },
      { method: 'eq', col: 'status', val: 'DRAFT' },
    ]);
    expect(mockState.ops.some((o) => o.method === 'select' && o.cols === 'id,status')).toBe(true);
    expect(mockState.ops.some((o) => o.method === 'upsert')).toBe(false);
    expect(mockState.ops.some((o) => o.method === 'insert')).toBe(false);
  });

  it('zero-row expected-status update is a remote conflict', async () => {
    mockState.updateResult = { data: [], error: null };
    await expect(supabaseCarrierRemote.updatePacket({ ...draftRow, status: 'READY' }, 'DRAFT')).rejects.toBeInstanceOf(
      CarrierPacketRemoteConflictError,
    );
    await expect(supabaseCarrierRemote.updatePacket({ ...draftRow, status: 'READY' }, 'DRAFT')).rejects.toMatchObject({
      reason: 'expected_status_miss',
    });
  });

  it('duplicate insert is a remote conflict, not an update', async () => {
    mockState.insertResult = {
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    };
    await expect(supabaseCarrierRemote.insertPacketDraft(draftRow)).rejects.toMatchObject({
      reason: 'duplicate_insert',
    });
    expect(mockState.ops.some((o) => o.method === 'update')).toBe(false);
    expect(mockState.ops.some((o) => o.method === 'upsert')).toBe(false);
  });

  it('malformed result shape is not accepted as success', async () => {
    mockState.insertResult = { data: [{ id: 'pkt' }, { id: 'pkt' }], error: null };
    await expect(supabaseCarrierRemote.insertPacketDraft(draftRow)).rejects.toMatchObject({
      reason: 'malformed_result',
    });
    mockState.updateResult = { data: [{ id: 'pkt' }, { id: 'other' }], error: null };
    await expect(supabaseCarrierRemote.updatePacket({ ...draftRow, status: 'READY' }, 'DRAFT')).rejects.toMatchObject({
      reason: 'malformed_result',
    });
  });

  it('carrierPacketSync.ts has no carrier_packets upsert leftover', () => {
    const src = nodeFs.readFileSync('src/data/carrierPacketSync.ts', 'utf8');
    expect(src).not.toMatch(/upsertPacket/);
    expect(src).not.toMatch(/table\('carrier_packets'\)[\s\S]{0,120}\.upsert/);
    expect(src).toMatch(/insertPacketDraft/);
    expect(src).toMatch(/updatePacket/);
    expect(src).toMatch(/\.eq\('status', expectedCurrentStatus\)/);
  });
});
