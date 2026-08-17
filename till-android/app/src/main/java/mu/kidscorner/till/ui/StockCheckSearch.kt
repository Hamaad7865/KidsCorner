package mu.kidscorner.till.ui

import mu.kidscorner.till.data.CatalogVariant
import mu.kidscorner.till.data.StockCheckLocation

data class StockCheckProduct(
    val productId: Int,
    val productName: String,
    val shelfLocation: String?,
    val variants: List<CatalogVariant>,
    val barcodeMatch: Boolean,
)

/** Groups a variant-shaped cache into the products shown by Stock Check. */
fun stockCheckMatches(
    query: String,
    catalog: List<CatalogVariant>,
): List<StockCheckProduct> {
    val needle = query.trim()
    if (needle.isEmpty()) return emptyList()

    return catalog
        .groupBy { it.productId }
        .values
        .mapNotNull { variants ->
            val exactBarcode = variants.any { it.barcode == needle }
            val matches = exactBarcode || variants.any { variant ->
                variant.productName.contains(needle, ignoreCase = true) ||
                    variant.sku.contains(needle, ignoreCase = true) ||
                    variant.barcode?.contains(needle, ignoreCase = true) == true
            }
            if (!matches) return@mapNotNull null

            val first = variants.first()
            StockCheckProduct(
                productId = first.productId,
                productName = first.productName,
                shelfLocation = variants.firstNotNullOfOrNull { it.shelfLocation },
                variants = variants.sortedWith(
                    compareBy<CatalogVariant> { it.sizeSort }
                        .thenBy { it.colourName.lowercase() }
                        .thenBy { it.id },
                ),
                barcodeMatch = exactBarcode,
            )
        }
        .sortedWith(
            compareByDescending<StockCheckProduct> { it.barcodeMatch }
                .thenBy { it.productName.lowercase() },
        )
        .take(30)
}

/** Missing balance rows are a real zero, not an omitted location. */
fun quantityAt(location: StockCheckLocation, variantId: Int): Int =
    location.quantities.firstOrNull { it.variantId == variantId }?.qty ?: 0
