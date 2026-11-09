"use client"

import { EmptyPrompt } from "@alter-ego/ui/page/empty-prompt"
import { PageHeader } from "@alter-ego/ui/page/page-header"
import { pageState } from "@alter-ego/ui/page/page-state"
import { Button } from "@alter-ego/ui/ui/button"
import { differenceInCalendarMonths, format, parseISO } from "date-fns"
import { ChevronLeft, ChevronRight, Plus } from "lucide-react"
import { useState, useSyncExternalStore } from "react"

import { CellDialog } from "../components/cell-dialog"
import { EndTenancyDialog } from "../components/end-tenancy-dialog"
import { LeaseDialog, tenantName } from "../components/lease-dialog"
import { PaymentDialog, fullMonth } from "../components/payment-dialog"
import { RenewDialog } from "../components/renew-dialog"
import { GridTable, MonthList } from "../components/rent-grid"
import { money } from "../components/status-badge"
import { TenantDialog } from "../components/tenant-dialog"
import { leaseNotSet, roomsText } from "../details"
import { useRent } from "../hooks"
import { groupByProperty, leasesInYear, trimProperty } from "../lease"
import { cellOf, depositOf, monthOf, monthsOfYear, owedFamilies, propertyGrid } from "../rent"

import type { RentAdapter, RentCashBook } from "../adapter"
import type { Figures } from "../components/rent-grid"
import type { GridRow, RentCost, RentMovement } from "../rent"
import type { Lease, Tenant } from "../types"

interface Props {
  db: RentAdapter & RentCashBook
  userId: string
  /** The cash book's rows, read by the app and handed in as plain data. */
  movements: RentMovement[]
  costs: RentCost[]
  accounts: { id: string; name: string }[]
  /** A house's income, costs and result for a year: the Cost Centres figures. */
  figures: (year: number, property: string) => Figures | null
  /** Where the Cost Centres figures live. */
  costCentresHref: string
  /**
   * End Tenancy with a deposit held: the app opens its cash book's Add Movement for giving it back,
   * filled in from this. Called after the lease's new end is saved.
   */
  onReturnDeposit: (back: DepositReturn) => void
  /** After Record Payment saved rows the app owns, so it can refresh them. */
  onCashBookChanged: () => void
  /** "yyyy-MM-dd"; the clock, overridable for tests. */
  today?: string
}

/** What the app needs to fill in Deposit Returned. `date` is "yyyy-MM-dd"; `accountId` is where the deposit came in, if known. */
export interface DepositReturn {
  leaseId: string
  amount: number
  date: string
  /** Whose deposit it is in the cash book: the name it came in under, else the tenant's. */
  counterparty: string
  property: string
  accountId?: string
}

type TenantDialogState = { tenant: Tenant | null; picked?: (tenantId: string) => void } | null
type Picked = { leaseId: string; month: string }

const PHONE = "(max-width: 639px)"
/** Whether the viewport is a phone (below sm): the grid gives way to one month at a time. */
function useIsPhone() {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia?.(PHONE)
      mq?.addEventListener("change", notify)
      return () => mq?.removeEventListener("change", notify)
    },
    () => window.matchMedia?.(PHONE).matches ?? false,
    () => false,
  )
}

const addMonths = (month: string, n: number) => format(new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + n, 1), "yyyy-MM")
const monthWord = (month: string) => format(parseISO(`${month}-01`), "MMMM")

const pill = "inline-flex items-center gap-1 rounded-[10px] border p-[3px]"
const pillValue = "rounded-[7px] bg-foreground px-3.5 py-1.5 text-sm font-medium tabular-nums text-background"

/** The Rent page: who paid each month, by property, and the leases behind it. The app hands it the database, the user and the cash book's rows. */
export function RentPage({ db, userId, movements, costs, accounts, figures, costCentresHref, onReturnDeposit, onCashBookChanged, today = format(new Date(), "yyyy-MM-dd") }: Props) {
  const rent = useRent(db, userId)
  const phone = useIsPhone()
  const [month, setMonth] = useState(() => monthOf(today))
  const year = Number(month.slice(0, 4))
  const [leaseDialog, setLeaseDialog] = useState<{ lease: Lease | null } | null>(null)
  const [tenantDialog, setTenantDialog] = useState<TenantDialogState>(null)
  const [renewing, setRenewing] = useState<Lease | null>(null)
  const [ending, setEnding] = useState<Lease | null>(null)
  const [opened, setOpened] = useState<Picked | null>(null)
  const [paying, setPaying] = useState<Picked | null>(null)

  const waiting = pageState([rent.tenants, rent.leases])
  if (waiting) return waiting

  const tenants = rent.tenants.data ?? [] // pageState returned unless both have data
  const leases = rent.leases.data ?? []
  const tenantOf = (l: Lease) => tenants.find((t) => t.id === l.tenantId)
  const nameOf = (l: Lease) => {
    const t = tenantOf(l)
    return t ? tenantName(t) : "Unknown tenant"
  }
  const groups = groupByProperty(leasesInYear(leases, year)).map((g) => ({
    ...g,
    // Every lease of the house, not only the year's: Owed counts earlier years' debts.
    grid: propertyGrid({ leases: leases.filter((l) => trimProperty(l.property) === g.property), year, movements, costs, today }),
  }))
  // The houses that have leases, in any year: the New Lease list.
  const houses = groupByProperty(leases).map((g) => ({ name: g.property, leases: g.leases.length }))
  const rowName = (r: GridRow) => nameOf(r.lease)
  const notSetOf = (r: GridRow) => leaseNotSet(r.lease, tenantOf(r.lease))
  const leaseOf = (p: Picked | null) => leases.find((l) => l.id === p?.leaseId)
  const pick = (r: GridRow, m: string): Picked => ({ leaseId: r.cells[m]?.leaseId ?? r.lease.id, month: m })

  const thisMonth = monthOf(today)
  const rowOf = (l: Lease) => groups.flatMap((g) => g.grid.rows).find((r) => r.lease.tenantId === l.tenantId && r.room === l.room && trimProperty(r.lease.property) === trimProperty(l.property))
  const depositFor = (l: Lease) => depositOf(l, leases, movements)
  const standing = (l: Lease) => {
    const dep = depositFor(l)
    const left = differenceInCalendarMonths(parseISO(l.endDate), parseISO(today))
    const plural = (n: number) => (n === 1 ? "1 month" : `${n} months`)
    const ends = left > 0 ? `ends in ${plural(left)}` : left === 0 ? "ends this month" : `ended ${plural(-left)} ago`
    return [dep && `Deposit held ${money(dep.held)}`, dep && `owed ${money(rowOf(l)?.owed ?? 0)}`, ends].filter(Boolean).join(" · ")
  }
  const cellsOf = (m: string) => groups.flatMap((g) => g.grid.rows.flatMap((r) => (r.cells[m] && r.cells[m].status !== "outside" ? [r.cells[m]] : [])))
  const sum = (cs: { due: number; paid: number }[], k: "due" | "paid") => Math.round(cs.reduce((s, c) => s + c[k], 0) * 100) / 100
  const nowCells = cellsOf(thisMonth)
  const shownCells = cellsOf(month)
  const leaseCount = groups.reduce((s, g) => s + g.leases.length, 0)
  const depositRows = groups.flatMap((g) => g.grid.rows).filter((r) => r.deposit != null)
  const depositTotal = Math.round(depositRows.reduce((t, r) => t + (r.deposit ?? 0), 0) * 100) / 100
  // Every house, every year: a departed tenant's debt counts here though no lease of theirs runs in the year shown.
  const owedTotal = Math.round(groupByProperty(leases).reduce((s, g) => s + owedFamilies({ leases: g.leases, movements, costs, today }).reduce((t, r) => t + r.owed, 0), 0) * 100) / 100

  const openedLease = leaseOf(opened)
  const payingLease = leaseOf(paying)
  const cellFor = (p: Picked, l: Lease) =>
    cellOf(l, p.month, { movements, costs }, today, leases.filter((x) => x.tenantId === l.tenantId && x.room === l.room && trimProperty(x.property) === trimProperty(l.property)))

  const owedLine = (
    <span key="o">
      Owed <b className="text-foreground">{money(owedTotal)}</b>
    </span>
  )
  // With no lease in the year shown, only the debts of earlier years are left to say.
  const lines = groups.length === 0
    ? [owedLine]
    : phone
    ? [
        <span key="p">
          <b className="text-foreground">{money(sum(shownCells, "paid"))}</b> of {money(sum(shownCells, "due"))} paid
        </span>,
        <span key="o">
          Owed <b className="text-foreground">{money(owedTotal)}</b>
        </span>,
      ]
    : [
        <span key="l">
          <b className="text-foreground">{leaseCount === 1 ? "1 lease" : `${leaseCount} leases`}</b> in {groups.length === 1 ? "1 property" : `${groups.length} properties`}
        </span>,
        ...(nowCells.length > 0
          ? [
              <span key="d">
                <b className="text-foreground">{money(sum(nowCells, "due"))}</b> due a month
              </span>,
              <span key="n">
                {monthWord(thisMonth)} <b className="text-foreground">{money(sum(nowCells, "paid"))}</b> of {money(sum(nowCells, "due"))} paid
              </span>,
            ]
          : []),
        <span key="o">
          Owed <b className="text-foreground">{money(owedTotal)}</b>
        </span>,
        ...(depositRows.length > 0
          ? [
              <span key="h">
                Deposits held <b className="text-foreground">{money(depositTotal)}</b>
              </span>,
            ]
          : []),
      ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Rent"
        subtitle="Who lives where, at what rent, and who has paid."
        actions={
          <>
            <Button variant="outline" onClick={() => setTenantDialog({ tenant: null })}>
              New Tenant
            </Button>
            <Button onClick={() => setLeaseDialog({ lease: null })}>
              <Plus aria-hidden /> New Lease
            </Button>
          </>
        }
      />

      {phone ? (
        <div role="group" aria-label="Month" className={pill}>
          <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft aria-hidden />
          </Button>
          <span aria-live="polite" className={pillValue}>
            {fullMonth(month)}
          </span>
          <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight aria-hidden />
          </Button>
        </div>
      ) : (
        <div role="group" aria-label="Year" className={pill}>
          <Button variant="ghost" size="icon" aria-label="Previous year" onClick={() => setMonth(addMonths(month, -12))}>
            <ChevronLeft aria-hidden />
          </Button>
          <span aria-live="polite" className={pillValue}>
            {year}
          </span>
          <Button variant="ghost" size="icon" aria-label="Next year" onClick={() => setMonth(addMonths(month, 12))}>
            <ChevronRight aria-hidden />
          </Button>
        </div>
      )}

      {(groups.length > 0 || owedTotal > 0) && <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">{lines}</p>}

      {leases.length === 0 ? (
        <EmptyPrompt
          title="No leases yet"
          description="Add a tenant with New Tenant, then the lease with New Lease: which room, at what rent, for how long."
        />
      ) : groups.length === 0 ? (
        <EmptyPrompt variant="inline" title={`No leases in ${year}`} />
      ) : (
        groups.map((g, i) => {
          const f = figures(year, g.property)
          const hidden = g.grid.hiddenBefore
          const shared = { grid: g.grid, year, today, nameOf: rowName, notSetOf, onCell: (r: GridRow, m: string) => setOpened(pick(r, m)), onLease: (r: GridRow) => setLeaseDialog({ lease: r.lease }) }
          return (
            <section key={g.property} aria-labelledby={`house-${i}`} className="overflow-hidden rounded-xl border">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-5 py-4">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <h2 id={`house-${i}`} className="text-lg font-semibold">
                    {g.property}
                  </h2>
                  <span className="text-sm text-muted-foreground">
                    {g.leases.length === 1 ? "1 lease" : `${g.leases.length} leases`} · {roomsText(g.leases)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {f &&
                    (phone ? (
                      <>
                        {year} result <b className="text-foreground">{money(f.result)}</b> ·{" "}
                      </>
                    ) : (
                      <>
                        {year} · income <b className="text-foreground">{money(f.income)}</b> · costs <b className="text-foreground">{money(f.costs)}</b> · result{" "}
                        <b className="text-foreground">{money(f.result)}</b> ·{" "}
                      </>
                    ))}
                  <a href={costCentresHref} className="underline underline-offset-2">
                    Cost Centres
                  </a>
                </p>
              </div>
              {phone ? <MonthList {...shared} month={month} /> : <GridTable {...shared} />}
              {!phone && hidden > 0 && g.grid.months.length > 0 && (
                <p className="border-t px-5 py-2 text-meta text-muted-foreground">
                  {hidden === 1 ? monthWord(monthsOfYear(year)[0]) : `${monthWord(monthsOfYear(year)[0])} to ${monthWord(monthsOfYear(year)[hidden - 1])}`} {hidden === 1 ? "is" : "are"} hidden: no lease ran then.
                </p>
              )}
            </section>
          )
        })
      )}
      {groups.length > 0 && <p className="text-meta text-muted-foreground">Click a month to record a payment or set an agreed amount. Click a tenant to edit, renew or end the lease.</p>}

      <LeaseDialog
        open={!!leaseDialog}
        onOpenChange={(open) => !open && setLeaseDialog(null)}
        lease={leaseDialog?.lease ?? null}
        tenants={tenants}
        properties={houses}
        onSubmit={(input) =>
          leaseDialog?.lease
            ? rent.updateLease.mutateAsync({ id: leaseDialog.lease.id, input })
            : rent.createLease.mutateAsync(input)
        }
        onNewTenant={(picked) => setTenantDialog({ tenant: null, picked })}
        onEditTenant={(tenant) => setTenantDialog({ tenant })}
        onRenew={() => {
          setRenewing(leaseDialog?.lease ?? null)
          setLeaseDialog(null)
        }}
        standing={leaseDialog?.lease ? standing(leaseDialog.lease) : null}
        onEndTenancy={() => {
          setEnding(leaseDialog?.lease ?? null)
          setLeaseDialog(null)
        }}
      />
      <TenantDialog
        open={!!tenantDialog}
        onOpenChange={(open) => !open && setTenantDialog(null)}
        tenant={tenantDialog?.tenant ?? null}
        onSubmit={async (input) => {
          if (tenantDialog?.tenant) return rent.updateTenant.mutateAsync({ id: tenantDialog.tenant.id, input })
          const created = await rent.createTenant.mutateAsync(input)
          tenantDialog?.picked?.(created.id)
        }}
      />
      {renewing && (
        <RenewDialog
          open
          onOpenChange={(open) => !open && setRenewing(null)}
          lease={renewing}
          tenant={nameOf(renewing)}
          onSubmit={(input) => rent.createLease.mutateAsync(input)}
        />
      )}
      {ending && (
        <EndTenancyDialog
          open
          onOpenChange={(open) => !open && setEnding(null)}
          lease={ending}
          tenant={nameOf(ending)}
          deposit={(() => {
            const dep = depositFor(ending)
            return dep && { held: dep.held, owed: rowOf(ending)?.owed ?? 0 }
          })()}
          onSubmit={async (lastDay) => {
            await rent.updateLease.mutateAsync({ id: ending.id, input: { endDate: lastDay } })
            const dep = depositFor(ending)
            // The new end is saved; cancelling the movement keeps it (the deposit stays held, to give back from the Cash Book).
            // A day still to come is not a day a movement can be dated: today, then.
            const date = lastDay < today ? lastDay : today
            if (dep && dep.held > 0) onReturnDeposit({ leaseId: ending.id, amount: dep.held, date, counterparty: dep.counterparty ?? nameOf(ending), property: ending.property, accountId: dep.accountId })
          }}
        />
      )}
      {opened && openedLease && (
        <CellDialog
          open
          onOpenChange={(open) => !open && setOpened(null)}
          lease={openedLease}
          tenant={nameOf(openedLease)}
          month={opened.month}
          cell={cellFor(opened, openedLease)}
          onSaveAgreed={(agreedMonths) => rent.updateLease.mutateAsync({ id: openedLease.id, input: { agreedMonths } })}
          onRecordPayment={() => {
            setPaying(opened)
            setOpened(null)
          }}
        />
      )}
      {paying && payingLease && (
        <PaymentDialog
          open
          onOpenChange={(open) => !open && setPaying(null)}
          lease={payingLease}
          tenant={nameOf(payingLease)}
          month={paying.month}
          cellFor={(m) => cellFor({ leaseId: payingLease.id, month: m }, payingLease)}
          months={monthsOfYear(year)}
          accounts={accounts}
          today={today}
          userId={userId}
          db={db}
          onSaved={onCashBookChanged}
        />
      )}
    </div>
  )
}
