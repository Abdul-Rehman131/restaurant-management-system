import i18n from 'i18next';

import enOrdering from '../i18n/locales/en/ordering.json';

// Order entry strings (menu picker, review sheet), loaded with the role chunks that take
// orders, never with the signed-in shell (plan 4.10).
i18n.addResourceBundle('en', 'ordering', enOrdering, true, false);
