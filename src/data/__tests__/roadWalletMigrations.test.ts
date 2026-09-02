/**
 * Static assertions over the Road Wallet migrations (Pass 1A + 1A.1). A live
 * Postgres is not available in this environment (CLEAN_BOOTSTRAP and
 * TWO_USER_RLS remain evidence gaps), so these tests pin the *declared* policy
 * and constraint semantics that independent DB review must confirm.
 */

// Node fs, required lazily + typed locally (the app tsconfig loads no Node types).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require('node:fs') as { readFileSync(path: string, enc: string): string };

const read = (name: string) => nodeFs.readFileSync(`supabase/migrations/${name}`, 'utf8');
const stripComments = (sql: string) => sql.replace(/--.*$/gm, '');
const normalize = (sql: string) => stripComments(sql).replace(/\s+/g, ' ').toLowerCase();

const core = normalize(read('20260902000013_road_wallet_core.sql'));
const hardening = normalize(read('20260902000014_road_wallet_integrity_hardening.sql'));
const sets = normalize(read('20260902000015_quick_present_sets.sql'));
const deletion = normalize(read('20260719000008_account_deletion.sql'));

/** Policies declared for a table across the given SQL: [name, command]. */
function policiesFor(sql: string, table: string): [string, string][] {
  const re = new RegExp(
    `create policy "([^"]+)" on ${table} for (select|insert|update|delete|all) to authenticated`,
    'g',
  );
  const out: [string, string][] = [];
  for (const m of sql.matchAll(re)) out.push([m[1], m[2]]);
  return out;
}
function droppedPolicies(sql: string, table: string): string[] {
  const re = new RegExp(`drop policy if exists "([^"]+)" on ${table}`, 'g');
  return [...sql.matchAll(re)].map((m) => m[1]);
}

describe('H1 — operational_documents RLS after hardening', () => {
  it('00013 declared the broad own-rows policy and 00014 drops it', () => {
    expect(policiesFor(core, 'operational_documents')).toEqual([['own rows', 'all']]);
    expect(droppedPolicies(hardening, 'operational_documents')).toEqual(['own rows']);
  });

  it('00014 grants the owner SELECT, INSERT and UPDATE only — no client DELETE', () => {
    const policies = policiesFor(hardening, 'operational_documents');
    expect(policies.map(([, cmd]) => cmd).sort()).toEqual(['insert', 'select', 'update']);
    expect(policies.map(([, cmd]) => cmd)).not.toContain('delete');
    expect(policies.map(([, cmd]) => cmd)).not.toContain('all');
    for (const [, cmd] of policies) {
      const clause = cmd === 'insert' ? 'with check' : 'using';
      expect(hardening).toMatch(
        new RegExp(
          `on operational_documents for ${cmd} to authenticated ${clause} \\(owner_id = \\(select auth\\.uid\\(\\)\\)\\)`,
        ),
      );
    }
  });

  it('archive remains the ordinary lifecycle exit (lifecycle column with ARCHIVED, no delete path)', () => {
    expect(core).toMatch(
      /lifecycle text not null default 'active' check \(lifecycle in \('active', 'archived'\)\)/,
    );
    expect(hardening).not.toMatch(/on operational_documents for delete/);
  });
});

describe('H1 — document_versions stays append-only', () => {
  it('has SELECT own + INSERT own and no UPDATE/DELETE/ALL policy anywhere', () => {
    const all = [
      ...policiesFor(core, 'document_versions'),
      ...policiesFor(hardening, 'document_versions'),
    ];
    expect(all.map(([, cmd]) => cmd).sort()).toEqual(['insert', 'select']);
    expect(core + hardening).not.toMatch(/on document_versions for (update|delete|all)/);
  });

  it('still cascades from the parent document and the auth user (account deletion path)', () => {
    expect(core).toMatch(/owner_id uuid not null references auth\.users \(id\) on delete cascade/);
    expect(core).toMatch(
      /foreign key \(operational_document_id, owner_id\) references operational_documents \(id, owner_id\) on delete cascade/,
    );
  });
});

describe('account deletion architecture is untouched', () => {
  it('delete_current_account still sweeps the three buckets and deletes the auth user', () => {
    expect(deletion).toMatch(/security definer/);
    expect(deletion).toMatch(/bucket_id in \('receipts', 'documents', 'reports'\)/);
    expect(deletion).toMatch(/delete from auth\.users where id = v_uid/);
  });

  it('00014 defines no functions and no SECURITY DEFINER code', () => {
    expect(hardening).not.toMatch(/create (or replace )?function/);
    expect(hardening).not.toMatch(/security definer/);
    expect(hardening).not.toMatch(/delete_current_account/);
  });
});

describe('H4 — same-owner truck association at the database', () => {
  it('adds a composite owner-aware FK with column-scoped SET NULL and drops the single-column FK', () => {
    expect(hardening).toMatch(
      /alter table trucks add constraint trucks_id_owner_unique unique \(id, owner_id\)/,
    );
    expect(hardening).toMatch(/drop constraint if exists operational_documents_truck_id_fkey/);
    expect(hardening).toMatch(
      /foreign key \(truck_id, owner_id\) references trucks \(id, owner_id\) on delete set null \(truck_id\)/,
    );
  });

  it('does not touch trucks row-level security', () => {
    expect(hardening).not.toMatch(/on trucks for/);
    expect(hardening).not.toMatch(/alter table trucks (enable|disable) row level security/);
  });
});

describe('H5 — fixed sensitivity for known kinds (DB CHECK mirrors the domain rule)', () => {
  it('constrains each known-sensitive kind to its class and leaves others configurable', () => {
    expect(hardening).toMatch(
      /add constraint operational_documents_sensitivity_for_kind_check check/,
    );
    for (const kind of ['cdl', 'medical_document', 'twic']) {
      expect(hardening).toMatch(
        new RegExp(`when '${kind}' then sensitivity = 'personal_sensitive'`),
      );
    }
    for (const kind of ['w9', 'factoring_noa', 'banking_document', 'lease_agreement']) {
      expect(hardening).toMatch(
        new RegExp(`when '${kind}' then sensitivity = 'financial_sensitive'`),
      );
    }
    expect(hardening).toMatch(/else true end/);
  });
});

describe('Pass 2 — presentation_sets / items (00015)', () => {
  it('stores CUSTOM sets only, opaque text PKs, name 1–80, ACTIVE|ARCHIVED', () => {
    expect(sets).toMatch(/create table presentation_sets/);
    expect(sets).toMatch(/set_kind text not null check \(set_kind = 'custom'\)/);
    expect(sets).toMatch(/char_length\(name\) between 1 and 80/);
    expect(sets).toMatch(/lifecycle text not null default 'active' check \(lifecycle in \('active', 'archived'\)\)/);
    expect(sets).toMatch(/unique \(id, owner_id\)/);
    expect(sets).toMatch(/id text primary key check \(id ~ '\^\[a-za-z0-9_-\]\{8,64\}\$'\)/);
  });

  it('items reference same-owner set and operational document; no client DELETE', () => {
    expect(sets).toMatch(/unique \(presentation_set_id, operational_document_id\)/);
    expect(sets).toMatch(
      /foreign key \(presentation_set_id, owner_id\) references presentation_sets \(id, owner_id\) on delete cascade/,
    );
    expect(sets).toMatch(
      /foreign key \(operational_document_id, owner_id\) references operational_documents \(id, owner_id\)/,
    );
    expect(policiesFor(sets, 'presentation_sets').map(([, cmd]) => cmd).sort()).toEqual([
      'insert',
      'select',
      'update',
    ]);
    expect(policiesFor(sets, 'presentation_set_items').map(([, cmd]) => cmd).sort()).toEqual([
      'insert',
      'select',
      'update',
    ]);
    expect(sets).not.toMatch(/on presentation_sets for delete/);
    expect(sets).not.toMatch(/on presentation_set_items for delete/);
    expect(sets).not.toMatch(/service_role|security definer/);
  });
});

describe('frozen Pass 1A schema contracts remain in 00013', () => {
  it('opaque text ids, documents bucket only, deterministic storage_path, sha256 shape', () => {
    expect(core).toMatch(/id text primary key check \(id ~ '\^\[a-za-z0-9_-\]\{8,64\}\$'\)/);
    expect(core).toMatch(/storage_bucket text not null check \(storage_bucket = 'documents'\)/);
    expect(core).toMatch(/sha256 text not null check \(sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(core).toMatch(/unique \(operational_document_id, version_number\)/);
    expect(core).not.toMatch(/original_filename|local_path|ocr_text|compliant/);
  });
});
