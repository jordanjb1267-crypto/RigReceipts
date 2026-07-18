import { SCAN_TYPES, scanTypeToExpenseCategory } from '@/domain';

import { contentTypeForPath, normalizedExpenseDate, storagePathFor } from '../captureSync';

describe('scanTypeToExpenseCategory', () => {
  it('maps expense-bearing scan types to real category slugs', () => {
    expect(scanTypeToExpenseCategory('fuel')).toBe('fuel');
    expect(scanTypeToExpenseCategory('repair_invoice')).toBe('repairs');
    expect(scanTypeToExpenseCategory('hotel')).toBe('lodging');
    expect(scanTypeToExpenseCategory('scale_ticket')).toBe('scales');
    expect(scanTypeToExpenseCategory('permit')).toBe('permits_registration');
    expect(scanTypeToExpenseCategory('receipt')).toBe('misc');
  });

  it('maps document-only scans to null (no expense created)', () => {
    expect(scanTypeToExpenseCategory('bol')).toBeNull();
    expect(scanTypeToExpenseCategory('pod')).toBeNull();
    expect(scanTypeToExpenseCategory('inspection')).toBeNull();
  });

  it('covers every canonical scan type', () => {
    for (const t of SCAN_TYPES) {
      // Either a mapped category or an explicit null — never undefined.
      expect(scanTypeToExpenseCategory(t.slug)).not.toBeUndefined();
    }
  });
});

describe('storagePathFor', () => {
  it('nests the object under the user folder and keeps the extension', () => {
    expect(storagePathFor('user-1', 'cap_9', 'file:///tmp/photo.png')).toBe('user-1/cap_9.png');
    expect(storagePathFor('user-1', 'cap_9', 'file:///tmp/IMG_0001.JPG')).toBe('user-1/cap_9.jpg');
  });

  it('handles query strings and missing extensions', () => {
    expect(storagePathFor('u', 'c', 'https://x/y.jpeg?token=abc')).toBe('u/c.jpeg');
    expect(storagePathFor('u', 'c', 'content://media/1234')).toBe('u/c.jpg');
    expect(storagePathFor('u', 'c', null)).toBe('u/c.jpg');
  });
});

describe('contentTypeForPath', () => {
  it('derives a MIME type from the extension, defaulting to JPEG', () => {
    expect(contentTypeForPath('u/c.png')).toBe('image/png');
    expect(contentTypeForPath('u/c.jpeg')).toBe('image/jpeg');
    expect(contentTypeForPath('u/c.heic')).toBe('image/heic');
    expect(contentTypeForPath('u/c.bin')).toBe('image/jpeg');
  });
});

describe('normalizedExpenseDate', () => {
  it('passes through valid ISO dates and rejects everything else', () => {
    expect(normalizedExpenseDate('2026-07-18')).toBe('2026-07-18');
    expect(normalizedExpenseDate('  2026-07-18 ')).toBe('2026-07-18');
    expect(normalizedExpenseDate('07/18/2026')).toBeUndefined();
    expect(normalizedExpenseDate('')).toBeUndefined();
    expect(normalizedExpenseDate(null)).toBeUndefined();
  });
});
