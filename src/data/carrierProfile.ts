import {
  canMutateCarrierProfile,
  CarrierProfile,
  carrierStatusAfterMutation,
  CloudSyncContext,
  snapshotCarrierProfile,
  validateCarrierProfile,
} from '@/domain';
import { selectVisibleCarrierProfile, useCarrierProfileStore } from '@/store/carrierProfile';

import { currentCloudSyncContext } from './cloudSyncAuth';
import { newSecureOpaqueId } from './documentFiles';

export class CarrierProfileDeniedError extends Error {
  readonly reason: 'NOT_ENTITLED' | 'NOT_FOUND' | 'NOT_VISIBLE' | 'ONE_PER_ACCOUNT';
  constructor(reason: CarrierProfileDeniedError['reason'], detail?: string) {
    super(`carrier profile denied: ${reason}${detail ? ` (${detail})` : ''}`);
    this.name = 'CarrierProfileDeniedError';
    this.reason = reason;
  }
}

export interface CarrierProfileDeps {
  ctx: () => CloudSyncContext;
  now: () => number;
  newId: () => string;
}

export const defaultCarrierProfileDeps = (): CarrierProfileDeps => ({
  ctx: currentCloudSyncContext,
  now: Date.now,
  newId: newSecureOpaqueId,
});

export type CarrierProfileInput = Pick<CarrierProfile, 'legalName'> &
  Partial<
    Pick<
      CarrierProfile,
      | 'dbaName'
      | 'usdotNumber'
      | 'mcNumber'
      | 'addressLine1'
      | 'addressLine2'
      | 'city'
      | 'stateProvince'
      | 'postalCode'
      | 'contactName'
      | 'contactEmail'
      | 'contactPhone'
      | 'equipmentTypes'
    >
  >;

const emptyOptional = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
};

export function saveCarrierProfile(
  input: CarrierProfileInput,
  deps: CarrierProfileDeps = defaultCarrierProfileDeps(),
): CarrierProfile {
  const ctx = deps.ctx();
  if (!canMutateCarrierProfile(ctx.tier)) throw new CarrierProfileDeniedError('NOT_ENTITLED');
  const existing = selectVisibleCarrierProfile(
    useCarrierProfileStore.getState().profiles,
    ctx.userId,
  );
  const now = deps.now();
  const next: CarrierProfile = {
    id: existing?.id ?? deps.newId(),
    accountOwnerId: ctx.userId,
    legalName: input.legalName.trim(),
    dbaName: emptyOptional(input.dbaName),
    usdotNumber: emptyOptional(input.usdotNumber),
    mcNumber: emptyOptional(input.mcNumber),
    addressLine1: emptyOptional(input.addressLine1),
    addressLine2: emptyOptional(input.addressLine2),
    city: emptyOptional(input.city),
    stateProvince: emptyOptional(input.stateProvince),
    postalCode: emptyOptional(input.postalCode),
    contactName: emptyOptional(input.contactName),
    contactEmail: emptyOptional(input.contactEmail),
    contactPhone: emptyOptional(input.contactPhone),
    equipmentTypes: input.equipmentTypes ?? [],
    identitySource: 'USER_ENTERED',
    cloudStatus: carrierStatusAfterMutation(ctx, true, ctx.userId),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  validateCarrierProfile(next);
  useCarrierProfileStore.getState().upsertProfile(next);
  return next;
}

export function currentCarrierProfile(
  deps: CarrierProfileDeps = defaultCarrierProfileDeps(),
): CarrierProfile | null {
  return selectVisibleCarrierProfile(useCarrierProfileStore.getState().profiles, deps.ctx().userId);
}

export function currentProfileSnapshot(
  deps: CarrierProfileDeps = defaultCarrierProfileDeps(),
) {
  const profile = currentCarrierProfile(deps);
  return profile ? snapshotCarrierProfile(profile, deps.now()) : null;
}
