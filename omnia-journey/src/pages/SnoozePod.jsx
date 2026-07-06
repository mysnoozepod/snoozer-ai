import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Ticket, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/useStore";
import { api } from "@/lib/api";
import {
  extractShopifyCartGid,
  getStoredShopifyCartIdentity,
  persistShopifyCartIdentity,
} from "@/lib/session/shopifyCartState";

function safeGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, val) {
  try {
    sessionStorage.setItem(key, val);
  } catch {}
}

function safeParseJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function safeSaveJson(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function formatMoney(n) {
  const v = Number(n) || 0;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}

function toPodId(v) {
  const s = String(v ?? "").trim();
  return s || "1";
}

function normalizeAttributes(attrs) {
  if (!Array.isArray(attrs)) return [];
  return attrs
    .map((a) => ({
      key: String(a?.key || "").trim(),
      value: String(a?.value || "").trim(),
    }))
    .filter((a) => a.key && a.value);
}

function pickKeyAttributes(attrs) {
  const allow = new Set([
    "Size",
    "Mattress",
    "Base",
    "Motion",
    "Dual Comfort",
    "Left Feel",
    "Right Feel",
    "SnoozePod",
  ]);

  const list = normalizeAttributes(attrs).filter((a) => allow.has(a.key));

  const order = [
    "SnoozePod",
    "Size",
    "Mattress",
    "Base",
    "Motion",
    "Dual Comfort",
    "Left Feel",
    "Right Feel",
  ];

  list.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return list;
}

function normalizeItemId(item, idx) {
  const id = item?.id || item?.lineId || item?.merchandiseId || item?.variantId;
  if (id) return String(id);
  return `item-${idx}`;
}

function extractCartGid(value) {
  return extractShopifyCartGid(value);
}

function persistCartIdentity(cartId) {
  return persistShopifyCartIdentity({ cartId }).cartId || "";
}

function getShopifyCartId() {
  return getStoredShopifyCartIdentity().cartId || "";
}

function toVariantGid(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;

  if (/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(s)) return s;
  if (/^\d+$/.test(s) && s !== "0") return `gid://shopify/ProductVariant/${s}`;

  return null;
}

function toNumberMoney(x) {
  if (typeof x === "number") return Number.isFinite(x) ? x : 0;
  const n = Number(String(x ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normalizeCartItem(item) {
  if (!item || typeof item !== "object") return null;

  const rawId =
    item.merchandiseId ||
    item.variantId ||
    item.variant_id ||
    item.firstAvailableVariantId ||
    item.id ||
    null;

  const merchandiseId = toVariantGid(rawId);
  if (!merchandiseId) return null;

  const qtyRaw = item.quantity ?? item.qty ?? item.count ?? 1;
  const quantity =
    typeof qtyRaw === "number" && Number.isFinite(qtyRaw) && qtyRaw > 0
      ? Math.floor(qtyRaw)
      : Math.floor(Number(qtyRaw) || 1);

  const title = item.title || "Untitled";

  const imageUrl =
    item.imageUrl ||
    item.image ||
    item.previewUrl ||
    item.images?.[0]?.url ||
    "/no-image.svg";

  const unitPrice = toNumberMoney(
    item.unitPrice ?? item.price ?? item.priceNumber ?? 0
  );

  return {
    id: String(merchandiseId),
    merchandiseId: String(merchandiseId),
    title,
    imageUrl,
    unitPrice,
    quantity: quantity > 0 ? quantity : 1,
    handle: item.handle || null,
    attributes: Array.isArray(item.attributes) ? item.attributes : undefined,
  };
}

function mergeCartItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  const merged = new Map();

  for (const raw of rawItems) {
    const item = normalizeCartItem(raw);
    if (!item) continue;

    const existing = merged.get(item.id);
    if (existing) {
      merged.set(item.id, {
        ...existing,
        quantity: (existing.quantity || 1) + (item.quantity || 1),
      });
    } else {
      merged.set(item.id, item);
    }
  }

  return Array.from(merged.values());
}

export default function SnoozePod() {
  const navigate = useNavigate();

  const plan = useStore((s) => (Array.isArray(s.snoozepod) ? s.snoozepod : []));
  const meta = useStore((s) => s.snoozepodMeta);
  const cart = useStore((s) => (Array.isArray(s.cart) ? s.cart : []));

  const setQty = useStore((s) => s.setSnoozePodQty);
  const remove = useStore((s) => s.removeFromSnoozePod);
  const clear = useStore((s) => s.clearSnoozePod);

  const applyCoupon = useStore((s) => s.applySnoozePodCoupon);
  const applyRewards = useStore((s) => s.applySnoozePodRewards);

  const estimate = useStore((s) => s.getSnoozePodEstimatedTotal);
  const setCartMeta = useStore((s) => s.setCartMeta);

  const [couponDraft, setCouponDraft] = useState(meta?.couponCode || "");
  const [pointsDraft, setPointsDraft] = useState(String(meta?.rewardsPointsApplied || 0));
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState("info");
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setCouponDraft(meta?.couponCode || "");
    setPointsDraft(String(meta?.rewardsPointsApplied || 0));
  }, [meta?.couponCode, meta?.rewardsPointsApplied]);

  useEffect(() => {
    const existingGid = getShopifyCartId();
    if (existingGid) persistCartIdentity(existingGid);
  }, []);

  const totals = useMemo(() => {
    try {
      return (
        estimate?.({ dollarsPerPoint: 0.01 }) || {
          subtotal: 0,
          rewardDiscount: 0,
          total: 0,
          points: 0,
          couponCode: meta?.couponCode || "",
        }
      );
    } catch {
      return {
        subtotal: 0,
        rewardDiscount: 0,
        total: 0,
        points: 0,
        couponCode: meta?.couponCode || "",
      };
    }
  }, [estimate, plan, meta?.couponCode, meta?.rewardsPointsApplied]);

  const continuePodId = useMemo(() => {
    const raw = safeGet("snooze.recommendations");
    const parsed = raw ? safeParseJson(raw) : null;
    const pods = Array.isArray(parsed?.pods) ? parsed.pods : [];
    const first = pods[0] || null;
    return first ? toPodId(first.podId ?? first.id) : "1";
  }, []);

  async function commitToCart() {
    setStatus("");
    setStatusTone("info");

    if (!Array.isArray(plan) || plan.length === 0) {
      setStatus("Your SnoozePod is empty.");
      setStatusTone("error");
      return;
    }

    setSyncing(true);

    try {
      setStatus("Syncing cart...");
      setStatusTone("info");

      const lines = plan
        .map((it) => {
          const merch =
            it?.merchandiseId ||
            it?.variantId ||
            it?.meta?.merchandiseId ||
            it?.meta?.variantId ||
            null;

          const normalizedMerch = toVariantGid(merch);
          if (!normalizedMerch) return null;

          const qty = Math.max(1, Math.floor(Number(it?.quantity) || 1));

          return {
            merchandiseId: normalizedMerch,
            quantity: qty,
            attributes: Array.isArray(it?.attributes) ? it.attributes : undefined,
          };
        })
        .filter(Boolean);

      if (!lines.length) {
        setStatus("Valid Shopify variants not found.");
        setStatusTone("error");
        return;
      }

      let cartId = getShopifyCartId();

      if (!cartId) {
        const created = await api.createCart({ lines });
        cartId = extractCartGid(created);

        if (!cartId) {
          setStatus("Could not create Shopify cart.");
          setStatusTone("error");
          return;
        }

        persistCartIdentity(cartId);
      } else {
        cartId = persistCartIdentity(cartId);

        if (!cartId) {
          setStatus("Stored cart ID is invalid.");
          setStatusTone("error");
          return;
        }

        const addResult = await api.addLinesToCart({ cartId, lines });
        const returnedCartId = extractCartGid(addResult);

        if (returnedCartId) {
          cartId = persistCartIdentity(returnedCartId);
        } else {
          persistCartIdentity(cartId);
        }
      }

      const cartResponse = await api.getCart(cartId);
      const normalizedCartId = extractCartGid(cartResponse) || cartId;
      persistCartIdentity(normalizedCartId);

      const checkoutUrl =
        cartResponse?.checkoutUrl ||
        cartResponse?.data?.checkoutUrl ||
        cartResponse?.cart?.checkoutUrl ||
        cartResponse?.data?.cart?.checkoutUrl ||
        "";

      if (checkoutUrl) {
        safeSet("snooze.checkoutUrl", String(checkoutUrl));
        safeSet("snooze.shopify.checkoutUrl", String(checkoutUrl));
      }

      setCartMeta({
        cartId: normalizedCartId,
        checkoutUrl: checkoutUrl || null,
      });

      const nextLocalCart = mergeCartItems([...(Array.isArray(cart) ? cart : []), ...plan]);

      useStore.setState((state) => ({
        ...state,
        cart: nextLocalCart,
        badges: { ...state.badges, Cart: true },
      }));

      safeSaveJson("snooze.cart", nextLocalCart);

      clear();

      setStatus(checkoutUrl ? "Cart ready." : "Added to cart.");
      setStatusTone("success");

      navigate("/cart");
    } catch (e) {
      setStatus(`Couldn’t sync to Shopify.${e?.message ? ` (${e.message})` : ""}`);
      setStatusTone("error");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="min-h-screen bg-gradient-to-b from-[#E8ECF5] to-white py-6">
      <div className="mx-auto max-w-4xl px-4">
        <div className="mb-5 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => navigate(`/pod/${encodeURIComponent(continuePodId)}`)}
              disabled={syncing}
            >
              Continue Testing
            </Button>
            <Button variant="outline" onClick={() => navigate("/results")} disabled={syncing}>
              Results
            </Button>
          </div>
        </div>

        <div className="rounded-3xl border bg-white p-5 shadow-sm md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">
                Your SnoozePod
              </h1>
              <p className="mt-2 text-sm text-gray-600">
                Review your setup, apply rewards, and head to checkout when you're ready.
              </p>
            </div>

            <div className="text-right">
              <div className="text-xs font-semibold text-gray-500">Estimated Total</div>
              <div className="text-3xl font-extrabold text-indigo-700">
                {formatMoney(totals.total)}
              </div>
              <div className="mt-1 text-xs text-gray-600">
                Subtotal: {formatMoney(totals.subtotal)} | Rewards: -{formatMoney(totals.rewardDiscount)}
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border bg-gray-50 p-4">
              <div className="flex items-center gap-2 text-sm font-extrabold text-gray-900">
                <Sparkles className="h-4 w-4" />
                Rewards
              </div>

              <div className="mt-3 flex gap-2">
                <input
                  value={pointsDraft}
                  onChange={(e) => setPointsDraft(e.target.value)}
                  className="h-11 w-full rounded-xl border bg-white px-3 text-sm"
                  placeholder="Points"
                  inputMode="numeric"
                />
                <Button
                  variant="outline"
                  onClick={() => applyRewards(pointsDraft)}
                  className="h-11"
                  disabled={syncing}
                >
                  Apply
                </Button>
              </div>

              <div className="mt-2 text-xs text-gray-600">
                Applied: <span className="font-bold">{totals.points || 0}</span> pts
              </div>
            </div>

            <div className="rounded-xl border bg-gray-50 p-4">
              <div className="flex items-center gap-2 text-sm font-extrabold text-gray-900">
                <Ticket className="h-4 w-4" />
                Coupon
              </div>

              <div className="mt-3 flex gap-2">
                <input
                  value={couponDraft}
                  onChange={(e) => setCouponDraft(e.target.value)}
                  className="h-11 w-full rounded-xl border bg-white px-3 text-sm"
                  placeholder="Code"
                />
                <Button
                  variant="outline"
                  onClick={() => applyCoupon(couponDraft)}
                  className="h-11"
                  disabled={syncing}
                >
                  Save
                </Button>
              </div>

              <div className="mt-2 text-xs text-gray-600">
                Saved: <span className="font-bold">{totals.couponCode || meta?.couponCode || "—"}</span>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border bg-white">
            <div className="flex items-center justify-between border-b p-4">
              <div className="text-sm font-extrabold text-gray-900">Items</div>
              <Button
                variant="outline"
                onClick={() => clear()}
                className="gap-2"
                disabled={!plan?.length || syncing}
                title={!plan?.length ? "Nothing to clear." : ""}
              >
                <Trash2 className="h-4 w-4" />
                Clear
              </Button>
            </div>

            <div className="space-y-3 p-4">
              {!plan?.length ? (
                <div className="py-6 text-center text-sm text-gray-600">No items added.</div>
              ) : (
                plan.map((item, idx) => {
                  const attrs = pickKeyAttributes(item?.attributes);
                  const itemId = normalizeItemId(item, idx);

                  return (
                    <div key={itemId} className="flex items-center gap-3 rounded-xl border bg-gray-50 p-3">
                      <img
                        src={item.imageUrl || "/no-image.svg"}
                        alt={item.title || "Item"}
                        className="h-16 w-16 rounded-lg border bg-white object-cover"
                        onError={(e) => {
                          e.currentTarget.src = "/no-image.svg";
                        }}
                      />

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-extrabold text-gray-900">
                          {item.title}
                        </div>
                        <div className="mt-1 text-xs text-gray-600">
                          {formatMoney(item.unitPrice)} each
                        </div>

                        {attrs.length ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {attrs.map((a) => (
                              <span
                                key={`${itemId}:${a.key}:${a.value}`}
                                className="inline-flex items-center rounded-full border bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-700"
                              >
                                {a.key}: {a.value}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          value={item.quantity}
                          onChange={(e) => {
                            const next = Math.max(1, Math.floor(Number(e.target.value) || 1));
                            setQty(itemId, next);
                          }}
                          className="h-10 w-16 rounded-lg border bg-white text-center text-sm"
                          inputMode="numeric"
                          min={1}
                          type="number"
                          disabled={syncing}
                        />
                        <Button
                          variant="outline"
                          onClick={() => remove(itemId)}
                          className="h-10"
                          disabled={syncing}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex flex-col gap-3 border-t p-4 md:flex-row md:items-center md:justify-between">
              <div className="text-xs text-gray-600">Review first. Cart next.</div>

              <Button
                onClick={commitToCart}
                className="h-12 px-6 text-base font-extrabold"
                disabled={!plan?.length || syncing}
                title={!plan?.length ? "Add items first." : ""}
              >
                {syncing ? "Syncing…" : `Add To Cart (${formatMoney(totals.total)})`}
              </Button>
            </div>

            {status ? (
              <div
                className={[
                  "px-4 pb-4 text-sm font-semibold",
                  statusTone === "error"
                    ? "text-red-700"
                    : statusTone === "success"
                    ? "text-emerald-700"
                    : "text-indigo-700",
                ].join(" ")}
              >
                {status}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
