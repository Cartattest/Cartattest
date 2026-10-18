import canonicalize from "canonicalize";
import { sha256 } from "../domain/Hash.js";
import type {
  CartBindingItemV1,
  CartBindingV1,
  MoneyBreakdown,
  NormalizedAddress,
  Sha256
} from "../domain/types.js";

type JsonObject = Record<string, unknown>;

/** Project only the material CartBindingV1 fields from a PayPal Orders v2 response. */
export function mapPayPalOrderToBinding(value: unknown): CartBindingV1 {
  const order = object(value, "PAYPAL_ORDER_INVALID");
  if (order.intent !== "CAPTURE") throw new Error("UNSUPPORTED_PAYPAL_INTENT");

  const purchaseUnits = order.purchase_units;
  if (!Array.isArray(purchaseUnits) || purchaseUnits.length !== 1) {
    throw new Error("UNSUPPORTED_PURCHASE_UNIT_COUNT");
  }
  const unit = object(purchaseUnits[0], "PAYPAL_PURCHASE_UNIT_INVALID");
  const preference = shippingPreference(order);
  if (preference !== "SET_PROVIDED_ADDRESS") throw new Error("FIXED_SHIPPING_REQUIRED");

  const payee = object(unit.payee, "PAYPAL_PAYEE_MISSING");
  const payeeBinding = typeof payee.merchant_id === "string" && payee.merchant_id.length > 0
    ? { identityType: "MERCHANT_ID" as const, identityValue: payee.merchant_id }
    : typeof payee.email_address === "string" && payee.email_address.length > 0
      ? { identityType: "EMAIL" as const, identityValue: payee.email_address }
      : undefined;
  if (!payeeBinding) throw new Error("PAYPAL_PAYEE_MISSING");

  const amount = object(unit.amount, "PAYPAL_AMOUNT_MISSING");
  const currency = string(amount.currency_code, "PAYPAL_CURRENCY_MISSING");
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("PAYPAL_CURRENCY_INVALID");
  const breakdown = object(amount.breakdown ?? {}, "PAYPAL_AMOUNT_BREAKDOWN_INVALID");
  const amountBreakdown: MoneyBreakdown = {
    itemTotal: optionalMoney(breakdown.item_total, currency),
    taxTotal: optionalMoney(breakdown.tax_total, currency),
    shipping: optionalMoney(breakdown.shipping, currency),
    handling: optionalMoney(breakdown.handling, currency),
    insurance: optionalMoney(breakdown.insurance, currency),
    shippingDiscount: optionalMoney(breakdown.shipping_discount, currency),
    discount: optionalMoney(breakdown.discount, currency),
    total: money(amount, currency)
  };

  const shipping = object(unit.shipping, "PAYPAL_SHIPPING_MISSING");
  const address = object(shipping.address, "PAYPAL_SHIPPING_ADDRESS_MISSING");
  const selectedOptions = Array.isArray(shipping.options)
    ? shipping.options.map((option) => object(option, "PAYPAL_SHIPPING_OPTION_INVALID")).filter((option) => option.selected === true)
    : [];
  if (selectedOptions.length !== 1) throw new Error("PAYPAL_SELECTED_SHIPPING_OPTION_INVALID");
  const selectedOption = selectedOptions[0]!;
  const optionType = selectedOption.type === undefined ? "SHIPPING" : string(selectedOption.type, "PAYPAL_SHIPPING_TYPE_MISSING");
  const shippingName = object(shipping.name, "PAYPAL_SHIPPING_NAME_MISSING");
  const addressBinding = mapAddress(address);

  const rawItems = unit.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new Error("PAYPAL_ITEMS_MISSING");
  const items: CartBindingItemV1[] = rawItems.map((rawItem) => {
    const item = object(rawItem, "PAYPAL_ITEM_INVALID");
    const unitAmount = object(item.unit_amount, "PAYPAL_ITEM_AMOUNT_MISSING");
    const itemTax = item.tax === undefined ? "0.00" : money(item.tax, currency);
    if (unitAmount.currency_code !== currency) throw new Error("PAYPAL_ITEM_CURRENCY_MISMATCH");
    return {
      name: string(item.name, "PAYPAL_ITEM_NAME_MISSING"),
      sku: string(item.sku, "PAYPAL_ITEM_SKU_MISSING"),
      quantity: positiveInteger(item.quantity),
      unitAmount: money(unitAmount, currency),
      tax: itemTax
    };
  });

  return {
    schemaVersion: "cart-binding-v1",
    intent: "CAPTURE",
    purchaseUnitCount: 1,
    payee: payeeBinding,
    currency,
    amountBreakdown,
    shipping: {
      preference: "SET_PROVIDED_ADDRESS",
      name: string(shippingName.full_name, "PAYPAL_SHIPPING_NAME_MISSING"),
      address: addressBinding,
      optionId: string(selectedOption.id, "PAYPAL_SHIPPING_OPTION_ID_MISSING"),
      type: optionType,
      amount: money(selectedOption.amount, currency)
    },
    items
  };
}

/**
 * Implement TWO mappers that yield the identical CartBindingV1 structure:
 * 1) trusted merchant/gateway selection -> CartBindingV1
 * 2) PayPal order response -> CartBindingV1
 *
 * Rules:
 * - intent must be CAPTURE
 * - exactly one purchase unit
 * - bind payee, complete amount breakdown, fixed provided shipping address/option, item name+variant SKU+quantity+unit amount+tax
 * - normalize missing amount breakdown components to exact zero values
 * - ignore payer data, HATEOAS links, timestamps, custom_id and other explicitly non-material metadata
 * - canonicalize with RFC 8785/JCS before SHA-256
 */
export function assertBindingEqual(expected: CartBindingV1, actual: CartBindingV1): void {
  if (canonicalBinding(expected) !== canonicalBinding(actual)) {
    throw new Error("CART_BINDING_MISMATCH");
  }
}

export async function hashCartBinding(binding: CartBindingV1): Promise<Sha256> {
  return sha256(canonicalBinding(binding));
}

function canonicalBinding(binding: CartBindingV1): string {
  const serialized = canonicalize(binding);
  if (serialized === undefined) throw new Error("CART_BINDING_NOT_JSON");
  return serialized;
}

function shippingPreference(order: JsonObject): unknown {
  const appContext = isObject(order.application_context) ? order.application_context.shipping_preference : undefined;
  const paypal = isObject(order.payment_source) && isObject(order.payment_source.paypal)
    ? order.payment_source.paypal
    : undefined;
  const paypalExperience = paypal && isObject(paypal.experience_context) ? paypal.experience_context.shipping_preference : undefined;
  if (appContext !== undefined && paypalExperience !== undefined && appContext !== paypalExperience) {
    throw new Error("PAYPAL_SHIPPING_PREFERENCE_CONFLICT");
  }
  return paypalExperience ?? appContext;
}

function mapAddress(value: JsonObject): NormalizedAddress {
  const line1 = string(value.address_line_1, "PAYPAL_SHIPPING_ADDRESS_INCOMPLETE");
  const city = string(value.admin_area_2, "PAYPAL_SHIPPING_ADDRESS_INCOMPLETE");
  const postalCode = string(value.postal_code, "PAYPAL_SHIPPING_ADDRESS_INCOMPLETE");
  const countryCode = string(value.country_code, "PAYPAL_SHIPPING_ADDRESS_INCOMPLETE");
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error("PAYPAL_SHIPPING_COUNTRY_INVALID");
  return {
    addressLine1: line1,
    ...(typeof value.address_line_2 === "string" && value.address_line_2.length > 0 ? { addressLine2: value.address_line_2 } : {}),
    adminArea2: city,
    ...(typeof value.admin_area_1 === "string" && value.admin_area_1.length > 0 ? { adminArea1: value.admin_area_1 } : {}),
    postalCode,
    countryCode
  };
}

function optionalMoney(value: unknown, currency: string): string {
  return value === undefined ? "0.00" : money(value, currency);
}

function money(value: unknown, currency: string): string {
  const amount = object(value, "PAYPAL_MONEY_INVALID");
  if (amount.currency_code !== currency) throw new Error("PAYPAL_AMOUNT_CURRENCY_MISMATCH");
  const result = string(amount.value, "PAYPAL_AMOUNT_VALUE_MISSING");
  if (!/^(0|[1-9][0-9]*)\.[0-9]{2}$/.test(result)) throw new Error("PAYPAL_AMOUNT_VALUE_INVALID");
  return result;
}

function positiveInteger(value: unknown): string {
  const result = string(value, "PAYPAL_ITEM_QUANTITY_MISSING");
  if (!/^[1-9][0-9]*$/.test(result)) throw new Error("PAYPAL_ITEM_QUANTITY_INVALID");
  return result;
}

function object(value: unknown, error: string): JsonObject {
  if (!isObject(value)) throw new Error(error);
  return value;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown, error: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(error);
  return value;
}
