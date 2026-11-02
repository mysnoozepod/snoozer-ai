#!/usr/bin/env python3
"""Build the bounded BEDGEAR Draft catalog manifest from approved workbook rows."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

import openpyxl


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r"C:\Users\1ones\Downloads\Bedgear Master PL Sept 2026.xlsx")
OUTPUT = ROOT / "docs" / "catalog" / "BEDGEAR_CATALOG_MANIFEST.json"


def slug(value: str) -> str:
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", value.lower()))


def geometry(size: str) -> str:
    normalized = size.lower()
    if "split head" in normalized:
        return "split_head"
    if normalized.startswith("split ") or "split king" in normalized or "split cal king" in normalized:
        return "full_split"
    return "standard"


def row_variant(ws, row_number: int, option_names: tuple[str, ...]) -> dict:
    sku, _, color, size, _, _, price, upc = [ws.cell(row_number, column).value for column in range(1, 9)]
    if not isinstance(sku, str) or not re.fullmatch(r"[A-Z0-9-]+", sku.strip()):
        raise ValueError(f"Invalid SKU at {ws.title}!A{row_number}: {sku!r}")
    if not isinstance(size, str) or not size.strip():
        raise ValueError(f"Missing size at {ws.title}!D{row_number}")
    if not isinstance(price, (int, float)):
        raise ValueError(f"Missing reference price at {ws.title}!G{row_number}")

    values = {"Size": size.strip()}
    if "Color" in option_names:
        if not isinstance(color, str) or not color.strip():
            raise ValueError(f"Missing color at {ws.title}!C{row_number}")
        values["Color"] = color.strip()

    key_suffix = "-".join(slug(values[name]) for name in option_names)
    return {
        "options": {name: values[name] for name in option_names},
        "sku": sku.strip(),
        "upc": str(upc).strip() if upc not in (None, "") else None,
        "referencePrice": f"{float(price):.2f}",
        "shopifyVariantId": None,
        "source": {"sheet": ws.title, "row": row_number},
        "contract": {
            "sleep_geometry": geometry(size.strip()),
            "price_verification_status": "HISTORICAL_REFERENCE",
            "fulfillment_readiness": "PENDING",
            "compatibility_key_suffix": key_suffix,
        },
    }


def product(
    *,
    title: str,
    handle: str,
    product_type: str,
    assortment_status: str,
    builder_roles: list[str],
    collections: list[str],
    variants: list[dict],
) -> dict:
    if not variants:
        raise ValueError(f"{handle} has no variants")
    for variant in variants:
        variant["contract"]["compatibility_key"] = f"{handle}-{variant['contract'].pop('compatibility_key_suffix')}"
    return {
        "title": title,
        "handle": handle,
        "manufacturer": "BEDGEAR",
        "productType": product_type,
        "assortmentStatus": assortment_status,
        "publicationReadiness": "BLOCKED",
        "shopifyStatus": "DRAFT",
        "shopifyProductId": None,
        "collections": collections,
        "contract": {
            "assortment_status": assortment_status,
            "publication_readiness": "BLOCKED",
            "builder_roles": builder_roles,
            "owner_content_status": "PENDING",
        },
        "variants": variants,
    }


def variants_for_rows(ws, rows: list[int], options: tuple[str, ...]) -> list[dict]:
    return [row_variant(ws, row, options) for row in rows]


def rows_with_prefix(ws, start: int, end: int, prefix: str) -> list[int]:
    return [
        row
        for row in range(start, end + 1)
        if isinstance(ws.cell(row, 1).value, str) and ws.cell(row, 1).value.strip().startswith(prefix)
    ]


def main() -> None:
    workbook = openpyxl.load_workbook(SOURCE, read_only=True, data_only=True)
    bases = workbook["ADJ BASE"]
    sheets = workbook["SHEETS & PILLOWCASES"]
    protectors = workbook["PROTECTORS"]
    lifestyle = workbook["LIFESTYLE"]

    products = [
        product(
            title="Flex L Adjustable Base",
            handle="flex-l-adjustable-base",
            product_type="Adjustable Base",
            assortment_status="APPROVED",
            builder_roles=["base"],
            collections=["adjustable-bases"],
            variants=variants_for_rows(bases, list(range(4, 8)), ("Size",)),
        ),
        product(
            title="Flex LSX Adjustable Base",
            handle="flex-lsx-adjustable-base",
            product_type="Adjustable Base",
            assortment_status="APPROVED",
            builder_roles=["base"],
            collections=["adjustable-bases"],
            variants=variants_for_rows(bases, list(range(10, 15)), ("Size",)),
        ),
        product(
            title="Flex SH Adjustable Base",
            handle="flex-sh-adjustable-base",
            product_type="Adjustable Base",
            assortment_status="APPROVED",
            builder_roles=["base"],
            collections=["adjustable-bases"],
            variants=variants_for_rows(bases, list(range(17, 20)), ("Size",)),
        ),
        product(
            title="Cotton Sheet Set",
            handle="cotton-sheet-set",
            product_type="Sheet Set",
            assortment_status="APPROVED",
            builder_roles=["bedding"],
            collections=["sheet-sets", "bedding"],
            variants=variants_for_rows(sheets, rows_with_prefix(sheets, 42, 83, "BGS122"), ("Size", "Color")),
        ),
        product(
            title="Dri-Tec Sheet Set",
            handle="dri-tec-sheet-set",
            product_type="Sheet Set",
            assortment_status="APPROVED",
            builder_roles=["bedding"],
            collections=["sheet-sets", "bedding"],
            variants=variants_for_rows(sheets, rows_with_prefix(sheets, 86, 134, "BGS194"), ("Size", "Color")),
        ),
        product(
            title="Ver-Tex Sheet Set",
            handle="ver-tex-sheet-set",
            product_type="Sheet Set",
            assortment_status="APPROVED",
            builder_roles=["bedding"],
            collections=["sheet-sets", "bedding"],
            variants=variants_for_rows(sheets, rows_with_prefix(sheets, 162, 185, "BGS197"), ("Size", "Color")),
        ),
        product(
            title="Dri-Tec Mattress Protector",
            handle="dri-tec-mattress-protector",
            product_type="Mattress Protector",
            assortment_status="APPROVED",
            builder_roles=["protection"],
            collections=["mattress-protectors"],
            variants=variants_for_rows(protectors, list(range(32, 44)), ("Size",)),
        ),
        product(
            title="Ver-Tex Mattress Protector",
            handle="ver-tex-mattress-protector",
            product_type="Mattress Protector",
            assortment_status="APPROVED",
            builder_roles=["protection"],
            collections=["mattress-protectors"],
            variants=variants_for_rows(protectors, rows_with_prefix(protectors, 59, 69, "BGM026"), ("Size",)),
        ),
        product(
            title="Stretchwick Mattress Encasement",
            handle="stretchwick-mattress-encasement",
            product_type="Mattress Protector",
            assortment_status="APPROVED",
            builder_roles=["protection"],
            collections=["mattress-protectors"],
            variants=variants_for_rows(protectors, rows_with_prefix(protectors, 72, 77, "BGM52"), ("Size",)),
        ),
        product(
            title="Light Weight Comforter",
            handle="light-weight-comforter",
            product_type="Comforter",
            assortment_status="APPROVED",
            builder_roles=["bedding"],
            collections=["bedding"],
            variants=variants_for_rows(lifestyle, [67, 68], ("Size",)),
        ),
        product(
            title="Medium Weight Comforter",
            handle="medium-weight-comforter",
            product_type="Comforter",
            assortment_status="APPROVED",
            builder_roles=["bedding"],
            collections=["bedding"],
            variants=variants_for_rows(lifestyle, [71, 72], ("Size",)),
        ),
        product(
            title="Ultra Weight Comforter",
            handle="ultra-weight-comforter",
            product_type="Comforter",
            assortment_status="APPROVED",
            builder_roles=["bedding"],
            collections=["bedding"],
            variants=variants_for_rows(lifestyle, [75, 76], ("Size",)),
        ),
        product(
            title="Cooling Performance Throw",
            handle="cooling-performance-throw",
            product_type="Throw",
            assortment_status="SELECTED",
            builder_roles=["bedding"],
            collections=["bedding"],
            variants=variants_for_rows(lifestyle, [121], ("Size", "Color")),
        ),
        product(
            title="Solid White Duvet + Sham Set",
            handle="solid-white-duvet-sham-set",
            product_type="Duvet Set",
            assortment_status="SELECTED",
            builder_roles=["bedding"],
            collections=["bedding"],
            variants=variants_for_rows(lifestyle, [104], ("Size", "Color")),
        ),
        product(
            title="Light Grey Racetrack Duvet + Sham Set",
            handle="light-grey-racetrack-duvet-sham-set",
            product_type="Duvet Set",
            assortment_status="SELECTED",
            builder_roles=["bedding"],
            collections=["bedding"],
            variants=variants_for_rows(lifestyle, [96], ("Size", "Color")),
        ),
        product(
            title="React Pro Performance Topper",
            handle="react-pro-performance-topper",
            product_type="Mattress Topper",
            assortment_status="SELECTED",
            builder_roles=[],
            collections=["mattress-toppers", "bedding"],
            variants=variants_for_rows(lifestyle, [132], ("Size",)),
        ),
    ]

    all_skus = [variant["sku"] for item in products for variant in item["variants"]]
    all_keys = [variant["contract"]["compatibility_key"] for item in products for variant in item["variants"]]
    if len(all_skus) != 146 or len(set(all_skus)) != 146:
        raise ValueError(f"Expected 146 unique variants, found {len(all_skus)} rows / {len(set(all_skus))} unique SKUs")
    if len(set(all_keys)) != len(all_keys):
        raise ValueError("Compatibility keys are not unique")

    manifest = {
        "schemaVersion": "1.0",
        "updatedAt": datetime.now(timezone.utc).date().isoformat(),
        "shopifyStore": "mysnoozepodtest",
        "publicationRule": "DRAFT_ONLY_UNTIL_OWNER_RELEASE_GATE",
        "priceRule": "BEDGEAR_SEPT_2026_UPP_IS_HISTORICAL_DRAFT_REFERENCE_NOT_LIVE_AUTHORIZATION",
        "readbackFile": "docs/catalog/bedgear-shopify-catalog-readback.json",
        "expectedProductCount": 16,
        "expectedVariantCount": 146,
        "collections": [
            {"title": "Adjustable Bases", "handle": "adjustable-bases", "shopifyCollectionId": None, "role": "canonical_builder_source"},
            {"title": "Sheet Sets", "handle": "sheet-sets", "shopifyCollectionId": None, "role": "canonical_builder_source"},
            {"title": "Bedding", "handle": "bedding", "shopifyCollectionId": None, "role": "canonical_builder_source"},
            {"title": "Mattress Protectors", "handle": "mattress-protectors", "shopifyCollectionId": None, "role": "canonical_builder_source"},
            {"title": "Mattress Toppers", "handle": "mattress-toppers", "shopifyCollectionId": None, "role": "merchandising_group"},
        ],
        "products": products,
        "excludedPendingDecision": [
            {
                "item": "Cooling Blanket",
                "reason": "Decision record permits Navy or Grey; exact display SKU/sample choice is unresolved.",
                "sourceRows": [113, 114, 117, 118],
            }
        ],
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Created {OUTPUT.relative_to(ROOT)}: {len(products)} products / {len(all_skus)} variants")


if __name__ == "__main__":
    main()
