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
    fun `a zero limit is no account, even with the other fields set`() {
        val customer = Customer(id = 1, fullName = "Rita", creditLimit = 0.0, creditAvailable = 0.0)
        assertFalse(customer.hasAccount)
        assertEquals("No credit account", customer.creditBlockedReason)
    }

    @Test
    fun `an open account with room is usable`() {
        val customer = Customer(
            id = 1,
            fullName = "Rita",
            creditLimit = 1_000.0,
            creditBalance = 200.0,
            creditAvailable = 800.0,
        )
        assertTrue(customer.hasAccount)
        assertTrue(customer.owes)
        assertTrue(customer.canUseCredit)
        assertNull(customer.creditBlockedReason)
    }

    @Test
    fun `a held account keeps its limit but cannot be used`() {
        val customer = Customer(
            id = 1,
            fullName = "Rita",
            creditLimit = 1_000.0,
            creditAvailable = 800.0,
            creditOnHold = true,
        )
        assertTrue(customer.hasAccount)
        assertFalse(customer.canUseCredit)
        assertEquals("Account on hold", customer.creditBlockedReason)
    }

    @Test
    fun `an account at its limit has no room`() {
        val customer = Customer(
            id = 1,
            fullName = "Rita",
            creditLimit = 1_000.0,
            creditBalance = 1_000.0,
            creditAvailable = 0.0,
        )
        assertFalse(customer.canUseCredit)
        assertEquals("No credit left", customer.creditBlockedReason)
    }

    @Test
    fun `a negative balance is money held for the customer, not debt`() {
        val customer = Customer(
            id = 1,
            fullName = "Rita",
            creditLimit = 1_000.0,
            creditBalance = -150.0,
            creditAvailable = 1_000.0,
        )
        assertFalse(customer.owes)
        assertTrue(customer.canUseCredit)
    }
}
