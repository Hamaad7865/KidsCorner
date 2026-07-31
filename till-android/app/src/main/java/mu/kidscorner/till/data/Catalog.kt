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
    version = 2,
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
    }
}
