create table if not exists public.mentor_prompt_configuration (
  id text primary key check (id = 'default'),
  configuration jsonb not null,
  version integer not null check (version > 0),
  updated_at timestamptz not null default now()
);
alter table public.mentor_prompt_configuration enable row level security;
revoke all on public.mentor_prompt_configuration from anon, authenticated;
grant select, insert, update on public.mentor_prompt_configuration to service_role;

create or replace function public.save_mentor_prompt_configuration(p_configuration jsonb, p_expected_version integer)
returns setof public.mentor_prompt_configuration language plpgsql security invoker set search_path = public as $$
begin
  if p_expected_version = 0 then
    return query insert into public.mentor_prompt_configuration (id, configuration, version)
      values ('default', p_configuration, 1) on conflict (id) do nothing returning *;
  else
    return query update public.mentor_prompt_configuration set configuration = p_configuration,
      version = version + 1, updated_at = now()
      where id = 'default' and version = p_expected_version returning *;
  end if;
end;
$$;
revoke all on function public.save_mentor_prompt_configuration(jsonb, integer) from public, anon, authenticated;
grant execute on function public.save_mentor_prompt_configuration(jsonb, integer) to service_role;
