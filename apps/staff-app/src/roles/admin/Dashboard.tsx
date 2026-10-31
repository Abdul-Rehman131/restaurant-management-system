import { formatMoney, usePublicSettings, type rpc } from '@rms/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Input,
  Label,
  MoneyText,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@rms/ui';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { lazy, Suspense, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { salesQuery } from './data';
import { PageHeader } from './ui';

// The chart library loads only here, after the numbers (plan 4.10: admin chunk only).
const BarsChart = lazy(() => import('./DashboardCharts'));

type Summary = rpc.SalesSummaryResponse;
/** The two views of a chart card (tab values, not text). */
const CHART = 'chart';
const TABLE = 'table';

function Kpi({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-sm text-fg-muted">{label}</p>
        <p className="text-2xl font-semibold break-words tabular-nums sm:text-3xl">{children}</p>
      </CardContent>
    </Card>
  );
}

/** A chart with its table alternative (plan 4.7: never information in a picture only). */
function ChartCard({
  title,
  chart,
  table,
  empty,
}: {
  title: string;
  chart: ReactNode;
  table: ReactNode;
  empty: boolean;
}) {
  const { t } = useTranslation(['admin']);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {empty ? (
          <EmptyState icon={BarChart3} title={t('admin:dashboard.noSales')} />
        ) : (
          <Tabs defaultValue={CHART}>
            <TabsList aria-label={t('admin:dashboard.view', { title })}>
              <TabsTrigger value={CHART}>{t('admin:dashboard.chart')}</TabsTrigger>
              <TabsTrigger value={TABLE}>{t('admin:dashboard.table')}</TabsTrigger>
            </TabsList>
            <TabsContent value={CHART} className="pt-3">
              <Suspense fallback={<Skeleton className="h-60 w-full" />}>{chart}</Suspense>
            </TabsContent>
            <TabsContent value={TABLE} className="pt-3">
              {table}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

function Report({ summary }: { summary: Summary }) {
  const { t, i18n } = useTranslation(['admin']);
  const { settings } = usePublicSettings();
  const money = (value: number) =>
    settings
      ? formatMoney(value, {
          currencyCode: settings.currencyCode,
          minorUnits: settings.currencyMinorUnits,
          locale: i18n.language,
        })
      : '';
  const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
  const noSales = summary.orders_count === 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t('admin:dashboard.sales')}>
          <MoneyText amount={summary.gross_sales} />
        </Kpi>
        <Kpi label={t('admin:dashboard.orders')}>{summary.orders_count}</Kpi>
        <Kpi label={t('admin:dashboard.average')}>
          <MoneyText amount={summary.average_order_value} />
        </Kpi>
        <Kpi label={t('admin:dashboard.openBills')}>{summary.open_count}</Kpi>
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <ChartCard
          title={t('admin:dashboard.byHour')}
          empty={noSales}
          chart={
            <BarsChart
              points={summary.by_hour.map((h) => ({ label: hourLabel(h.hour), value: h.sales }))}
              series={t('admin:dashboard.sales')}
              format={money}
            />
          }
          table={
            <Table aria-label={t('admin:dashboard.byHour')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin:dashboard.hour')}</TableHead>
                  <TableHead className="text-end">{t('admin:dashboard.orders')}</TableHead>
                  <TableHead className="text-end">{t('admin:dashboard.sales')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.by_hour
                  .filter((h) => h.orders > 0)
                  .map((h) => (
                    <TableRow key={h.hour}>
                      <TableCell className="tabular-nums">{hourLabel(h.hour)}</TableCell>
                      <TableCell className="text-end tabular-nums">{h.orders}</TableCell>
                      <TableCell className="text-end">
                        <MoneyText amount={h.sales} />
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          }
        />
        <ChartCard
          title={t('admin:dashboard.byType')}
          empty={noSales}
          chart={
            <BarsChart
              points={summary.by_type.map((x) => ({
                label: t(`admin:orderType.${x.type}`),
                value: x.sales,
              }))}
              series={t('admin:dashboard.sales')}
              format={money}
            />
          }
          table={
            <Table aria-label={t('admin:dashboard.byType')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin:dashboard.type')}</TableHead>
                  <TableHead className="text-end">{t('admin:dashboard.orders')}</TableHead>
                  <TableHead className="text-end">{t('admin:dashboard.sales')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.by_type.map((x) => (
                  <TableRow key={x.type}>
                    <TableCell>{t(`admin:orderType.${x.type}`)}</TableCell>
                    <TableCell className="text-end tabular-nums">{x.orders}</TableCell>
                    <TableCell className="text-end">
                      <MoneyText amount={x.sales} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin:dashboard.topItems')}</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.top_items.length === 0 ? (
            <EmptyState icon={BarChart3} title={t('admin:dashboard.noSales')} />
          ) : (
            <Table aria-label={t('admin:dashboard.topItems')}>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">{t('admin:dashboard.rank')}</TableHead>
                  <TableHead>{t('admin:dashboard.item')}</TableHead>
                  <TableHead className="text-end">{t('admin:dashboard.quantity')}</TableHead>
                  <TableHead className="text-end">{t('admin:dashboard.sales')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.top_items.map((item, index) => (
                  <TableRow key={item.menu_item_id}>
                    <TableCell className="tabular-nums">{index + 1}</TableCell>
                    <TableCell>{item.name}</TableCell>
                    <TableCell className="text-end tabular-nums">{item.quantity}</TableCell>
                    <TableCell className="text-end">
                      <MoneyText amount={item.sales} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="text-sm text-fg-muted">{t('admin:dashboard.note')}</p>
    </div>
  );
}

/**
 * Dashboard and daily report (M9, plan 4.9 and the 4.11 wireframe): pick a business day
 * (today in the settings time zone by default, BR-04: the server works it out), then the KPIs,
 * sales by hour and by order type (chart or table) and the top 10 items, all from
 * get_sales_summary. Live: order changes refetch it (useAdminLive).
 */
export function Dashboard() {
  const { t } = useTranslation(['admin']);
  const dateId = useId();
  const [day, setDay] = useState<string | null>(null);
  const summary = useQuery(salesQuery(day));
  const shown = day ?? summary.data?.business_date ?? '';

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin:dashboard.title')}
        actions={
          <div className="flex items-end gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor={dateId}>{t('admin:dashboard.businessDay')}</Label>
              <Input
                id={dateId}
                type="date"
                value={shown}
                className="w-44"
                onChange={(event) => {
                  setDay(event.target.value === '' ? null : event.target.value);
                }}
              />
            </div>
            <Button
              variant="outline"
              disabled={day === null}
              onClick={() => {
                setDay(null);
              }}
            >
              {t('admin:dashboard.today')}
            </Button>
          </div>
        }
      />
      {summary.isPending ? (
        <div className="space-y-4" aria-busy="true">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-72" />
        </div>
      ) : summary.isError ? (
        <ErrorState
          title={t('admin:loadFailed')}
          description={t('admin:loadFailedBody')}
          retryLabel={t('admin:retry')}
          retrying={summary.isFetching}
          onRetry={() => void summary.refetch()}
        />
      ) : (
        <Report summary={summary.data} />
      )}
    </div>
  );
}
