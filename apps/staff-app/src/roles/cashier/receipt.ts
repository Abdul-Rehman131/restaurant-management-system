/**
 * The receipt (M7, plan 4.9, D3), built from server data only: settings from get_settings,
 * the order's lines and totals as stored, and its live payments. Pure (receipt.test.ts); the
 * preview formats the integer amounts with formatMoney. It never contains a cost price: the
 * bill detail does not read one.
 */

export interface ReceiptSettings {
  restaurantName: string;
  address?: string | null | undefined;
  phone?: string | null | undefined;
  taxRegistrationNumber?: string | null | undefined;
  receiptFooter: string | null;
  timezone: string;
}

export interface ReceiptLine {
  name: string;
  quantity: number;
  line_total: number;
  is_cancelled: boolean;
}

export interface ReceiptOrder {
  order_number: string;
  created_at: string;
  table_number: number | null;
  customer_name: string | null;
  subtotal: number;
  discount: number;
  service_charge: number;
  tax: number;
  total: number;
  lines: ReceiptLine[];
}

export interface ReceiptPayment {
  method: 'cash' | 'card';
  amount: number;
  tendered: number | null;
  reference: string | null;
  received_at: string;
  voided_at: string | null;
}

export type TotalKey = 'subtotal' | 'discount' | 'serviceCharge' | 'tax' | 'total';

export interface Receipt {
  restaurantName: string;
  address: string | null;
  phone: string | null;
  /** Printed when set (settings.tax_registration_number, S5). */
  taxRegistrationNumber: string | null;
  orderNumber: string;
  /** Date and time in the restaurant's time zone (settings.timezone), not the device's. */
  date: string;
  time: string;
  /** Who it was for: a table, or a Take Away customer. */
  servedTo: { kind: 'table'; table: number } | { kind: 'takeAway'; name: string | null };
  lines: { name: string; quantity: number; amount: number }[];
  totals: { key: TotalKey; amount: number }[];
  payments: {
    method: 'cash' | 'card';
    amount: number;
    tendered: number | null;
    change: number | null;
    reference: string | null;
  }[];
  footer: string | null;
}

export function buildReceipt(
  order: ReceiptOrder,
  payments: readonly ReceiptPayment[],
  settings: ReceiptSettings,
  locale: string,
): Receipt {
  const live = payments.filter((p) => !p.voided_at);
  const paidAt = live
    .map((p) => p.received_at)
    .sort()
    .at(-1);
  const at = new Date(paidAt ?? order.created_at);
  const date = new Intl.DateTimeFormat(locale, {
    timeZone: settings.timezone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(at);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: settings.timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);

  const totals: Receipt['totals'] = [{ key: 'subtotal', amount: order.subtotal }];
  if (order.discount > 0) totals.push({ key: 'discount', amount: order.discount });
  if (order.service_charge > 0) totals.push({ key: 'serviceCharge', amount: order.service_charge });
  if (order.tax > 0) totals.push({ key: 'tax', amount: order.tax });
  totals.push({ key: 'total', amount: order.total });

  return {
    restaurantName: settings.restaurantName,
    address: settings.address ?? null,
    phone: settings.phone ?? null,
    taxRegistrationNumber: settings.taxRegistrationNumber ?? null,
    orderNumber: order.order_number,
    date,
    time,
    servedTo:
      order.table_number !== null
        ? { kind: 'table', table: order.table_number }
        : { kind: 'takeAway', name: order.customer_name },
    // Cancelled lines are not on the bill (their amount is not in the total).
    lines: order.lines
      .filter((line) => !line.is_cancelled)
      .map((line) => ({ name: line.name, quantity: line.quantity, amount: line.line_total })),
    totals,
    payments: live.map((p) => ({
      method: p.method,
      amount: p.amount,
      tendered: p.tendered,
      // As record_payment's change_due: what was handed back for this cash tender.
      change: p.tendered === null ? null : p.tendered - p.amount,
      reference: p.reference,
    })),
    footer: settings.receiptFooter,
  };
}
