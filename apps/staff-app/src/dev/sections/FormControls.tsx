import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Checkbox,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from '@rms/ui';
import { Plus, ReceiptText, Send } from 'lucide-react';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { GalleryRow, GallerySection } from '../GallerySection';

// Demo data only (plan: fake values, never real owner data).
const demoTables = ['1', '2', '7', '12'];
const paymentMethods = ['cash', 'card'] as const;

const schema = z.object({
  customerName: z.string().trim().min(1, 'validation.required').max(40, 'validation.tooLong'),
  table: z.string().min(1, 'validation.chooseOne'),
  notes: z.string().max(200, 'validation.tooLong'),
  payment: z.enum(paymentMethods, { error: 'validation.chooseOne' }),
  printReceipt: z.boolean(),
});
type DemoForm = z.infer<typeof schema>;

export function ButtonsSection() {
  const { t } = useTranslation('dev');
  return (
    <GallerySection id="buttons" title={t('sections.buttons')}>
      <GalleryRow>
        <Button>
          <Send aria-hidden className="rtl:-scale-x-100" />
          {t('buttons.primary')}
        </Button>
        <Button variant="secondary">{t('buttons.secondary')}</Button>
        <Button variant="outline">{t('buttons.outline')}</Button>
        <Button variant="ghost">{t('buttons.ghost')}</Button>
        <Button variant="destructive">{t('buttons.destructive')}</Button>
      </GalleryRow>
      <GalleryRow label={t('buttons.sizes')}>
        <Button size="sm">{t('buttons.small')}</Button>
        <Button size="md">{t('buttons.medium')}</Button>
        <Button size="lg">{t('buttons.large')}</Button>
        <Button size="xl">{t('buttons.extraLarge')}</Button>
      </GalleryRow>
      <GalleryRow label={t('buttons.states')}>
        <Button loading>{t('buttons.loading')}</Button>
        <Button loading variant="destructive">
          {t('buttons.loading')}
        </Button>
        <Button loading variant="outline">
          {t('buttons.loading')}
        </Button>
        <Button disabled variant="outline">
          {t('buttons.disabled')}
        </Button>
        <Button size="icon" variant="outline" aria-label={t('buttons.iconOnly')}>
          <Plus aria-hidden />
        </Button>
        <Button variant="secondary">
          <ReceiptText aria-hidden />
          {t('buttons.withIcon')}
        </Button>
      </GalleryRow>
    </GallerySection>
  );
}

export function FieldsSection() {
  const { t } = useTranslation('dev');
  const soundId = useId();
  const [valid, setValid] = useState(false);
  const form = useForm<DemoForm>({
    resolver: zodResolver(schema),
    defaultValues: { customerName: '', table: '', notes: '', printReceipt: true },
  });

  return (
    <GallerySection id="fields" title={t('sections.fields')}>
      <Form {...form}>
        <form
          noValidate
          className="grid max-w-xl gap-5"
          onSubmit={(event) => {
            setValid(false);
            void form.handleSubmit(() => {
              setValid(true);
            })(event);
          }}
        >
          <FormField
            control={form.control}
            name="customerName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('form.customerName')}</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <FormDescription>{t('form.customerNameHelp')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="table"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('form.table')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={t('form.tablePlaceholder')} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {demoTables.map((table) => (
                      <SelectItem key={table} value={table}>
                        {table}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('form.notes')}</FormLabel>
                <FormControl>
                  <Textarea placeholder={t('form.notesPlaceholder')} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="payment"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('form.payment')}</FormLabel>
                <FormControl>
                  <RadioGroup
                    value={field.value}
                    onValueChange={field.onChange}
                    className="flex gap-6"
                  >
                    {paymentMethods.map((method) => (
                      <div key={method} className="flex items-center gap-3">
                        <RadioGroupItem value={method} id={`payment-${method}`} />
                        <Label htmlFor={`payment-${method}`}>{t(`form.${method}`)}</Label>
                      </div>
                    ))}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="printReceipt"
            render={({ field }) => (
              <FormItem className="flex items-center gap-3">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(checked) => {
                      field.onChange(checked === true);
                    }}
                  />
                </FormControl>
                <FormLabel>{t('form.printReceipt')}</FormLabel>
              </FormItem>
            )}
          />
          <div className="flex items-center gap-3">
            <Switch id={soundId} defaultChecked />
            <Label htmlFor={soundId}>{t('form.sound')}</Label>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit">{t('form.submit')}</Button>
            <p role="status" className="text-sm font-medium text-success">
              {valid ? t('form.valid') : null}
            </p>
          </div>
        </form>
      </Form>
    </GallerySection>
  );
}
