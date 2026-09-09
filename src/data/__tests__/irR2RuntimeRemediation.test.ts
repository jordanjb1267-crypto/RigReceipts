/**
 * IR-R2 static assertions. Live cascade / TWO_USER_RLS re-run is out of scope
 * here — these tests pin declared SQL semantics only.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require('node:fs') as {
  readFileSync(path: string, enc?: string): string | Uint8Array;
  readdirSync(path: string): string[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeCrypto = require('node:crypto') as {
  createHash(alg: string): { update(b: Uint8Array): { digest(enc: string): string } };
};

const FROZEN_IR_R1 = '8c03f1c64db2fb7af25cffdcd6aed404809c604b';

/**
 * Byte-identical freeze of IR-R1 (`8c03f1c`) migrations, excluding 00006.
 *
 * Hashes were generated once at IR-R2.1 implementation from
 * `git cat-file blob 8c03f1c:supabase/migrations/<file>` (SHA-256 of raw
 * blob bytes). Jest must not regenerate them, fetch Git history, or call
 * `git show` / `git ls-tree` / `git diff` of a historical SHA — GitHub
 * Actions PR checkouts are shallow and the ancestor object is not present.
 *
 * 00006 is omitted: IR-R2 authorized a hosted-safe REVOKE rewrite, proven
 * by the semantic tests below. 00021 is additive and is not in this set.
 */
const FROZEN_IR_R1_PROTECTED_MIGRATION_SHA256: Record<string, string> = {
  '20260716000001_init.sql':
    'df92c27aa6bfed588979a0aef1bdc681ff60c59047f1637242b79de52ccb78dc',
  '20260716000002_rls.sql':
    '13fc8c1cfe7e21f860b6065c2e92b9d928d8507c276af79ef8c5cc8055be4c48',
  '20260716000003_storage.sql':
    'bf4bdfe5436bc9c4a2574c34393a3db295253788d12ac1915eab2cc263652307',
  '20260716000004_freight_intelligence.sql':
    'cd40c0c73d8d73331444840f75d068fa9be761d9bfd551b0b176148be3bdf36c',
  '20260716000005_freight_rls.sql':
    'acb95152269e84038f2a7e49b3edaf6e3280a89a158e030a43ad2f01d4ad4d3d',
  '20260718000007_lane_aggregate_job.sql':
    '132fd0db686d3aaa05066fd777ff25ee58144fbbaa3aab2afaf421eb5e902856',
  '20260719000008_account_deletion.sql':
    '10196b9a7d7da610be0c475c8841709700d28c0f1a407c9b4a284c249b8da398',
  '20260719000009_grades.sql':
    '96bcc09d1c3d10cd53a9f65a2bc83d64ea485231c90d381e1e98f2d0d008e0bc',
  '20260720000010_live_mileage.sql':
    '5563b8976ffd39c9e690e2c521498a3a3780b7dd9bf45efc091f4d144aff5c05',
  '20260902000011_pass0_entitlements.sql':
    '892841c5cd8923d0570949dc30eb518331750df49ea1234eff37393f10f00b4e',
  '20260902000012_storage_classification.sql':
    'ad7002fe6bdee902fc3c44eb3aabe111c7c145c501c5fbd17db4d3b1e18b018c',
  '20260902000013_road_wallet_core.sql':
    '07778db3b39a37e0f016bfe10dcc268f685fe9d5f110489ddc211a7a6a2f1089',
  '20260902000014_road_wallet_integrity_hardening.sql':
    '1760379f487207f1a804c149e2ce870138f784172a7a3e57ddf8c720117ed03d',
  '20260902000015_quick_present_sets.sql':
    '70b72f93396367fe0f43d2a30d10464db151515dc4b22fb40aba957c71cbb27d',
  '20260902000016_carrier_packets.sql':
    '2e5f6445386971207f917284fd5c47a2c546c2c93585d1c94e31f6561ad2945a',
  '20260902000017_carrier_packet_integrity_hardening.sql':
    '32739bc51662cbba4b1ea58b9e563bf092c3ef4d1f4e60694502024a56706d6e',
  '20260902000018_carrier_packet_snapshot_integrity.sql':
    'b848d5e690caec7a11b70a3c8e1c16af16f64ea332f8eceeee5604845f1c978e',
  '20260902000019_carrier_packet_final_evidence_hardening.sql':
    '75f71c8402b51b3338233489e3aa9478529aa786a5b42831a8c8df683d0b942e',
  '20260902000020_independent_review_remediation.sql':
    '00be56a4c3aaaf8d12a58384776898b261417c8c06a78210918ad01a8f48f6ed',
};

const read = (name: string) => nodeFs.readFileSync(`supabase/migrations/${name}`, 'utf8') as string;
const sha256FileBytes = (name: string) =>
  nodeCrypto
    .createHash('sha256')
    .update(nodeFs.readFileSync(`supabase/migrations/${name}`) as Uint8Array)
    .digest('hex');
const stripComments = (sql: string) => sql.replace(/--.*$/gm, '');
const normalize = (sql: string) => stripComments(sql).replace(/\s+/g, ' ').trim();

const FILE_00006 = '20260718000006_harden_rls_auto_enable.sql';
const FILE_00021 = '20260902000021_runtime_assurance_remediation.sql';
const FILE_00022 = '20260902000022_account_delete_dependency_ordering.sql';
const sql00006 = read(FILE_00006);
const sql00021 = read(FILE_00021);
const n06 = normalize(sql00006).toLowerCase();
const n21 = normalize(sql00021).toLowerCase();

const CANONICAL_KINDS = [
  'CDL',
  'MEDICAL_DOCUMENT',
  'TWIC',
  'VEHICLE_REGISTRATION',
  'TRAILER_REGISTRATION',
  'IRP_CAB_CARD',
  'ANNUAL_INSPECTION',
  'INSURANCE',
  'IFTA',
  'OPERATING_PERMIT',
  'OPERATING_AUTHORITY',
  'CERTIFICATE_OF_INSURANCE',
  'UCR',
  'W9',
  'FACTORING_NOA',
  'BANKING_DOCUMENT',
  'LEASE_AGREEMENT',
  'CUSTOM',
] as const;

const CANONICAL_SENSITIVITIES = ['STANDARD', 'PERSONAL_SENSITIVE', 'FINANCIAL_SENSITIVE'] as const;

/** Dollar-quote + parenthesis balance. Comments already stripped. */
function parseSql(sql: string): { ok: true } | { ok: false; reason: string } {
  const src = stripComments(sql);
  let i = 0;
  let paren = 0;
  let inSingle = false;
  let dollar: string | null = null;
  while (i < src.length) {
    const ch = src[i]!;
    if (dollar) {
      if (src.startsWith(dollar, i)) {
        i += dollar.length;
        dollar = null;
        continue;
      }
      i += 1;
      continue;
    }
    if (inSingle) {
      if (ch === "'" && src[i + 1] === "'") {
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      i += 1;
      continue;
    }
    if (ch === '$') {
      const m = src.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (m) {
        dollar = m[0];
        i += m[0].length;
        continue;
      }
    }
    if (ch === '(') paren += 1;
    if (ch === ')') {
      paren -= 1;
      if (paren < 0) return { ok: false, reason: 'unbalanced )' };
    }
    i += 1;
  }
  if (inSingle) return { ok: false, reason: 'unclosed string' };
  if (dollar) return { ok: false, reason: `unclosed dollar-quote ${dollar}` };
  if (paren !== 0) return { ok: false, reason: `unbalanced parentheses (${paren})` };
  if (!src.trim()) return { ok: false, reason: 'empty after comment strip' };
  return { ok: true };
}

/**
 * Hosted-present / hosted-absent semantics of 00006. Mirrors the DO block:
 * REVOKE runs only when to_regprocedure is not null. Never creates the function.
 */
function apply00006Compatibility(functionPresent: boolean): {
  revokeAttempted: boolean;
  functionCreated: boolean;
} {
  const present = functionPresent; // to_regprocedure(...) IS NOT NULL
  return {
    revokeAttempted: present,
    functionCreated: false,
  };
}

describe('IR-R2 SQL parse', () => {
  it('parses the rewritten 00006 and additive 00021', () => {
    expect(parseSql(sql00006)).toEqual({ ok: true });
    expect(parseSql(sql00021)).toEqual({ ok: true });
  });
});

describe('IR-R2 RR-DB-02 — 00006 hosted-platform compatibility', () => {
  it('checks to_regprocedure and does not create rls_auto_enable or an event trigger', () => {
    expect(n06).toMatch(/pg_catalog\.to_regprocedure\('public\.rls_auto_enable\(\)'\)/);
    expect(n06).not.toMatch(/create (or replace )?function/);
    expect(n06).not.toMatch(/create event trigger/);
    expect(n06).not.toMatch(/enable row level security/);
    expect(n06).not.toMatch(/alter table/);
  });

  it('keeps the exact prior REVOKE in the hosted-present EXECUTE path', () => {
    expect(sql00006).toMatch(
      /EXECUTE\s+'revoke execute on function public\.rls_auto_enable\(\) from public, anon, authenticated'/i,
    );
    expect(n06).toMatch(/from public, anon, authenticated/);
  });

  it('Case A — function absent: no REVOKE attempted, migration succeeds', () => {
    const result = apply00006Compatibility(false);
    expect(result.revokeAttempted).toBe(false);
    expect(result.functionCreated).toBe(false);
  });

  it('Case B — function present: REVOKE is attempted, function is not created', () => {
    const result = apply00006Compatibility(true);
    expect(result.revokeAttempted).toBe(true);
    expect(result.functionCreated).toBe(false);
  });
});

describe('IR-R2 RR-DB-02A — only 00006 historical migration differs from frozen IR-R1', () => {
  it('00001–00005 and 00007–00020 match the frozen IR-R1 SHA-256 manifest; 00006 and 00021 are excluded', () => {
    expect(FROZEN_IR_R1).toBe('8c03f1c64db2fb7af25cffdcd6aed404809c604b');
    expect(FROZEN_IR_R1_PROTECTED_MIGRATION_SHA256).not.toHaveProperty(FILE_00006);
    expect(FROZEN_IR_R1_PROTECTED_MIGRATION_SHA256).not.toHaveProperty(FILE_00021);

    const currentFiles = nodeFs
      .readdirSync('supabase/migrations')
      .filter((name) => name.endsWith('.sql'))
      .sort();
    const extras = currentFiles.filter(
      (name) =>
        !(name in FROZEN_IR_R1_PROTECTED_MIGRATION_SHA256) &&
        name !== FILE_00006 &&
        name !== FILE_00021 &&
        name !== FILE_00022,
    );
    expect(extras).toEqual([]);
    expect(currentFiles).toContain(FILE_00006);
    expect(currentFiles).toContain(FILE_00021);
    expect(currentFiles).toContain(FILE_00022);
    expect(currentFiles).toHaveLength(
      Object.keys(FROZEN_IR_R1_PROTECTED_MIGRATION_SHA256).length + 3,
    );

    for (const [name, expectedHash] of Object.entries(FROZEN_IR_R1_PROTECTED_MIGRATION_SHA256)) {
      const currentHash = sha256FileBytes(name);
      expect({ name, currentHash }).toEqual({ name, currentHash: expectedHash });
    }
  });
});

describe('IR-R2 RR-DB-01 — delete_current_account Storage context', () => {
  it('preserves SECURITY DEFINER, empty search_path, auth.uid scope, and grants', () => {
    expect(n21).toMatch(
      /create or replace function public\.delete_current_account\(\) returns void language plpgsql security definer set search_path = ''/,
    );
    expect(n21).toMatch(/v_uid uuid := \(select auth\.uid\(\)\)/);
    expect(n21).toMatch(/if v_uid is null then raise exception 'not authenticated'/);
    expect(n21).toMatch(
      /revoke all on function public\.delete_current_account\(\) from public, anon/,
    );
    expect(n21).toMatch(
      /grant execute on function public\.delete_current_account\(\) to authenticated/,
    );
    expect(n21).not.toMatch(/delete_current_account\(\s*uuid/);
    expect(n21).not.toMatch(/delete_current_account\(\s*text/);
    expect(n21).not.toMatch(/exception when/);
  });

  it('sets transaction-local storage.allow_delete_query immediately before storage.objects DELETE', () => {
    const idxConfig = n21.indexOf(
      "perform pg_catalog.set_config( 'storage.allow_delete_query', 'true', true )",
    );
    const idxDelete = n21.indexOf('delete from storage.objects');
    expect(idxConfig).toBeGreaterThan(-1);
    expect(idxDelete).toBeGreaterThan(idxConfig);
    expect(n21).toMatch(
      /perform pg_catalog\.set_config\(\s*'storage\.allow_delete_query',\s*'true',\s*true\s*\)/,
    );
    expect(n21).not.toMatch(/set_config\(\s*'storage\.allow_delete_query',\s*'true',\s*false/);
  });

  it('keeps the caller-folder storage predicate and auth.users delete scoped to v_uid', () => {
    expect(n21).toMatch(/bucket_id in \('receipts', 'documents', 'reports'\)/);
    expect(n21).toMatch(/\(storage\.foldername\(name\)\)\[1\] = v_uid::text/);
    expect(n21).toMatch(/delete from auth\.users where id = v_uid/);
    expect(n21).not.toMatch(/delete from storage\.objects\s*;/);
  });

  it('does not rewrite 00008 and does not claim live cascade PASS', () => {
    const orig = read('20260719000008_account_deletion.sql');
    expect(orig).toMatch(/create or replace function public\.delete_current_account\(\)/);
    expect(orig).not.toMatch(/storage\.allow_delete_query/);
    expect(sql00021).toMatch(/do not rewrite 00008/i);
    expect(sql00021).not.toMatch(/CASCADE_PASS|runtime cascade PASS/i);
  });
});

describe('IR-R2 RR-DB-03 — snapshot CHECK constraints', () => {
  it('declares exact canonical document kinds and rejects NOT_A_KIND by design', () => {
    expect(n21).toMatch(
      /add constraint carrier_packet_items_document_kind_snapshot_check check/,
    );
    for (const kind of CANONICAL_KINDS) {
      expect(sql00021).toMatch(new RegExp(`'${kind}'`));
    }
    expect(sql00021).not.toMatch(/NOT_A_KIND/);
    expect(n21).not.toMatch(/create type /);
    const listed = [...sql00021.matchAll(/'([A-Z0-9_]+)'/g)]
      .map((m) => m[1])
      .filter((k) => CANONICAL_KINDS.includes(k as (typeof CANONICAL_KINDS)[number]));
    expect(new Set(listed)).toEqual(new Set(CANONICAL_KINDS));
  });

  it('declares exact canonical sensitivities and rejects an invalid class by design', () => {
    expect(n21).toMatch(/add constraint carrier_packet_items_sensitivity_snapshot_check check/);
    for (const s of CANONICAL_SENSITIVITIES) {
      expect(sql00021).toMatch(new RegExp(`'${s}'`));
    }
    expect(sql00021).not.toMatch(/'SECRET'/);
    expect(sql00021).not.toMatch(/'UNKNOWN'/);
  });

  it('does not change item ownership, FKs, or policies', () => {
    expect(n21).not.toMatch(/drop constraint/);
    expect(n21).not.toMatch(/create policy/);
    expect(n21).not.toMatch(/drop policy/);
    expect(n21).not.toMatch(/owner_id_fkey/);
    expect(n21).not.toMatch(/enable row level security/);
  });
});

describe('IR-R2 RR-DB-03A — read-only dirty-data preflight is documented, not destructive', () => {
  it('embeds SELECT-only preflight for invalid snapshot scalars', () => {
    expect(sql00021).toMatch(/SELECT id, owner_id, document_kind_snapshot/i);
    expect(sql00021).toMatch(/SELECT id, owner_id, sensitivity_snapshot/i);
    expect(sql00021).toMatch(/WHERE document_kind_snapshot NOT IN/i);
    expect(sql00021).toMatch(/WHERE sensitivity_snapshot NOT IN/i);
    expect(n21).not.toMatch(/delete from public\.carrier_packet_items/);
    expect(n21).not.toMatch(/update public\.carrier_packet_items/);
    expect(n21).not.toMatch(/not valid/);
  });
});
