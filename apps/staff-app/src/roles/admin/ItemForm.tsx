import { zodResolver } from '@hookform/resolvers/zod';
import { amountToInput, usePublicSettings } from '@rms/shared';
import { Button, ErrorState, SkeletonList, toast } from '@rms/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';

import { ErrorLine, SelectField } from '../../dialogs/ReasonDialog';
import { newRequestId } from '../../lib/request-id';
import { useConnection } from '../../shell/connection-context';
import { adminKeys, adminRpc, menuQuery, uploadPhoto, type ItemInput } from './data';
import { itemFormSchema, toItemInput, type ItemForm as Form } from './forms';
import { adminPaths } from './paths';
import { toWebp, type PhotoError } from './photo';
import { useAdminAction } from './action';
import { FormSection, PageHeader, Photo, SaveBar, SwitchField, TextField } from './ui';
import type { rpc } from '@rms/shared';

type Item = rpc.AdminMenuItem;

/** The photo as the form will save it. */
type PhotoChoice =
  { kind: 'keep' } | { kind: 'remove' } | { kind: 'new'; blob: Blob; preview: string };

function formOf(item: Item | undefined, minorUnits: number, categoryId: string): Form {
  return {
    category_id: item?.category_id ?? categoryId,
    name: item?.name ?? '',
    description: item?.description ?? '',
    price: item ? amountToInput(item.price, minorUnits) : '',
    cost_price: item ? amountToInput(item.cost_price, minorUnits) : '',
    prep_time_min: item?.prep_time_min === null || !item ? '' : String(item.prep_time_min),
    needs_kitchen: item?.needs_kitchen ?? true,
    is_available: item?.is_available ?? true,
  };
}

function Editor({ item, categories }: { item: Item | undefined; categories: rpc.AdminCategory[] }) {
  const { t } = useTranslation(['admin', 'rpc']);
  const { settings } = usePublicSettings();
  const { canSend } = useConnection();
  const navigate = useNavigate();
  const fileId = useId();
  const minor = settings?.currencyMinorUnits ?? 2;
  const active = categories.filter((c) => c.is_active);
  const form = useForm<Form>({
    resolver: zodResolver(itemFormSchema(minor)),
    defaultValues: formOf(item, minor, active[0]?.id ?? ''),
  });
  const { register, control, handleSubmit, formState } = form;

  const [photo, setPhoto] = useState<PhotoChoice>({ kind: 'keep' });
  const [photoError, setPhotoError] = useState<PhotoError | null>(null);
  const [converting, setConverting] = useState(false);
  // A retry after a lost answer must send the same arguments (same request id, BR-15), so a
  // photo uploaded once is not uploaded again under another name.
  const uploaded = useRef<{ blob: Blob; path: string } | null>(null);

  useEffect(() => {
    if (photo.kind !== 'new') return;
    return () => {
      URL.revokeObjectURL(photo.preview);
    };
  }, [photo]);

  const save = useAdminAction(
    async (requestId: string, values: Form) => {
      let imagePath = photo.kind === 'remove' ? null : (item?.image_path ?? null);
      if (photo.kind === 'new') {
        if (uploaded.current?.blob !== photo.blob) {
          uploaded.current = {
            blob: photo.blob,
            path: await uploadPhoto(photo.blob, newRequestId),
          };
        }
        imagePath = uploaded.current.path;
      }
      const input: ItemInput = { ...toItemInput(values, minor), image_path: imagePath };
      return adminRpc.saveMenuItem(requestId, item?.id ?? null, input);
    },
    adminKeys.menu,
    (result) => {
      toast.success(
        result.created
          ? t('admin:item.created', { name: result.item.name })
          : t('admin:item.saved', { name: result.item.name }),
      );
      void navigate(adminPaths.menu);
    },
  );

  const current = photo.kind === 'new' ? null : photo.kind === 'remove' ? null : item?.image_path;
  const priceChanged = item !== undefined && formState.dirtyFields.price === true;

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(event) => {
        void handleSubmit((values) => save.run(values))(event);
      }}
    >
      <PageHeader
        title={item ? t('admin:item.editTitle', { name: item.name }) : t('admin:item.newTitle')}
        actions={
          <Button variant="ghost" asChild>
            <Link to={adminPaths.menu}>
              <ArrowLeft aria-hidden className="rtl:-scale-x-100" />
              {t('admin:item.back')}
            </Link>
          </Button>
        }
      />
      <div className="mx-auto max-w-2xl space-y-6">
        <FormSection title={t('admin:item.details')}>
          <TextField
            label={t('admin:item.name')}
            autoComplete="off"
            error={formState.errors.name}
            {...register('name')}
          />
          <Controller
            control={control}
            name="category_id"
            render={({ field, fieldState }) => (
              <div className="space-y-1.5">
                <SelectField
                  label={t('admin:item.category')}
                  value={field.value}
                  onChange={field.onChange}
                >
                  {active.length === 0 && <option value="">{t('admin:item.noCategory')}</option>}
                  {active.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </SelectField>
                {fieldState.error && (
                  <p className="text-sm font-medium text-danger">
                    {t('admin:form.categoryRequired')}
                  </p>
                )}
              </div>
            )}
          />
          <TextField
            label={t('admin:item.description')}
            multiline
            error={formState.errors.description}
            {...register('description')}
          />
        </FormSection>

        <FormSection title={t('admin:item.prices')} description={t('admin:item.pricesBody')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('admin:item.price', { currency: settings?.currencyCode ?? '' })}
              inputMode="decimal"
              autoComplete="off"
              error={formState.errors.price}
              hint={priceChanged ? t('admin:item.priceNewOrdersOnly') : undefined}
              {...register('price')}
            />
            <TextField
              label={t('admin:item.cost', { currency: settings?.currencyCode ?? '' })}
              inputMode="decimal"
              autoComplete="off"
              hint={t('admin:item.costHint')}
              error={formState.errors.cost_price}
              {...register('cost_price')}
            />
          </div>
        </FormSection>

        <FormSection title={t('admin:item.kitchen')}>
          <TextField
            label={t('admin:item.prepTime')}
            inputMode="numeric"
            autoComplete="off"
            className="sm:max-w-48"
            error={formState.errors.prep_time_min}
            {...register('prep_time_min')}
          />
          <Controller
            control={control}
            name="needs_kitchen"
            render={({ field }) => (
              <SwitchField
                label={t('admin:item.needsKitchen')}
                hint={t('admin:item.needsKitchenHint')}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <Controller
            control={control}
            name="is_available"
            render={({ field }) => (
              <SwitchField
                label={t('admin:item.available')}
                hint={t('admin:item.availableHint')}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </FormSection>

        <FormSection title={t('admin:item.photo')} description={t('admin:item.photoBody')}>
          <div className="flex flex-wrap items-center gap-4">
            {photo.kind === 'new' ? (
              <img
                src={photo.preview}
                alt={t('admin:item.photoPreview')}
                className="size-32 rounded-md object-cover"
              />
            ) : (
              <Photo path={current ?? null} alt={item?.name ?? ''} className="size-32" />
            )}
            <div className="flex flex-wrap gap-2">
              <input
                id={fileId}
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={!canSend || converting}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  setPhotoError(null);
                  setConverting(true);
                  void toWebp(file).then((result) => {
                    setConverting(false);
                    if ('error' in result) {
                      setPhotoError(result.error);
                      return;
                    }
                    setPhoto({
                      kind: 'new',
                      blob: result.blob,
                      preview: URL.createObjectURL(result.blob),
                    });
                  });
                }}
              />
              <Button variant="outline" asChild>
                <label htmlFor={fileId} className="cursor-pointer">
                  <ImagePlus aria-hidden />
                  {converting
                    ? t('admin:item.photoConverting')
                    : current || photo.kind === 'new'
                      ? t('admin:item.photoChange')
                      : t('admin:item.photoAdd')}
                </label>
              </Button>
              {(current || photo.kind === 'new') && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setPhoto({ kind: 'remove' });
                  }}
                >
                  <Trash2 aria-hidden />
                  {t('admin:item.photoRemove')}
                </Button>
              )}
            </div>
          </div>
          {photoError && (
            <p role="alert" className="text-sm font-medium text-danger">
              {t(`admin:photoError.${photoError}`)}
            </p>
          )}
        </FormSection>
        <ErrorLine error={save.error} />
      </div>
      <SaveBar>
        <Button variant="ghost" asChild>
          <Link to={adminPaths.menu}>{t('admin:cancel')}</Link>
        </Button>
        <Button type="submit" loading={save.pending} disabled={!canSend || converting}>
          {t('admin:save')}
        </Button>
      </SaveBar>
    </form>
  );
}

/** New or existing menu item (M2): details, prices (cost Admin only), kitchen, photo. */
export function ItemForm() {
  const { t } = useTranslation(['admin']);
  const { itemId } = useParams();
  const menu = useQuery(menuQuery);
  const item = useMemo(
    () => (itemId ? menu.data?.items.find((i) => i.id === itemId) : undefined),
    [menu.data, itemId],
  );

  if (menu.isPending) return <SkeletonList rows={8} />;
  if (menu.isError) {
    return (
      <ErrorState
        title={t('admin:loadFailed')}
        description={t('admin:loadFailedBody')}
        retryLabel={t('admin:retry')}
        onRetry={() => void menu.refetch()}
      />
    );
  }
  if (itemId && (!item || !item.is_active)) return <Navigate to={adminPaths.menu} replace />;
  return <Editor key={item?.id ?? 'new'} item={item} categories={menu.data.categories} />;
}
