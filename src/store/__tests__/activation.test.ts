import { useActivationStore } from '@/store/activation';

beforeEach(() => {
  useActivationStore.getState().reset();
});

describe('activation store', () => {
  it('starts with nothing done and incomplete', () => {
    const s = useActivationStore.getState();
    expect(s.costsAdded).toBe(false);
    expect(s.mileageEnabled).toBe(false);
    expect(s.accountLinked).toBe(false);
    expect(s.complete()).toBe(false);
  });

  it('is complete only once all three steps are done', () => {
    const s = useActivationStore.getState();
    s.setCostsAdded(true);
    expect(useActivationStore.getState().complete()).toBe(false);
    s.setMileageEnabled(true);
    expect(useActivationStore.getState().complete()).toBe(false);
    s.setAccountLinked(true);
    expect(useActivationStore.getState().complete()).toBe(true);
  });

  it('tracks dismissal independently of completion', () => {
    useActivationStore.getState().dismiss();
    expect(useActivationStore.getState().dismissed).toBe(true);
    expect(useActivationStore.getState().complete()).toBe(false);
  });
});
