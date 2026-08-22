package mu.kidscorner.till

import mu.kidscorner.till.print.AccountPaymentDueLine
import mu.kidscorner.till.print.AccountPaymentSlipDoc
import mu.kidscorner.till.print.PaperWidth
import mu.kidscorner.till.print.ShopIdentity
import mu.kidscorner.till.print.buildAccountPaymentSlip
import mu.kidscorner.till.print.toPlainText
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The printed account-payment slip.
 *
 * Checked without hardware, like the receipt and credit note: nothing exceeds
 * the paper, the money the customer handed over and the balance they leave with
 * are both stated, and — because a payment against a tab is not a sale — the slip
 * carries no VAT wording at all.
 */
class AccountPaymentSlipTest {

    private val shop = ShopIdentity(
        name = "Kids Corner",
        address = "Royal Road, Curepipe",
        phone = "5xxx xxxx",
    )

    private fun doc() = AccountPaymentSlipDoc(
        customerName = "Rita Appadoo",
        dateIso = "2026-08-18T10:15:00.000Z",
        method = "cash",
        amount = 350.0,
        previousBalance = 800.0,
        newBalance = 450.0,
        cashierName = "Marie",
    )

    @Test
    fun `no line ever exceeds the paper width`() {
        for (width in PaperWidth.entries) {
            val text = buildAccountPaymentSlip(doc(), shop, width).toPlainText(width)
            for (line in text.lines()) {
                assertTrue("\"$line\" too wide on ${width.label}", line.length <= width.columns)
            }
        }
    }

    @Test
    fun `states who paid, what they paid, and the new balance`() {
        for (width in PaperWidth.entries) {
            val text = buildAccountPaymentSlip(doc(), shop, width).toPlainText(width)
            assertTrue("no header on ${width.label}", text.contains("ACCOUNT PAYMENT"))
            assertTrue("no customer on ${width.label}", text.contains("Rita Appadoo"))
            assertTrue("payment not stated on ${width.label}", text.contains("Paid Cash"))
            assertTrue("amount missing on ${width.label}", text.contains("350.00"))
            assertTrue("new balance missing on ${width.label}", text.contains("450.00"))
            assertTrue("previous balance missing on ${width.label}", text.contains("800.00"))
            assertTrue("cashier missing on ${width.label}", text.contains("Marie"))
        }
    }

    @Test
    fun `carries no VAT wording, because a payment is not a sale`() {
        for (width in PaperWidth.entries) {
            val text = buildAccountPaymentSlip(doc(), shop, width).toPlainText(width)
            assertFalse("leaked 'VAT' on ${width.label}", text.contains("VAT"))
            assertFalse("leaked 'tax' on ${width.label}", text.lowercase().contains("tax"))
            assertFalse("leaked 'excl' on ${width.label}", text.lowercase().contains("excl"))
        }
    }

    @Test
    fun `names the receipts being settled, with what was owed and the total`() {
        val withDue = doc().copy(
            amount = 20.0,
            newBalance = 780.0,
            dueItems = listOf(
                AccountPaymentDueLine("S260822-3", 20.0),
                AccountPaymentDueLine("S260821-1", 45.5),
            ),
        )
        for (width in PaperWidth.entries) {
            val text = buildAccountPaymentSlip(withDue, shop, width).toPlainText(width)
            assertTrue("due header missing on ${width.label}", text.contains("Amount due on"))
            assertTrue("receipt 1 missing on ${width.label}", text.contains("S260822-3"))
            assertTrue("receipt 2 missing on ${width.label}", text.contains("S260821-1"))
            assertTrue("line total missing on ${width.label}", text.contains("20.00"))
            assertTrue("second line total missing on ${width.label}", text.contains("45.50"))
            assertTrue("due sum wrong on ${width.label}", text.contains("65.50Rs") || text.contains("65.50 Rs"))
        }
    }

    @Test
    fun `a whole-tab payment prints without a due block`() {
        val text = buildAccountPaymentSlip(doc(), shop, PaperWidth.Mm80).toPlainText(PaperWidth.Mm80)
        assertFalse(text.contains("Amount due on"))
    }

    @Test
    fun `sample slip, for reading`() {
        println("\n--- account payment slip ---")
        println(buildAccountPaymentSlip(doc(), shop, PaperWidth.Mm80).toPlainText(PaperWidth.Mm80))
    }
}
