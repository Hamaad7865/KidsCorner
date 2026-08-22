import type { Metadata } from "next"

import { AccessPanel } from "@/components/settings/access-panel"
import { BarcodesPanel } from "@/components/settings/barcodes-panel"
import { RolePermissions } from "@/components/settings/role-permissions"
import { LocationsPanel } from "@/components/settings/locations-panel"
import { DiscountsPanel } from "@/components/settings/discounts-panel"
import { getAccessGrid, listLocations } from "@/lib/access/queries"
import {
  countVariantsWithoutBarcode,
  readBarcodeSettings,
} from "@/lib/barcodes/queries"
import { MasterDataTabs } from "@/components/settings/master-data-tabs"
import { ShopSettings } from "@/components/settings/shop-settings"
import { VatSettings } from "@/components/settings/vat-settings"
import { StaffPins } from "@/components/settings/staff-pins"
import { StaffLogins } from "@/components/settings/staff-logins"
import {
  getPaymentMethods,
  getRefundRequiresManager,
  getShopIdentity,
  getShopName,
} from "@/lib/pos/queries"
import { getCurrentVatPolicy } from "@/lib/vat/policy"
import { canManageCatalog } from "@/lib/auth/roles"
import { listDiscounts } from "@/lib/discounts/queries"
import { listStaffPinState } from "@/lib/pos/actions"
import { listStaffLogins } from "@/lib/staff/actions"
import { requireAdminProfile } from "@/lib/auth/session"
import { getMasterData } from "@/lib/master-data/queries"

export const metadata: Metadata = { title: "Settings" }

export default async function SettingsPage() {
  const profile = await requireAdminProfile()
  const [
    data,
    staff,
    logins,
    discounts,
    shopName,
    vatPolicy,
    paymentMethods,
    refundRequiresManager,
    accessGrid,
    locations,
    barcodeSettings,
    barcodesMissing,
    identity,
  ] = await Promise.all([
    getMasterData(),
    listStaffPinState(),
    listStaffLogins(),
    listDiscounts(),
    getShopName(),
    getCurrentVatPolicy(),
    getPaymentMethods(),
    getRefundRequiresManager(),
    getAccessGrid(),
    listLocations(),
    readBarcodeSettings(),
    countVariantsWithoutBarcode(),
    getShopIdentity(),
  ])

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-xl font-semibold">Settings</h1>
        <p className="text-muted-foreground text-sm">
          The master data every product, variant and sale references. Owners and
          managers can edit; cashiers never reach this screen.
        </p>
      </header>

      <VatSettings policy={vatPolicy} canManage={profile.role === "owner"} />

      <div className="border-t pt-6">
        <ShopSettings
          shopName={shopName}
          shopAddress={identity.address ?? ""}
          shopPhone={identity.phone ?? ""}
          paymentMethods={paymentMethods}
          refundRequiresManager={refundRequiresManager}
          canManage={profile.role === "owner"}
        />
      </div>

      <div className="border-t pt-6">
        <BarcodesPanel
          settings={barcodeSettings}
          missingCount={barcodesMissing}
          canManage={profile.role === "owner"}
        />
      </div>

      <div className="border-t pt-6">
        <MasterDataTabs data={data} />
      </div>

      <div className="border-t pt-6">
        <DiscountsPanel
          discounts={discounts}
          categories={data.categories}
          canManage={canManageCatalog(profile.role)}
        />
      </div>

      <div className="border-t pt-6">
        <StaffPins staff={staff} canManage={profile.role === "owner"} />
      </div>

      {profile.role === "owner" ? (
        <div className="border-t pt-6">
          <StaffLogins
            staff={logins.staff}
            canCreate={logins.canCreate}
            currentUserId={profile.id}
          />
        </div>
      ) : null}

      <div className="border-t pt-6">
        <LocationsPanel
          locations={locations}
          canManage={canManageCatalog(profile.role)}
        />
      </div>

      <div className="border-t pt-6">
        <RolePermissions />
      </div>

      <div className="border-t pt-6">
        <AccessPanel grid={accessGrid} canManage={profile.role === "owner"} />
      </div>

      <p className="text-muted-foreground border-t pt-4 text-xs">
        Enabling or disabling VAT, or changing the rate, affects new sales only.
        Past sales keep the <code>vat_amount</code> and registration status frozen
        against the policy they were rung up under, so history never restates
        itself.
      </p>
    </div>
  )
}
