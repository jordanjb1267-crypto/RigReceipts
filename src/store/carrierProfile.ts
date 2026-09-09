import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  CarrierProfile,
  CloudSyncContext,
  CloudSyncStatus,
  isOpaqueId,
  reconcileCarrierCloudStatus,
  validateCarrierProfile,
  visibleProfilesForSession,
  authorizeCarrierProfileCloudWrite,
} from '@/domain';

export const CARRIER_PROFILE_PERSIST_VERSION = 1;

interface CarrierProfileState {
  profiles: CarrierProfile[];
  hydrated: boolean;
  upsertProfile: (profile: CarrierProfile) => void;
  setCloudStatus: (id: string, status: CloudSyncStatus) => void;
  importRecoveredProfile: (profile: CarrierProfile) => void;
  replaceSyncedProfile: (profile: CarrierProfile) => void;
  reconcileCloudStatuses: (ctx: CloudSyncContext) => number;
  clear: () => void;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function sanitizeProfile(raw: unknown): CarrierProfile | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || !isOpaqueId(raw.id)) return null;
  if (typeof raw.legalName !== 'string') return null;
  const accountOwnerId = typeof raw.accountOwnerId === 'string' ? raw.accountOwnerId : null;
  const profile: CarrierProfile = {
    id: raw.id,
    accountOwnerId,
    legalName: raw.legalName,
    dbaName: typeof raw.dbaName === 'string' ? raw.dbaName : null,
    usdotNumber: typeof raw.usdotNumber === 'string' ? raw.usdotNumber : null,
    mcNumber: typeof raw.mcNumber === 'string' ? raw.mcNumber : null,
    addressLine1: typeof raw.addressLine1 === 'string' ? raw.addressLine1 : null,
    addressLine2: typeof raw.addressLine2 === 'string' ? raw.addressLine2 : null,
    city: typeof raw.city === 'string' ? raw.city : null,
    stateProvince: typeof raw.stateProvince === 'string' ? raw.stateProvince : null,
    postalCode: typeof raw.postalCode === 'string' ? raw.postalCode : null,
    contactName: typeof raw.contactName === 'string' ? raw.contactName : null,
    contactEmail: typeof raw.contactEmail === 'string' ? raw.contactEmail : null,
    contactPhone: typeof raw.contactPhone === 'string' ? raw.contactPhone : null,
    equipmentTypes: Array.isArray(raw.equipmentTypes)
      ? raw.equipmentTypes.filter((x): x is string => typeof x === 'string')
      : [],
    identitySource: 'USER_ENTERED',
    cloudStatus:
      raw.cloudStatus === 'synced' && accountOwnerId !== null ? 'synced' : 'local_only',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  };
  try {
    validateCarrierProfile(profile);
  } catch {
    return null;
  }
  return profile;
}

export function normalizeCarrierProfileState(persisted: unknown): { profiles: CarrierProfile[] } {
  const state = isRecord(persisted) ? persisted : {};
  const raw = Array.isArray(state.profiles) ? state.profiles : [];
  const byOwner = new Map<string, CarrierProfile>();
  const unowned: CarrierProfile[] = [];
  for (const row of raw) {
    const profile = sanitizeProfile(row);
    if (!profile) continue;
    if (profile.accountOwnerId === null) {
      if (unowned.length === 0) unowned.push(profile);
      continue;
    }
    if (!byOwner.has(profile.accountOwnerId)) byOwner.set(profile.accountOwnerId, profile);
  }
  return { profiles: [...byOwner.values(), ...unowned] };
}

export const useCarrierProfileStore = create<CarrierProfileState>()(
  persist(
    (set, get) => ({
      profiles: [],
      hydrated: false,

      upsertProfile: (next) => {
        validateCarrierProfile(next);
        const existing = get().profiles.filter(
          (p) =>
            p.id !== next.id &&
            p.accountOwnerId !== null &&
            p.accountOwnerId === next.accountOwnerId,
        );
        if (existing.length > 0 && !get().profiles.some((p) => p.id === next.id)) {
          throw new Error('one CarrierProfile per account');
        }
        set((s) => ({
          profiles: s.profiles.some((p) => p.id === next.id)
            ? s.profiles.map((p) => (p.id === next.id ? next : p))
            : [next, ...s.profiles],
        }));
      },

      setCloudStatus: (id, status) =>
        set((s) => ({
          profiles: s.profiles.map((p) => (p.id === id ? { ...p, cloudStatus: status } : p)),
        })),

      importRecoveredProfile: (next) => {
        validateCarrierProfile(next);
        if (next.cloudStatus !== 'synced') throw new Error('recovered profile must be synced');
        if (get().profiles.some((p) => p.id === next.id)) return;
        if (
          next.accountOwnerId &&
          get().profiles.some((p) => p.accountOwnerId === next.accountOwnerId)
        ) {
          return;
        }
        set((s) => ({ profiles: [next, ...s.profiles] }));
      },

      replaceSyncedProfile: (remote) => {
        const local = get().profiles.find((p) => p.id === remote.id);
        if (!local) throw new Error('profile not found');
        if (local.cloudStatus !== 'synced') throw new Error('local profile has unsynced changes');
        if (local.accountOwnerId !== remote.accountOwnerId) throw new Error('ownership is immutable');
        validateCarrierProfile({ ...remote, cloudStatus: 'synced' });
        set((s) => ({
          profiles: s.profiles.map((p) =>
            p.id === local.id ? { ...remote, cloudStatus: 'synced' as const } : p,
          ),
        }));
      },

      reconcileCloudStatuses: (ctx) => {
        let changed = 0;
        const profiles = get().profiles.map((p) => {
          const next = reconcileCarrierCloudStatus(
            p.cloudStatus,
            authorizeCarrierProfileCloudWrite(ctx, p.accountOwnerId).allowed,
          );
          if (next === p.cloudStatus) return p;
          changed++;
          return { ...p, cloudStatus: next };
        });
        if (changed > 0) set({ profiles });
        return changed;
      },

      clear: () => set({ profiles: [] }),
    }),
    {
      name: 'rigreceipts.carrierProfile',
      version: CARRIER_PROFILE_PERSIST_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      migrate: (persisted) => normalizeCarrierProfileState(persisted),
      merge: (persisted, current) => ({
        ...current,
        ...normalizeCarrierProfileState(persisted),
      }),
      onRehydrateStorage: () => () => {
        useCarrierProfileStore.setState({ hydrated: true });
      },
    },
  ),
);

export const selectVisibleCarrierProfile = (
  profiles: CarrierProfile[],
  sessionUserId: string | null,
): CarrierProfile | null => visibleProfilesForSession(profiles, sessionUserId)[0] ?? null;
