import "server-only";
import { createHash } from "node:crypto";
import { HttpError } from "./http";
import { decimalAmount, matchesAmount, safeApprovalUrl } from "./policy";
import type { Milestone, PurchaseOrder } from "./types";

export const PAYPAL_BASE = "https://api-m.sandbox.paypal.com";
type Amount = { currency_code: string; value: string };
export type ProviderPayment = {
  id: string;
  status: string;
  amount: Amount;
  expiration_time?: string;
  create_time?: string;
};
export type ProviderOrder = {
  id: string;
  intent: string;
  status: string;
  purchase_units: {
    reference_id?: string;
    custom_id?: string;
    amount: Amount;
    payee?: { merchant_id?: string };
    payments?: {
      authorizations?: ProviderPayment[];
      captures?: ProviderPayment[];
    };
  }[];
  links?: { href: string; rel: string }[];
};
let cachedToken: { token: string; expires: number } | undefined;
export function paymentsConfigured() {
  return [
    "PAYPAL_CLIENT_ID",
    "PAYPAL_CLIENT_SECRET",
    "PAYPAL_MERCHANT_ID",
  ].every((k) => Boolean(process.env[k]));
}
function required(key: string) {
  const value = process.env[key];
  if (!value)
    throw new HttpError(
      503,
      "PayPal Sandbox is not connected yet. Add the sandbox app credentials and merchant ID on the server.",
    );
  return value;
}
export const requestId = (operation: string, key: string) =>
  createHash("sha256")
    .update(operation + ":" + key)
    .digest("hex")
    .slice(0, 32);
async function readResponse(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(502, "PayPal returned an empty response.");
  let size = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.length;
    if (size > 1_000_000) {
      await reader.cancel();
      throw new HttpError(502, "PayPal returned an oversized response.");
    }
    parts.push(item.value);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(parts).toString());
  } catch {
    throw new HttpError(502, "PayPal returned an unreadable response.");
  }
  return value;
}
export async function getPayPalAccessToken() {
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.token;
  const response = await fetch(PAYPAL_BASE + "/v1/oauth2/token", {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(
          required("PAYPAL_CLIENT_ID") + ":" + required("PAYPAL_CLIENT_SECRET"),
        ).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await readResponse(response);
  if (!response.ok || typeof data.access_token !== "string")
    throw new HttpError(
      502,
      "PayPal Sandbox could not authenticate this app. Check the sandbox credentials.",
    );
  cachedToken = {
    token: data.access_token,
    expires: Date.now() + Math.max(0, Number(data.expires_in) - 60) * 1000,
  };
  return cachedToken.token;
}
export async function paypal<T>(
  path: string,
  method = "GET",
  payload?: unknown,
  key?: string,
): Promise<T> {
  if (!/^\/v[12]\/[a-zA-Z0-9/_-]+$/.test(path))
    throw new Error("Invalid provider path.");
  const response = await fetch(PAYPAL_BASE + path, {
    method,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
    headers: {
      Authorization: "Bearer " + (await getPayPalAccessToken()),
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(key ? { "PayPal-Request-Id": key } : {}),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  if (response.status === 204 && response.ok) return {} as T;
  const data = await readResponse(response);
  if (!response.ok) {
    const issue = data?.details?.[0]?.issue;
    if (issue === "INSTRUMENT_DECLINED")
      throw new HttpError(
        422,
        "PayPal declined this funding source. Choose another sandbox funding source.",
      );
    if (issue === "AUTHORIZATION_EXPIRED")
      throw new HttpError(
        409,
        "The payment authorization expired. A new buyer authorization is required.",
      );
    throw new HttpError(
      response.status === 429 ? 429 : 502,
      "PayPal Sandbox could not complete the request. Refresh the payment status before retrying.",
    );
  }
  return data as T;
}
export function providerId(value: string) {
  if (!/^[A-Z0-9]{8,40}$/.test(value))
    throw new HttpError(502, "Invalid PayPal reference.");
  return value;
}
export function validateOrder(order: ProviderOrder, milestone: Milestone) {
  const unit = order.purchase_units?.[0];
  if (
    order.id !== milestone.paypal_order_id ||
    order.intent !== (milestone.payment_intent || "AUTHORIZE") ||
    order.purchase_units?.length !== 1 ||
    unit?.custom_id !== milestone.id ||
    unit.reference_id !== milestone.id ||
    !matchesAmount(unit.amount, milestone.amount_cents) ||
    unit.payee?.merchant_id !== required("PAYPAL_MERCHANT_ID")
  )
    throw new HttpError(
      409,
      "The PayPal order does not match this milestone's amount, currency or supplier merchant.",
    );
  return unit;
}
export async function createPayment(m: Milestone, order: PurchaseOrder) {
  const origin = required("APP_ORIGIN");
  const result = await paypal<ProviderOrder>(
    "/v2/checkout/orders",
    "POST",
    {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: m.id,
          custom_id: m.id,
          description: (order.number + " · " + m.title).slice(0, 127),
          amount: {
            currency_code: "USD",
            value: decimalAmount(m.amount_cents),
          },
          payee: { merchant_id: required("PAYPAL_MERCHANT_ID") },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "SilkPay",
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: origin + "/payment/return?milestone=" + m.id,
            cancel_url: origin + "/?order=" + order.id + "&payment=cancelled",
          },
        },
      },
    },
    requestId("create", m.attempt_key),
  );
  providerId(result.id);
  const url = result.links?.find(
    (l) => l.rel === "payer-action" || l.rel === "approve",
  )?.href;
  if (!url)
    throw new HttpError(502, "PayPal did not provide an approval link.");
  return { id: result.id, url: safeApprovalUrl(url) };
}
export async function retrieveOrder(m: Milestone) {
  if (!m.paypal_order_id)
    throw new HttpError(409, "Start the PayPal authorization first.");
  const order = await paypal<ProviderOrder>(
    "/v2/checkout/orders/" + providerId(m.paypal_order_id),
  );
  validateOrder(order, m);
  return order;
}
export async function authorizePayment(m: Milestone) {
  const order = await retrieveOrder(m);
  if (order.status !== "APPROVED" && order.status !== "COMPLETED")
    throw new HttpError(
      409,
      "Complete buyer approval in PayPal Sandbox first.",
    );
  const existing = order.purchase_units[0].payments?.authorizations?.[0];
  const result = existing
    ? order
    : await paypal<ProviderOrder>(
        "/v2/checkout/orders/" + providerId(order.id) + "/authorize",
        "POST",
        {},
        requestId("authorize", m.attempt_key),
      );
  const unit = validateOrder(result, m),
    a = unit.payments?.authorizations?.[0];
  if (
    !a ||
    a.status !== "CREATED" ||
    !matchesAmount(a.amount, m.amount_cents) ||
    !a.expiration_time ||
    !Number.isFinite(Date.parse(a.expiration_time))
  )
    throw new HttpError(
      409,
      "PayPal has not confirmed an available authorization.",
    );
  providerId(a.id);
  return a;
}
export async function capturePayment(m: Milestone) {
  if (!m.authorization_id)
    throw new HttpError(409, "A confirmed authorization is required.");
  const capture = await paypal<ProviderPayment>(
    "/v2/payments/authorizations/" +
      providerId(m.authorization_id) +
      "/capture",
    "POST",
    {
      amount: { currency_code: "USD", value: decimalAmount(m.amount_cents) },
      final_capture: true,
      note_to_payer: "SilkPay milestone accepted: " + m.title,
    },
    requestId("capture", m.attempt_key),
  );
  if (!matchesAmount(capture.amount, m.amount_cents))
    throw new HttpError(502, "PayPal returned a different capture amount.");
  providerId(capture.id);
  return capture;
}

/** Amount is integer cents from the database, never from the browser. */
export async function createOrder(
  amount: number,
  currency: "USD",
  context: { milestone: Milestone; order: PurchaseOrder },
) {
  const { milestone: m, order } = context;
  if (amount !== m.amount_cents || currency !== "USD")
    throw new HttpError(400, "The checkout must match the stored milestone.");
  const origin = required("APP_ORIGIN");
  const result = await paypal<ProviderOrder>(
    "/v2/checkout/orders",
    "POST",
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: m.id,
          custom_id: m.id,
          description: (order.number + " · " + m.title).slice(0, 127),
          amount: { currency_code: currency, value: decimalAmount(amount) },
          payee: { merchant_id: required("PAYPAL_MERCHANT_ID") },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "SilkPay",
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url:
              origin + "/payment/return?intent=CAPTURE&milestone=" + m.id,
            cancel_url: origin + "/?payment=cancelled",
          },
        },
      },
    },
    requestId("create-order", m.attempt_key),
  );
  providerId(result.id);
  const url = result.links?.find(
    (l) => l.rel === "payer-action" || l.rel === "approve",
  )?.href;
  if (!url) throw new HttpError(502, "PayPal did not provide a checkout link.");
  return { id: result.id, url: safeApprovalUrl(url) };
}

/** Caller must first acquire the settlement lease and validate the current review. */
export async function captureOrder(orderId: string, milestone: Milestone) {
  if (
    orderId !== milestone.paypal_order_id ||
    milestone.payment_intent !== "CAPTURE"
  )
    throw new HttpError(409, "This checkout does not belong to the milestone.");
  const before = await retrieveOrder(milestone);
  if (before.status !== "APPROVED" && before.status !== "COMPLETED")
    throw new HttpError(
      409,
      "Complete PayPal Sandbox approval before capture.",
    );
  const result = before.purchase_units[0].payments?.captures?.length
    ? before
    : await paypal<ProviderOrder>(
        "/v2/checkout/orders/" + providerId(orderId) + "/capture",
        "POST",
        {},
        requestId("capture-order", milestone.attempt_key),
      );
  const units = result.purchase_units;
  const capture = units?.[0]?.payments?.captures?.[0];
  // A capture response may omit custom_id and the purchase-unit amount.
  // Their values were checked against GET /orders immediately before capture.
  if (
    result.id !== orderId ||
    units?.length !== 1 ||
    units[0].payments?.captures?.length !== 1 ||
    !capture ||
    !matchesAmount(capture.amount, milestone.amount_cents)
  )
    throw new HttpError(
      502,
      "PayPal did not confirm the exact milestone capture.",
    );
  providerId(capture.id);
  return capture;
}
