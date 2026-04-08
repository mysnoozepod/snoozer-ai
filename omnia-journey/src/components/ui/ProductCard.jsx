// src/components/ui/ProductCard.jsx
import { Link } from "react-router-dom";

/**
 * ProductCard
 * - Safe image fallback
 * - Safe route slug (handle preferred, else sanitizes id)
 * - Optional Add to Cart button that calls onAddToCart(payload)
 * - Optional disableLink + onClick for showroom selection (no navigation)
 *
 * NEW:
 * - density="default" | "compact"
 * - showTitle (default true)
 * - showPrice (default true)
 *
 * Payload contract (frontend standard):
 * {
 *   productId,
 *   handle,
 *   title,
 *   imageUrl,
 *   merchandiseId,   // Shopify ProductVariant GID
 *   quantity,        // number (default 1)
 *   unitPrice        // number (best-effort numeric)
 * }
 */

const DETAIL_ROUTE_PREFIX = "/products";

function extractSlug({ id, handle }) {
  const h = typeof handle === "string" ? handle.trim() : "";
  if (h) return h;

  let cleanId = id ?? "";
  if (typeof cleanId === "string") {
    cleanId = cleanId.trim();
    if (cleanId.startsWith("gid://")) {
      const parts = cleanId.split("/");
      cleanId = parts[parts.length - 1] || "";
    }
  }

  cleanId = String(cleanId || "").trim();
  return cleanId || "";
}

function formatDisplayPrice(price) {
  if (price == null || price === "") return "—";

  if (typeof price === "number" && Number.isFinite(price)) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
      }).format(price);
    } catch {
      return `$${price.toFixed(2)}`;
    }
  }

  return String(price);
}

function parseNumberFromPriceString(v) {
  const s = String(v || "");
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normalizeVariantMerchandiseId(input) {
  if (input == null) return null;

  const s = String(input).trim();
  if (!s) return null;

  if (s.startsWith("gid://shopify/ProductVariant/")) return s;

  if (/^\d+$/.test(s)) {
    return `gid://shopify/ProductVariant/${s}`;
  }

  if (s.startsWith("gid://")) return null;

  return null;
}

export default function ProductCard({
  id,
  handle,
  title,
  price,
  priceNumber,
  imageUrl,

  variantId = null,
  merchandiseId = null,

  onAddToCart,
  quantity = 1,

  // Showroom mode
  disableLink = false,
  onClick = undefined,

  // NEW presentation controls
  density = "default", // "default" | "compact"
  showTitle = true,
  showPrice = true,
  className = "",
}) {
  const slug = extractSlug({ id, handle });
  const hasRoute = Boolean(slug);
  const to = hasRoute ? `${DETAIL_ROUTE_PREFIX}/${encodeURIComponent(slug)}` : null;

  const safeImageUrl = imageUrl || "/no-image.svg";
  const displayPrice = formatDisplayPrice(price);

  const unitPrice =
    typeof priceNumber === "number" && Number.isFinite(priceNumber)
      ? priceNumber
      : typeof price === "number" && Number.isFinite(price)
      ? price
      : parseNumberFromPriceString(price);

  const normalizedMerchId = normalizeVariantMerchandiseId(merchandiseId || variantId);

  const hasAddHandler = typeof onAddToCart === "function";
  const canAdd = hasAddHandler && Boolean(normalizedMerchId);

  const safeQty =
    typeof quantity === "number" && Number.isFinite(quantity) && quantity > 0
      ? Math.floor(quantity)
      : 1;

  const productPayload = {
    productId: id ?? null,
    handle: typeof handle === "string" && handle.trim() ? handle.trim() : null,
    title: title || "Untitled",
    imageUrl: safeImageUrl,
    merchandiseId: normalizedMerchId,
    quantity: safeQty,
    unitPrice,
  };

  const isCompact = String(density).toLowerCase() === "compact";

  const rootClasses = [
    "bg-white rounded-2xl border shadow-sm transition-all duration-200 flex flex-col h-full",
    isCompact ? "hover:shadow-sm" : "hover:shadow-md",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const imageWrapClasses = [
    "w-full bg-gray-50 flex items-center justify-center overflow-hidden",
    isCompact ? "h-28 p-2 rounded-xl" : "h-48 p-4 rounded-none",
  ].join(" ");

  const imgClasses = [
    isCompact ? "w-full h-full object-cover" : "max-h-full max-w-full object-contain",
  ].join(" ");

  const bodyClasses = [
    "flex-1 flex flex-col justify-between",
    isCompact ? "px-3 pb-3 pt-2" : "p-4",
  ].join(" ");

  const titleClasses = [
    "text-gray-900 leading-snug",
    isCompact ? "text-sm font-semibold line-clamp-1" : "text-lg font-semibold truncate",
  ].join(" ");

  const priceClasses = [
    "text-indigo-600 font-bold",
    isCompact ? "text-sm mt-1" : "text-xl mt-2",
  ].join(" ");

  const CardCore = (
    <div className={rootClasses}>
      <div className={imageWrapClasses}>
        <img
          src={safeImageUrl}
          alt={title || "Product image"}
          loading="lazy"
          onError={(e) => {
            e.currentTarget.src = "/no-image.svg";
          }}
          className={imgClasses}
        />
      </div>

      <div className={bodyClasses}>
        <div>
          {showTitle ? (
            <h2 title={title} className={titleClasses}>
              {title || "Untitled Product"}
            </h2>
          ) : null}

          {showPrice ? (
            <div className={priceClasses}>{displayPrice}</div>
          ) : null}
        </div>
      </div>
    </div>
  );

  const AddButton = hasAddHandler ? (
    <button
      type="button"
      disabled={!canAdd}
      onClick={() => {
        if (!canAdd) return;
        onAddToCart(productPayload);
      }}
      className={[
        isCompact ? "mt-2" : "mt-3",
        "w-full h-10 rounded-lg text-sm font-semibold transition",
        canAdd
          ? "bg-indigo-600 text-white hover:bg-indigo-700"
          : "bg-gray-200 text-gray-500 cursor-not-allowed",
      ].join(" ")}
      aria-disabled={!canAdd}
      aria-label={
        canAdd
          ? `Add ${title || "product"} to cart`
          : `Cannot add ${title || "product"} to cart`
      }
      title={canAdd ? "Add to Cart" : "Unavailable: missing variant (merchandiseId)"}
    >
      {canAdd ? "Add to Cart" : "Unavailable"}
    </button>
  ) : null;

  // Showroom Mode: card is clickable but does NOT navigate
  if (disableLink) {
    const clickable = typeof onClick === "function";

    return (
      <div className="block">
        <div
          role={clickable ? "button" : undefined}
          tabIndex={clickable ? 0 : undefined}
          onClick={() => {
            if (!clickable) return;
            onClick(productPayload);
          }}
          onKeyDown={(e) => {
            if (!clickable) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onClick(productPayload);
            }
          }}
          className={[
            "block rounded-2xl",
            clickable
              ? "cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500"
              : "",
          ].join(" ")}
          aria-label={clickable ? `Select ${title || "product"}` : undefined}
        >
          {CardCore}
        </div>

        {AddButton}
      </div>
    );
  }

  if (hasRoute && to) {
    return (
      <div className="block">
        <Link
          to={to}
          className="block cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-2xl"
        >
          {CardCore}
        </Link>

        {/* Button is OUTSIDE the Link (so it doesn’t navigate on click) */}
        {AddButton}
      </div>
    );
  }

  return (
    <div className="block cursor-default opacity-70 select-none" aria-disabled>
      {CardCore}
      {AddButton}
    </div>
  );
}

