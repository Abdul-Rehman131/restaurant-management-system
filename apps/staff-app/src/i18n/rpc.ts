import i18n from 'i18next';

import enRpc from './locales/en/rpc.json';

// The `rpc` namespace (RPC error messages, src/lib/rpc.ts) belongs to the role screens, not
// to the shell bundle (plan 4.10): each role chunk imports this module. Other languages load
// lazily, like every namespace.
i18n.addResourceBundle('en', 'rpc', enRpc, true, false);
