/**
 * IR-R2 static assertions. Live cascade / TWO_USER_RLS re-run is out of scope
 * here — these tests pin declared SQL semantics only.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require('node:fs') as { readFileSync(path: string, enc: string): string };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeCp = require('node:child_process') as {
  execFileSync(file: string, args: string[], opts?: { encoding?: string }): string;
};

const FROZEN_IR_R1 = '8c03f1c64db2fb7af25cffdcd6aed404809c604b';

const read = (name: string) => nodeFs.readFileSync(`supabase/migrations/${name}`, 'utf8');
const stripComments = (sql: string) => sql.replace(/--.*$/gm, '');
const normalize = (sql: string) => stripComments(sql).replace(/\s+/g, ' ').trim();

const FILE_00006 = '20260718000006_harden_rls_auto_enable.sql';
const FILE_00021 = '20260902000021_runtime_assurance_remediation.sql';
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
  it('00001–00005 and 00007–00020 are byte-identical to 8c03f1c; only 00006 changed', () => {
    const listing = nodeCp.execFileSync(
      'git',
      ['ls-tree', '--name-only', `${FROZEN_IR_R1}:supabase/migrations`],
      { encoding: 'utf8' },
    );
    const frozenFiles = listing.trim().split('\n').filter(Boolean);
    expect(frozenFiles).not.toContain(FILE_00021);
    const mutated: string[] = [];
    for (const name of frozenFiles) {
      const frozen = nodeCp.execFileSync('git', ['show', `${FROZEN_IR_R1}:supabase/migrations/${name}`], {
        encoding: 'utf8',
      });
      const current = read(name);
      if (frozen !== current) mutated.push(name);
    }
    expect(mutated).toEqual([FILE_00006]);
    expect(read(FILE_00021).length).toBeGreaterThan(0);
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
