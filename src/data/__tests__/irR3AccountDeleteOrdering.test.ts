/**
 * IR-R3 static assertions for RR-DB-04 account-delete dependency ordering.
 * Live cascade re-run is out of scope here.
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

const FROZEN_IR_R2 = '4891a588df01a1e3e9523ea691573d252f92e90a';

/**
 * Byte-identical freeze of IR-R2 (`4891a58`) migrations 00001–00021.
 *
 * Hashes were generated once at IR-R3 implementation from the working-tree
 * bytes of that frozen subject. Jest must not regenerate them or call
 * `git show` / `git ls-tree` / `git diff` of a historical SHA.
 *
 * 00022 is the authorized additive migration and is not in this set.
 */
const FROZEN_IR_R2_PROTECTED_MIGRATION_SHA256: Record<string, string> = {
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
  '20260718000006_harden_rls_auto_enable.sql':
    '7c521a74daebc25f07f8065b0f2201d1b6480fd0f7278dc4a87a23fd010a338b',
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
  '20260902000021_runtime_assurance_remediation.sql':
    'ab331e5fd7d101a8990257735cd935aacbc832526d38667b0f3268042b38827a',
};

const read = (name: string) => nodeFs.readFileSync(`supabase/migrations/${name}`, 'utf8') as string;
const sha256FileBytes = (name: string) =>
  nodeCrypto
    .createHash('sha256')
    .update(nodeFs.readFileSync(`supabase/migrations/${name}`) as Uint8Array)
    .digest('hex');
const stripComments = (sql: string) => sql.replace(/--.*$/gm, '');
const normalize = (sql: string) => stripComments(sql).replace(/\s+/g, ' ').trim();

const FILE_00008 = '20260719000008_account_deletion.sql';
const FILE_00015 = '20260902000015_quick_present_sets.sql';
const FILE_00016 = '20260902000016_carrier_packets.sql';
const FILE_00021 = '20260902000021_runtime_assurance_remediation.sql';
const FILE_00022 = '20260902000022_account_delete_dependency_ordering.sql';
const sql00015 = read(FILE_00015);
const sql00016 = read(FILE_00016);
const sql00021 = read(FILE_00021);
const sql00022 = read(FILE_00022);
const n22 = normalize(sql00022).toLowerCase();

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

describe('IR-R3 SQL parse', () => {
  it('parses additive 00022', () => {
    expect(parseSql(sql00022)).toEqual({ ok: true });
  });
});

describe('IR-R3 freeze — 00001–00021 are byte-identical to 4891a58', () => {
  it('matches the frozen IR-R2 SHA-256 manifest; only 00022 is additive', () => {
    expect(FROZEN_IR_R2).toBe('4891a588df01a1e3e9523ea691573d252f92e90a');
    expect(FROZEN_IR_R2_PROTECTED_MIGRATION_SHA256).not.toHaveProperty(FILE_00022);
    expect(Object.keys(FROZEN_IR_R2_PROTECTED_MIGRATION_SHA256)).toHaveLength(21);

    const currentFiles = nodeFs
      .readdirSync('supabase/migrations')
      .filter((name) => name.endsWith('.sql'))
      .sort();
    const extras = currentFiles.filter((name) => !(name in FROZEN_IR_R2_PROTECTED_MIGRATION_SHA256));
    expect(extras).toEqual([FILE_00022]);
    expect(currentFiles).toHaveLength(22);

    for (const [name, expectedHash] of Object.entries(FROZEN_IR_R2_PROTECTED_MIGRATION_SHA256)) {
      const currentHash = sha256FileBytes(name);
      expect({ name, currentHash }).toEqual({ name, currentHash: expectedHash });
    }
  });
});

describe('IR-R3 RR-DB-04 — delete_current_account dependency ordering', () => {
  it('replaces delete_current_account with SECURITY DEFINER, empty search_path, auth.uid-only scope', () => {
    expect(n22).toMatch(
      /create or replace function public\.delete_current_account\(\) returns void language plpgsql security definer set search_path = ''/,
    );
    expect(n22).toMatch(/v_uid uuid := \(select auth\.uid\(\)\)/);
    expect(n22).toMatch(/if v_uid is null then raise exception 'not authenticated'/);
    expect(n22).toMatch(
      /revoke all on function public\.delete_current_account\(\) from public, anon/,
    );
    expect(n22).toMatch(
      /grant execute on function public\.delete_current_account\(\) to authenticated/,
    );
    expect(n22).not.toMatch(/delete_current_account\(\s*uuid/);
    expect(n22).not.toMatch(/delete_current_account\(\s*text/);
    expect(n22).not.toMatch(/exception when/);
    expect(n22).not.toMatch(/execute\s+'/);
    expect(n22).not.toMatch(/execute\s+format/);
  });

  it('sets transaction-local storage.allow_delete_query before Storage DELETE', () => {
    const idxConfig = n22.indexOf(
      "perform pg_catalog.set_config( 'storage.allow_delete_query', 'true', true )",
    );
    const idxStorage = n22.indexOf('delete from storage.objects');
    expect(idxConfig).toBeGreaterThan(-1);
    expect(idxStorage).toBeGreaterThan(idxConfig);
    expect(n22).toMatch(
      /perform pg_catalog\.set_config\(\s*'storage\.allow_delete_query',\s*'true',\s*true\s*\)/,
    );
    expect(n22).not.toMatch(/set_config\(\s*'storage\.allow_delete_query',\s*'true',\s*false/);
    expect(n22).toMatch(/bucket_id in \('receipts', 'documents', 'reports'\)/);
    expect(n22).toMatch(/\(storage\.foldername\(name\)\)\[1\] = v_uid::text/);
  });

  it('deletes caller packets then presentation sets before auth.users, and does not delete children directly', () => {
    const idxStorage = n22.indexOf('delete from storage.objects');
    const idxPackets = n22.indexOf('delete from public.carrier_packets where owner_id = v_uid');
    const idxSets = n22.indexOf('delete from public.presentation_sets where owner_id = v_uid');
    const idxAuth = n22.indexOf('delete from auth.users where id = v_uid');
    expect(idxStorage).toBeGreaterThan(-1);
    expect(idxPackets).toBeGreaterThan(idxStorage);
    expect(idxSets).toBeGreaterThan(idxPackets);
    expect(idxAuth).toBeGreaterThan(idxSets);

    expect(n22).not.toMatch(/delete from public\.carrier_packet_items/);
    expect(n22).not.toMatch(/delete from public\.presentation_set_items/);
    expect(n22).not.toMatch(/delete from public\.operational_documents/);
    expect(n22).not.toMatch(/delete from public\.document_versions/);
  });

  it('does not rewrite 00008 or 00021 and does not add client DELETE policies', () => {
    expect(read(FILE_00008)).not.toMatch(/storage\.allow_delete_query/);
    expect(sql00021).toMatch(/do not rewrite 00008/i);
    expect(sql00022).toMatch(/do not rewrite 00008 or 00021/i);
    expect(n22).not.toMatch(/create policy/);
    expect(n22).not.toMatch(/drop policy/);
    expect(n22).not.toMatch(/for delete/);
    expect(n22).not.toMatch(/alter table/);
    expect(n22).not.toMatch(/drop constraint/);
    expect(n22).not.toMatch(/on delete cascade/);
  });
});

describe('IR-R3 — historical NO ACTION FKs are not rewritten', () => {
  it('keeps carrier_packet_items OperationalDocument and DocumentVersion FKs non-cascading', () => {
    expect(sql00016).toMatch(
      /foreign key \(operational_document_id, owner_id\)\s+references operational_documents \(id, owner_id\)/,
    );
    expect(sql00016).not.toMatch(
      /foreign key \(operational_document_id, owner_id\)\s+references operational_documents \(id, owner_id\) on delete cascade/,
    );
    expect(sql00016).toMatch(
      /foreign key \(document_version_id, operational_document_id, owner_id\)\s+references document_versions \(id, operational_document_id, owner_id\)/,
    );
    expect(sql00016).not.toMatch(
      /foreign key \(document_version_id, operational_document_id, owner_id\)\s+references document_versions \(id, operational_document_id, owner_id\) on delete cascade/,
    );
    expect(sql00016).toMatch(
      /foreign key \(carrier_packet_id, owner_id\)\s+references carrier_packets \(id, owner_id\) on delete cascade/,
    );
  });

  it('keeps presentation_set_items OperationalDocument FK non-cascading and set parent cascading', () => {
    expect(sql00015).toMatch(
      /foreign key \(operational_document_id, owner_id\)\s+references operational_documents \(id, owner_id\)/,
    );
    expect(sql00015).not.toMatch(
      /foreign key \(operational_document_id, owner_id\)\s+references operational_documents \(id, owner_id\) on delete cascade/,
    );
    expect(sql00015).toMatch(
      /foreign key \(presentation_set_id, owner_id\)\s+references presentation_sets \(id, owner_id\) on delete cascade/,
    );
  });
});
