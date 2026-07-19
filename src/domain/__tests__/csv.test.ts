import { buildCsv, escapeCsvCell, CsvColumn } from '../csv';

describe('escapeCsvCell', () => {
  it('passes plain values through', () => {
    expect(escapeCsvCell('fuel')).toBe('fuel');
    expect(escapeCsvCell(512.6)).toBe('512.6');
  });

  it('renders null/undefined as empty', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it('quotes and escapes commas, quotes, and newlines', () => {
    expect(escapeCsvCell('Love’s, Effingham')).toBe('"Love’s, Effingham"');
    expect(escapeCsvCell('a "b" c')).toBe('"a ""b"" c"');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('buildCsv', () => {
  interface Row {
    date: string;
    vendor: string | null;
    amount: number | null;
  }
  const columns: CsvColumn<Row>[] = [
    { header: 'Date', value: (r) => r.date },
    { header: 'Vendor', value: (r) => r.vendor },
    { header: 'Amount', value: (r) => r.amount },
  ];

  it('emits a header plus CRLF-joined rows with escaping', () => {
    const csv = buildCsv(columns, [
      { date: '2026-07-18', vendor: 'Pilot', amount: 512.6 },
      { date: '2026-07-19', vendor: 'Scales, Inc', amount: null },
    ]);
    expect(csv).toBe('Date,Vendor,Amount\r\n2026-07-18,Pilot,512.6\r\n2026-07-19,"Scales, Inc",');
  });

  it('emits just the header for no rows', () => {
    expect(buildCsv(columns, [])).toBe('Date,Vendor,Amount');
  });
});
