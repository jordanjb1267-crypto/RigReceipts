import { ScanTypeSlug } from '@/domain';

/**
 * Sample OCR text for each document kind. Used by the parser unit tests and by
 * the stub engine so the capture → review flow is exercisable without a device
 * camera or the native ML Kit module (Expo Go, web, CI, this sandbox).
 */
export const OCR_FIXTURES: Partial<Record<ScanTypeSlug, string>> = {
  fuel: [
    'PILOT TRAVEL CENTER #421',
    '1201 W Reno Ave',
    'Oklahoma City, OK',
    '',
    '07/11/2026  14:32',
    'Pump 07   Diesel',
    'GAL        69.400',
    'PRICE/GAL   4.499',
    'FUEL TOTAL  $312.45',
    'Card #XXXX1234',
    'TOTAL       $312.45',
    'Thank you for choosing Pilot',
  ].join('\n'),

  repair_invoice: [
    'BIG RIG DIESEL REPAIR LLC',
    'Invoice #A-8842',
    'Date: July 8, 2026',
    '',
    'Labor              450.00',
    'Parts              612.35',
    'Shop Supplies       28.00',
    'Subtotal         1,090.35',
    'Tax                 85.60',
    'AMOUNT DUE     $1,175.95',
  ].join('\n'),

  meal: [
    'Iron Skillet Restaurant',
    'Server: Dana   Table 12',
    '',
    'Subtotal     18.50',
    'Tax           1.52',
    'Total        20.02',
    '07-11-26',
  ].join('\n'),

  lumper: [
    'Capstone Logistics',
    'Lumper Receipt',
    'Facility: Oak Ridge DC',
    'Load: 48291',
    'Date 07/11/2026',
    'Amount Paid: $185.00',
  ].join('\n'),

  toll: ['OKLAHOMA TURNPIKE', 'PIKEPASS', '2026-07-11', 'Toll   $6.75'].join('\n'),
};

/** A reasonable default when the requested type has no fixture. */
export const DEFAULT_FIXTURE = OCR_FIXTURES.fuel as string;
