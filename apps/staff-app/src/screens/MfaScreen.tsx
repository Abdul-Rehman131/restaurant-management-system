import { Button, Input, Label, Skeleton } from '@rms/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';

import { needsMfaStep, useAuth } from '../auth/auth-context';
import { auth as supabaseAuth } from '../lib/supabase';
import { paths } from '../paths';
import { useScreenAppearance } from '../shell/theme-context';
import { AuthCard, Notice } from './AuthCard';

interface Enrolment {
  factorId: string;
  qrCode: string;
  secret: string;
}

/**
 * Admin's second step, required (S5). With a verified TOTP factor: enter the code (the session
 * becomes aal2). Without one: set it up first (QR code, key, first code). Recovery when the
 * phone is lost: another Admin, or the factor is removed through Supabase (README).
 */
export function MfaScreen() {
  const { t } = useTranslation();
  const auth = useAuth();
  const navigate = useNavigate();
  const codeId = useId();
  const [code, setCode] = useState('');
  const [error, setError] = useState<'wrongCode' | 'setupFailed' | null>(null);
  const [busy, setBusy] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const started = useRef(false);
  // The one thing to do here: the code field takes focus, so a keyboard user types the code at
  // once instead of tabbing from the top of the page (S6 sweep).
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    codeInput.current?.focus();
  }, []);
  useScreenAppearance({ density: 'touch' });

  const setupMode = !auth.hasVerifiedFactor;

  useEffect(() => {
    if (auth.status !== 'signedIn' || started.current) return;
    started.current = true;
    void (async () => {
      const { data, error: listError } = await supabaseAuth.mfa.listFactors();
      if (listError) {
        setError('setupFailed');
        return;
      }
      // data.totp lists verified TOTP factors only.
      const verified = data.totp[0];
      if (verified) {
        setFactorId(verified.id);
        return;
      }
      // Remove half-finished set-ups, then start a fresh one.
      for (const factor of data.all.filter((f) => f.status === 'unverified')) {
        await supabaseAuth.mfa.unenroll({ factorId: factor.id });
      }
      const { data: enrolled, error: enrolError } = await supabaseAuth.mfa.enroll({
        factorType: 'totp',
      });
      if (enrolError) {
        setError('setupFailed');
        return;
      }
      setFactorId(enrolled.id);
      setEnrolment({
        factorId: enrolled.id,
        qrCode: enrolled.totp.qr_code,
        secret: enrolled.totp.secret,
      });
    })();
  }, [auth.status]);

  if (auth.status === 'signedOut') return <Navigate to={paths.login} replace />;
  if (auth.status === 'signedIn' && !needsMfaStep(auth)) {
    return <Navigate to={paths.home} replace />;
  }

  const verify = async () => {
    if (!factorId) return;
    setBusy(true);
    setError(null);
    const { error: verifyError } = await supabaseAuth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (verifyError) {
      setError('wrongCode');
      setCode('');
      return;
    }
    void navigate(paths.home, { replace: true });
  };

  return (
    <AuthCard
      title={setupMode ? t('mfa.setupTitle') : t('mfa.verifyTitle')}
      description={setupMode ? t('mfa.setupBody') : t('mfa.verifyBody')}
    >
      {error && <Notice tone="danger">{t(`mfa.${error}`)}</Notice>}

      {setupMode && (
        <div className="grid justify-items-center gap-3">
          {enrolment ? (
            <img
              src={enrolment.qrCode}
              alt={t('mfa.qrAlt')}
              width={176}
              height={176}
              className="size-44 rounded-md bg-white p-2"
            />
          ) : (
            <Skeleton className="size-44" />
          )}
          {enrolment && (
            <div className="w-full space-y-1 text-center">
              <p className="text-sm text-fg-muted">{t('mfa.secretLabel')}</p>
              <code className="block rounded-md bg-surface-2 px-3 py-2 text-sm break-all tabular-nums">
                {enrolment.secret}
              </code>
            </div>
          )}
        </div>
      )}

      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void verify();
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor={codeId}>{t('mfa.code')}</Label>
          <Input
            id={codeId}
            ref={codeInput}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            className="text-center text-2xl tracking-[0.4em] tabular-nums"
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, ''));
            }}
          />
        </div>
        <Button type="submit" size="lg" loading={busy} disabled={code.length !== 6 || !factorId}>
          {t('mfa.verify')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            void auth.signOut();
          }}
        >
          {t('mfa.signOut')}
        </Button>
        {!setupMode && <p className="text-center text-sm text-fg-muted">{t('mfa.lostDevice')}</p>}
      </form>
    </AuthCard>
  );
}

export { MfaScreen as Component };
