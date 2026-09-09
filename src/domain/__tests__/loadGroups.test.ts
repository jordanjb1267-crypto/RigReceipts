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
    expect(loadListGroupFor({ id: 'c', status: 'paid' }, [action('c')])).toBe('closed');
  });
});
