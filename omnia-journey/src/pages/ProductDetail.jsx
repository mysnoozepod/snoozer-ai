// src/pages/ProductDetail.jsx
import { useParams, Link, useNavigate } from "react-router-dom";
import { useEffect, useState, useMemo } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/useStore";

const STORE_DOMAIN =
  import.meta.env.VITE_STORE_DOMAIN || "mysnoozepodtest.myshopify.com";

function safeGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeParseJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function toPodId(v) {
  const s = String(v ?? "").trim();
  return s || "1";
}

function toNumericId(id) {
  if (!id) return "";
  const s = String(id);
  return s.startsWith("gid://") ? s.split("/").pop() : s;
}

function normalizeImages(imagesLike) {
  if (!imagesLike) return [];
  if (Array.isArray(imagesLike)) return imagesLike.filter(Boolean);

  // GraphQL: { edges:[{node:{url}}] } or { nodes:[{url}] }
  const edges = imagesLike?.edges;
  if (Array.isArray(edges)) return edges.map((e) => e?.node).filter(Boolean);

  const nodes = imagesLike?.nodes;
  if (Array.isArray(nodes)) return nodes.filter(Boolean);

  return [];
}

function pickImage(imagesLike) {
  const images = normalizeImages(imagesLike);
  if (!Array.isArray(images) || images.length === 0) return "/no-image.svg";

  const candidates = [
    images.find((i) => i?.url)?.url,
    images.find((i) => i?.src)?.src,
    images.find((i) => i?.originalSrc)?.originalSrc,
  ].filter(Boolean);

  return candidates[0] || "/no-image.svg";
}

function normalizeVariants(variantsLike) {
  if (!variantsLike) return [];
  if (Array.isArray(variantsLike)) return variantsLike.filter(Boolean);

  const edges = variantsLike?.edges;
  if (Array.isArray(edges)) return edges.map((e) => e?.node).filter(Boolean);

  const nodes = variantsLike?.nodes;
  if (Array.isArray(nodes)) return nodes.filter(Boolean);

  return [];
}

function parsePrice(v) {
  // backend can return price as number, string, or {amount,currencyCode}
  const amt =
    v?.price?.amount ??
    v?.priceV2?.amount ??
    v?.priceAmount ??
    v?.price ??
    null;

  const n = typeof amt === "number" ? amt : Number(String(amt ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseCurrency(v, product) {
  return (
    v?.price?.currencyCode ||
    v?.priceV2?.currencyCode ||
    product?.priceRange?.currencyCode ||
    product?.priceRange?.minVariantPrice?.currencyCode ||
    "USD"
  );
}

function formatMoney(amount, currency = "USD") {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "Price Unavailable";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export default function ProductDetail() {
  const { slug } = useParams(); // handle or numeric ID
  const navigate = useNavigate();

  // ✅ Cart is managed via zustand store (matches Cart.jsx + Explore.jsx)
  const addToCart = useStore((s) => s.addToCart);
  const setCartMeta = useStore((s) => s.setCartMeta);

  const [product, setProduct] = useState(null);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creatingCheckout, setCreatingCheckout] = useState(false);
  const [error, setError] = useState(null);
  const [checkoutError, setCheckoutError] = useState("");
  const [addedMsg, setAddedMsg] = useState("");

  // Back should follow top recommendation, not hardcoded pod/1
  const backPodId = useMemo(() => {
    const raw = safeGet("snooze.recommendations");
    const parsed = raw ? safeParseJson(raw) : null;
    const pods = Array.isArray(parsed?.pods) ? parsed.pods : [];
    const first = pods[0] || null;
    return first ? toPodId(first.podId ?? first.id) : "1";
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        setCheckoutError("");
        setAddedMsg("");

        // ✅ api.getProductById returns the product object (not { product: ... })
        const fetched = await api.getProductById(slug);

        if (!alive) return;

        if (!fetched) {
          setError("Product not found.");
          setProduct(null);
          setSelectedVariant(null);
          return;
        }

        const imgUrl = pickImage(fetched.images || fetched.images?.edges || fetched.images?.nodes);
        const variantsArr = normalizeVariants(fetched.variants);

        const normalized = {
          id: toNumericId(fetched.id),
          gid: fetched.id,
          title: fetched.title || "Untitled Product",
          handle: fetched.handle || slug,
          description: fetched.description || fetched.descriptionHtml || "",
          imageUrl: imgUrl,
          variants: variantsArr.map((v) => ({
            id: toNumericId(v.id), // numeric suffix (string)
            gid: v.id, // full variant GID
            title: v.title || "Default",
            price: parsePrice(v),
            currency: parseCurrency(v, fetched),
          })),
          priceRange: fetched.priceRange || null,
        };

        setProduct(normalized);
        setSelectedVariant(normalized.variants[0] || null);
      } catch (e) {
        console.error("❌ Product load error:", e);
        if (!alive) return;
        setError("Unable to load product.");
        setProduct(null);
        setSelectedVariant(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [slug]);

  const productUrl = useMemo(() => {
    if (!product?.handle) return null;
    return `https://${STORE_DOMAIN}/products/${product.handle}`;
  }, [product?.handle]);

  const displayPrice = useMemo(() => {
    if (selectedVariant?.price != null) {
      return formatMoney(selectedVariant.price, selectedVariant.currency || "USD");
    }

    const pr = product?.priceRange;
    const min =
      pr?.min ??
      (typeof pr?.minVariantPrice?.amount === "string"
        ? Number(pr.minVariantPrice.amount)
        : pr?.minVariantPrice?.amount);

    const cur =
      pr?.currencyCode || pr?.minVariantPrice?.currencyCode || "USD";

    if (typeof min === "number" && Number.isFinite(min)) {
      return formatMoney(min, cur);
    }

    return "Price Unavailable";
  }, [selectedVariant, product]);

  const buildCartItem = () => {
    if (!product || !selectedVariant?.gid) return null;

    return {
      merchandiseId: selectedVariant.gid, // ✅ Shopify Variant GID
      handle: product.handle || null,
      title: product.title,
      imageUrl: product.imageUrl,
      unitPrice: Number(selectedVariant.price ?? 0) || 0,
      quantity: 1,
    };
  };

  // ✅ Add to cart = stay on site, keep shopping
  const handleAddToCart = () => {
    setCheckoutError("");
    setAddedMsg("");

    const item = buildCartItem();
    if (!item) {
      setCheckoutError("This product variant is not available.");
      return;
    }

    addToCart?.(item);
    setAddedMsg("Added to cart.");
    window.setTimeout(() => setAddedMsg(""), 1500);
  };

  // ✅ Checkout now = create Shopify cart + redirect (and persist identity everywhere)
  const handleCheckoutNow = async () => {
    setCheckoutError("");
    setAddedMsg("");

    const item = buildCartItem();
    if (!item) {
      setCheckoutError("This product variant is not available.");
      return;
    }

    try {
      setCreatingCheckout(true);

      // Keep local cart in sync for UI
      addToCart?.(item);

      // Deterministic: create a new cart from this one item
      const res = await api.createCart({
        variantId: item.merchandiseId,
        quantity: 1,
      });

      const cartObj = res?.cart || res?.data?.cart || null;
      const cartId = res?.cartId || res?.id || cartObj?.id || null;
      const checkoutUrl = res?.checkoutUrl || cartObj?.checkoutUrl || null;

      if (checkoutUrl) {
        // Persist identity in BOTH: zustand + legacy sessionStore
        setCartMeta?.({ cartId, checkoutUrl });
        setCartIdentity?.({ cartId, checkoutUrl });

        // Also keep the simple sessionStorage keys warm for any legacy readers
        try {
          sessionStorage.setItem("snooze.checkoutUrl", String(checkoutUrl));
          sessionStorage.setItem("snooze.shopify.checkoutUrl", String(checkoutUrl));
          if (cartId) {
            sessionStorage.setItem("snooze.cartId", String(cartId));
            sessionStorage.setItem("snooze.shopify.cartId", String(cartId));
          }
        } catch {
          // ignore
        }

        window.location.assign(checkoutUrl);
        return;
      }

      console.warn("⚠️ No checkoutUrl from createCart, routing to cart.", res);
      setCheckoutError("Checkout had a hiccup. You can still checkout from your cart.");
      navigate("/cart");
    } catch (err) {
      console.error("❌ Checkout Now / createCart failed", err);
      setCheckoutError("Checkout had a hiccup. You can still checkout from your cart.");
      navigate("/cart");
    } finally {
      setCreatingCheckout(false);
    }
  };

  if (loading) return <p className="p-8 text-center">Loading product…</p>;

  if (error) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-500">{error}</p>
        <Link to={`/pod/${encodeURIComponent(backPodId)}`} className="text-indigo-600 hover:underline">
          ← Back
        </Link>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-500">Product not found.</p>
        <Link to={`/pod/${encodeURIComponent(backPodId)}`} className="text-indigo-600 hover:underline">
          ← Back
        </Link>
      </div>
    );
  }

  return (
    <section className="max-w-4xl mx-auto p-8">
      <Link to={`/pod/${encodeURIComponent(backPodId)}`} className="text-indigo-600 hover:underline">
        ← Back
      </Link>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Image */}
        <div className="w-full h-80 bg-gray-50 flex items-center justify-center rounded-lg shadow">
          <img
            src={product.imageUrl}
            alt={product.title}
            className="max-h-full object-contain"
            onError={(e) => {
              e.currentTarget.src = "/no-image.svg";
            }}
          />
        </div>

        {/* Details */}
        <div className="flex flex-col justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-4">{product.title}</h1>

            <p className="text-indigo-600 text-2xl font-semibold mb-6">
              {displayPrice}
            </p>

            {productUrl && (
              <a
                href={productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mb-6 text-sm text-gray-700 hover:underline"
              >
                View on Shopify
              </a>
            )}

            {product.variants?.length > 1 ? (
              <div className="mb-6">
                <label className="block text-sm font-medium mb-2">
                  Choose an option
                </label>
                <select
                  className="border rounded p-2 w-full"
                  value={selectedVariant?.gid || ""}
                  onChange={(e) =>
                    setSelectedVariant(
                      product.variants.find((v) => v.gid === e.target.value) || null
                    )
                  }
                >
                  {product.variants.map((v) => (
                    <option key={v.gid} value={v.gid}>
                      {v.title}{" "}
                      {typeof v.price === "number"
                        ? `— ${formatMoney(v.price, v.currency || "USD")}`
                        : ""}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <button
              onClick={handleAddToCart}
              className="w-full py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-60"
              disabled={!selectedVariant?.gid || creatingCheckout}
            >
              Add to Cart
            </button>

            <button
              onClick={handleCheckoutNow}
              className="w-full py-3 border border-indigo-600 text-indigo-700 rounded-lg hover:bg-indigo-50 transition disabled:opacity-60"
              disabled={!selectedVariant?.gid || creatingCheckout}
            >
              {creatingCheckout ? "Preparing checkout…" : "Checkout Now"}
            </button>

            {addedMsg ? (
              <p className="text-sm text-green-700" role="status">
                {addedMsg}
              </p>
            ) : null}

            {checkoutError ? (
              <p className="text-sm text-red-600" role="alert">
                {checkoutError}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}