// Loaded only inside the signed-in shell: importing it ties the modules this screen shares with
// the shell (data client, status check, UI) to the shell chunk instead of splitting them into
// shared chunks the shell would download as extra files (plan 4.10 budgets).
import '../shell/SignedIn';

import { Button, Input, Label, toast } from '@rms/ui';
import { useQueryClient } from '@tanstack/react-query';
import i18n from 'i18next';
import { Check, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useAuth } from '../auth/auth-context';
import enAccount from '../i18n/locales/en/account.json';
import { newRequestId } from '../lib/request-id';
import { supabaseKey, supabaseUrl } from '../lib/env';
import { accessToken } from '../lib/supabase';
import { paths } from '../paths';
import { accountKey, useStaffStatus } from '../shell/useStaffStatus';
import { AuthCard, Notice } from './AuthCard';
import { checkPassword, passwordOk, usernameOf, type PasswordCheck } from './password-rules';

// This screen's strings load with it, not with the signed-in shell (plan 4.10).
i18n.addResourceBundle('en', 'account', enAccount, true, false);

type ErrorCode = keyof typeof enAccount.error;
const knownErrors = new Set(Object.keys(enAccount.error));

/**
 * Own password (S6): every staff member can change it from the account menu, and a new or
 * reset account must change its temporary password here before any other screen (the server
 * refuses every call until then: PASSWORD_CHANGE_REQUIRED). The `account` Edge Function
 * checks the current password, sets the new one, ends the person's other sessions and keeps
 * this one signed in. One request id per attempt, kept for retries (BR-15).
 */
export function ChangePasswordScreen() {
  const { t } = useTranslation(['account']);
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useStaffStatus();
  const forced = status.account?.password_change === true;
  const ids = { current: useId(), next: useId(), confirm: useId(), rules: useId() };
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<ErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);

  const check = checkPassword({
    next,
    confirm,
    current,
    username: usernameOf(auth.session?.user.email),
  });

  async function submit() {
    if (busy || !passwordOk(check) || current === '') return;
    setBusy(true);
    setError(null);
    requestId.current ??= newRequestId();
    try {
      const token = await accessToken();
      const response = await fetch(`${supabaseUrl}/functions/v1/account`, {
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          action: 'change_password',
          request_id: requestId.current,
          current_password: current,
          new_password: next,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
        const code = typeof body?.error === 'string' ? body.error : 'unknown';
        // A rule or the current password: a new attempt gets a new request id.
        requestId.current = null;
        setError(knownErrors.has(code) ? (code as ErrorCode) : 'unknown');
        return;
      }
      requestId.current = null;
      await queryClient.refetchQueries({ queryKey: accountKey });
      toast.success(t('account:changed'));
      void navigate(paths.home, { replace: true });
    } catch {
      // The answer may be lost: the same request id on the next try is a replay.
      setError('network');
    } finally {
      setBusy(false);
    }
  }

  const rule = (ok: boolean, label: string) => (
    <li
      className={
        ok ? 'flex items-center gap-2 text-success' : 'flex items-center gap-2 text-fg-muted'
      }
    >
      {ok ? <Check aria-hidden className="size-4" /> : <X aria-hidden className="size-4" />}
      <span>
        {label}
        <span className="sr-only">{ok ? t('account:ruleMet') : t('account:ruleNotMet')}</span>
      </span>
    </li>
  );
  const rules = (c: PasswordCheck) => (
    <ul id={ids.rules} className="grid gap-1 text-sm">
      {rule(c.long && c.notTooLong, t('account:ruleLength'))}
      {rule(c.notCurrent, t('account:ruleNotCurrent'))}
      {rule(c.noUsername, t('account:ruleNoUsername'))}
      {rule(c.matches, t('account:ruleMatch'))}
    </ul>
  );

  return (
    <AuthCard
      title={forced ? t('account:forcedTitle') : t('account:title')}
      description={forced ? t('account:forcedBody') : t('account:body')}
    >
      {error && <Notice tone="danger">{t(`account:error.${error}`)}</Notice>}
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor={ids.current}>
            {forced ? t('account:currentTemporary') : t('account:current')}
          </Label>
          <Input
            id={ids.current}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => {
              setCurrent(event.target.value);
            }}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={ids.next}>{t('account:new')}</Label>
          <Input
            id={ids.next}
            type="password"
            autoComplete="new-password"
            aria-describedby={ids.rules}
            value={next}
            onChange={(event) => {
              setNext(event.target.value);
            }}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={ids.confirm}>{t('account:confirm')}</Label>
          <Input
            id={ids.confirm}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => {
              setConfirm(event.target.value);
            }}
          />
        </div>
        {rules(check)}
        <Button
          type="submit"
          size="lg"
          loading={busy}
          // Not tied to the Realtime connection: it refuses a pending password change itself.
          disabled={current === '' || !passwordOk(check)}
        >
          {t('account:save')}
        </Button>
        {forced ? (
          <Button
            variant="ghost"
            onClick={() => {
              void auth.signOut();
            }}
          >
            {t('account:signOut')}
          </Button>
        ) : (
          <Button
            variant="ghost"
            onClick={() => {
              void navigate(-1);
            }}
          >
            {t('account:cancel')}
          </Button>
        )}
      </form>
    </AuthCard>
  );
}

export { ChangePasswordScreen as Component };
