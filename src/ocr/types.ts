/** Which engine produced a result — surfaced in the review sheet for transparency. */
export type OcrEngineName = 'mlkit' | 'stub';

export interface OcrResult {
  /** Full recognized text, newline-separated in reading order. */
  text: string;
  /** Which engine ran. `stub` means no on-device recognizer was available. */
  engine: OcrEngineName;
}

/** Structured fields pulled from receipt/invoice text. Any field may be null. */
export interface ParsedReceipt {
  /** Grand total in dollars, or null if none could be found. */
  totalUsd: number | null;
  vendor: string | null;
  /** ISO date `YYYY-MM-DD`, or null. */
  date: string | null;
  /** Fuel volume in gallons, when the document is a fuel receipt. */
  gallons: number | null;
  /** The raw text the fields were parsed from. */
  rawText: string;
}
