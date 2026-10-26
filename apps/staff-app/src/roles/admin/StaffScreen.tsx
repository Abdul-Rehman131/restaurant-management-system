import { zodResolver } from '@hookform/resolvers/zod';
import type { rpc } from '@rms/shared';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  toast,
} from '@rms/ui';
import { useQuery } from '@tanstack/react-query';
import {
  Copy,
  KeyRound,
  Pencil,
  ShieldOff,
  UserCheck,
  UserPlus,
  UserX,
  UsersRound,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../../auth/auth-context';
import { ErrorLine, ReasonDialog, SelectField } from '../../dialogs/ReasonDialog';
import { useConnection } from '../../shell/connection-context';
import { adminKeys, staffAdmin, staffQuery } from './data';
import { DataTable, type Column } from './DataTable';
import { staffFormSchema, type StaffForm } from './forms';
import { useAdminAction } from './action';
import { PageHeader, StateBadge, TextField } from './ui';

type Staff = rpc.StaffDirectoryRow;
type Role = StaffForm['role'];
const roles: Role[] = ['admin', 'cashier', 'waiter', 'chef', 'rider'];
const ALL = 'all';
const ACTIVE = 'active';
/** The state filter: its value and the admin:state.* word it shows. */
const states = [
  { value: ACTIVE, label: 'active' },
  { value: 'inactive', label: 'archived' },
  { value: ALL, label: 'all' },
] as const;

/** The new temporary password, shown once (it is not stored anywhere readable). */
function PasswordDialog({
  shown,
  onClose,
}: {
  shown: { name: string; username: string; password: string } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(['admin']);
  return (
    <AlertDialog
      open={shown !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('admin:staff.passwordTitle', { name: shown?.name ?? '' })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('admin:staff.passwordBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        <dl className="grid gap-2 rounded-md bg-surface-2 p-4">
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">{t('admin:staff.username')}</dt>
            <dd className="font-semibold" data-testid="new-username">
              {shown?.username}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">{t('admin:staff.temporaryPassword')}</dt>
            <dd
              className="font-mono text-lg font-semibold tracking-wide"
              data-testid="new-password"
            >
              {shown?.password}
            </dd>
          </div>
        </dl>
        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (!shown) return;
              void navigator.clipboard.writeText(shown.password).then(
                () => toast.success(t('admin:staff.copied')),
                () => null,
              );
            }}
          >
            <Copy aria-hidden />
            {t('admin:staff.copy')}
          </Button>
          <AlertDialogCancel>{t('admin:staff.done')}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function StaffDialog({
  staff,
  onClose,
  onPassword,
}: {
  staff: Staff | null;
  onClose: () => void;
  onPassword: (shown: { name: string; username: string; password: string }) => void;
}) {
  const { t } = useTranslation(['admin', 'rpc']);
  const { canSend } = useConnection();
  const form = useForm<StaffForm>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: {
      username: staff?.username ?? '',
      full_name: staff?.full_name ?? '',
      phone: staff?.phone ?? '',
      role: staff?.role ?? 'waiter',
    },
  });
  const save = useAdminAction(
    staffAdmin,
    adminKeys.staff,
    useCallback(
      (result: rpc.StaffAdminResponse) => {
        onClose();
        if (result.temporary_password) {
          onPassword({
            name: result.staff.full_name,
            username: result.staff.username,
            password: result.temporary_password,
          });
        } else {
          toast.success(t('admin:staff.saved', { name: result.staff.full_name }));
        }
      },
      [onClose, onPassword, t],
    ),
  );
  const { register, control, handleSubmit, formState } = form;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            void handleSubmit((values) => {
              const phone = values.phone.trim() === '' ? null : values.phone.trim();
              return save.run(
                staff
                  ? {
                      action: 'update',
                      user_id: staff.id,
                      full_name: values.full_name.trim(),
                      phone,
                      role: values.role,
                    }
                  : {
                      action: 'create',
                      username: values.username.trim().toLowerCase(),
                      full_name: values.full_name.trim(),
                      phone,
                      role: values.role,
                    },
              );
            })(event);
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {staff
                ? t('admin:staff.editTitle', { name: staff.full_name })
                : t('admin:staff.newTitle')}
            </DialogTitle>
            <DialogDescription>
              {staff ? t('admin:staff.editBody') : t('admin:staff.newBody')}
            </DialogDescription>
          </DialogHeader>
          <TextField
            label={t('admin:staff.username')}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={staff !== null}
            hint={staff ? t('admin:staff.usernameFixed') : t('admin:staff.usernameHint')}
            error={formState.errors.username}
            {...register('username')}
          />
          <TextField
            label={t('admin:staff.fullName')}
            autoComplete="off"
            error={formState.errors.full_name}
            {...register('full_name')}
          />
          <TextField
            label={t('admin:staff.phone')}
            type="tel"
            autoComplete="off"
            error={formState.errors.phone}
            {...register('phone')}
          />
          <Controller
            control={control}
            name="role"
            render={({ field }) => (
              <SelectField
                label={t('admin:staff.role')}
                value={field.value}
                onChange={field.onChange}
                hint={staff ? t('admin:staff.roleHint') : undefined}
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {t(`admin:role.${role}`)}
                  </option>
                ))}
              </SelectField>
            )}
          />
          <ErrorLine error={save.error} />
          <DialogFooter>
            <Button type="submit" loading={save.pending} disabled={!canSend}>
              {staff ? t('admin:save') : t('admin:staff.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A one-step confirmation for the resets (they end the person's sessions). */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  error: Parameters<typeof ErrorLine>[0]['error'];
  onConfirm: () => void;
}) {
  const { t } = useTranslation(['admin']);
  const { canSend } = useConnection();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorLine error={error} />
        <AlertDialogFooter>
          <AlertDialogCancel>{t('admin:keep')}</AlertDialogCancel>
          <Button variant="destructive" loading={pending} disabled={!canSend} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Staff (M1): every account with its role, phone (Admin only) and state; create (a temporary
 * password shown once), edit, reset password, reset two-step sign-in (another Admin's lost
 * authenticator), deactivate (reason; sessions end, sign-in refused) and reactivate. All of it
 * through the staff-admin Edge Function, which holds the service key.
 */
export function StaffScreen() {
  const { t } = useTranslation(['admin', 'rpc']);
  const { canSend } = useConnection();
  const { session } = useAuth();
  const me = session?.user.id;
  const staff = useQuery(staffQuery);
  const [role, setRole] = useState<string>(ALL);
  const [state, setState] = useState<string>(ACTIVE);
  const [editing, setEditing] = useState<Staff | 'new' | null>(null);
  const [password, setPassword] = useState<{
    name: string;
    username: string;
    password: string;
  } | null>(null);
  const [deactivating, setDeactivating] = useState<Staff | null>(null);
  const [resetting, setResetting] = useState<{ staff: Staff; kind: 'password' | 'mfa' } | null>(
    null,
  );

  const deactivate = useAdminAction(staffAdmin, adminKeys.staff);
  const reactivate = useAdminAction(
    staffAdmin,
    adminKeys.staff,
    useCallback(
      (result: rpc.StaffAdminResponse) => {
        toast.success(t('admin:staff.reactivated', { name: result.staff.full_name }));
      },
      [t],
    ),
  );
  const reset = useAdminAction(
    staffAdmin,
    adminKeys.staff,
    useCallback(
      (result: rpc.StaffAdminResponse) => {
        setResetting(null);
        if (result.temporary_password) {
          setPassword({
            name: result.staff.full_name,
            username: result.staff.username,
            password: result.temporary_password,
          });
        } else {
          toast.success(t('admin:staff.mfaReset', { name: result.staff.full_name }));
        }
      },
      [t],
    ),
  );

  const rows = (staff.data ?? []).filter(
    (s) =>
      (role === ALL || s.role === role) &&
      (state === ALL || (state === ACTIVE ? s.is_active : !s.is_active)),
  );

  const columns: Column<Staff>[] = [
    {
      key: 'name',
      header: t('admin:staff.fullName'),
      cell: (s) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{s.full_name}</span>
          {s.id === me && <Badge variant="brand">{t('admin:staff.you')}</Badge>}
        </span>
      ),
    },
    { key: 'username', header: t('admin:staff.username'), cell: (s) => s.username },
    { key: 'role', header: t('admin:staff.role'), cell: (s) => t(`admin:role.${s.role}`) },
    { key: 'phone', header: t('admin:staff.phoneColumn'), cell: (s) => s.phone ?? '' },
    {
      key: 'state',
      header: t('admin:staff.state'),
      cell: (s) => <StateBadge archived={!s.is_active} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin:staff.title')}
        description={t('admin:staff.description')}
        actions={
          <Button
            disabled={!canSend}
            onClick={() => {
              setEditing('new');
            }}
          >
            <UserPlus aria-hidden />
            {t('admin:staff.new')}
          </Button>
        }
      />
      <ErrorLine error={reactivate.error} />
      {staff.isError ? (
        <ErrorState
          title={t('admin:loadFailed')}
          description={t('admin:loadFailedBody')}
          retryLabel={t('admin:retry')}
          onRetry={() => void staff.refetch()}
        />
      ) : (
        <DataTable
          rows={rows}
          rowId={(s) => s.id}
          columns={columns}
          loading={staff.isPending}
          caption={t('admin:staff.title')}
          searchLabel={t('admin:staff.search')}
          matches={(s, query) =>
            `${s.full_name} ${s.username} ${s.phone ?? ''}`.toLocaleLowerCase().includes(query)
          }
          empty={t('admin:staff.empty')}
          emptyIcon={UsersRound}
          filters={[
            {
              label: t('admin:staff.role'),
              value: role,
              onChange: setRole,
              options: [
                { value: ALL, label: t('admin:staff.allRoles') },
                ...roles.map((r) => ({ value: r, label: t(`admin:role.${r}`) })),
              ],
            },
            {
              label: t('admin:staff.state'),
              value: state,
              onChange: setState,
              options: states.map((x) => ({ value: x.value, label: t(`admin:state.${x.label}`) })),
            },
          ]}
          actions={(s) =>
            s.is_active ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('admin:edit', { name: s.full_name })}
                  disabled={!canSend}
                  onClick={() => {
                    setEditing(s);
                  }}
                >
                  <Pencil aria-hidden />
                </Button>
                {s.id !== me && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('admin:staff.resetPassword', { name: s.full_name })}
                      disabled={!canSend}
                      onClick={() => {
                        reset.clearError();
                        setResetting({ staff: s, kind: 'password' });
                      }}
                    >
                      <KeyRound aria-hidden />
                    </Button>
                    {s.role === 'admin' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('admin:staff.resetMfa', { name: s.full_name })}
                        disabled={!canSend}
                        onClick={() => {
                          reset.clearError();
                          setResetting({ staff: s, kind: 'mfa' });
                        }}
                      >
                        <ShieldOff aria-hidden />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-danger"
                      aria-label={t('admin:staff.deactivate', { name: s.full_name })}
                      disabled={!canSend}
                      onClick={() => {
                        deactivate.clearError();
                        setDeactivating(s);
                      }}
                    >
                      <UserX aria-hidden />
                    </Button>
                  </>
                )}
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={!canSend || reactivate.pending}
                onClick={() =>
                  void reactivate.run({
                    action: 'set_active',
                    user_id: s.id,
                    is_active: true,
                    reason: null,
                  })
                }
              >
                <UserCheck aria-hidden />
                {t('admin:staff.reactivate')}
              </Button>
            )
          }
        />
      )}
      {editing !== null && (
        <StaffDialog
          key={editing === 'new' ? 'new' : editing.id}
          staff={editing === 'new' ? null : editing}
          onClose={() => {
            setEditing(null);
          }}
          onPassword={setPassword}
        />
      )}
      <PasswordDialog
        shown={password}
        onClose={() => {
          setPassword(null);
        }}
      />
      <ConfirmDialog
        open={resetting !== null}
        onOpenChange={(open) => {
          if (!open) setResetting(null);
        }}
        title={
          resetting?.kind === 'mfa'
            ? t('admin:staff.resetMfaTitle', { name: resetting.staff.full_name })
            : t('admin:staff.resetPasswordTitle', { name: resetting?.staff.full_name ?? '' })
        }
        description={
          resetting?.kind === 'mfa'
            ? t('admin:staff.resetMfaBody')
            : t('admin:staff.resetPasswordBody')
        }
        confirmLabel={
          resetting?.kind === 'mfa'
            ? t('admin:staff.resetMfaConfirm')
            : t('admin:staff.resetPasswordConfirm')
        }
        pending={reset.pending}
        error={reset.error}
        onConfirm={() => {
          if (!resetting) return;
          void reset.run({
            action: resetting.kind === 'mfa' ? 'reset_mfa' : 'reset_password',
            user_id: resetting.staff.id,
          });
        }}
      />
      <ReasonDialog
        open={deactivating !== null}
        onOpenChange={(open) => {
          if (!open) setDeactivating(null);
        }}
        title={t('admin:staff.deactivateTitle', { name: deactivating?.full_name ?? '' })}
        description={t('admin:staff.deactivateBody')}
        confirmLabel={t('admin:staff.deactivateConfirm')}
        labels={{
          reason: t('admin:reason'),
          placeholder: t('admin:staff.deactivatePlaceholder'),
          keep: t('admin:keep'),
        }}
        pending={deactivate.pending}
        error={deactivate.error}
        onConfirm={(reason) =>
          deactivating
            ? deactivate.run({
                action: 'set_active',
                user_id: deactivating.id,
                is_active: false,
                reason,
              })
            : Promise.resolve(false)
        }
      />
    </div>
  );
}
