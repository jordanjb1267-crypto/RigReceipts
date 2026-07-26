import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  AccountingCategory,
  activeSegment,
  BusinessSubtype,
  Classification,
  ClassificationSource,
  MileageSegment,
  MileageSession,
  TrackingMode,
  TrailerConfiguration,
} from '@/domain';

/**
 * Live Mileage sessions + segments (build prompt §12). The driver-confirmed
 * state machine: Start → Going to Pickup → Deadhead → I'm Loaded → Loaded →
 * Mark Delivered → What's Next. Manual entry uses the same segment model.
 *
 * The store never infers freight status and never fabricates distance — miles
 * only accumulate via `appendMiles` (a GPS/manual tick) or explicit entry.
 */
const sid = () => `msess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const gid = () => `mseg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export interface BeginSegmentOpts {
  loadId?: string | null;
  trailerConfiguration?: TrailerConfiguration;
  source?: ClassificationSource;
  startLocation?: string | null;
}

export interface ManualSegmentInput {
  /** ISO date; anchors the segment in time. */
  date: string;
  startLocation?: string | null;
  endLocation?: string | null;
  miles: number;
  category: AccountingCategory;
  subtype?: BusinessSubtype | null;
  loadId?: string | null;
  trailerConfiguration?: TrailerConfiguration;
  note?: string | null;
}

export type SegmentPatch = Partial<
  Pick<
    MileageSegment,
    | 'accountingCategory'
    | 'businessSubtype'
    | 'loadId'
    | 'startedAt'
    | 'endedAt'
    | 'adjustedMiles'
    | 'trailerConfiguration'
    | 'note'
    | 'startLocation'
    | 'endLocation'
  >
>;

interface MileageState {
  sessions: MileageSession[];
  segments: MileageSegment[];
  activeSessionId: string | null;
  hydrated: boolean;

  startSession: (mode?: TrackingMode, vehicleId?: string | null) => string;
  /** Start tracking with the first segment from the "what's the truck doing" menu. */
  startTracking: (classification: Classification, opts?: BeginSegmentOpts) => string;
  /** Close the active segment and open a new one (a status change / next leg). */
  beginSegment: (classification: Classification, opts?: BeginSegmentOpts) => string;
  /** Deadhead → Loaded, same load (build prompt §E). */
  imLoaded: (loadId?: string | null) => void;
  /** Loaded → close + open a fresh unclassified segment (build prompt §F). */
  markDelivered: () => void;
  /** Accumulate distance into the active segment (a GPS/manual tick). */
  appendMiles: (miles: number) => void;
  /** Classify/correct a segment (unclassified review + corrections, §H/§I). */
  classifySegment: (id: string, c: Classification, loadId?: string | null) => void;
  editSegment: (id: string, patch: SegmentPatch) => void;
  addManualSegment: (input: ManualSegmentInput) => string;
  removeSegment: (id: string) => void;
  stopSession: () => void;
  clear: () => void;
}

export const useMileageStore = create<MileageState>()(
  persist(
    (set, get) => {
      const closeActive = (segments: MileageSegment[], at: number): MileageSegment[] =>
        segments.map((s) => (s.endedAt === null ? { ...s, endedAt: at, updatedAt: at } : s));

      const openSegment = (
        classification: Classification,
        opts: BeginSegmentOpts,
        at: number,
      ): MileageSegment => ({
        id: gid(),
        sessionId: get().activeSessionId,
        loadId: opts.loadId ?? null,
        startedAt: at,
        endedAt: null,
        startLocation: opts.startLocation ?? null,
        endLocation: null,
        calculatedMiles: 0,
        adjustedMiles: null,
        accountingCategory: classification.category,
        businessSubtype: classification.subtype,
        trailerConfiguration: opts.trailerConfiguration ?? 'unknown',
        classificationSource: opts.source ?? 'user',
        classificationConfidence: null,
        userConfirmed: (opts.source ?? 'user') === 'user',
        note: null,
        createdAt: at,
        updatedAt: at,
      });

      return {
        sessions: [],
        segments: [],
        activeSessionId: null,
        hydrated: false,

        startSession: (mode = 'manual', vehicleId = null) => {
          const id = sid();
          const now = Date.now();
          const session: MileageSession = {
            id,
            vehicleId,
            startedAt: now,
            endedAt: null,
            trackingMode: mode,
            source: mode,
            totalTrackedMiles: 0,
            reconciliationStatus: 'none',
            createdAt: now,
            updatedAt: now,
          };
          set((s) => ({ sessions: [session, ...s.sessions], activeSessionId: id }));
          return id;
        },

        startTracking: (classification, opts = {}) => {
          if (!get().activeSessionId) get().startSession('manual');
          return get().beginSegment(classification, opts);
        },

        beginSegment: (classification, opts = {}) => {
          const now = Date.now();
          const next = openSegment(classification, opts, now);
          set((s) => ({ segments: [next, ...closeActive(s.segments, now)] }));
          return next.id;
        },

        imLoaded: (loadId) => {
          const current = activeSegment(get().segments);
          const targetLoad = loadId ?? current?.loadId ?? null;
          get().beginSegment({ category: 'loaded', subtype: null }, { loadId: targetLoad });
        },

        markDelivered: () => {
          // Post-delivery miles start unclassified — never auto-classified (§F, §24).
          get().beginSegment({ category: 'unclassified', subtype: null }, { loadId: null });
        },

        appendMiles: (miles) => {
          if (!(miles > 0)) return;
          const now = Date.now();
          set((s) => {
            const active = activeSegment(s.segments);
            if (!active) return {};
            return {
              segments: s.segments.map((seg) =>
                seg.id === active.id
                  ? { ...seg, calculatedMiles: seg.calculatedMiles + miles, updatedAt: now }
                  : seg,
              ),
              sessions: s.sessions.map((sess) =>
                sess.id === active.sessionId
                  ? {
                      ...sess,
                      totalTrackedMiles: sess.totalTrackedMiles + miles,
                      updatedAt: now,
                    }
                  : sess,
              ),
            };
          });
        },

        classifySegment: (id, c, loadId) =>
          set((s) => ({
            segments: s.segments.map((seg) =>
              seg.id === id
                ? {
                    ...seg,
                    accountingCategory: c.category,
                    businessSubtype: c.subtype,
                    loadId: loadId !== undefined ? loadId : seg.loadId,
                    classificationSource: 'user',
                    userConfirmed: true,
                    updatedAt: Date.now(),
                  }
                : seg,
            ),
          })),

        editSegment: (id, patch) =>
          set((s) => ({
            segments: s.segments.map((seg) =>
              seg.id === id
                ? {
                    ...seg,
                    ...patch,
                    // A manual correction is user-confirmed; original calculatedMiles is kept.
                    userConfirmed: true,
                    classificationSource: 'user',
                    updatedAt: Date.now(),
                  }
                : seg,
            ),
          })),

        addManualSegment: (input) => {
          const now = Date.now();
          const startedAt = Date.parse(`${input.date}T12:00:00`) || now;
          const segment: MileageSegment = {
            id: gid(),
            sessionId: null,
            loadId: input.loadId ?? null,
            startedAt,
            endedAt: startedAt,
            startLocation: input.startLocation ?? null,
            endLocation: input.endLocation ?? null,
            calculatedMiles: input.miles > 0 ? input.miles : 0,
            adjustedMiles: null,
            accountingCategory: input.category,
            businessSubtype: input.subtype ?? null,
            trailerConfiguration: input.trailerConfiguration ?? 'unknown',
            classificationSource: 'manual',
            classificationConfidence: null,
            userConfirmed: true,
            note: input.note?.trim() || null,
            createdAt: now,
            updatedAt: now,
          };
          set((s) => ({ segments: [segment, ...s.segments] }));
          return segment.id;
        },

        removeSegment: (id) =>
          set((s) => ({ segments: s.segments.filter((seg) => seg.id !== id) })),

        stopSession: () => {
          const now = Date.now();
          const activeId = get().activeSessionId;
          set((s) => ({
            segments: closeActive(s.segments, now),
            sessions: s.sessions.map((sess) =>
              sess.id === activeId ? { ...sess, endedAt: now, updatedAt: now } : sess,
            ),
            activeSessionId: null,
          }));
        },

        clear: () => set({ sessions: [], segments: [], activeSessionId: null }),
      };
    },
    {
      name: 'rigreceipts.mileage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      onRehydrateStorage: () => () => {
        useMileageStore.setState({ hydrated: true });
      },
    },
  ),
);
