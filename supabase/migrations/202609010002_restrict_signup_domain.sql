-- Bloqueia novos cadastros fora do domínio corporativo.
-- Contas já existentes não são alteradas, preservando administradores externos.
create or replace function public.hook_restrict_signup_to_suzano(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  signup_email text := lower(coalesce(event->'user'->>'email', ''));
begin
  if signup_email !~ '^[^@]+@suzano\.com\.br$' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Novos cadastros são permitidos somente com e-mail @suzano.com.br.'
      )
    );
  end if;
  return '{}'::jsonb;
end;
$$;

grant execute on function public.hook_restrict_signup_to_suzano(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup_to_suzano(jsonb) from public, anon, authenticated;
