import { captureProductNowMs, readProductNowMs } from '../productNow';

describe('productNow (RR-PR15-002)', () => {
  afterEach(() => {
    captureProductNowMs(Date.now());
  });

  it('rejects a non-finite clock', () => {
    expect(() => captureProductNowMs(Number.NaN)).toThrow(/nowMs/);
  });

  it('stores an explicit capture and is never epoch 0', () => {
    const n = captureProductNowMs(1_725_000_000_000);
    expect(n).toBe(1_725_000_000_000);
    expect(readProductNowMs()).toBe(1_725_000_000_000);
    expect(readProductNowMs()).not.toBe(0);
  });
});
