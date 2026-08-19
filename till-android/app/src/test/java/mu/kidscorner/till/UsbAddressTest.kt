package mu.kidscorner.till

import mu.kidscorner.till.print.parseUsbAddress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The `vendorId:productId` a USB printer is stored under.
 *
 * The only pure logic in the USB path worth pinning: nothing here can talk to a
 * USB device on a build machine, but the string a plugged-in printer is saved as
 * and looked up by has to round-trip exactly, or the settings screen saves a
 * printer that `PrinterSettings.transport` can never resolve.
 */
class UsbAddressTest {

    @Test
    fun `parses a decimal vendor and product pair, trimming spaces`() {
        assertEquals(1234 to 5678, parseUsbAddress("1234:5678"))
        assertEquals(0 to 0, parseUsbAddress("0:0"))
        assertEquals(1155 to 22339, parseUsbAddress(" 1155 : 22339 "))
    }

    @Test
    fun `rejects anything that is not two non-negative integers`() {
        val bad = listOf(
            "", // nothing
            "1234", // one number, no colon
            "1234:", // missing product
            ":5678", // missing vendor
            "1234:56:78", // three parts
            "12ab:34", // not a number
            "-1:2", // negative vendor
            "1:-2", // negative product
            "0x4:0x5", // hex, which this format does not accept
        )
        for (value in bad) {
            assertNull("expected null for '$value'", parseUsbAddress(value))
        }
    }
}
