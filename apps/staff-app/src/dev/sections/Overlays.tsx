import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Combobox,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@rms/ui';
import {
  ArrowRightLeft,
  CircleHelp,
  EllipsisVertical,
  Plus,
  Printer,
  Search,
  X,
} from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GalleryRow, GallerySection } from '../GallerySection';

// Demo data only (fake menu and bills).
const demoItems = [
  { value: 'tikka', label: 'Chicken Tikka (Leg)' },
  { value: 'karahi', label: 'Mutton Karahi (Half)' },
  { value: 'naan', label: 'Garlic Naan' },
  { value: 'lassi', label: 'Sweet Lassi' },
  { value: 'water', label: 'Mineral Water (Small)' },
];
const demoBills = ['ORD-20261024-004 · Table 4', 'ORD-20261024-007 · Table 9'];

export function OverlaysSection() {
  const { t } = useTranslation('dev');
  const comboboxId = useId();
  const [item, setItem] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showPrices, setShowPrices] = useState(true);

  return (
    <GallerySection id="overlays" title={t('sections.overlays')}>
      <GalleryRow>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">{t('overlays.dialog')}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('overlays.dialogTitle')}</DialogTitle>
              <DialogDescription>{t('overlays.dialogBody')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">{t('overlays.chooseTable')}</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button>{t('overlays.openBill')}</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline">{t('overlays.alertDialog')}</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('overlays.alertTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('overlays.alertBody')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('overlays.keepOrder')}</AlertDialogCancel>
              <AlertDialogAction destructive>{t('overlays.cancelOrder')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">{t('overlays.sheet')}</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{t('overlays.sheetTitle')}</SheetTitle>
              <SheetDescription>{t('overlays.sheetBody')}</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>

        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="outline">{t('overlays.drawer')}</Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{t('overlays.drawerTitle')}</DrawerTitle>
              <DrawerDescription>{t('overlays.drawerBody')}</DrawerDescription>
            </DrawerHeader>
            <DrawerFooter>
              <DrawerClose asChild>
                <Button>{t('overlays.done')}</Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">{t('overlays.popover')}</Button>
          </PopoverTrigger>
          <PopoverContent>
            <p className="text-sm">{t('overlays.popoverBody')}</p>
          </PopoverContent>
        </Popover>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('overlays.tooltipTrigger')}>
              <CircleHelp aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('overlays.tooltip')}</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label={t('overlays.menu')}>
              <EllipsisVertical aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t('overlays.menuLabel')}</DropdownMenuLabel>
            <DropdownMenuItem>
              <ArrowRightLeft aria-hidden />
              {t('overlays.moveTable')}
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Printer aria-hidden />
              {t('overlays.printBill')}
              <DropdownMenuShortcut>{t('overlays.printShortcut')}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuCheckboxItem checked={showPrices} onCheckedChange={setShowPrices}>
              {t('overlays.showPrices')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive>
              <X aria-hidden />
              {t('overlays.voidOrder')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </GalleryRow>

      <div className="grid max-w-xl gap-2">
        <Label htmlFor={comboboxId}>{t('overlays.comboboxLabel')}</Label>
        <Combobox
          id={comboboxId}
          options={demoItems}
          value={item}
          onValueChange={setItem}
          placeholder={t('overlays.comboboxPlaceholder')}
        />
      </div>

      <GalleryRow>
        <Button
          variant="secondary"
          onClick={() => {
            setPaletteOpen(true);
          }}
        >
          <Search aria-hidden />
          {t('overlays.palette')}
          <kbd className="ms-2 rounded-sm border border-border px-1.5 text-xs text-fg-muted">
            {'/'}
          </kbd>
        </Button>
        <CommandDialog
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          title={t('overlays.paletteTitle')}
          description={t('overlays.paletteDescription')}
        >
          <CommandInput placeholder={t('overlays.paletteSearch')} />
          <CommandList>
            <CommandEmpty>{t('combobox.empty', { ns: 'ui' })}</CommandEmpty>
            <CommandGroup heading={t('overlays.paletteBills')}>
              {demoBills.map((bill) => (
                <CommandItem key={bill}>{bill}</CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading={t('overlays.paletteActions')}>
              <CommandItem>
                <Plus aria-hidden />
                {t('overlays.newOrder')}
                <CommandShortcut>{'N'}</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandDialog>
      </GalleryRow>

      <GalleryRow>
        <Button
          variant="outline"
          onClick={() => {
            toast.success(t('overlays.paymentRecorded'), {
              description: t('overlays.paymentRecordedBody'),
            });
          }}
        >
          {t('overlays.toastSuccess')}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            toast.error(t('overlays.notSaved'));
          }}
        >
          {t('overlays.toastError')}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            toast.info(t('overlays.newBill'));
          }}
        >
          {t('overlays.toastInfo')}
        </Button>
      </GalleryRow>
    </GallerySection>
  );
}
