-- A guest who signs up keeps their account: the page adds an email + password to the
-- anonymous user instead of creating a new one. handle_new_user() only fills profiles on
-- insert, so copy the email and sign-up details across when they change.
create function public.sync_profile_from_auth() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m jsonb := new.raw_user_meta_data;
begin
  update public.profiles p set
    email = new.email,
    phone = coalesce(m->>'phone', p.phone),
    gender = coalesce(m->>'gender', p.gender),
    organization = coalesce(m->>'organization', p.organization),
    accepted_terms = coalesce((m->>'accepted_terms')::boolean, p.accepted_terms),
    accepted_terms_at = case when (m->>'accepted_terms')::boolean and p.accepted_terms_at is null
                             then now() else p.accepted_terms_at end
  where p.id = new.id;
  return new;
end $$;
create trigger on_auth_user_updated after update of email, raw_user_meta_data on auth.users
  for each row when (old.email is distinct from new.email
                     or old.raw_user_meta_data is distinct from new.raw_user_meta_data)
  execute function public.sync_profile_from_auth();

-- Guests older than p_days, with every file they have in storage, for the worker to delete
-- (storage files can't be removed from SQL, so it goes through the storage API, then
-- deletes the user, which cascades to profiles, datasets, runs, fish, species_counts).
-- Guests with a video still queued or processing are left for the next pass.
create function public.expired_guests(p_days int default 7) returns json
language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
           'user_id', u.id,
           'paths', (select coalesce(json_agg(o.name), '[]'::json) from storage.objects o
                      where o.bucket_id = 'datasets' and o.name like u.id::text || '/%'))), '[]'::json)
    from (select id from auth.users u
           where u.is_anonymous and u.created_at < now() - make_interval(days => p_days)
             and not exists (select 1 from public.datasets d join public.runs r on r.dataset_id = d.id
                              where d.user_id = u.id and r.status in ('pending', 'processing'))
           limit 100) u
$$;

revoke execute on function public.sync_profile_from_auth(), public.expired_guests(int)
  from public, anon, authenticated;
grant execute on function public.expired_guests(int) to service_role;
