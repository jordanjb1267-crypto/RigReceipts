import { OCR_FIXTURES } from '../fixtures';
import { parseReceipt } from '../parseReceipt';

describe('parseReceipt — fuel receipt', () => {
  const r = parseReceipt(OCR_FIXTURES.fuel as string);

  it('reads the grand total, not the per-gallon price', () => {
    expect(r.totalUsd).toBe(312.45);
  });
  it('reads gallons', () => {
    expect(r.gallons).toBe(69.4);
  });
  it('reads the date as ISO', () => {
    expect(r.date).toBe('2026-07-11');
  });
  it('reads the vendor from the top line', () => {
    expect(r.vendor).toBe('PILOT TRAVEL CENTER #421');
  });
});

describe('parseReceipt — meal receipt', () => {
  const r = parseReceipt(OCR_FIXTURES.meal as string);

  it('picks Total over Subtotal and Tax', () => {
    expect(r.totalUsd).toBe(20.02);
  });
  it('expands a 2-digit year', () => {
    expect(r.date).toBe('2026-07-11');
  });
  it('has no gallons', () => {
    expect(r.gallons).toBeNull();
  });
});

describe('parseReceipt — repair invoice', () => {
  const r = parseReceipt(OCR_FIXTURES.repair_invoice as string);

  it('prefers "AMOUNT DUE" over subtotal and line items', () => {
    expect(r.totalUsd).toBe(1175.95);
  });
  it('parses a month-name date', () => {
    expect(r.date).toBe('2026-07-08');
  });
  it('reads the shop name', () => {
    expect(r.vendor).toBe('BIG RIG DIESEL REPAIR LLC');
  });
});

describe('parseReceipt — lumper receipt', () => {
  const r = parseReceipt(OCR_FIXTURES.lumper as string);

  it('reads the amount paid', () => {
    expect(r.totalUsd).toBe(185.0);
  });
  it('reads the date', () => {
    expect(r.date).toBe('2026-07-11');
  });
});

describe('parseReceipt — toll receipt', () => {
  const r = parseReceipt(OCR_FIXTURES.toll as string);

  it('reads a small total', () => {
    expect(r.totalUsd).toBe(6.75);
  });
  it('reads an ISO date', () => {
    expect(r.date).toBe('2026-07-11');
  });
});

describe('parseReceipt — resilience', () => {
  it('returns all-null (never throws) on empty input', () => {
    const r = parseReceipt('');
    expect(r).toEqual({ totalUsd: null, vendor: null, date: null, gallons: null, rawText: '' });
  });

  it('falls back to the largest amount when no total label exists', () => {
    const r = parseReceipt('Coffee 3.50\nDonut 2.25\nCard 5.75');
    expect(r.totalUsd).toBe(5.75);
  });

  it('does not read a total from a subtotal-only document', () => {
    const r = parseReceipt('Subtotal 10.00\nTax 0.80');
    // No grand total; falls back to the largest value present.
    expect(r.totalUsd).toBe(10.0);
  });
});
