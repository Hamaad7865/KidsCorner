package mu.kidscorner.till.data

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Transaction

/**
 * The last few customers this till dealt with, cached on the device.
 *
 * The attach dialog's RECENT section is only honest if it survives a restart,
 which no in-memory list does, so it lives in Room beside the catalog and the
 sale queue — the two other things a till must be able to reach with no line.
 *
 * A dedicated entity rather than annotating [Customer] itself: Customer is a
 wire DTO used all over the app, and none of its other callers should carry a
 local timestamp column.
 */

/** How many recents are kept. Small on purpose: it is a shelf, not a directory. */
const val RECENT_CUSTOMERS_CAP = 8

@Entity(tableName = "recent_customers")
data class RecentCustomer(
    @PrimaryKey val id: Int,
    val fullName: String,
    val phone: String?,
    val creditEnabled: Boolean,
    val creditBalance: Double,
    val creditOnHold: Boolean,
    /** Epoch millis — orders the list, drives eviction. */
    val lastUsedAt: Long,
)

@Dao
interface RecentCustomerDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: RecentCustomer)

    @Query("SELECT * FROM recent_customers ORDER BY lastUsedAt DESC LIMIT :limit")
    suspend fun recent(limit: Int): List<RecentCustomer>

    @Query(
        "DELETE FROM recent_customers WHERE id NOT IN " +
            "(SELECT id FROM recent_customers ORDER BY lastUsedAt DESC LIMIT :keep)",
    )
    suspend fun trim(keep: Int)

    /** Newest touch wins; the oldest rows fall off the end. */
    @Transaction
    suspend fun touchAndTrim(row: RecentCustomer, keep: Int = RECENT_CUSTOMERS_CAP) {
        upsert(row)
        trim(keep)
    }
}

fun RecentCustomer.toCustomer(): Customer = Customer(
    id = id,
    fullName = fullName,
    phone = phone,
    creditEnabled = creditEnabled,
    creditBalance = creditBalance,
    creditOnHold = creditOnHold,
)
