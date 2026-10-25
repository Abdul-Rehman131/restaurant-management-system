import i18n from 'i18next';

import '../../i18n/rpc';
import enKitchen from '../../i18n/locales/en/kitchen.json';

// The kitchen's strings travel with the kitchen chunk, not the signed-in shell (plan 4.10).
i18n.addResourceBundle('en', 'kitchen', enKitchen, true, false);
