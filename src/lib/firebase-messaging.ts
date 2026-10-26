/**
 * Browser-only Firebase Messaging loader.
 *
 * The Firebase browser SDK is loaded from Google's versioned CDN so this
 * feature does not require bundling Firebase into the large app dependency
 * graph. Admin credentials never enter this module.
 */
type FirebaseModule = {
  initializeApp: (config: Record<string, string>) => unknown;
  getApps: () => unknown[];
  getApp: () => unknown;
};
type MessagingModule = {
  isSupported: () => Promise<boolean>;
  getMessaging: (app?: unknown) => unknown;
  getToken: (messaging: unknown, options: { vapidKey: string; serviceWorkerRegistration: ServiceWorkerRegistration }) => Promise<string>;
  onMessage: (messaging: unknown, callback: (payload: FcmPayload) => void) => () => void;
  deleteToken: (messaging: unknown) => Promise<boolean>;
};
export type FcmPayload = {
  notification?: { title?: string; body?: string };
  data?: Record<string, string>;
};
type FcmRuntime = { messaging: unknown; sdk: MessagingModule };

const FIREBASE_VERSION = "10.14.1";
const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) || "xplorepondy-notifications",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

let runtimePromise: Promise<FcmRuntime> | undefined;

async function loadModule<T>(url: string): Promise<T> {
  // @vite-ignore — Firebase is intentionally loaded from Google's CDN.
  return import(/* @vite-ignore */ url) as Promise<T>;
}

async function getRuntime(): Promise<FcmRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      if (!FIREBASE_CONFIG.apiKey || !FIREBASE_CONFIG.messagingSenderId || !FIREBASE_CONFIG.appId || !VAPID_KEY) {
        throw new Error("Firebase web messaging configuration is incomplete. Check the VITE_FIREBASE_* environment variables.");
      }
      const [appSdk, messagingSdk] = await Promise.all([
        loadModule<FirebaseModule>(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
        loadModule<MessagingModule>(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-messaging.js`),
      ]);
      const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp({
        apiKey: FIREBASE_CONFIG.apiKey,
        authDomain: FIREBASE_CONFIG.authDomain || "",
        projectId: FIREBASE_CONFIG.projectId || "",
        messagingSenderId: FIREBASE_CONFIG.messagingSenderId,
        appId: FIREBASE_CONFIG.appId,
      });
      if (!(await messagingSdk.isSupported())) {
        throw new Error("Firebase push messaging is not supported in this browser or device.");
      }
      return { messaging: messagingSdk.getMessaging(app), sdk: messagingSdk };
    })().catch((error) => {
      runtimePromise = undefined;
      throw error;
    });
  }
  return runtimePromise;
}

function decodeVapidKey(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function isFcmPushSubscription(subscription: PushSubscription | null): Promise<boolean> {
  if (!subscription || !VAPID_KEY) return false;
  const applicationServerKey = subscription.options.applicationServerKey;
  if (!applicationServerKey) return false;
  const actual = new Uint8Array(applicationServerKey);
  const expected = decodeVapidKey(VAPID_KEY);
  return actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
}

export type FcmDeviceRegistration = { token: string; endpoint: string };

export async function getFcmDeviceToken(): Promise<FcmDeviceRegistration> {
  const { messaging, sdk } = await getRuntime();
  const registration = await navigator.serviceWorker.ready;
  const currentSubscription = await registration.pushManager.getSubscription();
  if (currentSubscription && !(await isFcmPushSubscription(currentSubscription))) {
    throw new Error("This device still has a legacy push subscription. Re-register it with Firebase before sending FCM notifications.");
  }
  const token = await sdk.getToken(messaging, {
    vapidKey: VAPID_KEY as string,
    serviceWorkerRegistration: registration,
  });
  if (!token) throw new Error("Firebase did not return a device token.");
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) throw new Error("Firebase did not create a browser push subscription.");
  return { token, endpoint: subscription.endpoint };
}

export async function listenForForegroundFcm(callback: (payload: FcmPayload) => void): Promise<() => void> {
  const { messaging, sdk } = await getRuntime();
  return sdk.onMessage(messaging, callback);
}

export async function revokeFcmToken(): Promise<boolean> {
  const { messaging, sdk } = await getRuntime();
  return sdk.deleteToken(messaging);
}
