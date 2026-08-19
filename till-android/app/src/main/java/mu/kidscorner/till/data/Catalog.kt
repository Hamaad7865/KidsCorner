package mu.kidscorner.till.data

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.migration.Migration
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.execSQL
import kotlinx.serialization.Serializable

/**
 * The sellable catalog, cached on the device.
 *
 * Room here is for durability, not for searching: the whole catalog is read
 * into memory at launch and filtered in Kotlin, because a shop's catalog is a
 * few thousand rows and a scanner expects an answer before the cashier's hand
 * leaves the trigger. What Room buys is a till that can still find a product on
 * the morning the internet is down, before any fetch has succeeded.
 *
 * `price` is display only. Every sale is re-priced on the server, so a stale
 * cache shows an old price but can never charge one.
 */

@Serializable
@Entity(tableName = "catalog")
data class CatalogVariant(
    @PrimaryKey val id: Int,
    val productId: Int,
    val productName: String,
    /** Optional product-level shelf code, repeated per cached variant. */
    val shelfLocation: String? = null,
    /** How staff identify the product itself — also product-level, also repeated. */
    val productCode: String? = null,
    val categoryId: Int? = null,
    val categoryName: String? = null,
    val sizeLabel: String = "",
    val sizeSort: Int = 0,
    val colourName: String = "",
    val colourHex: String? = null,
    val sku: String = "",
    val barcode: String? = null,
    val price: Double = 0.0,
    val qtyOnHand: Int = 0,
    /**
     * The product's photograph, where the shop has taken one.
     *
     * On the product, not the variant — a garment is photographed once, and the
     * colour in a customer's hand is already carried by `colourHex`.
     *
     * Defaulted so a till running an older build against a newer server, or a
     * newer build against an older one, simply sees no picture. A missing field
     * must never be the reason a catalogue fails to parse and the counter
     * cannot sell.
     */
    val imageUrl: String? = null,
) {
    /** "Blue · 3-4y", or whichever halves exist. */
    val variantLabel: String
        get() = listOf(colourName, sizeLabel).filter { it.isNotBlank() }.joinToString(" · ")
}

@Serializable
data class CatalogResponse(val ok: Boolean = true, val variants: List<CatalogVariant> = emptyList())

@Dao
interface CatalogDao {
    @Query("SELECT * FROM catalog ORDER BY productName, sizeSort, colourName")
    suspend fun all(): List<CatalogVariant>

    @Query("SELECT COUNT(*) FROM catalog")
    suspend fun count(): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(variants: List<CatalogVariant>)

    @Query("DELETE FROM catalog")
    suspend fun clear()

    /**
     * Replaces the cache wholesale, in one transaction.
     *
     * Not an upsert: a variant retired in the back office has to *leave* the
     * till, and an upsert would keep selling it forever. The transaction means
     * a fetch interrupted halfway cannot leave the till with a half-catalog —
     * it keeps the old one, which is stale but complete.
     */
    @Transaction
    suspend fun replaceAll(variants: List<CatalogVariant>) {
        if (variants.isEmpty()) return
        clear()
        insertAll(variants)
    }
}

@Database(
    entities = [CatalogVariant::class, QueuedSale::class],
    version = 5,
    exportSchema = true,
)
abstract class TillDatabase : RoomDatabase() {
    abstract fun catalog(): CatalogDao
    abstract fun queue(): SaleQueueDao

    companion object {
        /**
         * Adds the sale queue.
         *
         * Written out rather than left to `fallbackToDestructiveMigration`,
         * which the catalog could afford — it is a cache of server state — and
         * this table cannot. A destructive migration here would silently delete
         * sales the shop has already taken money for and not yet sent.
         */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(connection: SQLiteConnection) {
                connection.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `queued_sales` (
                        `key` TEXT NOT NULL,
                        `payload` TEXT NOT NULL,
                        `queuedAt` INTEGER NOT NULL,
                        `attempts` INTEGER NOT NULL,
                        `lastAttemptAt` INTEGER,
                        `lastError` TEXT,
                        `total` REAL NOT NULL,
                        `itemCount` INTEGER NOT NULL,
                        PRIMARY KEY(`key`)
                    )
                    """.trimIndent(),
                )
            }
        }

        /**
         * Adds the product photograph to the cached catalogue.
         *
         * Written out rather than dropped and refetched even though the catalog
         * IS a cache and could afford it. The two tables share a database, and
         * `fallbackToDestructiveMigration` does not know the difference — it
         * would take `queued_sales` with it, and that table holds sales the shop
         * has already been paid for and not yet sent.
         *
         * Nullable with no default: a till that migrates before its next fetch
         * shows no pictures for a few seconds and then has them, which is the
         * correct behaviour for a cache.
         */
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(connection: SQLiteConnection) {
                connection.execSQL("ALTER TABLE `catalog` ADD COLUMN `imageUrl` TEXT")
            }
        }

        /** Keeps queued sales while adding the product's stock-finding hint. */
        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(connection: SQLiteConnection) {
                connection.execSQL("ALTER TABLE `catalog` ADD COLUMN `shelfLocation` TEXT")
            }
        }

        /** Same idea as 3→4, for the code staff identify the product by. */
        val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(connection: SQLiteConnection) {
                connection.execSQL("ALTER TABLE `catalog` ADD COLUMN `productCode` TEXT")
            }
        }
    }
}
