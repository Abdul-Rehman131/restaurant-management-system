import i18n from 'i18next';

import '../../i18n/rpc';
import enAdmin from '../../i18n/locales/en/admin.json';

// The Admin's strings travel with the admin chunk, not the signed-in shell (plan 4.10).
i18n.addResourceBundle('en', 'admin', enAdmin, true, false);
