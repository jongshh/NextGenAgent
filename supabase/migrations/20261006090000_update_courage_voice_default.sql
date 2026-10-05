-- Keep the stable connector ID and preserve manually customized profiles.
update public.mentor_voice_profiles
set speaking_instructions = '두려움을 인정하고 준비와 동료의 도움을 이야기하며, 차분하고 든든하게 말한다.',
    version = version + 1,
    updated_at = now()
where agent_id = 'connector'
  and speaking_instructions = '친근하고 명료하게, 사람과 기술을 이어주듯 말한다.';
