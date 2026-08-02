create table if not exists public.participant_sessions (
  participant_key text primary key,
  session_data jsonb not null default '{"version":1,"sessions":{}}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint participant_sessions_key_format check (participant_key ~ '^[a-f0-9]{64}$'),
  constraint participant_sessions_data_is_object check (jsonb_typeof(session_data) = 'object')
);

alter table public.participant_sessions enable row level security;

revoke all on table public.participant_sessions from anon, authenticated;
grant all on table public.participant_sessions to service_role;

comment on table public.participant_sessions is
  'Passwordless demo sessions keyed by a SHA-256 digest of the participant ID. Access only through session-api.';
