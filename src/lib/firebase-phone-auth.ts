/**
 * Firebase Phone Authentication for reservation phone verification.
 * Browser-only Firebase SDK; server enforcement happens in WordPress by
 * verifying the resulting Firebase ID token and its phone_number claim.
 */
type FirebaseAppModule = {
  initializeApp: (config: Record<string, string>) => unknown;
  getApps: () => unknown[];
  getApp: () => unknown;
};
type FirebaseAuthModule = {
  getAuth: (app?: unknown) => unknown;
  RecaptchaVerifier: new (auth: unknown, container: string, parameters: Record<string, unknown>) => { clear: () => void };
  signInWithPhoneNumber: (auth: unknown, phoneNumber: string, verifier: unknown) => Promise<{ confirm: (code: string) => Promise<{ user: { phoneNumber: string | null; getIdToken: (forceRefresh?: boolean) => Promise<string> } }> }>;
};
const VERSION = "10.14.1";
const CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) || "xplorepondy-notifications",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};
let authRuntime: Promise<{ auth: unknown; sdk: FirebaseAuthModule }> | undefined;
let activeVerifier: InstanceType<FirebaseAuthModule["RecaptchaVerifier"]> | undefined;
let activeConfirmation: Awaited<ReturnType<FirebaseAuthModule["signInWithPhoneNumber"]>> | undefined;
let activePhone = "";

async function load<T>(url: string): Promise<T> {
  return import(/* @vite-ignore */ url) as Promise<T>;
}
async function getRuntime() {
  if (!authRuntime) {
    authRuntime = (async () => {
      if (!CONFIG.apiKey || !CONFIG.authDomain || !CONFIG.projectId || !CONFIG.appId || !CONFIG.messagingSenderId) {
        throw new Error("Firebase Authentication configuration is incomplete. Check the public VITE_FIREBASE_* settings.");
      }
      const [appSdk, authSdk] = await Promise.all([
        load<FirebaseAppModule>(`https://www.gstatic.com/firebasejs/${VERSION}/firebase-app.js`),
        load<FirebaseAuthModule>(`https://www.gstatic.com/firebasejs/${VERSION}/firebase-auth.js`),
      ]);
      const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp({
        apiKey: CONFIG.apiKey!, authDomain: CONFIG.authDomain!, projectId: CONFIG.projectId!,
        messagingSenderId: CONFIG.messagingSenderId!, appId: CONFIG.appId!,
      });
      return { auth: authSdk.getAuth(app), sdk: authSdk };
    })().catch((error) => { authRuntime = undefined; throw error; });
  }
  return authRuntime;
}

export function normalizeReservationPhone(input: string): string {
  const raw = input.trim();
  const digits = raw.replace(/[^\d]/g, "");
  if (/^\+?91/.test(raw) && digits.length === 12 && digits.startsWith("91")) return "+" + digits;
  if (/^\d{10}$/.test(digits)) return "+91" + digits;
  if (/^\d{11}$/.test(digits) && digits.startsWith("0")) return "+91" + digits.slice(1);
  if (/^\+?[1-9]\d{7,14}$/.test(raw.replace(/[\s().-]/g, ""))) {
    const value = raw.replace(/[\s().-]/g, "");
    return value.startsWith("+") ? value : "+" + value;
  }
  throw new Error("Enter a valid mobile number with country code, or a 10-digit Indian mobile number.");
}

export async function sendReservationPhoneOtp(phoneInput: string, recaptchaContainerId: string): Promise<string> {
  const phone = normalizeReservationPhone(phoneInput);
  const { auth, sdk } = await getRuntime();
  if (activeVerifier) { activeVerifier.clear(); activeVerifier = undefined; }
  activeConfirmation = undefined;
  activePhone = "";
  const verifier = new sdk.RecaptchaVerifier(auth, recaptchaContainerId, { size: "normal" });
  activeVerifier = verifier;
  try {
    activeConfirmation = await sdk.signInWithPhoneNumber(auth, phone, verifier);
    activePhone = phone;
    return phone;
  } catch (error) {
    verifier.clear();
    activeVerifier = undefined;
    throw error;
  }
}

export async function confirmReservationPhoneOtp(code: string): Promise<{ phoneNumber: string; idToken: string }> {
  if (!activeConfirmation || !activePhone) throw new Error("Request a new verification code first.");
  if (!/^\d{6}$/.test(code.trim())) throw new Error("Enter the 6-digit code sent by SMS.");
  const result = await activeConfirmation.confirm(code.trim());
  const phoneNumber = result.user.phoneNumber;
  if (!phoneNumber || phoneNumber !== activePhone) throw new Error("The verified phone number does not match the booking number.");
  const idToken = await result.user.getIdToken(true);
  activeConfirmation = undefined;
  if (activeVerifier) { activeVerifier.clear(); activeVerifier = undefined; }
  return { phoneNumber, idToken };
}

export function clearReservationPhoneOtp() {
  activeConfirmation = undefined;
  activePhone = "";
  if (activeVerifier) { activeVerifier.clear(); activeVerifier = undefined; }
}
