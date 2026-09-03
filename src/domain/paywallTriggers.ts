/**
 * Contextual paywall triggers (Section 46). Copy never leads with storage or
 * limits. Road Wallet triggers (Refinement Pass 0) name the Driver Pro /
 * Owner-Operator convenience being unlocked; the local, offline wallet and
 * Quick Present stay free and are never paywalled.
 */

export const PAYWALL_TRIGGERS = [
  'rate_check_limit',
  'compare',
  'lane_history',
  'cloud_document_backup',
  'saved_presentation_sets',
  'document_share_export',
  'carrier_packet',
  'carrier_profile',
  'carrier_packet_builder',
  'carrier_packet_templates',
  'carrier_packet_history',
] as const;

export type PaywallTrigger = (typeof PAYWALL_TRIGGERS)[number];

export const DEFAULT_PAYWALL_TRIGGER: PaywallTrigger = 'rate_check_limit';

export const PAYWALL_TRIGGER_COPY: Record<PaywallTrigger, { headline: string; body: string }> = {
  rate_check_limit: {
    headline: 'Keep checking loads with your real numbers.',
    body: 'Upgrade to Owner-Operator for unlimited Rate Checks, personal break-even analysis, advanced lane comparisons, and Freight Intelligence alerts.',
  },
  compare: {
    headline: 'See what this rate means for your truck.',
    body: 'Compare community rates with your actual fuel, deadhead, fixed costs, and target profit.',
  },
  lane_history: {
    headline: 'See how this lane has been moving.',
    body: 'Unlock extended community history, verified rate trends, and personalized lane comparisons.',
  },
  cloud_document_backup: {
    headline: 'Keep a backed-up copy of your Road Wallet.',
    body: 'Driver Pro adds private cloud backup and recovery for your registrations, insurance, permits, and credentials, and alerts you before they expire. Your wallet keeps working offline on this device either way.',
  },
  saved_presentation_sets: {
    headline: 'Save the sets you present most.',
    body: 'Driver Pro lets you build and save custom Quick Present sets beyond the built-in Roadside and Shipper sets.',
  },
  document_share_export: {
    headline: 'Share a document straight from your wallet.',
    body: 'Driver Pro adds one-tap share and export for the documents you store. You always choose what goes out and when.',
  },
  carrier_packet: {
    headline: 'Put your carrier packet together once.',
    body: 'Owner-Operator adds a Carrier Profile and the Carrier Packet Builder: assemble, review, and snapshot the exact documents you send brokers. Nothing is submitted or signed for you.',
  },
  carrier_profile: {
    headline: 'Save the carrier details you entered.',
    body: 'Owner-Operator adds a reusable Carrier Profile — legal name, USDOT, MC, and contact — entered by you. Nothing here is FMCSA-verified or broker-approved.',
  },
  carrier_packet_builder: {
    headline: 'Assemble the packet you actually send.',
    body: 'Owner-Operator lets you freeze exact Road Wallet versions, review missing or stale copies, and attest that this snapshot was shared. Nothing is emailed, submitted or signed for you.',
  },
  carrier_packet_templates: {
    headline: 'Save the packet layouts you reuse.',
    body: 'Owner-Operator lets you build custom packet templates beyond the standard broker starting point. Broker and customer requirements still vary.',
  },
  carrier_packet_history: {
    headline: 'Keep the snapshots you already shared.',
    body: 'Owner-Operator keeps historical SHARED packet snapshots on this account. A shared record is your attestation, not proof of delivery or acceptance.',
  },
};

const isPaywallTrigger = (value: string): value is PaywallTrigger =>
  (PAYWALL_TRIGGERS as readonly string[]).includes(value);

/** Unknown or missing route params fall back to the Rate Check copy. */
export function resolvePaywallTrigger(raw: string | undefined): PaywallTrigger {
  return raw && isPaywallTrigger(raw) ? raw : DEFAULT_PAYWALL_TRIGGER;
}
