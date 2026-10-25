import { staffLoginEmail } from '@rms/shared';
import { Button, Input, Label, useOnlineStatus } from '@rms/ui';
import { Eye, EyeOff } from 'lucide-react';
import { useId, useRef, useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router';

import { useAuth } from '../auth/auth-context';
import { loginErrorFrom, type LoginError } from '../auth/errors';
import { auth as supabaseAuth } from '../lib/supabase';
import { paths } from '../paths';
import { useScreenAppearance } from '../shell/theme-context';
import { AuthCard, Notice } from './AuthCard';

type Field = 'username' | 'password';

/**
 * Username and password. The username maps to the internal login email (staffLoginEmail).
 * A plain form (no form library) keeps the login bundle small (plan 4.10).
 */
export function LoginScreen() {
  const { t } = useTranslation();
  const auth = useAuth();
  const location = useLocation();
  const online = useOnlineStatus();
  const id = useId();
  const passwordRef = useRef<HTMLInputElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [missing, setMissing] = useState<Field[]>([]);
  const [error, setError] = useState<LoginError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  useScreenAppearance({ density: 'touch' });

  // Signed in (now or already): the guard on "/" picks MFA or the role home.
  if (auth.status === 'signedIn') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? paths.home} replace />;
  }

  const onSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const empty = (
      [
        ['username', username.trim()],
        ['password', password],
      ] as const
    )
      .filter(([, value]) => value === '')
      .map(([field]) => field);
    setMissing(empty);
    setError(null);
    if (empty.length > 0) {
      (empty[0] === 'username' ? usernameRef : passwordRef).current?.focus();
      return;
    }

    const email = staffLoginEmail(username);
    if (!email) {
      // Not a possible username: same message as a wrong one (no hint which part was wrong).
      setError('invalidCredentials');
      return;
    }
    setSubmitting(true);
    const { error: signInError } = await supabaseAuth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) {
      setError(loginErrorFrom(signInError));
      setPassword('');
      passwordRef.current?.focus();
    }
  };

  const fieldError = (field: Field) =>
    missing.includes(field) ? (
      <p id={`${id}-${field}-error`} className="text-sm font-medium text-danger">
        {t('validation.required', { ns: 'ui' })}
      </p>
    ) : null;
  const describedBy = (field: Field) =>
    missing.includes(field) ? `${id}-${field}-error` : undefined;

  return (
    <AuthCard title={t('login.title')} description={t('login.subtitle')}>
      {!online && <Notice tone="warning">{t('login.offline')}</Notice>}
      {!error && auth.endReason && (
        <Notice tone="warning">{t(`login.ended.${auth.endReason}`)}</Notice>
      )}
      {error && <Notice tone="danger">{t(`login.errors.${error}`)}</Notice>}

      <form noValidate className="grid gap-5" onSubmit={(event) => void onSubmit(event)}>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-username`}>{t('login.username')}</Label>
          <Input
            ref={usernameRef}
            id={`${id}-username`}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            aria-invalid={missing.includes('username')}
            aria-describedby={describedBy('username')}
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
            }}
          />
          {fieldError('username')}
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-password`}>{t('login.password')}</Label>
          <div className="relative">
            <Input
              ref={passwordRef}
              id={`${id}-password`}
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              enterKeyHint="go"
              className="pe-14"
              aria-invalid={missing.includes('password')}
              aria-describedby={describedBy('password')}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="absolute end-0.5 top-1/2 size-control-sm -translate-y-1/2"
              aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
              aria-pressed={showPassword}
              onClick={() => {
                setShowPassword((shown) => !shown);
              }}
            >
              {showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            </Button>
          </div>
          {fieldError('password')}
        </div>
        <Button type="submit" size="lg" loading={submitting} disabled={!online}>
          {t('login.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}

export { LoginScreen as Component };
