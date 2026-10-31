import i18n from 'i18next';

import enShift from '../i18n/locales/en/shift.json';

// The shift strings travel with the role chunks that have a shift, not the signed-in shell.
i18n.addResourceBundle('en', 'shift', enShift, true, false);
