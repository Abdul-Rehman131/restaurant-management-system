export { cn } from './lib/cn';
export { applyDensity, applyTheme, type Density, type Theme } from './lib/theme';
export { UiProvider, type UiProviderProps } from './components/UiProvider';
export { AppHeader, type AppHeaderProps } from './components/AppHeader';

// Form controls
export { Button, buttonVariants, type ButtonProps } from './components/Button';
export { Checkbox } from './components/Checkbox';
export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
} from './components/Form';
export { Input, Textarea } from './components/Input';
export { Label } from './components/Label';
export { RadioGroup, RadioGroupItem } from './components/RadioGroup';
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from './components/Select';
export { Switch } from './components/Switch';

// Overlays
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './components/Dialog';
export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './components/Command';
export { Combobox, type ComboboxOption, type ComboboxProps } from './components/Combobox';
export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from './components/Drawer';
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from './components/DropdownMenu';
export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from './components/Popover';
export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './components/Sheet';
export { Toaster } from './components/Toaster';
export { toast } from 'sonner';
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/Tooltip';

// Display
export { Avatar, AvatarFallback, AvatarImage, initials } from './components/Avatar';
export { Badge, badgeVariants, type BadgeProps } from './components/Badge';
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/Card';
export { ScrollArea, ScrollBar } from './components/ScrollArea';
export { Separator } from './components/Separator';
export {
  Skeleton,
  SkeletonCard,
  SkeletonGroup,
  SkeletonList,
  SkeletonText,
  SkeletonTiles,
} from './components/Skeleton';
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './components/Table';
export { Tabs, TabsContent, TabsList, TabsTrigger } from './components/Tabs';

// Domain primitives
export {
  ConnectionDot,
  type ConnectionDotProps,
  type ConnectionState,
} from './components/ConnectionDot';
export { EmptyState, type EmptyStateProps } from './components/EmptyState';
export { ErrorState, type ErrorStateProps } from './components/ErrorState';
export { MoneyText, type MoneyTextProps } from './components/MoneyText';
export {
  OfflineBanner,
  useOnlineStatus,
  type OfflineBannerProps,
} from './components/OfflineBanner';
export { QtyStepper, type QtyStepperProps } from './components/QtyStepper';
export { StatusBadge, type StatusBadgeProps } from './components/StatusBadge';
export { StickyActionBar, type StickyActionBarProps } from './components/StickyActionBar';
