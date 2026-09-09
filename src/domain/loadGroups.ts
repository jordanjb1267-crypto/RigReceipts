/**
 * Derived load-list grouping. Not a new lifecycle — presentation only.
 *
 *   Active        — open, no load-scoped action items
 *   Needs Action  — open, and at least one derived action targets the load
 *   Closed        — paid
 */

import { ActionItem, actionItemsForLoad } from './actionItems';
import { isOpenLoad, LoadStatus } from './loads';

export const LOAD_LIST_GROUPS = ['needs_action', 'active', 'closed'] as const;
export type LoadListGroup = (typeof LOAD_LIST_GROUPS)[number];

export interface GroupableLoad {
  id: string;
  status: LoadStatus;
}

export function loadListGroupFor(
  load: GroupableLoad,
  actionItems: readonly ActionItem[],
): LoadListGroup {
  if (!isOpenLoad(load.status)) return 'closed';
  return actionItemsForLoad(actionItems, load.id).length > 0 ? 'needs_action' : 'active';
}

export interface GroupedLoads<T extends GroupableLoad> {
  needsAction: T[];
  active: T[];
  closed: T[];
}

export function groupLoadsForList<T extends GroupableLoad>(
  loads: readonly T[],
  actionItems: readonly ActionItem[],
): GroupedLoads<T> {
  const needsAction: T[] = [];
  const active: T[] = [];
  const closed: T[] = [];
  for (const load of loads) {
    const group = loadListGroupFor(load, actionItems);
    switch (group) {
      case 'needs_action':
        needsAction.push(load);
        break;
      case 'active':
        active.push(load);
        break;
      case 'closed':
        closed.push(load);
        break;
      default: {
        const exhaustive: never = group;
        return exhaustive;
      }
    }
  }
  return { needsAction, active, closed };
}
