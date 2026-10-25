import i18n from 'i18next';

import '../../i18n/rpc';
import enWaiter from '../../i18n/locales/en/waiter.json';

// The waiter's strings travel with the waiter chunk, not the signed-in shell (plan 4.10).
i18n.addResourceBundle('en', 'waiter', enWaiter, true, false);
