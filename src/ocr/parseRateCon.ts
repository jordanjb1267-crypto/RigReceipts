/**
 * Rate-confirmation parser. Extracts the fields needed to build a load and run
 * a Rate Check: broker, load number, origin/destination, offer, fuel surcharge,
 * loaded miles, and pickup/delivery dates.
 *
 * Like parseReceipt: pure, Hermes-safe, never throws; unknown fields are null.
 * The user reviews everything before it is saved (Section 31).
 */

export interface ParsedRateCon {
  broker: string | null;
  loadNumber: string | null;
  originCity: string | null;
  originState: string | null;
  destinationCity: string | null;
  destinationState: string | null;
  offerUsd: number | null;
  fuelSurchargeUsd: number | null;
  loadedMiles: number | null;
  pickupDate: string | null;
  deliveryDate: string | null;
  rawText: string;
}

const MONEY_RE = /\d[\d,]*\.\d{2}/g;
const CITY_STATE_RE = /([A-Za-z][A-Za-z .'-]+),\s*([A-Z]{2})\b/;
const NUMERIC_DATE_RE = /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/;
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;

function lastMoney(line: string): number | null {
  const vals = [...line.matchAll(MONEY_RE)].map((m) => Number(m[0].replace(/,/g, '')));
  return vals.length ? vals[vals.length - 1] : null;
}

function isoFrom(line: string): string | null {
  const isoM = line.match(ISO_DATE_RE);
  if (isoM) return `${isoM[1]}-${isoM[2]}-${isoM[3]}`;
  const num = line.match(NUMERIC_DATE_RE);
  if (num) {
    const mm = Number(num[1]);
    const dd = Number(num[2]);
    let yy = Number(num[3]);
    if (yy < 100) yy += 2000;
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  return null;
}

function cityState(line: string): { city: string; state: string } | null {
  const m = line.match(CITY_STATE_RE);
  return m ? { city: m[1].trim(), state: m[2] } : null;
}

const hasAny = (lc: string, keys: string[]) => keys.some((k) => lc.includes(k));

export function parseRateCon(rawText: string): ParsedRateCon {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const result: ParsedRateCon = {
    broker: null,
    loadNumber: null,
    originCity: null,
    originState: null,
    destinationCity: null,
    destinationState: null,
    offerUsd: null,
    fuelSurchargeUsd: null,
    loadedMiles: null,
    pickupDate: null,
    deliveryDate: null,
    rawText,
  };

  // Broker: labeled line, else the first name-like line.
  for (const line of lines) {
    const lc = line.toLowerCase();
    if (lc.startsWith('broker')) {
      result.broker = afterLabel(line);
      break;
    }
  }
  if (!result.broker) {
    result.broker =
      lines.find(
        (l) => (l.match(/[A-Za-z]/g) ?? []).length >= 3 && !/rate confirmation/i.test(l),
      ) ?? null;
  }

  // Offer: prefer total/agreed rate over line haul; never the fuel-surcharge line.
  const rateCandidates: { priority: number; value: number }[] = [];
  const RATE_KEYS = ['total rate', 'agreed rate', 'gross', 'rate', 'line haul'];

  for (const line of lines) {
    const lc = line.toLowerCase();

    if (
      result.loadNumber === null &&
      hasAny(lc, ['load #', 'load#', 'load number', 'order #', 'order#', 'pro #', 'ref #'])
    ) {
      result.loadNumber = extractLoadNumber(line);
    }

    if (hasAny(lc, ['origin', 'pickup', 'pu:', 'ship from', 'shipper'])) {
      const cs = cityState(line);
      if (cs && result.originCity === null) {
        result.originCity = cs.city;
        result.originState = cs.state;
      }
      const d = isoFrom(line);
      if (d && result.pickupDate === null) result.pickupDate = d;
    }

    if (hasAny(lc, ['destination', 'delivery', 'del:', 'consignee', 'ship to', 'drop'])) {
      const cs = cityState(line);
      if (cs && result.destinationCity === null) {
        result.destinationCity = cs.city;
        result.destinationState = cs.state;
      }
      const d = isoFrom(line);
      if (d && result.deliveryDate === null) result.deliveryDate = d;
    }

    if (hasAny(lc, ['fuel surcharge', 'fsc']) && result.fuelSurchargeUsd === null) {
      result.fuelSurchargeUsd = lastMoney(line);
    } else if (hasAny(lc, RATE_KEYS) && !hasAny(lc, ['fuel', 'fsc', 'detention', 'lumper'])) {
      const value = lastMoney(line);
      if (value !== null) {
        rateCandidates.push({ priority: RATE_KEYS.findIndex((k) => lc.includes(k)), value });
      }
    }

    if (hasAny(lc, ['miles', 'mileage']) && result.loadedMiles === null) {
      const m = line.match(/(\d[\d,]*)\s*(?:mi|miles)?\b/);
      // pull the number that follows the label, not a date
      const num = line.match(/(?:miles?|mileage)\D*(\d[\d,]*)/i) ?? m;
      if (num) result.loadedMiles = Number(num[1].replace(/,/g, ''));
    }
  }

  if (rateCandidates.length > 0) {
    rateCandidates.sort((a, b) => a.priority - b.priority || b.value - a.value);
    result.offerUsd = rateCandidates[0].value;
  }

  return result;
}

function afterLabel(line: string): string | null {
  const idx = line.indexOf(':');
  const v = idx >= 0 ? line.slice(idx + 1).trim() : line.trim();
  return v.length ? v : null;
}

function extractLoadNumber(line: string): string | null {
  const m = line.match(/(?:load|order|pro|ref)\s*#?\s*:?\s*([A-Za-z0-9-]+)/i);
  return m ? m[1] : null;
}
