-- Hygiene per security advisor: the platform-provided rls_auto_enable() event
-- trigger function should not be executable through the Data API. Revoking
-- EXECUTE does not affect the event trigger itself.
--
-- IR-R2 historical compatibility (runtime-proven): hosted Supabase provides
-- public.rls_auto_enable(); disposable local Postgres images do not. An
-- unconditional REVOKE aborts CLEAN_BOOTSTRAP (SQLSTATE 42883). When the
-- function exists the exact prior REVOKE still runs. When it is absent this
-- migration no-ops. It does not create the function or an event trigger.
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    EXECUTE
      'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  END IF;
END
$$;
