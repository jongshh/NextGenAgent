create table if not exists public.mentor_voice_profiles (
  agent_id text primary key,
  provider text not null default 'openai-live',
  model text not null default 'gpt-live-1',
  voice_id text not null,
  speaking_instructions text not null default '',
  activation_mode text not null default 'tap_vad',
  eagerness text not null default 'auto',
  preview_text text not null default '',
  enabled boolean not null default true,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint mentor_voice_profiles_agent check (agent_id in ('pathfinder', 'creator', 'thinker', 'connector')),
  constraint mentor_voice_profiles_provider check (provider = 'openai-live'),
  constraint mentor_voice_profiles_voice check (voice_id in ('alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar')),
  constraint mentor_voice_profiles_activation check (activation_mode in ('tap_vad', 'wake_prefix', 'push_to_talk')),
  constraint mentor_voice_profiles_eagerness check (eagerness in ('low', 'auto', 'high')),
  constraint mentor_voice_profiles_version check (version > 0)
);

alter table public.mentor_voice_profiles enable row level security;
revoke all on table public.mentor_voice_profiles from anon, authenticated;
grant all on table public.mentor_voice_profiles to service_role;

insert into public.mentor_voice_profiles
  (agent_id, voice_id, speaking_instructions, preview_text)
values
  ('pathfinder', 'cedar', '차분하고 든든하게, 생각할 여유를 주며 말한다.', '반가워요. 서두르지 말고, 지금 마음에 있는 이야기부터 들려주세요.'),
  ('creator', 'coral', '생동감 있고 따뜻하게, 창작의 에너지를 살려 말한다.', '반가워요. 서두르지 말고, 지금 마음에 있는 이야기부터 들려주세요.'),
  ('thinker', 'marin', '낮고 침착한 호흡으로, 문장 사이에 생각할 틈을 둔다.', '반가워요. 서두르지 말고, 지금 마음에 있는 이야기부터 들려주세요.'),
  ('connector', 'verse', '친근하고 명료하게, 사람과 기술을 이어주듯 말한다.', '반가워요. 서두르지 말고, 지금 마음에 있는 이야기부터 들려주세요.')
on conflict (agent_id) do nothing;

comment on table public.mentor_voice_profiles is
  'Server-only GPT-Live voice profiles for the four AI mentors.';
