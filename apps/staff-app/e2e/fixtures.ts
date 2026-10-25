import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

/**
 * Every spec imports `test` from here. When a test fails, its failed requests are attached,
 * and a failure caused by the HOST's network changing is named as such.
 *
 * Why: in the S2 flake investigation, one failure was a blank page because every dev-server
 * module request ended with net::ERR_NETWORK_CHANGED. The Windows event log showed the
 * machine's Wi-Fi dropping and reconnecting at that second; Chromium then aborts in-flight
 * requests, even to localhost. That is not an app or test bug, and retrying or sleeping would
 * hide real ones, so the failure states its cause instead of looking random.
 */
export const test = base.extend<{ requestFailures: string[] }>({
  requestFailures: [
    async ({ context }, use, testInfo) => {
      const failures: string[] = [];
      context.on('requestfailed', (request) => {
        failures.push(
          `${request.failure()?.errorText ?? 'failed'} ${request.method()} ${request.url()}`,
        );
      });
      await use(failures);
      if (testInfo.status === testInfo.expectedStatus) return;
      if (failures.length > 0) {
        await testInfo.attach('failed-requests', {
          body: failures.join('\n'),
          contentType: 'text/plain',
        });
      }
      if (failures.some((f) => f.startsWith('net::ERR_NETWORK_CHANGED'))) {
        const description =
          'The machine running the browser changed network (Wi-Fi drop, VPN, adapter) during this test: Chromium aborted requests with ERR_NETWORK_CHANGED. Check the OS network log, then re-run.';
        testInfo.annotations.push({ type: 'host-network-changed', description });
        console.warn(`[host-network-changed] ${description}`);
      }
    },
    { auto: true },
  ],
});
