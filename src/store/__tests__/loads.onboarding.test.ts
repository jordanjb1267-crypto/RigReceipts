/**
 * Refinement C3 — onboarding saves persist real LoadRecords through the live
 * loads store (idempotently), and the store accepts the `evaluated` status.
 */
import { createFirstLoadSaver, rateCheckLoadDraft, rateConLoadDraft } from '@/domain';
import { parseRateCon, RATE_CON_FIXTURES } from '@/ocr';
import { useLoadsStore } from '@/store/loads';

const CLOCK = new Date(Date.UTC(2026, 8, 2, 20, 15, 9));

const wire = () => {
  const events: string[] = [];
  const save = createFirstLoadSaver({
    addLoad: (draft) => useLoadsStore.getState().addLoad(draft),
    completeFirstAction: () => events.push('completeFirstAction'),
    trackSaved: () => events.push('first_load_saved'),
    navigateToReveal: () => events.push('navigate:/(onboarding)/reveal'),
  });
  return { events, save };
};

beforeEach(() => {
  useLoadsStore.getState().clear();
});

describe('Rate Check -> one persisted evaluated load', () => {
  it('creates exactly one LoadRecord with the exact inputs and no invented data', () => {
    const { events, save } = wire();
    const id = save(
      rateCheckLoadDraft({
        offer: 2150,
        loadedMiles: 720,
        deadheadMiles: 142,
        trip: {
          originCity: 'Chicago',
          originState: 'IL',
          destinationCity: 'Atlanta',
          destinationState: 'GA',
        },
        now: CLOCK,
      }),
      { verdict: 'below_target', source: 'rate_check' },
    );

    const loads = useLoadsStore.getState().loads;
    expect(loads).toHaveLength(1);
    expect(loads[0]).toMatchObject({
      id,
      loadNumber: 'RR-DRAFT-20260902-201509',
      status: 'evaluated',
      grossRate: 2150,
      loadedMiles: 720,
      deadheadMiles: 142,
      origin: 'Chicago, IL',
      destination: 'Atlanta, GA',
      broker: null,
      fuelSurcharge: null,
      bolRequired: true,
    });
    expect(loads[0].note).toMatch(/onboarding Rate Check/);
    expect(events).toEqual([
      'completeFirstAction',
      'first_load_saved',
      'navigate:/(onboarding)/reveal',
    ]);
  });

  it('a repeated save does not produce a duplicate record', () => {
    const { events, save } = wire();
    const draft = rateCheckLoadDraft({
      offer: 2150,
      loadedMiles: 720,
      deadheadMiles: 142,
      trip: null,
      now: CLOCK,
    });
    const a = save(draft, {});
    const b = save(draft, {});
    const c = save(draft, {});
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(useLoadsStore.getState().loads).toHaveLength(1);
    expect(events.filter((e) => e === 'first_load_saved')).toHaveLength(1);
  });
});

describe('Rate Con -> one persisted booked load', () => {
  it('persists the parsed sample rate con as booked with its own load number and broker', () => {
    const parsed = parseRateCon(RATE_CON_FIXTURES.standard);
    expect(parsed.loadNumber).toBeTruthy();
    expect(parsed.broker).toBeTruthy();

    const { events, save } = wire();
    const id = save(rateConLoadDraft(parsed, CLOCK), { source: 'rate_con' });

    const loads = useLoadsStore.getState().loads;
    expect(loads).toHaveLength(1);
    expect(loads[0]).toMatchObject({
      id,
      status: 'booked',
      loadNumber: parsed.loadNumber,
      broker: parsed.broker,
      grossRate: parsed.offerUsd,
      loadedMiles: parsed.loadedMiles,
      deadheadMiles: null,
    });
    expect(loads[0].origin).toBe(`${parsed.originCity}, ${parsed.originState}`);
    expect(loads[0].destination).toBe(`${parsed.destinationCity}, ${parsed.destinationState}`);
    expect(events).toEqual([
      'completeFirstAction',
      'first_load_saved',
      'navigate:/(onboarding)/reveal',
    ]);
  });

  it('uses the RR-DRAFT id when the document lacks a load number', () => {
    const parsed = { ...parseRateCon(RATE_CON_FIXTURES.standard), loadNumber: null };
    const { save } = wire();
    save(rateConLoadDraft(parsed, CLOCK), { source: 'rate_con' });
    const [load] = useLoadsStore.getState().loads;
    expect(load.loadNumber).toBe('RR-DRAFT-20260902-201509');
    expect(load.status).toBe('booked');
    expect(load.broker).toBe(parsed.broker);
  });

  it('a repeated analyze does not produce a duplicate record', () => {
    const parsed = parseRateCon(RATE_CON_FIXTURES.standard);
    const { save } = wire();
    save(rateConLoadDraft(parsed, CLOCK), {});
    save(rateConLoadDraft(parsed, CLOCK), {});
    expect(useLoadsStore.getState().loads).toHaveLength(1);
  });
});

describe('loads store lifecycle with evaluated', () => {
  it('stores evaluated as given and steps it to booked without touching other loads', () => {
    const store = useLoadsStore.getState();
    const evaluatedId = store.addLoad({
      loadNumber: 'RR-DRAFT-20260902-201509',
      broker: null,
      origin: null,
      destination: null,
      note: null,
      status: 'evaluated',
    });
    const paidId = store.addLoad({
      loadNumber: 'LN-1',
      broker: 'B',
      origin: null,
      destination: null,
      note: null,
      status: 'paid',
    });
    useLoadsStore.getState().setStatus(evaluatedId, 'booked');
    const byId = (id: string) => useLoadsStore.getState().loads.find((l) => l.id === id);
    expect(byId(evaluatedId)?.status).toBe('booked');
    expect(byId(paidId)?.status).toBe('paid');
  });

  it('still defaults to booked when no status is given (unchanged behaviour)', () => {
    const id = useLoadsStore.getState().addLoad({
      loadNumber: 'LN-2',
      broker: null,
      origin: null,
      destination: null,
      note: null,
    });
    expect(useLoadsStore.getState().loads.find((l) => l.id === id)?.status).toBe('booked');
  });
});
