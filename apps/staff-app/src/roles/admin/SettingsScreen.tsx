import { zodResolver } from '@hookform/resolvers/zod';
import { amountToInput } from '@rms/shared';
import { Button, ErrorState, SkeletonList, toast } from '@rms/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { ErrorLine, SelectField } from '../../dialogs/ReasonDialog';
import { useConnection } from '../../shell/connection-context';
import { adminKeys, adminRpc, settingsQuery, type AdminSettings } from './data';
import {
  bpsToPercent,
  changedSettings,
  settingsFormSchema,
  toSettingsChanges,
  type SettingsForm,
} from './forms';
import { adminPaths } from './paths';
import { useAdminAction } from './action';
import { FormSection, PageHeader, SaveBar, SwitchField, TextField } from './ui';

const roundingModes = ['half_up', 'half_even', 'up', 'down'] as const;
const pricingRules = [
  'prices_include_tax',
  'discount_reduces_charges',
  'service_charge_on_dine_in',
  'service_charge_on_take_away',
  'service_charge_on_delivery',
  'tax_on_service_charge',
] as const;

/** Time zones the browser knows (the server checks the name again). */
function timeZones(current: string): string[] {
  const zones =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return zones.includes(current) ? zones : [current, ...zones];
}

function formOf(s: AdminSettings): SettingsForm {
  const minor = s.currency_minor_units;
  return {
    restaurant_name: s.restaurant_name,
    address: s.address ?? '',
    phone: s.phone ?? '',
    receipt_footer: s.receipt_footer ?? '',
    tax_registration_number: s.tax_registration_number ?? '',
    currency_code: s.currency_code,
    currency_minor_units: String(minor),
    timezone: s.timezone,
    day_cutoff_time: s.day_cutoff_time.slice(0, 5),
    tax_percent: bpsToPercent(s.tax_bps ?? 0),
    service_charge_percent: bpsToPercent(s.service_charge_bps ?? 0),
    prices_include_tax: s.prices_include_tax ?? false,
    discount_reduces_charges: s.discount_reduces_charges ?? true,
    service_charge_on_dine_in: s.service_charge_on_dine_in ?? true,
    service_charge_on_take_away: s.service_charge_on_take_away ?? false,
    service_charge_on_delivery: s.service_charge_on_delivery ?? false,
    tax_on_service_charge: s.tax_on_service_charge ?? false,
    rounding_mode: s.rounding_mode ?? 'half_up',
    rounding_unit: amountToInput(s.rounding_unit_minor ?? 1, minor),
    kitchen_warn_min: String(s.kitchen_warn_min),
    kitchen_late_min: String(s.kitchen_late_min),
  };
}

function Editor({ saved }: { saved: AdminSettings }) {
  const { t } = useTranslation(['admin', 'rpc']);
  const { canSend } = useConnection();
  const queryClient = useQueryClient();
  const minor = saved.currency_minor_units;
  const zones = useMemo(() => timeZones(saved.timezone), [saved.timezone]);
  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsFormSchema(minor)),
    defaultValues: formOf(saved),
  });
  const { register, control, handleSubmit, formState, reset } = form;

  const save = useAdminAction(
    adminRpc.updateSettings,
    adminKeys.settings,
    useCallback(
      async (result: AdminSettings) => {
        // Every screen's header and receipt read the shell's settings: refresh them too.
        await queryClient.refetchQueries({ queryKey: ['settings'] });
        reset(formOf(result));
        toast.success(t('admin:settings.saved'));
      },
      [queryClient, reset, t],
    ),
  );

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(event) => {
        void handleSubmit((values) => {
          const changes = changedSettings(toSettingsChanges(values, minor), saved);
          return save.run(changes);
        })(event);
      }}
    >
      <PageHeader
        title={t('admin:settings.title')}
        description={t('admin:settings.description')}
        actions={
          <Button variant="outline" asChild>
            <Link to={adminPaths.billCheck}>
              <Calculator aria-hidden />
              {t('admin:billCheck.title')}
            </Link>
          </Button>
        }
      />
      <div className="mx-auto max-w-2xl space-y-6">
        <FormSection
          title={t('admin:settings.restaurant')}
          description={t('admin:settings.restaurantBody')}
        >
          <TextField
            label={t('admin:settings.name')}
            autoComplete="off"
            error={formState.errors.restaurant_name}
            {...register('restaurant_name')}
          />
          <TextField
            label={t('admin:settings.address')}
            multiline
            error={formState.errors.address}
            {...register('address')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('admin:settings.phone')}
              type="tel"
              autoComplete="off"
              error={formState.errors.phone}
              {...register('phone')}
            />
            <TextField
              label={t('admin:settings.taxNumber')}
              autoComplete="off"
              hint={t('admin:settings.taxNumberHint')}
              error={formState.errors.tax_registration_number}
              {...register('tax_registration_number')}
            />
          </div>
          <TextField
            label={t('admin:settings.footer')}
            multiline
            hint={t('admin:settings.footerHint')}
            error={formState.errors.receipt_footer}
            {...register('receipt_footer')}
          />
        </FormSection>

        <FormSection title={t('admin:settings.money')} description={t('admin:settings.moneyBody')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('admin:settings.currency')}
              autoComplete="off"
              maxLength={3}
              error={formState.errors.currency_code}
              {...register('currency_code')}
            />
            <TextField
              label={t('admin:settings.decimals')}
              inputMode="numeric"
              autoComplete="off"
              error={formState.errors.currency_minor_units}
              {...register('currency_minor_units')}
            />
          </div>
          <p className="text-sm text-fg-muted">{t('admin:settings.currencyHint')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('admin:settings.tax')}
              inputMode="decimal"
              autoComplete="off"
              error={formState.errors.tax_percent}
              {...register('tax_percent')}
            />
            <TextField
              label={t('admin:settings.serviceCharge')}
              inputMode="decimal"
              autoComplete="off"
              error={formState.errors.service_charge_percent}
              {...register('service_charge_percent')}
            />
          </div>
        </FormSection>

        <FormSection title={t('admin:settings.rules')} description={t('admin:settings.rulesBody')}>
          {pricingRules.map((rule) => (
            <Controller
              key={rule}
              control={control}
              name={rule}
              render={({ field }) => (
                <SwitchField
                  label={t(`admin:settings.rule.${rule}`)}
                  hint={t(`admin:settings.ruleHint.${rule}`)}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          ))}
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="rounding_mode"
              render={({ field }) => (
                <SelectField
                  label={t('admin:settings.roundingMode')}
                  value={field.value}
                  onChange={field.onChange}
                >
                  {roundingModes.map((mode) => (
                    <option key={mode} value={mode}>
                      {t(`admin:settings.rounding.${mode}`)}
                    </option>
                  ))}
                </SelectField>
              )}
            />
            <TextField
              label={t('admin:settings.roundingUnit', { currency: saved.currency_code })}
              inputMode="decimal"
              autoComplete="off"
              hint={t('admin:settings.roundingUnitHint')}
              error={formState.errors.rounding_unit}
              {...register('rounding_unit')}
            />
          </div>
        </FormSection>

        <FormSection title={t('admin:settings.day')} description={t('admin:settings.dayBody')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="timezone"
              render={({ field }) => (
                <SelectField
                  label={t('admin:settings.timezone')}
                  value={field.value}
                  onChange={field.onChange}
                >
                  {zones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </SelectField>
              )}
            />
            <TextField
              label={t('admin:settings.cutoff')}
              type="time"
              hint={t('admin:settings.cutoffHint')}
              error={formState.errors.day_cutoff_time}
              {...register('day_cutoff_time')}
            />
          </div>
        </FormSection>

        <FormSection
          title={t('admin:settings.kitchen')}
          description={t('admin:settings.kitchenBody')}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('admin:settings.warn')}
              inputMode="numeric"
              autoComplete="off"
              error={formState.errors.kitchen_warn_min}
              {...register('kitchen_warn_min')}
            />
            <TextField
              label={t('admin:settings.late')}
              inputMode="numeric"
              autoComplete="off"
              error={formState.errors.kitchen_late_min}
              {...register('kitchen_late_min')}
            />
          </div>
        </FormSection>
        <ErrorLine error={save.error} />
      </div>
      <SaveBar
        summary={
          <p className="text-sm text-fg-muted">
            {formState.isDirty ? t('admin:settings.unsaved') : t('admin:settings.upToDate')}
          </p>
        }
      >
        <Button
          variant="ghost"
          disabled={!formState.isDirty}
          onClick={() => {
            reset(formOf(saved));
          }}
        >
          {t('admin:settings.undo')}
        </Button>
        <Button type="submit" loading={save.pending} disabled={!canSend || !formState.isDirty}>
          {t('admin:save')}
        </Button>
      </SaveBar>
    </form>
  );
}

/** Settings (M2): every business value; nothing is hard-coded in the app. */
export function SettingsScreen() {
  const { t } = useTranslation(['admin']);
  const settings = useQuery(settingsQuery);
  if (settings.isPending) return <SkeletonList rows={10} />;
  if (settings.isError) {
    return (
      <ErrorState
        title={t('admin:loadFailed')}
        description={t('admin:loadFailedBody')}
        retryLabel={t('admin:retry')}
        onRetry={() => void settings.refetch()}
      />
    );
  }
  return <Editor saved={settings.data} />;
}
