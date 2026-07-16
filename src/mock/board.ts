import { Tone } from '@/theme';

/**
 * Mock road-board data for the Home command center. This stands in for the
 * Supabase-backed daily/weekly aggregates until those loops are wired. Values
 * mirror the Industrial Atlas mockup so the hub reads realistically; the UI
 * labels it "Sample" so it is never mistaken for real records.
 */

export interface OwedItem {
  label: string;
  amountUsd: number;
  tone: Tone;
}

export interface LoadInMotion {
  loadNumber: string;
  route: string;
  statusLabel: string;
  statusTone: Tone;
}

export interface BoardData {
  weekOf: string;
  headline: string;
  rpm: {
    grade: string;
    actualRpm: number;
    targetRpm: number;
    cpm: number;
    owedUsd: number;
    note: string;
  };
  spend: { total7dUsd: number; note: string };
  records: { pct: number; grade: string };
  moneyOwed: { totalUsd: number; items: OwedItem[] };
  loads: { activeCount: number; packetPct: number; items: LoadInMotion[] };
  rpmCoach: { targetRpm: number; breakEvenRpm: number; deadheadImpactCents: number };
  calendar: { monthLabel: string; monthTotalUsd: number; recentDays: DaySnapshot[] };
  closeout: { pct: number; itemsLeft: number };
  truckHealth: { lastService: string; nextPmInMiles: number; repairsThisMonthUsd: number };
}

export interface DaySnapshot {
  day: number;
  spendUsd: number;
  tone: 'good' | 'warn' | 'hot' | 'none';
}

const POPULATED: BoardData = {
  weekOf: 'Week of Jul 13',
  headline: 'On course — collect what you are owed.',
  rpm: {
    grade: 'B+',
    actualRpm: 2.61,
    targetRpm: 2.48,
    cpm: 1.84,
    owedUsd: 460,
    note: 'Actual rate is above target. Deadhead and pending detention are the weak points.',
  },
  spend: { total7dUsd: 2184, note: 'Fuel, repairs, meals, showers, tolls.' },
  records: { pct: 82, grade: 'B' },
  moneyOwed: {
    totalUsd: 460,
    items: [
      { label: 'Detention · Load #48291', amountUsd: 275, tone: 'blue' },
      { label: 'Lumper reimbursement · Oak Ridge DC', amountUsd: 185, tone: 'amber' },
    ],
  },
  loads: {
    activeCount: 3,
    packetPct: 75,
    items: [
      {
        loadNumber: '#48291',
        route: 'Chicago, IL → Dallas, TX',
        statusLabel: 'Needs POD',
        statusTone: 'amber',
      },
      {
        loadNumber: '#48308',
        route: 'Tulsa, OK → Memphis, TN',
        statusLabel: 'Complete',
        statusTone: 'green',
      },
      {
        loadNumber: '#48311',
        route: 'Laredo, TX → Atlanta, GA',
        statusLabel: 'Rate check',
        statusTone: 'blue',
      },
    ],
  },
  rpmCoach: { targetRpm: 2.48, breakEvenRpm: 2.02, deadheadImpactCents: 18 },
  calendar: {
    monthLabel: 'July 2026',
    monthTotalUsd: 8420,
    recentDays: [
      { day: 8, spendUsd: 244, tone: 'good' },
      { day: 9, spendUsd: 18, tone: 'none' },
      { day: 10, spendUsd: 734, tone: 'hot' },
      { day: 11, spendUsd: 428, tone: 'warn' },
      { day: 12, spendUsd: 90, tone: 'good' },
      { day: 13, spendUsd: 310, tone: 'warn' },
      { day: 14, spendUsd: 48, tone: 'none' },
    ],
  },
  closeout: { pct: 82, itemsLeft: 9 },
  truckHealth: {
    lastService: 'Jun 28 · oil + filter',
    nextPmInMiles: 2400,
    repairsThisMonthUsd: 1516,
  },
};

const EMPTY: BoardData = {
  weekOf: 'This week',
  headline: 'Your road board is ready.',
  rpm: {
    grade: '—',
    actualRpm: 0,
    targetRpm: 0,
    cpm: 0,
    owedUsd: 0,
    note: 'Start capturing to see your rate per mile.',
  },
  spend: { total7dUsd: 0, note: 'No expenses logged yet.' },
  records: { pct: 0, grade: '—' },
  moneyOwed: { totalUsd: 0, items: [] },
  loads: { activeCount: 0, packetPct: 0, items: [] },
  rpmCoach: { targetRpm: 0, breakEvenRpm: 0, deadheadImpactCents: 0 },
  calendar: { monthLabel: 'This month', monthTotalUsd: 0, recentDays: [] },
  closeout: { pct: 0, itemsLeft: 0 },
  truckHealth: { lastService: 'No service logged', nextPmInMiles: 0, repairsThisMonthUsd: 0 },
};

/**
 * Simulates the board fetch. `populated` decides whether the user has data yet
 * (drives the empty-state path). Resolves on a tick so the loading state is
 * real; rejects when `EXPO_PUBLIC_MOCK_BOARD_ERROR=1` to exercise the error path.
 */
export function fetchBoard(populated: boolean): Promise<BoardData> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (process.env.EXPO_PUBLIC_MOCK_BOARD_ERROR === '1') {
        reject(new Error('Could not load your road board.'));
        return;
      }
      resolve(populated ? POPULATED : EMPTY);
    }, 350);
  });
}
