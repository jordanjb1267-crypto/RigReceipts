import { ActionItem } from '../actionItems';
import { groupLoadsForList, loadListGroupFor } from '../loadGroups';

const action = (loadId: string): ActionItem => ({
  id: `missing_document:load:${loadId}:pod`,
  sourceObjectType: 'load',
  sourceObjectId: loadId,
  kind: 'missing_document',
  urgency: 'now',
  title: 'Scan POD',
  context: 'x',
  deepLink: { pathname: '/load-detail', params: { id: loadId } },
  reason: 'POD missing',
});

describe('load list grouping', () => {
  it('is derived presentation, not a new lifecycle', () => {
    const loads = [
      { id: 'a', status: 'in_transit' as const },
      { id: 'b', status: 'booked' as const },
      { id: 'c', status: 'paid' as const },
    ];
    const grouped = groupLoadsForList(loads, [action('a')]);
    expect(grouped.needsAction.map((l) => l.id)).toEqual(['a']);
    expect(grouped.active.map((l) => l.id)).toEqual(['b']);
    expect(grouped.closed.map((l) => l.id)).toEqual(['c']);
    expect(grouped.saved).toEqual([]);
    expect(loadListGroupFor({ id: 'c', status: 'paid' }, [action('c')])).toBe('closed');
  });

  it('never groups a clean evaluated offer as Active (RR-PR15-001)', () => {
    const offer = { id: 'eval_1', status: 'evaluated' as const };
    const frozen = { ...offer };
    const grouped = groupLoadsForList([offer], []);
    expect(loadListGroupFor(offer, [])).toBe('saved');
    expect(grouped.saved.map((l) => l.id)).toEqual(['eval_1']);
    expect(grouped.active).toEqual([]);
    expect(grouped.needsAction).toEqual([]);
    expect(grouped.closed).toEqual([]);
    expect(offer.status).toBe('evaluated');
    expect(offer).toEqual(frozen);
  });

  it('keeps evaluated in Saved even when it has a later economics action', () => {
    const offer = { id: 'eval_2', status: 'evaluated' as const };
    const grouped = groupLoadsForList(
      [offer],
      [
        {
          id: 'incomplete_economics:load:eval_2',
          sourceObjectType: 'load',
          sourceObjectId: 'eval_2',
          kind: 'incomplete_economics',
          urgency: 'later',
          title: 'Finish load economics',
          context: 'offer',
          deepLink: { pathname: '/load-detail', params: { id: 'eval_2' } },
          reason: 'Gross rate is not entered',
        },
      ],
    );
    expect(grouped.saved.map((l) => l.id)).toEqual(['eval_2']);
    expect(grouped.active).toEqual([]);
    expect(grouped.needsAction).toEqual([]);
    expect(offer.status).toBe('evaluated');
  });

  it('groups booked with no action as Active', () => {
    const booked = { id: 'b1', status: 'booked' as const };
    expect(loadListGroupFor(booked, [])).toBe('active');
    expect(groupLoadsForList([booked], []).active.map((l) => l.id)).toEqual(['b1']);
    expect(booked.status).toBe('booked');
  });

  it('groups in_transit with a load-scoped action as Needs Action', () => {
    const moving = { id: 't1', status: 'in_transit' as const };
    expect(loadListGroupFor(moving, [action('t1')])).toBe('needs_action');
    expect(moving.status).toBe('in_transit');
  });

  it('groups paid as Closed even if stale actions exist', () => {
    const paid = { id: 'p1', status: 'paid' as const };
    expect(loadListGroupFor(paid, [action('p1')])).toBe('closed');
    expect(paid.status).toBe('paid');
  });

  it('keeps delivered operationally open (Needs Action) until paid', () => {
    const delivered = { id: 'd1', status: 'delivered' as const };
    expect(loadListGroupFor(delivered, [])).toBe('needs_action');
    expect(loadListGroupFor(delivered, [action('d1')])).toBe('needs_action');
    expect(delivered.status).toBe('delivered');
  });

  it('does not mutate status while grouping a mixed list', () => {
    const loads = [
      { id: 's', status: 'evaluated' as const },
      { id: 'a', status: 'booked' as const },
      { id: 'n', status: 'in_transit' as const },
      { id: 'd', status: 'delivered' as const },
      { id: 'c', status: 'paid' as const },
    ];
    const before = loads.map((l) => l.status);
    const grouped = groupLoadsForList(loads, [action('n'), action('d')]);
    expect(grouped.saved.map((l) => l.id)).toEqual(['s']);
    expect(grouped.active.map((l) => l.id)).toEqual(['a']);
    expect(grouped.needsAction.map((l) => l.id)).toEqual(['n', 'd']);
    expect(grouped.closed.map((l) => l.id)).toEqual(['c']);
    expect(loads.map((l) => l.status)).toEqual(before);
  });
});
