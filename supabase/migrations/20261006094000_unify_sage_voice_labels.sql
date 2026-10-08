-- Preserve selected voices and custom instructions while standardizing the role name.
update public.mentor_voice_profiles
set speaking_instructions = replace(speaking_instructions, '선배', '현자'),
    version = version + 1,
    updated_at = now()
where speaking_instructions like '%선배%';
