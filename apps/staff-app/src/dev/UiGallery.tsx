import { PublicSettingsProvider, type PublicSettings } from '@rms/shared';
import { applyDensity, applyTheme, Button, UiProvider, type Density } from '@rms/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import i18n from '../i18n';
import devEn from './locales/en/dev.json';
import { ButtonsSection, FieldsSection } from './sections/FormControls';
import { DisplaySection } from './sections/Display';
import { DomainSection } from './sections/Domain';
import { OverlaysSection } from './sections/Overlays';

// Development-only screen (/dev/ui). main.tsx loads it only when import.meta.env.DEV, and
// `pnpm size` fails the build if this marker ever reaches a production bundle.
const DEV_ONLY_MARKER = 'rms-dev-only';

i18n.addResourceBundle('en', 'dev', devEn);

// Demo settings for the gallery only (fake values, as in seed.sql). Real screens get settings
// from the get_settings RPC through the same provider (T8).
const demoSettings: PublicSettings = {
  restaurantName: 'Ember Kitchen (Demo)',
  currencyCode: 'PKR',
  currencyMinorUnits: 2,
  taxBps: 1600,
  serviceChargeBps: 500,
  receiptFooter: null,
};

type ThemeOption = 'light' | 'dark';
type DirOption = 'ltr' | 'rtl';

// Options come from the URL too (?theme=dark&dir=rtl&density=desk), so screenshots and the
// axe check can open each combination directly.
function readOption<T extends string>(name: string, options: readonly T[], fallback: T): T {
  const value = new URLSearchParams(window.location.search).get(name);
  return options.find((option) => option === value) ?? fallback;
}

function Toggle<T extends string>({
  label,
  options,
  value,
  onChange,
  optionLabel,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  optionLabel: (value: T) => string;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2">
      <span className="text-sm font-medium text-fg-muted">{label}</span>
      {options.map((option) => (
        <Button
          key={option}
          size="sm"
          variant={option === value ? 'primary' : 'outline'}
          aria-pressed={option === value}
          onClick={() => {
            onChange(option);
          }}
        >
          {optionLabel(option)}
        </Button>
      ))}
    </div>
  );
}

export default function UiGallery() {
  const { t } = useTranslation('dev');
  const [theme, setTheme] = useState<ThemeOption>(() =>
    readOption('theme', ['light', 'dark'], 'light'),
  );
  const [dir, setDir] = useState<DirOption>(() => readOption('dir', ['ltr', 'rtl'], 'ltr'));
  const [density, setDensity] = useState<Density>(() =>
    readOption('density', ['touch', 'display', 'desk'], 'touch'),
  );

  useEffect(() => {
    applyTheme(theme, { persist: false });
    document.documentElement.dir = dir;
    applyDensity(density);
    const params = new URLSearchParams({ theme, dir, density });
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, [theme, dir, density]);

  return (
    <PublicSettingsProvider value={{ settings: demoSettings, loading: false }}>
      <UiProvider dir={dir}>
        <div data-dev-only={DEV_ONLY_MARKER} className="min-h-dvh bg-bg text-fg">
          <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
              <h1 className="me-auto text-lg font-semibold tracking-tight">{t('title')}</h1>
              <Toggle<ThemeOption>
                label={t('toolbar.theme')}
                options={['light', 'dark']}
                value={theme}
                onChange={setTheme}
                optionLabel={(value) => t(`toolbar.${value}`)}
              />
              <Toggle<DirOption>
                label={t('toolbar.direction')}
                options={['ltr', 'rtl']}
                value={dir}
                onChange={setDir}
                optionLabel={(value) => t(`toolbar.${value}`)}
              />
              <Toggle<Density>
                label={t('toolbar.density')}
                options={['touch', 'display', 'desk']}
                value={density}
                onChange={setDensity}
                optionLabel={(value) => t(`toolbar.${value}`)}
              />
            </div>
          </header>
          <main className="mx-auto max-w-5xl space-y-10 px-4 py-8">
            <p className="text-fg-muted">{t('intro')}</p>
            <ButtonsSection />
            <FieldsSection />
            <OverlaysSection />
            <DisplaySection />
            <DomainSection />
          </main>
        </div>
      </UiProvider>
    </PublicSettingsProvider>
  );
}
