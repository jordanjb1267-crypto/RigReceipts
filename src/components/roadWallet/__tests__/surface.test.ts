/**
 * Static assertions over the Road Wallet product surface (Pass 1B). The repo
 * has no React Native render harness, so wiring and copy-safety invariants are
 * pinned by reading the source files.
 */
import { saveErrorCopy, shareErrorCopy } from '@/components/roadWallet/errorCopy';
import { DEFAULT_FLAGS } from '@/config/flags';
import { ShareDeniedError } from '@/data/roadWallet';
import { SCAN_TYPES } from '@/domain';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require('node:fs') as { readFileSync(path: string, enc: string): string };
const read = (p: string) => nodeFs.readFileSync(p, 'utf8');

const layout = read('src/app/_layout.tsx');
const tabsLayout = read('src/app/(tabs)/_layout.tsx');
const board = read('src/app/(tabs)/index.tsx');
const reports = read('src/app/(tabs)/reports.tsx');
const scan = read('src/app/(tabs)/scan.tsx');
const wallet = read('src/app/road-wallet.tsx');
const add = read('src/app/add-road-document.tsx');
const detail = read('src/app/document-detail.tsx');
const gate = read('src/components/roadWallet/RoadWalletGate.tsx');
const sourceSheet = read('src/components/roadWallet/DocumentSourceSheet.tsx');
const dataLayer = read('src/data/roadWallet.ts') + read('src/data/documentSync.ts');
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe('root stack + sync bootstrap', () => {
  it('registers the three Road Wallet routes and keeps every existing stack route', () => {
    for (const name of [
      'road-wallet',
      'add-road-document',
      'document-detail',
      'quick-present',
      'presentation-set-edit',
    ]) {
      expect(count(layout, new RegExp(`<Stack\\.Screen name="${name}"`, 'g'))).toBe(1);
    }
    for (const existing of [
      '(onboarding)',
      '(tabs)',
      'paywall',
      'load-detail',
      'live-mileage',
      'mileage-review',
    ]) {
      expect(layout).toContain(`<Stack.Screen name="${existing}"`);
    }
  });

  it('initializes document sync exactly once alongside capture sync', () => {
    expect(count(layout, /^initDocumentSync\(\);/gm)).toBe(1);
    expect(count(layout, /^initCaptureSync\(\);/gm)).toBe(1);
    expect(count(layout, /initDocumentSync\(/g)).toBe(1);
    expect(layout).toMatch(/import \{ initDocumentSync \} from '@\/data\/documentSync';/);
  });

  it('keeps exactly five tabs — no Road Wallet tab', () => {
    expect(count(tabsLayout, /<Tabs\.Screen/g)).toBe(5);
    expect(tabsLayout).not.toMatch(/road-wallet|documents/i);
  });
});

describe('feature flag gating', () => {
  it('all Road Wallet flags default off', () => {
    for (const f of [
      'road_wallet_enabled',
      'quick_present_enabled',
      'document_expiry_alerts_enabled',
      'carrier_profile_enabled',
      'carrier_packet_builder_enabled',
      'carrier_packet_history_enabled',
      'multi_unit_documents_enabled',
    ] as const) {
      expect(DEFAULT_FLAGS[f]).toEqual({ state: 'off' });
    }
  });

  it('every Road Wallet route renders through the gate, which redirects when the flag is off', () => {
    expect(gate).toMatch(/isFeatureEnabled\('road_wallet_enabled'\)/);
    expect(gate).toMatch(/<Redirect href="\/\(tabs\)\/reports" \/>/);
    for (const screen of [wallet, add, detail]) {
      expect(screen).toMatch(/<RoadWalletGate>/);
      expect(screen).toMatch(/export default function/);
    }
  });

  it('Board, Reports and Scan entries are gated by road_wallet_enabled', () => {
    expect(board).toMatch(/const roadWalletEnabled = isFeatureEnabled\('road_wallet_enabled'\);/);
    expect(board).toMatch(/roadWalletEnabled && \(/);
    expect(board).toMatch(/<RoadWalletWidget/);
    expect(reports).toMatch(/roadWalletEnabled && \([\s\S]{0,600}router\.push\('\/road-wallet'\)/);
    expect(scan).toMatch(
      /isFeatureEnabled\('road_wallet_enabled'\) && \([\s\S]{0,400}onAddRoadDocument/,
    );
    expect(scan).toMatch(/router\.push\('\/add-road-document'\)/);
  });
});

describe('Pass 1B.1 — Board readiness truth, restore UX, recovery ordering', () => {
  const sync = read('src/data/documentSync.ts');
  const recovery = read('src/data/roadWalletRecovery.ts');

  it('the Board triggers a current-process readiness check on focus when the flag is on (no polling)', () => {
    expect(board).toMatch(/useFocusEffect\(/);
    expect(board).toMatch(
      /if \(roadWalletEnabled\) \{[\s\S]{0,120}refreshRoadWalletReadinessForSession\(userId\)/,
    );
    expect(board).not.toMatch(/setInterval|setTimeout\(/);
    expect(board).toMatch(/Checking…/);
  });

  it('Document Detail offers "Restore to this device" (owner right, not Share/Export) with the financial notice', () => {
    expect(detail).toMatch(/Restore to this device/);
    expect(detail).toMatch(/restoreDocumentVersionToDevice\(doc\.id\)/);
    expect(detail).toMatch(/current\.cloudStatus === 'synced' && readiness !== 'READY'/);
    expect(detail).not.toMatch(/canShare && canRestore|canRestore && canShare/);
    expect(detail).toMatch(/app-private local copy[\s\S]{0,120}platform’s app storage protections/);
    expect(detail).not.toMatch(/hardware[- ]encrypt/i);
  });

  it('the cloud cycle recovers before it writes, coalesces, and is what initDocumentSync runs', () => {
    const recoverIdx = sync.indexOf('recovery = await recoverRw()');
    const writeSafeIdx = sync.indexOf('if (writeSafe)');
    const writeIdx = sync.indexOf('writes = await syncRw()', writeSafeIdx);
    expect(recoverIdx).toBeGreaterThan(-1);
    expect(writeSafeIdx).toBeGreaterThan(recoverIdx);
    expect(writeIdx).toBeGreaterThan(writeSafeIdx);
    expect(sync).toMatch(/writeSafeFromRecovery/);
    expect(sync).toMatch(/void runRoadWalletCloudCycle\(\);/);
    expect(sync).toMatch(/useRoadWalletStore\.persist\.hasHydrated\(\)/);
    expect(sync).toMatch(/usePresentationSetsStore\.persist\.hasHydrated\(\)/);
    expect(sync).toMatch(/cycleInFlight/);
    expect(sync).not.toMatch(/setInterval/);
  });

  it('recovery uses only owner-scoped RLS reads and the private documents bucket — no service role, no SECURITY DEFINER', () => {
    expect(recovery).toMatch(/\.eq\('owner_id', userId\)/);
    expect(recovery).toMatch(/storage\.from\(bucket\)\.download\(path\)/);
    expect(recovery).not.toMatch(/service_role|serviceRole|security definer|rpc\(/i);
    expect(recovery).toMatch(/fromRemoteDocumentRow\(row, userId\)/);
    expect(recovery).toMatch(/fromRemoteVersionRow\(row, userId, parent\)/);
  });

  it('copy describes Driver Pro as cloud backup and recovery, never a bare "backs them up"', () => {
    for (const src of [wallet, detail, add, read('src/domain/paywallTriggers.ts')]) {
      expect(src).not.toMatch(/backs them up|backs up your/);
    }
    expect(wallet).toMatch(/private cloud backup and recovery/);
  });
});

describe('Board / Reports / Scan integration', () => {
  it('the Board widget uses the real summary, never mock board data, and the nav type is generalized', () => {
    expect(board).toMatch(/useRoadWalletSummary\(\)/);
    expect(board).toMatch(/type TabPath = Extract<Href, string>;/);
    expect(board).not.toMatch(/mock\/board[^\n]*[Rr]oadWallet/);
    expect(board).not.toMatch(/roadWallet[^\n]*mock\/board/);
    expect(board).toMatch(/quick_present_enabled/);
    expect(board).toMatch(/Quick Present/);
    expect(board).toMatch(/onNavigate\('\/rate-board'\)/); // existing behaviour preserved
  });

  it('Reports gains a Road Wallet management entry without replacing the existing ones', () => {
    expect(reports).toMatch(/title="Road Wallet"/);
    expect(reports).toMatch(
      /Registrations, insurance, permits and credentials — organized for the road\./,
    );
    for (const t of [
      'Monthly closeout',
      'RPM Coach',
      'Export records (CSV)',
      'Account &amp; data',
    ]) {
      expect(reports).toContain(`title="${t}"`);
    }
    expect(reports).toContain("router.push('/road-grade')");
    expect(reports).toContain("router.push('/broker-check')");
    expect(reports).toContain("router.push('/rate-board')");
  });

  it('Scan adds one Road Wallet entry outside the type chips and SCAN_TYPES is unchanged', () => {
    expect(count(scan, /title="Road Wallet document"/g)).toBe(1);
    expect(SCAN_TYPES).toHaveLength(15);
    expect(SCAN_TYPES.map((t) => t.slug)).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/cdl|insurance|ifta|permit_|w9|registration/i),
      ]),
    );
  });
});

describe('Road Wallet never touches the receipt pipeline', () => {
  it('screens and data layer do not use OCR, captures, document_scans or expenses', () => {
    for (const src of [wallet, add, detail, sourceSheet, dataLayer]) {
      expect(src).not.toMatch(/parseReceipt|recognizeDocument|createCapture|useCapturesStore/);
      expect(src).not.toMatch(/'document_scans'|'expenses'/);
    }
    expect(dataLayer).not.toMatch(/from\('expenses'\)|from\('document_scans'\)/);
  });

  it('the source sheet uses expo-document-picker for files and never stores the picker URI as canonical', () => {
    expect(sourceSheet).toMatch(/from 'expo-document-picker'/);
    expect(sourceSheet).toMatch(/application\/pdf/);
    expect(add).toMatch(/createOperationalDocumentFromFile\(source/);
    expect(add).not.toMatch(/AsyncStorage|persist\(/);
  });
});

describe('copy safety', () => {
  const FORBIDDEN =
    /compliant|legally valid|DOT compliant|roadside approved|regulatory approved|non-compliant|out of service|invalid for operation/i;
  const disclaimerLines = (src: string) =>
    src.split('\n').filter((l) => /ROAD_WALLET_DISCLAIMER|does not determine/.test(l));

  it('Road Wallet screens never claim compliance except via the explicit disclaimer', () => {
    for (const src of [wallet, add, detail, sourceSheet, gate]) {
      const offending = src
        .split('\n')
        .filter((l) => FORBIDDEN.test(l))
        .filter((l) => !disclaimerLines(src).includes(l));
      expect(offending).toEqual([]);
    }
  });

  it('error copy never echoes private paths or internal exception text and never claims compliance', () => {
    const samples = [
      saveErrorCopy(new Error('import verification failed: EMPTY')),
      saveErrorCopy(new Error('import verification failed: CONTENT_MISMATCH')),
      saveErrorCopy(new Error('source not found')),
      saveErrorCopy(new Error('/data/user/0/com.rigreceipts.app/road-wallet/abc/def.jpg: EACCES')),
      saveErrorCopy('nope'),
      shareErrorCopy(new ShareDeniedError('FILE_UNAVAILABLE', 'MISSING')).body,
      shareErrorCopy(new ShareDeniedError('FILE_UNAVAILABLE', 'HASH_MISMATCH')).body,
      shareErrorCopy(new ShareDeniedError('NOT_ENTITLED')).body,
      shareErrorCopy(new ShareDeniedError('ARCHIVED')).body,
      shareErrorCopy(new Error('boom /private/path')).body,
    ];
    for (const s of samples) {
      expect(s).not.toMatch(/road-wallet\/|\/data\/|EACCES|boom|\.jpg/);
      expect(s).not.toMatch(FORBIDDEN);
    }
    expect(shareErrorCopy(new ShareDeniedError('FILE_UNAVAILABLE', 'MISSING')).body).toMatch(
      /replace|restore/i,
    );
    expect(shareErrorCopy(new ShareDeniedError('FILE_UNAVAILABLE', 'HASH_MISMATCH')).body).toMatch(
      /no longer matches/,
    );
  });

  it('PDF is described truthfully: no inline preview, no "open in system viewer"', () => {
    expect(detail).toMatch(/In-app PDF preview is not available yet\./);
    expect(detail).not.toMatch(/Open in system viewer/i);
    expect(detail).not.toMatch(/react-native-pdf|WebView/);
  });

  it('Detail offers no delete-version action and images render only when READY', () => {
    expect(detail).not.toMatch(/Delete version|deleteVersion|removeVersion/);
    expect(detail).not.toMatch(/Delete document permanently/);
    expect(detail).toMatch(/version\.fileKind === 'IMAGE' && state === 'READY'/);
    expect(detail).toMatch(/uriFor\(version\.relativePath\)/);
  });

  it('screens never render paths, hashes or storage locations', () => {
    for (const src of [wallet, detail]) {
      expect(src).not.toMatch(/\{[^}]*\.sha256\}/);
      expect(src).not.toMatch(/\{[^}]*remoteStoragePath\}/);
      expect(src).not.toMatch(/\{[^}]*remoteStorageBucket\}/);
      expect(src).not.toMatch(/<Text[^>]*>\{[^}]*relativePath\}/);
    }
  });

  it('Add Document asks only for the last four of a reference and masks it', () => {
    expect(add).toMatch(/Last 4 of document number/);
    expect(add).toMatch(/maskReference\(lastFour\)/);
    expect(add).not.toMatch(/maskedReference: lastFour/);
    expect(add).not.toMatch(/track\(/); // no analytics carrying document details
  });
});

describe('Pass 2 — Quick Present surface', () => {
  const present = read('src/app/quick-present.tsx');
  const editor = read('src/app/presentation-set-edit.tsx');
  const qpGate = read('src/components/roadWallet/QuickPresentGate.tsx');
  const FORBIDDEN_PHRASES = [
    'Roadside compliant',
    'DOT approved',
    'Accepted everywhere',
    'Legally valid',
    'All documents ready',
    'Required documents',
  ];

  it('gates Quick Present on both flags and registers no sixth tab', () => {
    expect(qpGate).toMatch(/road_wallet_enabled/);
    expect(qpGate).toMatch(/quick_present_enabled/);
    expect(present).toMatch(/<QuickPresentGate>/);
    expect(editor).toMatch(/<QuickPresentGate>/);
    expect(count(tabsLayout, /<Tabs\.Screen/g)).toBe(5);
  });

  it('Road Wallet and Board expose Quick Present only behind quick_present_enabled', () => {
    expect(wallet).toMatch(/isFeatureEnabled\('quick_present_enabled'\)/);
    expect(wallet).toMatch(/Quick Present/);
    expect(board).toMatch(/isFeatureEnabled\('quick_present_enabled'\)/);
    expect(board).toMatch(/Quick Present/);
  });

  it('copy rejects compliance marketing and names the real disclaimer', () => {
    for (const src of [present, editor]) {
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(src).not.toContain(phrase);
      }
      expect(src).toMatch(/QUICK_PRESENT_DISCLAIMER/);
      expect(src).not.toMatch(/required documents/i);
      expect(src).not.toMatch(/Open in system viewer/i);
      expect(src).not.toMatch(/react-native-pdf/);
      expect(src).not.toMatch(/track\(/);
    }
    expect(present).toMatch(/AppState/);
    expect(present).toMatch(/destroyPresentationSession/);
    expect(present).toMatch(/saved_presentation_sets/);
    expect(present).not.toMatch(/Share \/ Export this PDF[\s\S]{0,80}FINANCIAL/);
  });
});
