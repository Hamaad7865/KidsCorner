package mu.kidscorner.till

import mu.kidscorner.till.print.Align
import mu.kidscorner.till.print.DepositSlipDoc
import mu.kidscorner.till.print.DepositSlipLine
import mu.kidscorner.till.print.DepositSlipPayment
import mu.kidscorner.till.print.DepositTopUpSlipDoc
import mu.kidscorner.till.print.PaperWidth
import mu.kidscorner.till.print.ShopIdentity
import mu.kidscorner.till.print.buildDepositSlip
import mu.kidscorner.till.print.buildDepositTopUpSlip
import mu.kidscorner.till.print.toPlainText
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The deposit slips, checked without a printer.
 *
 * Each visit's slip must tell the dated money story so far: what was paid,
 * when, and what is still owed — the second visit names the first payment's
 * date, the third names both.
 */
class DepositSlipTest {

    private val shop = ShopIdentity(
        name = "Kids Corner",
        address = "Royal Road, Curepipe",
        phone = "5xxx xxxx",
    )

    private val items = listOf(
        DepositSlipLine("Cotton tee 3-6 mths Pink", 1, 340.0, 0.0),
        DepositSlipLine("Denim shorts 2 yrs Blue", 1, 660.0, 0.0),
    )

    @Test
    fun `the take slip is invoice-styled with the first payment dated`() {
        val text = buildDepositSlip(
            doc = DepositSlipDoc(
                orderNo = "D-0001",
                customerName = "Marie",
                customerPhone = null,
                dateIso = "2026-09-01T10:00:00.000Z",
                items = items,
                total = 1000.0,
                paidNow = 200.0,
                payments = listOf(DepositSlipPayment("2026-09-01T10:00:00.000Z", "cash", 200.0)),
                balance = 800.0,
            ),
            shop = shop,
            width = PaperWidth.Mm80,
        ).toPlainText(PaperWidth.Mm80)
        assertTrue(text.contains("DEPOSIT INVOICE"))
        assertTrue(text.contains("D-0001"))
        assertTrue(text.contains("Cotton tee"))
        assertTrue(text.contains("200.00Rs"))
        assertTrue(text.contains("Balance due : 800.00Rs"))
    }

    @Test
    fun `the top-up slip names every earlier payment with its date`() {
        val text = buildDepositTopUpSlip(
            doc = DepositTopUpSlipDoc(
                orderNo = "D-0001",
                customerName = "Marie",
                dateIso = "2026-09-05T15:30:00.000Z",
                items = items,
                method = "cash",
                amountPaidNow = 200.0,
                payments = listOf(
                    DepositSlipPayment("2026-09-01T10:00:00.000Z", "cash", 200.0),
                    DepositSlipPayment("2026-09-05T15:30:00.000Z", "cash", 200.0),
                ),
                totalPaid = 400.0,
                balance = 600.0,
            ),
            shop = shop,
            width = PaperWidth.Mm80,
        ).toPlainText(PaperWidth.Mm80)
        // The goods are still named — a later slip must say what the money is for.
        assertTrue(text.contains("Denim shorts"))
        // Both tenders dated, not just totals.
        assertTrue(text.contains("01/09 10:00"))
        assertTrue(text.contains("05/09 15:30"))
        assertTrue(text.contains("Balance now : 600.00Rs"))
    }

    @Test
    fun `a partially collected line says what is already home`() {
        val text = buildDepositSlip(
            doc = DepositSlipDoc(
                orderNo = "D-0001",
                customerName = "Marie",
                customerPhone = null,
                dateIso = "2026-09-01T10:00:00.000Z",
                items = listOf(
                    DepositSlipLine("Cotton tee 3-6 mths Pink", 1, 340.0, 0.0, collectedQty = 1),
                    DepositSlipLine("Denim shorts 2 yrs Blue", 1, 660.0, 0.0),
                ),
                total = 1000.0,
                paidNow = 400.0,
                payments = listOf(DepositSlipPayment("2026-09-01T10:00:00.000Z", "cash", 400.0)),
                balance = 600.0,
            ),
            shop = shop,
            width = PaperWidth.Mm80,
        ).toPlainText(PaperWidth.Mm80)
        assertTrue(text.contains("collected 1 of 1"))
    }

    @Test
    fun `no slip line ever exceeds the paper width`() {
        val take = buildDepositSlip(
            doc = DepositSlipDoc(
                orderNo = "D-0001",
                customerName = "Jean-Christophe Ramgoolam-Beeharry",
                customerPhone = null,
                dateIso = "2026-09-01T10:00:00.000Z",
                items = items,
                total = 1000.0,
                paidNow = 200.0,
                payments = listOf(DepositSlipPayment("2026-09-01T10:00:00.000Z", "cash", 200.0)),
                balance = 800.0,
            ),
            shop = shop,
            width = PaperWidth.Mm58,
        ).toPlainText(PaperWidth.Mm58)
        for (line in take.lines()) {
            assertTrue("overflowed (${line.length}): $line", line.length <= PaperWidth.Mm58.columns)
        }
        val topUp = buildDepositTopUpSlip(
            doc = DepositTopUpSlipDoc(
                orderNo = "D-0001",
                customerName = "Marie",
                dateIso = "2026-09-05T15:30:00.000Z",
                items = items,
                method = "cash",
                amountPaidNow = 200.0,
                payments = listOf(
                    DepositSlipPayment("2026-09-01T10:00:00.000Z", "cash", 200.0),
                    DepositSlipPayment("2026-09-05T15:30:00.000Z", "cash", 200.0),
                ),
                totalPaid = 400.0,
                balance = 600.0,
            ),
            shop = shop,
            width = PaperWidth.Mm58,
        ).toPlainText(PaperWidth.Mm58)
        for (line in topUp.lines()) {
            assertTrue("overflowed (${line.length}): $line", line.length <= PaperWidth.Mm58.columns)
        }
    }

    @Test
    fun `a refund leg reads as money back, never a negative payment`() {
        val text = buildDepositTopUpSlip(
            doc = DepositTopUpSlipDoc(
                orderNo = "D-0001",
                customerName = "Marie",
                dateIso = "2026-09-05T15:30:00.000Z",
                method = "cash",
                amountPaidNow = 200.0,
                payments = listOf(
                    DepositSlipPayment("2026-09-01T10:00:00.000Z", "cash", 200.0),
                    DepositSlipPayment("2026-09-03T10:00:00.000Z", "cash", -50.0),
                    DepositSlipPayment("2026-09-05T15:30:00.000Z", "cash", 200.0),
                ),
                totalPaid = 350.0,
                balance = 650.0,
            ),
            shop = shop,
            width = PaperWidth.Mm80,
        ).toPlainText(PaperWidth.Mm80)
        assertTrue(text.contains("REFUND"))
        assertFalse(text.contains("-50.00Rs"))
    }
}
