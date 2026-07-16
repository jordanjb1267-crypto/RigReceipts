-- RigReceipts V2 — storage buckets (Master Build Prompt §6):
--   receipts  — receipt images
--   documents — BOL/POD/load documents, permits, inspections
--   reports   — generated PDF/CSV exports
-- All private; objects live under a per-user folder: {auth.uid()}/...

insert into storage.buckets (id, name, public)
values
  ('receipts', 'receipts', false),
  ('documents', 'documents', false),
  ('reports', 'reports', false)
on conflict (id) do nothing;

do $$
declare
  b text;
begin
  foreach b in array array['receipts', 'documents', 'reports']
  loop
    execute format(
      'create policy %I on storage.objects for all to authenticated '
      || 'using (bucket_id = %L and (storage.foldername(name))[1] = (select auth.uid())::text) '
      || 'with check (bucket_id = %L and (storage.foldername(name))[1] = (select auth.uid())::text)',
      b || '_owner_access', b, b
    );
  end loop;
end;
$$;
