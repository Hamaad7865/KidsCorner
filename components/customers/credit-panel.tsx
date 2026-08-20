import { CircleAlert, Clock, Wallet } from "lucide-react"

import {
  CreditTermsDialog,
  SettleAccountDialog,
  WriteOffDialog,
} from "@/components/customers/credit-dialogs"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AGING_COLUMNS, daysBetween, type AgingBuckets } from "@/lib/credit/aging"
import {
  CREDIT_ENTRY_LABELS,
  type CreditAccount,
  type CreditEntry,
} from "@/lib/credit/queries"
import { PAYMENT_METHOD_LABELS } from "@/lib/db-enums"
import { formatDate, formatDateTime, formatRs, round2, shopToday } from "@/lib/format"

/**
 * The account section of a customer's page: what they owe, how old it is, and
 * every movement that got them there.
 *
 * Rendered on the server. Only the three dialogs are client components, because
 * only they need state — the figures all come from `customer_credit_accounts`,
 * which derives them from the ledger, so there is nothing here to keep in sync.
 */
export function CreditPanel({
  customer,
  account,
  aging,
  statement,
  canWriteOff,
}: {
  customer: { id: number; fullName: string }
  /** Null when this customer has no account and none has ever been used. */
  account: CreditAccount | null
  aging: AgingBuckets
  statement: CreditEntry[]
  /** Owner only — writing a debt off is not a manager's call. */
  canWriteOff: boolean
}) {
  const terms = {
    id: customer.id,
    fullName: customer.fullName,
    creditLimit: account?.creditLimit ?? 0,
    creditTermsDays: account?.creditTermsDays ?? 30,
    onHold: account?.onHold ?? false,
  }

  // No account and no history: offer to open one and say nothing else.
  if (!account) {
    return (
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-base font-medium">Credit account</h2>
          <CreditTermsDialog customer={terms} hasAccount={false} />
        </div>
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Wallet className="text-muted-foreground mx-auto size-8" aria-hidden />
          <p className="mt-3 font-medium">No account</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            {customer.fullName} pays at the till. Open an account to let the till
            bill them and settle later.
          </p>
        </div>
      </section>
    )
  }

  const owes = account.balance > 0
  const inCredit = account.balance < 0
  const overdue = round2(
    aging.days1to30 + aging.days31to60 + aging.days60plus,
  )
  const closed = account.creditLimit <= 0
  const usage =
    account.creditLimit > 0
      ? Math.min(100, Math.max(0, (account.balance / account.creditLimit) * 100))
      : 0
  const today = shopToday()

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-base font-medium">Credit account</h2>
        <div className="flex flex-wrap gap-2">
          <CreditTermsDialog customer={terms} hasAccount />
          {canWriteOff ? (
            <WriteOffDialog
              customerId={customer.id}
              customerName={customer.fullName}
              balance={account.balance}
            />
          ) : null}
          <SettleAccountDialog
            customerId={customer.id}
            customerName={customer.fullName}
            balance={account.balance}
          />
        </div>
      </div>

      {account.onHold ? (
        <div className="border-destructive/40 bg-destructive/5 flex items-start gap-2 rounded-lg border p-3">
          <CircleAlert className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="text-sm">
            This account is <strong>on hold</strong>. The till will refuse to add
            anything to it until the hold is lifted.
          </p>
        </div>
      ) : null}

      {closed && owes ? (
        <div className="flex items-start gap-2 rounded-lg border p-3">
          <CircleAlert className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="text-sm">
            The limit is Rs 0, so nothing more can be charged — but{" "}
            {formatRs(account.balance)} is still owed and still being chased.
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <div
              className={`text-2xl font-semibold tabular-nums ${
                overdue > 0 ? "text-destructive" : ""
              }`}
            >
              {formatRs(Math.abs(account.balance))}
            </div>
            <div className="text-muted-foreground text-sm">
              {inCredit ? "Held in credit" : "Owed"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-2xl font-semibold tabular-nums">
              {formatRs(account.available)}
            </div>
            <div className="text-muted-foreground text-sm">
              Available of {formatRs(account.creditLimit)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div
              className={`text-2xl font-semibold tabular-nums ${
                overdue > 0 ? "text-destructive" : ""
              }`}
            >
              {formatRs(overdue)}
            </div>
            <div className="text-muted-foreground text-sm">Overdue</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-2xl font-semibold tabular-nums">
              {account.creditTermsDays}
              <span className="text-muted-foreground ml-1 text-base font-normal">
                days
              </span>
            </div>
            <div className="text-muted-foreground text-sm">
              {account.oldestDueOn
                ? `Oldest due ${formatDate(account.oldestDueOn)}`
                : "Terms to pay"}
            </div>
          </CardContent>
        </Card>
      </div>

      {account.creditLimit > 0 ? (
        <div className="space-y-1">
          <div className="bg-muted h-2 overflow-hidden rounded-full">
            <div
              className={`h-full rounded-full ${
                usage >= 100 ? "bg-destructive" : "bg-brand-600"
              }`}
              style={{ width: `${usage}%` }}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {usage >= 100
              ? "At the limit — the till will refuse a new charge."
              : `${Math.round(usage)}% of the limit used.`}
          </p>
        </div>
      ) : null}

      {aging.total > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {AGING_COLUMNS.map((column) => (
                  <TableHead key={column.key} className="text-right">
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                {AGING_COLUMNS.map((column) => {
                  const value = aging[column.key]
                  return (
                    <TableCell
                      key={column.key}
                      className={`text-right tabular-nums ${
                        column.key !== "current" && value > 0
                          ? "text-destructive font-medium"
                          : ""
                      }`}
                    >
                      {value > 0 ? formatRs(value) : "—"}
                    </TableCell>
                  )
                })}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      ) : null}

      <h3 className="pt-2 text-sm font-medium">Statement</h3>

      {statement.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Clock className="text-muted-foreground mx-auto size-8" aria-hidden />
          <p className="mt-3 font-medium">Nothing on the account yet</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            Charges appear here when the till rings up a sale on account.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">When</TableHead>
                <TableHead>What</TableHead>
                <TableHead className="w-32">Due</TableHead>
                <TableHead className="w-32 text-right">Amount</TableHead>
                <TableHead className="w-32 text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Newest first on screen; the running balance was computed
                  oldest-first, which is the only order it means anything in. */}
              {[...statement].reverse().map((entry) => {
                const late =
                  entry.entryType === "charge" &&
                  entry.dueOn !== null &&
                  daysBetween(entry.dueOn, today) > 0

                return (
                  <TableRow key={entry.id}>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDateTime(entry.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>
                          {CREDIT_ENTRY_LABELS[entry.entryType] ?? entry.entryType}
                        </span>
                        {entry.method ? (
                          <Badge variant="secondary">
                            {PAYMENT_METHOD_LABELS[entry.method]}
                          </Badge>
                        ) : null}
                        {late ? <Badge variant="outline">Overdue</Badge> : null}
                      </div>
                      {entry.reason ? (
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          {entry.reason}
                          {entry.createdByName ? ` · ${entry.createdByName}` : ""}
                        </p>
                      ) : entry.createdByName ? (
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          {entry.createdByName}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {entry.dueOn ? formatDate(entry.dueOn) : "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        entry.amount < 0 ? "text-brand-700" : ""
                      }`}
                    >
                      {entry.amount > 0 ? "+" : ""}
                      {formatRs(entry.amount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRs(entry.runningBalance)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {statement.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          The account is an append-only ledger: nothing here is ever edited or
          deleted, and a correction is a new entry that says so. The balance is
          the sum of this column, not a stored figure.
        </p>
      ) : null}
    </section>
  )
}
