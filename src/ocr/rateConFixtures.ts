/** Sample rate-confirmation OCR text for parser tests and the stub engine. */
export const RATE_CON_FIXTURES = {
  standard: [
    'MEGA FREIGHT BROKERS, INC',
    'Rate Confirmation',
    'Load #: 48291',
    'Carrier: JB TRUCKING LLC',
    '',
    'Origin: Chicago, IL',
    'Pickup Date: 07/12/2026',
    'Destination: Atlanta, GA',
    'Delivery Date: 07/14/2026',
    '',
    'Equipment: Dry Van',
    'Line Haul: $1,950.00',
    'Fuel Surcharge: $200.00',
    'Total Rate: $2,150.00',
    'Total Miles: 720',
    '',
    'Detention: $50/hr after 2 hours',
    'Lumper: Paid by carrier, reimbursed',
  ].join('\n'),

  terse: [
    'SUMMIT LOGISTICS',
    'Order # A-5567',
    'PU: Dallas, TX  06/30/2026',
    'DEL: Memphis, TN  07/01/2026',
    'Reefer',
    'Agreed Rate: $1,480.00',
    'Miles: 452',
  ].join('\n'),
};
