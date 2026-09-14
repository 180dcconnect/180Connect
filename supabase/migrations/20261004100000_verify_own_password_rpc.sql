-- verify_own_password RPC — change password from /settings/profile.
--
-- Schema change approval record (SOP §7):
--   Change        | Add the public.verify_own_password(text) RPC.
--   Reason        | A signed-in user changing their password must first prove they
--                 | know the current one. Without that check, anyone holding a
--                 | session (an unlocked laptop, a stolen cookie) could set a new
--                 | password and — because the change signs out every other
--                 | session — lock the real owner out of their own account.
--   Compatibility | New function only. No table, column, grant or policy changes.
--   Data migration| None.
--   Security      | SECURITY DEFINER so it can read auth.users.encrypted_password,
--                 | which no client role can. Scoped to auth.uid(): the caller
--                 | can only test a guess against their own hash, and the hash
--                 | itself never leaves the database — the function returns a
--                 | boolean. Executable by authenticated only. Guess rate is
--                 | bounded in the app by the F227 per-account login throttle
--                 | (src/app/settings/profile/actions.ts), so a session holder
--                 | brute-forcing this gets the same delays as the login form.
--   Documentation | Function only; no Data Model entity or dictionary change.
--
-- Why not Supabase's own checks: `updateUser({ current_password })` is enforced
-- only when the hosted GoTrue flag
-- GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD is set, which this
-- repo cannot see or pin; and re-running signInWithPassword needs a Turnstile
-- token (auth.captcha is on), which a settings form does not carry.
--
-- Timestamp: dated after 20261004090000, the latest migration in the tree.
--
-- Reversibility: paired rollback in
-- ../rollback/20261004100000_verify_own_password_rpc.down.sql

create or replace function public.verify_own_password(p_password text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_hash  text;
begin
  if v_actor is null then
    raise exception 'verify_own_password requires an authenticated session'
      using errcode = '42501';
  end if;

  -- A deactivated user keeps a JWT until it expires; they must not be able to
  -- use it to keep probing their credential.
  if not (select app.is_active_user()) then
    raise exception 'verify_own_password requires an active user'
      using errcode = '42501';
  end if;

  if p_password is null or p_password = '' then
    return false;
  end if;

  select encrypted_password into v_hash
  from auth.users
  where id = v_actor;

  -- No password set (e.g. an invite never completed): nothing can match.
  if v_hash is null or v_hash = '' then
    return false;
  end if;

  -- GoTrue stores bcrypt hashes; crypt() re-hashes the guess with the stored
  -- salt, so equality means the password matches.
  return v_hash = extensions.crypt(p_password, v_hash);
end;
$$;

comment on function public.verify_own_password(text) is
  'Returns whether p_password is the caller''s current password. SECURITY DEFINER '
  'to read auth.users.encrypted_password; scoped to auth.uid() and returns only a '
  'boolean. Guess rate is bounded in the app by the F227 login throttle.';

-- Same revoke-then-grant as mark_invite_accepted: EXECUTE defaults to public on
-- create and Supabase also default-grants it to anon.
revoke execute on function public.verify_own_password(text) from public;
revoke execute on function public.verify_own_password(text) from anon;
grant execute on function public.verify_own_password(text) to authenticated;
