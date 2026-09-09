/**
 * Derived load-list grouping. Not a new lifecycle — presentation only.
 * Grouping never writes `LoadStatus`.
 *
 *   Saved         — `evaluated` offers. Not booked work and never Active.
 *                   Evaluated-specific later actions (e.g. missing gross) may
 *                   render on the Saved card; they do not reclassify the offer
 *                   as operational Needs Action or Active.
 *   Needs Action  — booked / in_transit with a load-scoped derived action;
 *                   delivered stays here until paid (operationally open,
 *                   local closeout not confirmed).
 *   Active        — booked / in_transit with no load-scoped action.
 *   Closed        — paid.
 *
 * `evaluated != booked`. This function never treats an evaluated offer as
 * booked or as accepted work.
 */

import { ActionItem, actionItemsForLoad } from './actionItems';
import { LoadStatus } from './loads';

export const LOAD_LIST_GROUPS = ['saved', 'needs_action', 'active', 'closed'] as const;
export type LoadListGroup = (typeof LOAD_LIST_GROUPS)[number];

export interface GroupableLoad {
  id: string;
  status: LoadStatus;
}

export function loadListGroupFor(
  load: GroupableLoad,
  actionItems: readonly ActionItem[],
): LoadListGroup {
  switch (load.status) {
    case 'paid':
      return 'closed';
    case 'evaluated':
      return 'saved';
    case 'delivered':
      return 'needs_action';
    case 'booked':
    case 'in_transit':
      return actionItemsForLoad(actionItems, load.id).length > 0 ? 'needs_action' : 'active';
    default: {
      const exhaustive: never = load.status;
      return exhaustive;
    }
  }
}

export interface GroupedLoads<T extends GroupableLoad> {
  saved: T[];
  needsAction: T[];
  active: T[];
  closed: T[];
}

export function groupLoadsForList<T extends GroupableLoad>(
  loads: readonly T[],
  actionItems: readonly ActionItem[],
): GroupedLoads<T> {
  const saved: T[] = [];
  const needsAction: T[] = [];
  const active: T[] = [];
  const closed: T[] = [];
  for (const load of loads) {
    const group = loadListGroupFor(load, actionItems);
    switch (group) {
      case 'saved':
        saved.push(load);
        break;
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
  return { saved, needsAction, active, closed };
}
