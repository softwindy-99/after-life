/// <reference lib="webworker" />

const serviceWorker = self as unknown as ServiceWorkerGlobalScope;

interface NotificationPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

serviceWorker.addEventListener("install", (event) => {
  event.waitUntil(serviceWorker.skipWaiting());
});

serviceWorker.addEventListener("activate", (event) => {
  event.waitUntil(clearLegacyCaches());
});

serviceWorker.addEventListener("push", (event) => {
  const payload = readNotificationPayload(event);
  event.waitUntil(
    serviceWorker.registration.showNotification(payload.title || "After Life", {
      body: payload.body || "你有一条新提醒。",
      icon: "/icons/pwa-192.png",
      badge: "/icons/pwa-192.png",
      tag: payload.tag || "after-life-notification",
      data: { url: payload.url || "/checkin" },
    }),
  );
});

serviceWorker.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    String(event.notification.data?.url || "/checkin"),
    serviceWorker.location.origin,
  );
  const targetUrl =
    target.origin === serviceWorker.location.origin ? target.href : serviceWorker.location.origin;

  event.waitUntil(
    serviceWorker.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windowClients) => {
        const matchingClient = windowClients.find((client) => {
          const clientUrl = new URL(client.url);
          return clientUrl.origin === target.origin;
        });
        if (matchingClient) {
          await matchingClient.navigate(targetUrl);
          return matchingClient.focus();
        }
        return serviceWorker.clients.openWindow(targetUrl);
      }),
  );
});

async function clearLegacyCaches(): Promise<void> {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
  await serviceWorker.clients.claim();
}

function readNotificationPayload(event: PushEvent): NotificationPayload {
  if (!event.data) return {};
  try {
    const value: unknown = event.data.json();
    return value && typeof value === "object" ? (value as NotificationPayload) : {};
  } catch {
    return { body: event.data.text() };
  }
}
