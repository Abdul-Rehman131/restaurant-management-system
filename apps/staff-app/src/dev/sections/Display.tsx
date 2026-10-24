import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  initials,
  ScrollArea,
  Separator,
  SkeletonCard,
  SkeletonList,
  SkeletonText,
  SkeletonTiles,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@rms/ui';
import { useTranslation } from 'react-i18next';

import { GalleryRow, GallerySection } from '../GallerySection';

// Demo data only (fake staff and menu).
const demoLines = [
  { name: 'Chicken Tikka (Leg)', qty: 2, batch: 1 },
  { name: 'Garlic Naan', qty: 4, batch: 1 },
  { name: 'Sweet Lassi', qty: 2, batch: 2 },
];
const demoStaff = ['Waiter One', 'Waiter Two', 'Chef Demo', 'Cashier Demo'];
const demoTickets = Array.from({ length: 12 }, (_, i) => i + 1);
const tab = { table: 'table', cards: 'cards', loading: 'loading' } as const;

export function DisplaySection() {
  const { t } = useTranslation('dev');
  return (
    <GallerySection id="display" title={t('sections.display')}>
      <Tabs defaultValue={tab.table}>
        <TabsList aria-label={t('display.tabsLabel')}>
          <TabsTrigger value={tab.table}>{t('display.tabTable')}</TabsTrigger>
          <TabsTrigger value={tab.cards}>{t('display.tabCards')}</TabsTrigger>
          <TabsTrigger value={tab.loading}>{t('display.tabLoading')}</TabsTrigger>
        </TabsList>

        <TabsContent value={tab.table}>
          <Table>
            <TableCaption>{t('display.tableCaption')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('display.item')}</TableHead>
                <TableHead>{t('display.batch')}</TableHead>
                <TableHead numeric>{t('display.qty')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {demoLines.map((line) => (
                <TableRow key={line.name}>
                  <TableCell>{line.name}</TableCell>
                  <TableCell>
                    {line.batch === 1 ? (
                      t('display.firstBatch')
                    ) : (
                      <Badge variant="accent">{t('display.addOn')}</Badge>
                    )}
                  </TableCell>
                  <TableCell numeric>{line.qty}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value={tab.cards} className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('display.cardTitle')}</CardTitle>
              <CardDescription>{t('display.cardDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              <p>{t('display.cardBody')}</p>
            </CardContent>
            <CardFooter>
              <Button size="sm">{t('display.openOrder')}</Button>
            </CardFooter>
          </Card>
          <div className="space-y-4">
            <GalleryRow>
              <Badge>{t('display.newLabel')}</Badge>
              <Badge variant="outline">{t('display.addOn')}</Badge>
              <Badge variant="brand">{t('display.cartCount', { count: 3 })}</Badge>
              <Badge variant="accent">{t('display.addOn')}</Badge>
            </GalleryRow>
            <Separator />
            <GalleryRow label={t('display.staff')}>
              {demoStaff.map((name) => (
                <Avatar key={name} title={name}>
                  <AvatarFallback>{initials(name)}</AvatarFallback>
                </Avatar>
              ))}
            </GalleryRow>
            <Separator />
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-fg-muted">{t('display.scrollTitle')}</h3>
              <ScrollArea className="h-40 rounded-md border border-border">
                <ul className="divide-y divide-border">
                  {demoTickets.map((n) => (
                    <li key={n} className="px-4 py-2.5">
                      {t('display.scrollItem', { n })}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>
          </div>
        </TabsContent>

        <TabsContent value={tab.loading} className="grid gap-6 md:grid-cols-2">
          <SkeletonText />
          <SkeletonCard />
          <SkeletonList />
          <SkeletonTiles />
        </TabsContent>
      </Tabs>
    </GallerySection>
  );
}
