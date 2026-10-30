import * as Sentry from '@sentry/react';

/**
 * Error reporting (S6, plan T11), OFF unless VITE_SENTRY_DSN is set at build time: main.tsx
 * imports this module only then, so without a DSN no Sentry code is built at all (the bundle
 * budgets stay as they are). No DSN exists yet; the owner creates the project at go-live.
 *
 * Privacy (the restaurant's staff and guests): no IP address, cookies, request headers or
 * bodies, user details or query strings are sent; only the error, its stack, the screen's
 * path and the release. Release = the commit the build came from (VITE_RELEASE).
 */
const dsn = import.meta.env.VITE_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    release: import.meta.env.VITE_RELEASE ?? 'local',
    environment: import.meta.env.MODE,
    // Collect no personal data at all (Sentry v11's switches; beforeSend below scrubs again).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
    },
    // Errors only: no performance tracing, no session replay (they would record screens).
    tracesSampleRate: 0,
    beforeSend(event) {
      delete event.user;
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.data;
        delete event.request.query_string;
        if (event.request.url) event.request.url = event.request.url.split('?')[0] ?? '';
      }
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      // Request breadcrumbs carry URLs with ids and tokens in query strings: keep the path only.
      if (breadcrumb.data && typeof breadcrumb.data['url'] === 'string') {
        breadcrumb.data['url'] = breadcrumb.data['url'].split('?')[0];
      }
      return breadcrumb;
    },
  });
}
