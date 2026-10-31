import i18n from 'i18next';

import '../../i18n/rpc';
import enCashier from '../../i18n/locales/en/cashier.json';

// The cashier's strings travel with the cashier chunk, not the signed-in shell (plan 4.10).
i18n.addResourceBundle('en', 'cashier', enCashier, true, false);
