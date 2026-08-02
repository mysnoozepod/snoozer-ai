const { resolveRewardsIdentity } = require("./rewards/identity");
const customerProfile = require("./customerProfile");
const shopify = require("./shopify");

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function validCartId(value) {
  return /^gid:\/\/shopify\/Cart\/[^/#?\s]+(?:\?key=[^#\s]+)?$/i.test(clean(value));
}

function isExpiredCartError(error) {
  const code = clean(error?.code).toUpperCase();
  const statusCode = Number(error?.statusCode || error?.status || 0);
  const message = clean(error?.message).toLowerCase();
  return (
    code === "CART_NOT_FOUND" ||
    statusCode === 404 ||
    /cart\s+(?:was\s+)?(?:not found|expired|invalid|does not exist)/i.test(message)
  );
}

function cartResponse(identity, cart, extra = {}) {
  return {
    cart: cart || null,
    cartId: clean(cart?.id) || null,
    checkoutUrl: clean(cart?.checkoutUrl) || null,
    shopperId: identity.shopperId,
    profileId: identity.profileId,
    ...extra,
  };
}

async function persistCart(identity, cart, options = {}) {
  await (options.customerProfileService || customerProfile).upsertCustomerProfile(
    {
      profileId: identity.profileId,
      shopperId: identity.shopperId,
      sessionId: identity.sessionId,
      shopifyCartId: clean(cart?.id) || undefined,
      shopifyCheckoutUrl: clean(cart?.checkoutUrl) || undefined,
      shopifyCartStatus: "active",
      cartUpdatedAt: new Date().toISOString(),
      sourceSurface: "shopify_cart",
    },
    options.customerProfileOptions || {}
  );
}

async function markCartExpired(identity, options = {}) {
  await (options.customerProfileService || customerProfile).upsertCustomerProfile(
    {
      profileId: identity.profileId,
      shopperId: identity.shopperId,
      sessionId: identity.sessionId,
      shopifyCartStatus: "expired",
      cartUpdatedAt: new Date().toISOString(),
      sourceSurface: "shopify_cart",
    },
    options.customerProfileOptions || {}
  );
}

async function identityFor(event, options = {}) {
  return (options.resolveIdentity || resolveRewardsIdentity)(event, options.identityOptions || {});
}

async function resolveShopperCart(event, options = {}) {
  const identity = await identityFor(event, options);
  const cartId = clean(identity.profile?.shopifyCartId);
  if (!validCartId(cartId)) {
    return cartResponse(identity, null, { restored: false, reason: "NO_OWNED_CART" });
  }

  try {
    const cart = await (options.shopify || shopify).getCart({ cartId });
    await persistCart(identity, cart, options);
    return cartResponse(identity, cart, { restored: true });
  } catch (error) {
    if (!isExpiredCartError(error)) throw error;
    await markCartExpired(identity, options);
    return cartResponse(identity, null, {
      restored: false,
      recovered: true,
      reason: "OWNED_CART_EXPIRED",
      previousCartId: cartId,
    });
  }
}

async function addShopperCartLines(event, lines, options = {}) {
  const identity = await identityFor(event, options);
  const client = options.shopify || shopify;
  const existingCartId = clean(identity.profile?.shopifyCartId);
  let cart = null;
  let recovered = false;

  if (validCartId(existingCartId)) {
    try {
      cart = await client.addCartLines({ cartId: existingCartId, lines });
    } catch (error) {
      if (!isExpiredCartError(error)) throw error;
      await markCartExpired(identity, options);
      recovered = true;
    }
  }
  if (!cart) cart = await client.createCart({ lines });

  await persistCart(identity, cart, options);
  return cartResponse(identity, cart, { restored: validCartId(existingCartId) && !recovered, recovered });
}

async function mutateOwnedCart(event, mutation, payload, options = {}) {
  const identity = await identityFor(event, options);
  const cartId = clean(identity.profile?.shopifyCartId);
  if (!validCartId(cartId)) {
    const error = new Error("No active Shopify cart belongs to this Snooze Profile.");
    error.code = "SHOPPER_CART_NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }
  const cart = await (options.shopify || shopify)[mutation]({ cartId, ...payload });
  await persistCart(identity, cart, options);
  return cartResponse(identity, cart, { restored: true });
}

const updateShopperCartLines = (event, lines, options) =>
  mutateOwnedCart(event, "updateCartLines", { lines }, options);
const removeShopperCartLines = (event, lineIds, options) =>
  mutateOwnedCart(event, "removeCartLines", { lineIds }, options);

module.exports = {
  addShopperCartLines,
  removeShopperCartLines,
  resolveShopperCart,
  updateShopperCartLines,
  isExpiredCartError,
  validCartId,
};
