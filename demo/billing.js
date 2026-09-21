// RevenueCat Web Billing integration for the Duel demo's "Pro" gate.
//
// This file imports a bare specifier (`@revenuecat/purchases-js`), which
// only browsers with an import map can resolve — plain <script
// type="module"> cannot. It's a build INPUT: `npm run build` bundles it
// (via esbuild, alongside the two library builds) into
// demo/billing.bundle.js, which is what demo/index.html actually loads.
// Run `npm install && npm run build` before opening the demo locally.
//
// API verified directly against the installed @revenuecat/purchases-js
// package's type declarations (not just docs), since docs can drift from
// what's actually shipped: Purchases.configure({apiKey, appUserId}) ->
// Purchases; purchases.getOfferings() -> Promise<Offerings>;
// purchases.purchase({rcPackage}) -> Promise<PurchaseResult>;
// purchases.isEntitledTo(id) -> Promise<boolean>.
import { Purchases, ErrorCode } from '@revenuecat/purchases-js';

// Fill this in with your own Web Billing public API key from the
// RevenueCat dashboard (Project settings -> API keys -> Web Billing).
// Until it's set, billing stays visibly "not configured" instead of
// silently failing or throwing a confusing SDK error.
const REVENUECAT_WEB_API_KEY = 'YOUR_REVENUECAT_WEB_BILLING_PUBLIC_API_KEY';

// Must match an Entitlement identifier you create in the RevenueCat
// dashboard, attached to at least one Product in a web-enabled Offering.
const PRO_ENTITLEMENT_ID = 'pro';

const APP_USER_ID_STORAGE_KEY = 'risto-demo-app-user-id';

export function isBillingConfigured() {
  return (
    typeof REVENUECAT_WEB_API_KEY === 'string' &&
    REVENUECAT_WEB_API_KEY.length > 0 &&
    !REVENUECAT_WEB_API_KEY.startsWith('YOUR_')
  );
}

function getOrCreateAppUserId() {
  let id = localStorage.getItem(APP_USER_ID_STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(APP_USER_ID_STORAGE_KEY, id);
  }
  return id;
}

let purchasesInstance = null;

/**
 * Configures the SDK once (idempotent) and returns the shared instance.
 * @returns {Purchases}
 */
function getPurchases() {
  if (!purchasesInstance) {
    purchasesInstance = Purchases.configure({
      apiKey: REVENUECAT_WEB_API_KEY,
      appUserId: getOrCreateAppUserId(),
    });
  }
  return purchasesInstance;
}

/**
 * @returns {Promise<boolean>} whether the current user already has the Pro entitlement
 */
export async function checkProStatus() {
  if (!isBillingConfigured()) return false;
  const purchases = getPurchases();
  return purchases.isEntitledTo(PRO_ENTITLEMENT_ID);
}

/**
 * Fetches the current offering and starts a purchase for the first
 * available package (preferring a monthly package if one is configured).
 * Presents RevenueCat's own hosted checkout UI as a modal.
 * @returns {Promise<{ purchased: boolean, cancelled: boolean }>}
 */
export async function purchasePro() {
  if (!isBillingConfigured()) {
    throw new Error(
      'RevenueCat is not configured — set REVENUECAT_WEB_API_KEY in demo/billing.js to your Web Billing public API key.'
    );
  }
  const purchases = getPurchases();

  const offerings = await purchases.getOfferings();
  const offering = offerings.current;
  if (!offering || offering.availablePackages.length === 0) {
    throw new Error(
      'No offering configured — create an Offering with at least one web-enabled Product/Package in the RevenueCat dashboard.'
    );
  }
  const rcPackage = offering.monthly ?? offering.availablePackages[0];

  try {
    const result = await purchases.purchase({ rcPackage });
    const active = Boolean(result.customerInfo.entitlements.active[PRO_ENTITLEMENT_ID]);
    return { purchased: active, cancelled: false };
  } catch (err) {
    if (err && err.errorCode === ErrorCode.UserCancelledError) {
      return { purchased: false, cancelled: true };
    }
    throw err;
  }
}
