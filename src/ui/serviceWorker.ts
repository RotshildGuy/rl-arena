/**
 * The service worker (`public/sw.js`) is there only so the site can be
 * installed ("add to home screen"). Registered at startup, after the page has
 * loaded, so it never competes with the first render.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js')
      .then(dropOldNotifications)
      .catch(() => {
        // An installable site is a bonus; a failed registration changes nothing else.
      });
  });
}

/**
 * The site used to send race notifications, and a device that turned them on
 * still holds a subscription for them. Nothing sends any more; dropping the
 * subscription makes sure nothing can, and forgets the old switch.
 */
async function dropOldNotifications(registration: ServiceWorkerRegistration): Promise<void> {
  try {
    localStorage.removeItem('rl-arena-push');
  } catch {
    // Only a leftover flag.
  }
  if (!('pushManager' in registration)) return;
  const subscription = await registration.pushManager.getSubscription().catch(() => null);
  await subscription?.unsubscribe().catch(() => false);
}
