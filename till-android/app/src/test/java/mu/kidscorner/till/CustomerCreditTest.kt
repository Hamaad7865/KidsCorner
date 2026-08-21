package mu.kidscorner.till

import mu.kidscorner.till.data.Customer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The rules that decide what the ON ACCOUNT tile says and does.
 *
 * These defaults are the difference between a till that never offers credit
 * (against an older server) and one that offers it wrongly. They are also the
 * only customer-side decision about credit — everything else is re-checked on
 * the server, so a wrong answer here is a wrong label, never a wrong charge.
 *
 * There is no ceiling: an open account, not on hold, is usable whatever its
 * balance.
 */
class CustomerCreditTest {

    @Test
    fun `an older server payload means no account at all`() {
        val customer = Customer(id = 1, fullName = "Rita")
        assertFalse(customer.hasAccount)
        assertFalse(customer.canUseCredit)
        assertFalse(customer.owes)
        assertEquals("No credit account", customer.creditBlockedReason)
    }

    @Test
    fun `credit disabled is no account`() {
        val customer = Customer(id = 1, fullName = "Rita", creditEnabled = false)
        assertFalse(customer.hasAccount)
        assertEquals("No credit account", customer.creditBlockedReason)
    }

    @Test
    fun `an open account is usable, whatever the balance`() {
        val customer = Customer(
            id = 1,
            fullName = "Rita",
            creditEnabled = true,
            creditBalance = 200.0,
        )
        assertTrue(customer.hasAccount)
        assertTrue(customer.owes)
        assertTrue(customer.canUseCredit)
        assertNull(customer.creditBlockedReason)
    }

    @Test
    fun `a large balance on an open account is still usable`() {
        // The whole point of dropping the limit: no figure blocks the tile.
        val customer = Customer(
            id = 1,
            fullName = "Rita",
            creditEnabled = true,
            creditBalance = 5_000_000.0,
        )
        assertTrue(customer.canUseCredit)
        assertNull(customer.creditBlockedReason)
    }

    @Test
    fun `a held account keeps its account but cannot be used`() {
        val customer = Customer(
            id = 1,
            fullName = "Rita",
            creditEnabled = true,
            creditOnHold = true,
        )
        assertTrue(customer.hasAccount)
        assertFalse(customer.canUseCredit)
        assertEquals("Account on hold", customer.creditBlockedReason)
    }

    @Test
    fun `a negative balance is money held for the customer, not debt`() {
        val customer = Customer(
            id = 1,
            fullName = "Rita",
            creditEnabled = true,
            creditBalance = -150.0,
        )
        assertFalse(customer.owes)
        assertTrue(customer.canUseCredit)
    }
}
