"""Build the four-product BEDGEAR Draft mattress manifest from verified workbook rows."""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r"C:\Users\1ones\Downloads\Bedgear Master PL Sept 2026.xlsx")
OUTPUT = ROOT / "docs" / "catalog" / "BEDGEAR_MATTRESS_CATALOG_MANIFEST.json"


def text(value: object) -> str:
    return str(value).strip()


def price(value: object) -> str:
    return f"{Decimal(str(value)):.2f}"


def geometry(size: str) -> str:
    if "Split Head" in size:
        return "split_head"
    if size.startswith("Split "):
        return "full_split"
    return "standard"


def typed(field_type: str, value: object) -> dict[str, object]:
    return {"type": field_type, "value": value}


def base_contract(model: str, display_count: int) -> dict[str, object]:
    return {
        "assortment_status": "APPROVED",
        "publication_readiness": "BLOCKED",
        "builder_roles": ["mattress"],
        "owner_content_status": "PENDING",
        "model": model,
        "showroom_representation": typed(
            "json",
            {
                "type": "full_display",
                "displayCount": display_count,
                "locationStatus": "PENDING_LOCATION",
                "locations": [],
            },
        ),
    }


def variant_contract(handle: str, size: str) -> dict[str, str]:
    return {
        "sleep_geometry": geometry(size),
        "price_verification_status": "HISTORICAL_REFERENCE",
        "fulfillment_readiness": "PENDING",
        "compatibility_key": f"{handle}-{size.lower().replace(' ', '-')}".replace("--", "-"),
    }


def standard_product(ws, *, model: str, title: str, handle: str, rows: range, display_count: int) -> dict[str, object]:
    variants = []
    for row in rows:
        size = text(ws.cell(row, 4).value)
        sku = text(ws.cell(row, 1).value)
        variants.append(
            {
                "options": {"Size": size},
                "sku": sku,
                "upc": text(ws.cell(row, 8).value),
                "referencePrice": price(ws.cell(row, 7).value),
                "source": {"document": SOURCE.name, "sheet": ws.title, "row": row},
                "verifiedSpecifications": {
                    "size": size,
                    "dimensionsInches": {
                        "length": ws.cell(row, 9).value,
                        "width": ws.cell(row, 10).value,
                        "height": ws.cell(row, 11).value,
                    },
                },
                "contract": variant_contract(handle, size),
            }
        )
    return {
        "title": title,
        "handle": handle,
        "manufacturer": "BEDGEAR",
        "model": model,
        "productType": "Mattress",
        "templateSuffix": "product-pod-builder",
        "assortmentStatus": "APPROVED",
        "shopifyStatus": "DRAFT",
        "publicationReadiness": "BLOCKED",
        "collections": ["mattresses"],
        "source": {"document": SOURCE.name, "sheet": ws.title, "rows": [rows.start, rows.stop - 1]},
        "contract": base_contract(model, display_count),
        "variants": variants,
    }


def modular_product(
    ws,
    *,
    model: str,
    title: str,
    handle: str,
    row_groups: list[tuple[int, int, int]],
    excluded: list[dict[str, object]] | None = None,
    geometry_overrides: dict[int, str] | None = None,
) -> dict[str, object]:
    variants = []
    for chassis_row, suspension_start, complete_row in row_groups:
        size = text(ws.cell(chassis_row, 4).value)
        sku = text(ws.cell(chassis_row, 1).value)
        suspension_rows = range(suspension_start, suspension_start + 4)
        suspension_count = 1 if size == "Twin XL" else 2
        complete_price = Decimal(str(ws.cell(chassis_row, 7).value)) + (
            Decimal(str(ws.cell(suspension_start, 7).value)) * suspension_count
        )
        options = []
        for row in suspension_rows:
            label = text(ws.cell(row, 2).value).split(" Independent", 1)[0]
            options.append(
                {
                    "feel": label,
                    "manufacturerComponentSku": text(ws.cell(row, 1).value),
                    "manufacturerComponentUpc": text(ws.cell(row, 8).value),
                    "sourceRow": row,
                }
            )
        contract = variant_contract(handle, size)
        if geometry_overrides and chassis_row in geometry_overrides:
            contract["sleep_geometry"] = geometry_overrides[chassis_row]
        variants.append(
            {
                "options": {"Size": size},
                "sku": sku,
                "skuScope": "CHASSIS_AND_COMFORT_LAYER_COMPONENT_ONLY",
                "referencePrice": price(complete_price),
                "referencePriceScope": "HISTORICAL_COMPLETE_PRICE_USING_ONE_SUPPORTED_FEEL_PER_REQUIRED_SUSPENSION",
                "source": {
                    "document": SOURCE.name,
                    "sheet": ws.title,
                    "chassisRow": chassis_row,
                    "suspensionRows": [suspension_start, suspension_start + 3],
                    "completePriceRow": complete_row,
                },
                "verifiedSpecifications": {
                    "size": size,
                    "workbookGroupLabel": text(ws.cell(chassis_row - 2, 2).value),
                    "chassisAndComfortLayerSku": sku,
                    "chassisUpc": text(ws.cell(chassis_row, 8).value),
                    "dimensionsInches": {
                        "length": ws.cell(chassis_row, 9).value,
                        "width": ws.cell(chassis_row, 10).value,
                        "height": ws.cell(chassis_row, 11).value,
                    },
                    "requiredIndependentSuspensionCount": suspension_count,
                    "manufacturerComponentFeelOptions": options,
                },
                "configurationStatus": "PENDING_APPROVED_COMPLETE_SELL_UNIT_AND_LEFT_RIGHT_COMBINATION_MAP",
                "contract": contract,
            }
        )
    contract = base_contract(model, 2)
    contract.update(
        {
            "comfort_options": typed(
                "json",
                {
                    "verifiedComponentFeelLabels": ["0.0", "1.0", "2.0", "3.0"],
                    "requestedSelectionMode": "independent_left_right",
                    "verificationStatus": "PENDING_APPROVED_COMPLETE_CONFIGURATION_MAP",
                },
            ),
            "configuration_readiness": "PENDING_VENDOR_CONFIGURATION_MAP",
        }
    )
    return {
        "title": title,
        "handle": handle,
        "manufacturer": "BEDGEAR",
        "model": model,
        "productType": "Mattress",
        "templateSuffix": "product-pod-builder",
        "assortmentStatus": "APPROVED",
        "shopifyStatus": "DRAFT",
        "publicationReadiness": "BLOCKED",
        "collections": ["mattresses"],
        "source": {"document": SOURCE.name, "sheet": ws.title},
        "dualComfort": {
            "componentFeelLabelsVerified": ["0.0", "1.0", "2.0", "3.0"],
            "independentLeftRightSelection": "PENDING_APPROVED_COMPLETE_CONFIGURATION_MAP",
            "shopifyVariantBoundary": "SIZE_ONLY_DRAFT_STRUCTURE",
            "missingFields": ["approved complete sell-unit SKU", "allowed left/right combinations", "fulfillment component quantities by configuration"],
        },
        "excludedManufacturerRows": excluded or [],
        "contract": contract,
        "variants": variants,
    }


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Missing workbook: {SOURCE}")
    wb = load_workbook(SOURCE, data_only=False, read_only=True)
    products = [
        standard_product(
            wb["MATTRESSES"],
            model="S7",
            title='S7 — 12" Memory Foam Mattress',
            handle="bedgear-s7-12-memory-foam",
            rows=range(22, 32),
            display_count=1,
        ),
        standard_product(
            wb["MATTRESSES"],
            model="H6",
            title='H6 — 12" Hybrid Mattress',
            handle="bedgear-h6-12-hybrid",
            rows=range(58, 68),
            display_count=1,
        ),
        modular_product(
            wb["M3 - CURRENT"],
            model="M3",
            title='M3 — 12" Dual Comfort Mattress',
            handle="bedgear-m3-12-dual-comfort",
            row_groups=[(7, 8, 12), (17, 18, 22), (27, 28, 32), (37, 38, 42), (47, 48, 52), (57, 58, 62), (77, 78, 82), (87, 88, 92)],
            excluded=[
                {
                    "size": "Split King",
                    "rows": [67, 72],
                    "reason": "The current sheet reuses the Twin XL chassis SKU and instructs Order 2; no unique complete sell-unit SKU is provided.",
                }
            ],
        ),
        modular_product(
            wb["M5 - ALL"],
            model="M5",
            title='M5 — 14" Dual Comfort Mattress',
            handle="bedgear-m5-14-dual-comfort",
            row_groups=[(7, 8, 12), (17, 18, 22), (27, 28, 32), (37, 38, 42), (47, 48, 52), (57, 58, 62), (67, 68, 72), (77, 78, 82), (87, 88, 92)],
            geometry_overrides={77: "full_split"},
        ),
    ]
    manifest = {
        "schemaVersion": "1.0",
        "generatedAt": "2026-10-31",
        "shopifyStore": "mysnoozepodtest",
        "publicationRule": "DRAFT_ONLY_UNTIL_OWNER_RELEASE_GATE",
        "readbackFile": "docs/catalog/bedgear-mattress-shopify-readback.json",
        "expectedProductCount": 4,
        "expectedVariantCount": 37,
        "sourcePolicy": "Exact workbook rows only; historical prices are Draft references and not live authorization.",
        "collections": [
            {
                "title": "Mattresses",
                "handle": "mattresses",
                "templateSuffix": "snoozepod-v1",
                "role": "CANONICAL_BUILDER_SOURCE",
                "requiredForLaunch": True,
            }
        ],
        "products": products,
    }
    OUTPUT.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT} with {len(products)} products and {sum(len(p['variants']) for p in products)} variants.")


if __name__ == "__main__":
    main()
