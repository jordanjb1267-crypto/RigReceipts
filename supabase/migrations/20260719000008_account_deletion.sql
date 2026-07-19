-- Self-service account deletion (App Store 5.1.1(v) / Google Play data deletion).
-- SECURITY DEFINER so it can delete the caller's auth user and stored files;
-- it only ever acts on auth.uid(), so any authenticated user can delete only
-- their own account. Pinned empty search_path; execute revoked from anon/public.
--
-- Deleting auth.users cascades every owner-scoped row (all app tables FK to
-- auth.users on delete cascade). Storage rows are removed explicitly here; for
-- guaranteed physical file removal a future Edge Function can call storage.remove.

create or replace function public.delete_current_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Remove the user's stored files (per-user folder in each private bucket).
  delete from storage.objects
  where bucket_id in ('receipts', 'documents', 'reports')
    and (storage.foldername(name))[1] = v_uid::text;

  -- Deleting the auth user cascades every owner-scoped row (FKs on delete cascade).
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.delete_current_account() from public, anon;
grant execute on function public.delete_current_account() to authenticated;

-- DOWN (manual):
--   drop function if exists public.delete_current_account();
