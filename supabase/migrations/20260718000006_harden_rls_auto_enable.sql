-- Hygiene per security advisor: the platform-provided rls_auto_enable() event
-- trigger function should not be executable through the Data API. Revoking
-- EXECUTE does not affect the event trigger itself.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
