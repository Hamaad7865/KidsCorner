package mu.kidscorner.till.data

import kotlinx.serialization.Serializable

/**
 * Product management on the tablet: browse, edit, barcode, print.
 *
 * Everything the back office does to a product, minus the jobs that belong at
 * a desk — new products, size×colour generation, photographs, promotions.
 * Those stay on the web; the counter gets searching, price and flag edits,
 * barcode issuing and label printing.
 */

@Serializable
data class TillProductRow(
    val id: Int,
    val name: String,
    val productCode: String? = null,
    val categoryName: String? = null,
    val brandName: String? = null,
    val imageUrl: String? = null,
    val isActive: Boolean = true,
    val variantCount: Int = 0,
    val totalStock: Int = 0,
    val minPrice: Double? = null,
    val maxPrice: Double? = null,
    /** Variants with no barcode or an invalid one — what Generate fixes. */
    val barcodelessCount: Int = 0,
) {
    /** "Rs 450" or "Rs 450 – 890", blank where there is nothing to sell. */
    val priceText: String?
        get() = when {
            minPrice == null || maxPrice == null -> null
            minPrice == maxPrice -> formatRs(minPrice)
            else -> formatPriceRange(minPrice, maxPrice)
        }
}

@Serializable
data class TillProductsResponse(
    val ok: Boolean = true,
    val rows: List<TillProductRow> = emptyList(),
    val hasMore: Boolean = false,
    val error: String? = null,
)

@Serializable
data class TillProductVariant(
    val id: Int,
    val sku: String = "",
    val sizeLabel: String = "",
    val colourName: String = "",
    val colourHex: String? = null,
    val costPrice: Double = 0.0,
    val sellingPrice: Double = 0.0,
    val qtyOnHand: Int = 0,
    val reorderLevel: Int = 0,
    val barcode: String? = null,
    /** False when missing or failing the EAN-13 check — unscannable. */
    val barcodeValid: Boolean = false,
    val isActive: Boolean = true,
) {
    /** "Blue · 3-4y", or whichever halves exist. */
    val variantLabel: String
        get() = listOf(colourName, sizeLabel).filter { it.isNotBlank() }.joinToString(" · ")
}

@Serializable
data class TillProductDetail(
    val id: Int,
    val name: String,
    val productCode: String? = null,
    val categoryName: String? = null,
    val brandName: String? = null,
    val shelfLocation: String? = null,
    val description: String? = null,
    val imageUrl: String? = null,
    val isActive: Boolean = true,
    val variants: List<TillProductVariant> = emptyList(),
) {
    val totalStock: Int get() = variants.filter { it.isActive }.sumOf { it.qtyOnHand }
    val barcodeless: List<TillProductVariant>
        get() = variants.filter { !it.barcodeValid }
}

@Serializable
data class TillProductResponse(
    val ok: Boolean = true,
    val product: TillProductDetail? = null,
    val error: String? = null,
    /** Which field refused, so the editor can point at it. */
    val field: String? = null,
)

@Serializable
data class VariantPatchRequest(
    val variantId: Int,
    val sellingPrice: Double,
    /** Sent only by owner/manager — the server refuses it from anyone else. */
    val costPrice: Double? = null,
    val reorderLevel: Int,
    /**
     * Null clears the barcode — so "leave it alone" needs its own flag,
     * because kotlinx always serialises the null.
     */
    val barcode: String? = null,
    val barcodeTouched: Boolean = false,
    val isActive: Boolean,
)

@Serializable
data class ProductPatchRequest(
    val name: String,
    val productCode: String,
    val shelfLocation: String? = null,
    val isActive: Boolean,
)

@Serializable
data class GenerateBarcodesRequest(val variantIds: List<Int>)

@Serializable
data class GenerateBarcodesResponse(
    val ok: Boolean = true,
    val written: Int = 0,
    /** Asked for but already carrying a valid code — never touched. */
    val skippedValid: Int = 0,
    val product: TillProductDetail? = null,
    val error: String? = null,
)
