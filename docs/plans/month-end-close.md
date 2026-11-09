> History, dated 2026-11-09: this plan predates the split of the personal and company apps. It describes the old build, so the personal tools (`list_accounts`, `add_transaction`) and the `-crm` file names it mentions no longer exist here.

# Month End Close

> Repository copy of the owner's plan (written in Italian, 2026-10-10), in English and shortened. Names and amounts are made up; no real data of the owner goes in the repository or the tests.

## 1. In short

- A new page, **Month End** (`/month-end`), in the Company menu right after Cash Book: one place to close the month just ended, instead of going round Plan, Invoices, Cash Book, Deadlines and Costs. It does not exist in the personal build.
- It opens on last month. The current month cannot be closed: its hours and invoices are still open.
- One line gives the verdict: "September 2026: 2 steps to do (Hours, Invoices)" or "September 2026 is closed: every required step is done."
- Five steps block: **Hours**, **Invoices**, **Bank**, **To Chase**, **Deadlines**. Three only warn, in amber, and never block: **Waiting for Payment**, **Supplier Invoices Owed**, **Recurring Costs**.
- "Closed" is never stored: it is computed from the data. Edit a September row in November and September turns red again, and the page says so ("Also open").
- **Download CSV** saves the month's export for the accountant without opening the Export dialog.
- Four PRs, each useful alone. No new collection, no new Firestore rule.

## 2. What you see

1. **The month**, with Prev and Next. Next stops at last month; Prev goes back to the first month with data (the first month with hours, or the first company account's opening, whichever is earlier).
2. **The verdict.**
3. **Older months still open**, when there are any: "Also open: 2 earlier months (oldest: July 2026)", with a link.
4. **The amber line**: "3 invoices waiting for payment · 1 recurring cost not paid".
5. **The steps**, in the order the data depends on each other (hours change the plan; invoices rest on the hours). Each is a card with its name, **Done**, **To Do** or **Check** (amber), a count, a sentence saying what done means, and its items, each with one action.

| Step                       | Blocks?                    | Done means                                                                                                                                                                                                                                                         |
| -------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Hours**                  | Yes                        | Every contract planned in the month has hours; the plan holds them (no Use waiting); no month over 31 days; no hours outside a contract's months. A planned month with no hours blocks until hours are logged or the month is set to 0 days.                       |
| **Invoices**               | Yes                        | No client has unbilled hours in this month or an earlier one. Each client invoiced in the month shows the invoice that covers it, e.g. "covered by 14/2026 (Aug–Sep 2026)", so a wrong period shows.                                                               |
| **Waiting for Payment**    | No (amber)                 | A reminder as of today: overdue invoices, invoices with no due date (they never reach Deadlines) and open credit notes.                                                                                                                                            |
| **Supplier Invoices Owed** | No (amber)                 | Supplier invoices dated up to the month end not paid in full.                                                                                                                                                                                                      |
| **Recurring Costs**        | No (amber)                 | Each recurring estimate has a linked payment covering the month; a forgotten link and a payment made just after the month end are pointed out.                                                                                                                     |
| **Bank**                   | Yes, with company accounts | Every account open by the month end matches the bank in a check made on the month's last day or later. A later check counts, and says so: "Matches the bank on 05/10/2026 (after month end)". An account checked at 0 with nothing after it asks for nothing more. |
| **To Chase**               | Yes, with company accounts | Nothing to fix dated up to the month end, an old item included: a balance below zero, a payment with no account, a cost with no document, an estimated date, a row before its account opened.                                                                      |
| **Deadlines**              | Yes                        | No deadline of yours dated up to the month end still open. F24s are not here.                                                                                                                                                                                      |

### The routine on the 1st

1. Wait for the month-end bank statement.
2. Open **Month End**: it is already on last month.
3. **Hours**: log what is missing, then Use. For a month with no work, set it to 0 days.
4. **Invoices**: record an invoice for each red client; read the "covered by" lines for a wrong period.
5. **Bank**: Check Balance with the statement's balance on the last day.
6. **To Chase** and **Deadlines** until they are green; glance at the amber ones.
7. **Download CSV** and send it to the accountant.

## 3. Examples

- **A missing invoice.** Lumen Srl logged 9 days in September at €450: "Lumen Srl, September 2026: €4,050.00 not invoiced", with Record Invoice. Studio Verdi's card says "Studio Verdi, August 2026: €2,700.00 not invoiced": August comes before September, so it blocks September too. Its invoice had gone in as September's ("Studio Verdi: covered by 15/2026 (Sep 2026)").
- **The bank does not match.** "Main Bank: Missing IN of €1,830.00 on 30/09/2026", with the rows to look through and "Invoice 12/2026 · Nordica Spa, €1,830.00, unpaid: was it paid?".
- **A recurring cost not linked.** "Accountant fee (€250.00, every month): not paid in September. Paid as "Accountant September" on 12/09? Link it to the estimate." Amber: a cost may skip a month.
- **A clean close.** "August 2026 is closed: every required step is done." Hours: "Bottega Rossi · Support: no work (0 days)". Invoices: "Lumen Srl: covered by 13/2026 (Aug 2026)". Bank: "Main Bank: Matches the bank on 31/08/2026". Download CSV saves `cash-book_2026-08_all-accounts_all-cost-centres.csv`.

## 4. What it does not do

- It stores no "Closed" stamp and no notes, and never blocks edits to a closed month.
- It does not close the current month.
- It writes nothing by itself: every fix is a click of yours in a window you know.
- It does not know whether you downloaded the export.
- It keeps no bank statement history: each account remembers its last check only. A later matching check proves the running total, not the exact month-end cut-off, and says "after month end".
- It does not judge overdue invoices "at month end": they are chased today.
- It does not check Tasks, adds no dashboard card, and works with AI off.

## 5. Build order

1. **PR 1, this one**: the checklist (`lib/month-end.ts`) and the read-only page, every action a link to the screen that fixes it.
2. **PR 2**: `get_month_end` in chat, server 0.22.0.
3. **PR 3**: the one-click fixes on the page (Use, Use All, No Work, Record Invoice, Edit Period, Mark Paid, Check Balance and Record Payment dated the month end, Mark Done).
4. **PR 4, optional**: the month's F24s against the payments recorded.

## As shipped (PR 1)

Differences from the plan, and plan claims checked against the code (v0.7.0, 157939b):

- **Shape.** `monthEndChecklist(data, month, today)` returns `{ month, end, closed, todo, steps }`, `steps` keyed by step, each `{ status, items }`. Items carry `kind`, `status` (done, todo, check), `text`, `detail` and `ref` (the record the action is about). The sentences are built in the lib, so the page and the chat tool of PR 2 say the same thing. The structured Record Invoice suggestion and the misdated invoice's id are left to PR 3, which needs them; the misdated question is in the item's text.
- **Context once.** `clientBilling`, `planCells`, `monthHours`, the Cash Book rows and To Chase do not depend on the month, so they are built once per call and `openMonths` reads the 24 months from them. The planned `ponytail:` memo note was not needed.
- **Links.** Hours: `/plan?week=<first Monday of the month>` (2026-09-07 for September, not 31 August); hours outside the plan: the client. Invoices: `/invoices#ready`; a misdated invoice: the client's invoices (`/clients/<id>#invoices`); provisional and credited months: the client's months. Bank: `/cash-book?tab=movements&month=<month>`. To Chase: `/cash-book?tab=chase`. Supplier invoices: `/cash-book?tab=owed`. Recurring: `/costs`. Deadlines: `/deadlines`.
- **Month in the URL.** Prev and Next write `?month=`, so Back from a link returns to the same month. The page reads the month from the URL on every render, never from state of its own: Month End in the sidebar (no `?month=`) shows last month again.
- **Other Periods** (planned for PR 3) ships here: it only opens the existing Export dialog. Both export buttons show once a company account exists.
- **Credited months.** A month a credit note took back in full is to check; with more unbilled than credited, the whole month is to do, and the detail says how much was credited.
- **Runs.** An unbilled month in a run Ready to Invoice would bill as one invoice says so: "Ready to Invoice suggests one invoice for Aug–Sep 2026, €9,000.00."
- **Bank.** A dormant account is a done item ("closed at €0.00 since 12/08/2026") rather than the whole step reading not needed. A matching check before the month end reads "Last checked on 15/09/2026, before the month end". A check after the month end that doesn't match is the one to fix: Check Balance never saves an older check over it (check-balance-dialog.tsx), so the item says "The 31/08/2026 check doesn't match the bank: fix that first. A check dated before it won't be saved." and Open Cash Book goes to that check's month.
- **Provisional, capped.** An unbilled month under an invoice still running into the current month is provisional only up to what that invoice can still move back onto it: its shares on the months not ended yet. Beyond that the month is to do. Example: €4,500 logged in September, and the only invoice touching it is €200 for Sep–Oct. At most €100 more can come back, so "€4,400.00 not invoiced" blocks. The provisional line now gives the amount: "provisional, €1,500.00 to come from 17/2026 (Oct–Dec 2026)".
- **Cards.** The sentence under each step reads as the goal, "Done when …", and for the three amber steps as "Reminder, never blocking: …", so a red card never sits under a line that sounds like everything is fine. The count separates the two kinds: "1 to do · 1 to check". Each item says its status to screen readers ("To do:", "To check:"), not only through the icon. The closed verdict says "every required step is done", since an amber step can still have items.
- **One meaning of "closed".** Invoices said "closed months" for months that had ended; it now says "ended months" ("From your logged hours, in ended months"), so "closed" is only the Month End verdict. The MCP descriptions still say "closed month"; they are left for PR 2, the chat tool.
- **Contrast.** The Done and To Do badges and the red verdict use darker fills (emerald-700, red-700; red-400 on dark) to reach WCAG AA at their size. The app-wide destructive token is unchanged.
- **Supplier invoices without an account.** With no company account the Cash Book shows only its first-run screen, so a supplier invoice opens on Costs.
- **Hours.** `pace` cannot come for a month that has ended (`hoursAction` treats it as closed), so only use, over, outside and missing block.
- **The MCP layer was touched**, against the plan's "PR 1 does not": moving `bookRows` into `cash-book.ts` changes the import in `crm-read.ts` and `crm-write.ts`. No tool changes behaviour. The Cash Book page now builds its rows with `bookRows` too.
- **Verified:** `monthEnd` (cash-book.ts:150), `bookRows` (helpers.ts:264), PlanGrid's `line()` (plan-grid.tsx:110-126), `planCells`/`monthHours`/`hoursAction` (timecards.ts:167, 194, 234), the inactive-with-no-end skip (engagement-burndown.ts:168), `MAX_BANK_FEE`, `statementCheck` and `rowsSinceCheck` (cash-book.ts:79, 340-398), `toChase` (cash-book.ts:764-805), `estimateCovered` (projection.ts:133), `pickEstimate` (cash-book.ts:754), the To Chase list not scoped by month (cash-book-shell.tsx:177), and `isRouteEnabled` letting undeclared routes through (nav.ts), so the nav item is the page's only gate.
- **Not done here:** counting the first-run noise on real data (open decision 3) is the owner's, before relying on the verdict for old months.

## As shipped (PR 2)

- **Version.** Server 0.22.0: #200 had taken 0.21.0.
- **The tool.** `get_month_end` returns the page's checklist for a month that has ended: the verdict, the blocking steps to do, every step in order with its status, what done means (for a step with nothing to check, `notNeeded`: the page's reason, now `NOT_NEEDED` in the lib), its counts and items (`kind`, `status`, `text`, `detail`, `ref`), the earlier months still open with their steps to do, and the amber line. It loads what the page loads and calls `monthEndChecklist` and `openMonths`. Read-only, so a read-only token calls it, and like every read it is not audited. A step lists at most 50 items, with `more` counting the rest.
- **Months.** None is the last month that has ended (Europe/Rome). An English month name is its most recent ended occurrence: December asked in January is last year's, and this month's name is last year's. The current month or a later one is refused ("2026-10 can't be closed until 1 November 2026: … Ask for 2026-09 or earlier."), and so is a month before the first with data, as the page never shows one.
- **next.** Each open item names the tool that fixes it with the arguments the data holds, or `app` where none can. Since #200 more of them have a tool than the plan assumed: linking a payment to its estimate and moving a payment's date are `update_expense`; a cost with no document, an estimated date, a row before its account opened or on a deleted account are `update_movement`, `update_expense` or `update_loan` on that entry; an invoice paid into no account is `update_invoice` paidDate null, then `mark_invoice_paid` with the account. Only a contract's start month (hours outside the plan) and an account's opening date are app only. A balance below zero points at `get_cash_book` for that month, as there is no single fix. A month to invoice carries Ready to Invoice's draft, numbered and due as `get_unbilled` proposes it: both pass every client to `invoiceDrafts`, which numbers the largest amount to invoice first; two months of one draft are one invoice. A provisional month has no `next`: nothing to record until its invoice ends. A Missing IN's unpaid invoice carries `mark_invoice_paid` on the check's day with `received` when it is short by a bank fee, so the fee is booked and the check matches; the owner confirms the real day.
- **Restated rules.** The checklist names some records only in its text: the month an invoice item is about, the misdated invoice, the unlinked or late payment, a Missing IN's invoice, a To Chase row. `monthEndNext` finds them again with `month-end.ts`'s own rules and order (`ponytail:` comment); PR 3 adds those fields to the items, and the hints should then read them.
- **Descriptions.** `list_deadlines` no longer sends F24 questions to `get_plan`, which has no tax events: no tool returns F24 estimates yet, and a month's close is `get_month_end`. `get_unbilled` and `update_invoice` say "ended month" where they said "closed month", so "closed" is only the Month End verdict.

## As shipped (PR 3)

Each item's link became the fix itself, in the window the other pages already use; the page recomputes once it is saved (each write invalidates the list it changed), so the verdict turns without a reload.

- **Hours.** `useApplyHours` moved from the Plan into `use-allocations.tsx` (renamed from `.ts` for the toast's Undo), and both pages use it: **Use 9 d** on an item, **Use All (n)** on the card with two or more, **No Work** on a planned month with no hours (an explicit 0, not a deleted row, which would bring the contract's default back). One toast with Undo for each, as on the Plan. **Log Hours**, **Fix Hours** and **Set Start Month** stay links: they need the week of hours or the client.
- **Invoices.** **Record Invoice** opens the InvoiceSheet on Ready to Invoice's draft for the month (a run of open months included). **Edit Period** opens the misdated invoice. The checklist now carries what they need: `period` and `invoiceId` on the item. Provisional and credited months keep their link to the client.
- **Waiting for Payment.** **Mark Paid** (**Settle** for a credit note), dated today. An invoice the Bank names for a Missing IN says so ("It may be the Missing IN on Main Bank.") and opens as it does on the Bank: Waiting comes first on the page, and today would put the money in October and leave September red.
- **Bank.** **Check Balance** on the item's account, the day preset to the month's last day; the owner can change it. A later check that doesn't match keeps its link to that month's movements: a check on the month end would only be compared, never saved over it. For a Missing IN, each matching unpaid invoice has **Mark 12/2026 Paid** into the item's account, not the last one used, dated by the check and never by the month on screen (`suspects.accountId`, `suspects.paidOn`): the check's day when it is dated by the month end, the month end when it falls early next month. A check two months or more after the month names none (its own month fixes it), nor an invoice whose period begins after that day. MarkPaid gained `defaultPaidDate` and `defaultAccount` for it, and says "Change it if the money moved on another day."
- **Recurring Costs.** **Record Payment** dated the month's last day (`CostDialogState` 'pay' gained `date`). **Link** opens the forgotten one-off with its estimate picked ('edit' gained `estimateId`); **Edit Date** opens the payment made just after the month end. Record Payment stays beside them, in case the hint is wrong.
- **Deadlines.** **Mark Done**, with Undo in its toast.
- **Other Periods** opens Export on **A Month**, the page's month, instead of This Month (ExportDialog `month`).
- **Focus.** A fix that takes its item away hands focus to its step's card (each card is focusable by its key as id), so the keyboard is never dropped on the page body: Mark Paid's popup too, and a window whose list lands after it closed. Each action is described by its item's text (`aria-describedby`), so two Mark Paid in a step say which invoice each is about.
- **Wording.** The recurring hints no longer send you to Costs ("Link it to the estimate.", "Edit its date."): the button is beside them, and in chat the tool's hint says where.
- **Unchanged:** the lib's other sentences (shared with chat), Supplier Invoices Owed and To Chase (links: their fixes live on the Cash Book), and every owner decision: closed is computed, a later bank check says "after month end", To Chase counts up to the month end, a planned month with no hours blocks until hours or No Work.
