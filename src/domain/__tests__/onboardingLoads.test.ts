/**
 * Refinement C3 — onboarding first-load persistence helpers.
 */
import {
  createFirstLoadSaver,
  DRAFT_LOAD_NUMBER_PREFIX,
  draftLoadNumber,
  isDraftLoadNumber,
  OnboardingLoadDraft,
  rateCheckLoadDraft,
  rateConLoadDraft,
  routeStop,
} from '../loads';

const CLOCK = new Date(Date.UTC(2026, 8, 2, 20, 15, 9)); // 2026-09-02T20:15:09Z

describe('draftLoadNumber', () => {
  it('is RR-DRAFT-YYYYMMDD-HHMMSS (UTC) and deterministic for a given clock', () => {
    expect(draftLoadNumber(CLOCK)).toBe('RR-DRAFT-20260902-201509');
    expect(draftLoadNumber(CLOCK)).toBe(draftLoadNumber(new Date(CLOCK.getTime())));
    expect(draftLoadNumber(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)))).toBe(
      'RR-DRAFT-20260101-000000',
    );
  });

  it('is visibly app-generated and recognisable as such', () => {
    const n = draftLoadNumber(CLOCK);
    expect(n.startsWith(DRAFT_LOAD_NUMBER_PREFIX)).toBe(true);
    expect(isDraftLoadNumber(n)).toBe(true);
    expect(isDraftLoadNumber('LN-448812')).toBe(false);
    expect(isDraftLoadNumber('RR-DRAFT-notadate')).toBe(false);
  });

  it('changes second by second (unique enough for local use)', () => {
    const a = draftLoadNumber(CLOCK);
    const b = draftLoadNumber(new Date(CLOCK.getTime() + 1000));
    expect(a).not.toBe(b);
  });
});

describe('routeStop', () => {
  it('builds "City, ST" from user input only, and null when nothing was entered', () => {
    expect(routeStop('Chicago', 'IL')).toBe('Chicago, IL');
    expect(routeStop(' Chicago ', ' IL ')).toBe('Chicago, IL');
    expect(routeStop('Chicago', '')).toBe('Chicago');
    expect(routeStop('', 'IL')).toBe('IL');
    expect(routeStop('', '')).toBeNull();
    expect(routeStop(null, undefined)).toBeNull();
  });
});

describe('rateCheckLoadDraft', () => {
  const input = { offer: 2150, loadedMiles: 720, deadheadMiles: 142, trip: null, now: CLOCK };

  it('produces an evaluated load, never a booked one', () => {
    expect(rateCheckLoadDraft(input).status).toBe('evaluated');
  });

  it('preserves the exact gross / loaded / deadhead inputs', () => {
    const d = rateCheckLoadDraft({ ...input, offer: 1999.5, loadedMiles: 731, deadheadMiles: 0 });
    expect(d.grossRate).toBe(1999.5);
    expect(d.loadedMiles).toBe(731);
    expect(d.deadheadMiles).toBe(0);
  });

  it('uses a RigReceipts draft load number and says so in the note', () => {
    const d = rateCheckLoadDraft(input);
    expect(d.loadNumber).toBe('RR-DRAFT-20260902-201509');
    expect(isDraftLoadNumber(d.loadNumber)).toBe(true);
    expect(d.note).toMatch(/onboarding Rate Check/);
    expect(d.note).toMatch(/No broker load number was supplied/);
    expect(d.note).toMatch(/RigReceipts-generated/);
  });

  it('invents no broker, surcharge or other data', () => {
    const d = rateCheckLoadDraft(input);
    expect(d.broker).toBeNull();
    expect(d.fuelSurcharge).toBeNull();
    expect(Object.keys(d).sort()).toEqual(
      [
        'loadNumber',
        'broker',
        'origin',
        'destination',
        'note',
        'status',
        'grossRate',
        'fuelSurcharge',
        'loadedMiles',
        'deadheadMiles',
      ].sort(),
    );
  });

  it('leaves the route empty when the user entered no trip details', () => {
    const d = rateCheckLoadDraft(input);
    expect(d.origin).toBeNull();
    expect(d.destination).toBeNull();
  });

  it('builds the route only from user-entered trip data when present', () => {
    const d = rateCheckLoadDraft({
      ...input,
      trip: {
        originCity: 'Chicago',
        originState: 'IL',
        destinationCity: 'Atlanta',
        destinationState: 'GA',
      },
    });
    expect(d.origin).toBe('Chicago, IL');
    expect(d.destination).toBe('Atlanta, GA');

    const partial = rateCheckLoadDraft({
      ...input,
      trip: { originCity: 'Dallas', originState: 'TX', destinationCity: '', destinationState: '' },
    });
    expect(partial.origin).toBe('Dallas, TX');
    expect(partial.destination).toBeNull();
  });
});

describe('rateConLoadDraft', () => {
  const scanned = {
    broker: 'Acme Logistics',
    loadNumber: 'LN-448812',
    originCity: 'Chicago',
    originState: 'IL',
    destinationCity: 'Atlanta',
    destinationState: 'GA',
    offerUsd: 2150,
    loadedMiles: 718,
  };

  it('produces a booked load from the reviewed document values', () => {
    const d = rateConLoadDraft(scanned, CLOCK);
    expect(d).toEqual<OnboardingLoadDraft>({
      loadNumber: 'LN-448812',
      broker: 'Acme Logistics',
      origin: 'Chicago, IL',
      destination: 'Atlanta, GA',
      note: 'Created from the reviewed Rate Confirmation extraction during onboarding.',
      status: 'booked',
      grossRate: 2150,
      fuelSurcharge: null,
      loadedMiles: 718,
      deadheadMiles: null,
    });
  });

  it('falls back to the RR-DRAFT id when the document has no load number, without inventing a broker number', () => {
    const d = rateConLoadDraft({ ...scanned, loadNumber: null }, CLOCK);
    expect(d.loadNumber).toBe('RR-DRAFT-20260902-201509');
    expect(d.note).toMatch(/did not include a load number/);
    expect(d.broker).toBe('Acme Logistics');
    expect(rateConLoadDraft({ ...scanned, loadNumber: '   ' }, CLOCK).loadNumber).toBe(
      'RR-DRAFT-20260902-201509',
    );
  });

  it('keeps missing fields null rather than fabricating them', () => {
    const d = rateConLoadDraft(
      {
        broker: null,
        loadNumber: null,
        originCity: null,
        originState: null,
        destinationCity: null,
        destinationState: null,
        offerUsd: null,
        loadedMiles: null,
      },
      CLOCK,
    );
    expect(d.broker).toBeNull();
    expect(d.origin).toBeNull();
    expect(d.destination).toBeNull();
    expect(d.grossRate).toBeNull();
    expect(d.loadedMiles).toBeNull();
    expect(d.deadheadMiles).toBeNull();
    expect(d.status).toBe('booked');
  });
});

describe('createFirstLoadSaver', () => {
  const draft = rateCheckLoadDraft({
    offer: 2150,
    loadedMiles: 720,
    deadheadMiles: 142,
    trip: null,
    now: CLOCK,
  });

  const build = () => {
    const calls: string[] = [];
    const deps = {
      addLoad: jest.fn((d: OnboardingLoadDraft) => {
        calls.push(`addLoad:${d.status}`);
        return 'load_1';
      }),
      completeFirstAction: jest.fn(() => {
        calls.push('completeFirstAction');
      }),
      trackSaved: jest.fn((_props: Record<string, string | number | boolean>) => {
        calls.push('track');
      }),
      navigateToReveal: jest.fn(() => {
        calls.push('navigate');
      }),
    };
    return { calls, deps, save: createFirstLoadSaver(deps) };
  };

  it('persists first, then completes the action, then tracks, then navigates', () => {
    const { calls, save } = build();
    expect(save(draft, { source: 'rate_check' })).toBe('load_1');
    expect(calls).toEqual(['addLoad:evaluated', 'completeFirstAction', 'track', 'navigate']);
  });

  it('emits first_load_saved only after addLoad succeeded (a throwing addLoad emits nothing)', () => {
    const { deps, save } = build();
    deps.addLoad.mockImplementationOnce(() => {
      throw new Error('storage unavailable');
    });
    expect(() => save(draft, {})).toThrow('storage unavailable');
    expect(deps.completeFirstAction).not.toHaveBeenCalled();
    expect(deps.trackSaved).not.toHaveBeenCalled();
    expect(deps.navigateToReveal).not.toHaveBeenCalled();
  });

  it('a repeated call (double tap / repeated callback) creates no second load and does nothing else', () => {
    const { deps, save } = build();
    const first = save(draft, { source: 'rate_check' });
    const second = save(draft, { source: 'rate_check' });
    const third = save({ ...draft, loadNumber: 'RR-DRAFT-20260902-201510' }, {});
    expect(first).toBe('load_1');
    expect(second).toBe('load_1');
    expect(third).toBe('load_1');
    expect(deps.addLoad).toHaveBeenCalledTimes(1);
    expect(deps.completeFirstAction).toHaveBeenCalledTimes(1);
    expect(deps.trackSaved).toHaveBeenCalledTimes(1);
    expect(deps.navigateToReveal).toHaveBeenCalledTimes(1);
  });

  it('sends only non-private analytics props', () => {
    const { deps, save } = build();
    save(draft, { verdict: 'below_target', source: 'rate_check' });
    expect(deps.trackSaved).toHaveBeenCalledWith({
      verdict: 'below_target',
      source: 'rate_check',
      load_number_generated: true,
    });
    const sent = JSON.stringify(deps.trackSaved.mock.calls[0][0]);
    expect(sent).not.toContain('2150');
    expect(sent).not.toContain('RR-DRAFT');
  });

  it('flags a document-supplied load number as not generated', () => {
    const { deps, save } = build();
    const conDraft = rateConLoadDraft(
      {
        broker: 'Acme Logistics',
        loadNumber: 'LN-448812',
        originCity: 'Chicago',
        originState: 'IL',
        destinationCity: 'Atlanta',
        destinationState: 'GA',
        offerUsd: 2150,
        loadedMiles: 718,
      },
      CLOCK,
    );
    save(conDraft, { source: 'rate_con' });
    expect(deps.trackSaved).toHaveBeenCalledWith({
      source: 'rate_con',
      load_number_generated: false,
    });
    const sent = JSON.stringify(deps.trackSaved.mock.calls[0][0]);
    expect(sent).not.toContain('Acme');
    expect(sent).not.toContain('LN-448812');
    expect(sent).not.toContain('Chicago');
  });
});
