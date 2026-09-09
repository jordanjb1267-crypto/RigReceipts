import { Href } from 'expo-router';

import { ActionItem, DocumentType, ScanTypeSlug } from '@/domain';
import { useScanContextStore } from '@/store/scanContext';

export function hrefFromAction(item: ActionItem): Href {
  if (item.deepLink.params) {
    return {
      pathname: item.deepLink.pathname,
      params: item.deepLink.params,
    } as Href;
  }
  return item.deepLink.pathname as Href;
}

/** Navigate an action. Missing-document actions bind scan context first. */
export function launchAction(item: ActionItem, router: { push: (href: Href) => void }): void {
  const params = item.deepLink.params;
  if (item.kind === 'missing_document' && params?.loadId && params.intendedDocType) {
    useScanContextStore.getState().setContext({
      loadId: params.loadId,
      intendedDocType: params.intendedDocType as DocumentType,
      scanType: (params.scanType as ScanTypeSlug) ?? 'other',
      sourceAction: params.sourceAction ?? item.kind,
    });
  }
  router.push(hrefFromAction(item));
}
