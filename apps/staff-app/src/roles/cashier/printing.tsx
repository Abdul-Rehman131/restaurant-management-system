import { usePublicSettings } from '@rms/shared';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { BillDetail } from './data';
import { ReceiptView } from './ReceiptPreview';
import { buildReceipt, type Receipt } from './receipt';

/** The receipt content for a bill, from server data and settings only (receipt.ts). */
export function useReceipt(bill: BillDetail | null | undefined): Receipt | null {
  const { i18n } = useTranslation();
  const { settings } = usePublicSettings();
  if (!bill || !settings) return null;
  return buildReceipt(
    {
      order_number: bill.order_number,
      created_at: bill.created_at,
      table_number: bill.table?.number ?? null,
      customer_name: bill.customer_name,
      subtotal: bill.subtotal,
      discount: bill.discount,
      service_charge: bill.service_charge,
      tax: bill.tax,
      total: bill.total,
      lines: bill.order_batches.flatMap((batch) =>
        batch.order_items.map((line) => ({
          name: line.name_snapshot,
          quantity: line.quantity,
          line_total: line.line_total,
          is_cancelled: line.is_cancelled,
        })),
      ),
    },
    bill.payments,
    settings,
    i18n.language,
  );
}

/**
 * Prints a receipt: renders the print copy (only it prints, receipt.css), opens the browser's
 * print dialog, and removes the copy afterwards.
 */
export function usePrintReceipt(receipt: Receipt | null) {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    const done = () => {
      setPrinting(false);
    };
    window.addEventListener('afterprint', done);
    // The copy is in the page now: print it. (If a browser never fires afterprint, the copy
    // stays hidden on screen, receipt.css, until the next print.)
    window.print();
    return () => {
      window.removeEventListener('afterprint', done);
    };
  }, [printing]);
  const portal =
    printing && receipt
      ? createPortal(
          <div className="receipt-print-root">
            <ReceiptView receipt={receipt} />
          </div>,
          document.body,
        )
      : null;
  return {
    print: () => {
      if (receipt) setPrinting(true);
    },
    portal,
  };
}
