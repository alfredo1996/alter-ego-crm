import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import Link from "next/link"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { BrandMark } from "../brand-mark"
import { ContentCard, stretchedLink } from "../content-card"
import { DataTableCard } from "../data-table-card"
import { EmptyPrompt } from "../empty-prompt"
import { FilterBar, FilterSelect } from "../filter-bar"
import { InlineEditor } from "../inline-editor"
import { MetaRow, StatusDot } from "../meta-row"
import { MonthStepper } from "../month-stepper"
import { OnThisPage } from "../on-this-page"
import { PageHeader } from "../page-header"
import { ProgressBar, SegmentedProgress } from "../progress"
import { SectionHeader } from "../section-header"
import { SegmentedButtons } from "../segmented-buttons"
import { SignedAmount } from "../signed-amount"
import { StatCard, StatStrip } from "../stat-card"
import { StatusPill, TagChip, TagList } from "../status-pill"
import { StatusTabs } from "../status-tabs"
import { Timeline } from "../timeline"

// The kit's promises (plan §2): what pages and tests rely on, not how it looks.
describe("PageHeader", () => {
  it("renders the one h1, its subtitle and actions", () => {
    render(<PageHeader title="Budgets" subtitle="October 2026" actions={<button>New Budget</button>} />)
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
    expect(screen.getByRole("heading", { level: 1, name: "Budgets" })).toBeInTheDocument()
    expect(screen.getByText("October 2026")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "New Budget" })).toBeInTheDocument()
  })

  it("names the back link for where it goes, over pills, the title and a meta line", () => {
    render(
      <PageHeader
        size="detail"
        back={{ href: "/accounts", label: "Accounts" }}
        pills={<StatusPill tone="neutral">Archived</StatusPill>}
        title="Main Checking"
        meta={<MetaRow>EUR</MetaRow>}
      />,
    )
    const back = screen.getByRole("link", { name: "Back to Accounts" })
    expect(back).toHaveAttribute("href", "/accounts")
    expect(screen.getByRole("heading", { level: 1, name: "Main Checking" })).toHaveClass("sm:text-4xl")
    // Reading order: back, pills, title, meta.
    const text = document.body.textContent ?? ""
    expect(text.indexOf("Accounts")).toBeLessThan(text.indexOf("Archived"))
    expect(text.indexOf("Archived")).toBeLessThan(text.indexOf("Main Checking"))
    expect(text.indexOf("Main Checking")).toBeLessThan(text.indexOf("EUR"))
  })

  it("ends the breadcrumb with the current page, the slash hidden from a screen reader", () => {
    render(<PageHeader size="detail" back={{ href: "/clients", label: "Clients", current: "Nordwind Retail S.p.A." }} title="Nordwind Retail S.p.A." />)
    const back = screen.getByRole("link", { name: "Back to Clients" })
    const crumb = back.parentElement!
    expect(crumb).toHaveTextContent("Back to Clients/Nordwind Retail S.p.A.")
    expect(within(crumb).getByText("/")).toHaveAttribute("aria-hidden")
  })

  it("puts a detail page's More menu after its actions, lifted beside the breadcrumb on a phone", () => {
    const { container } = render(
      <PageHeader
        size="detail"
        back={{ href: "/solutions", label: "Solutions" }}
        title="Product knowledge graph"
        actions={<button>Edit Details</button>}
        more={<button>More actions</button>}
      />,
    )
    const [edit, more] = screen.getAllByRole("button")
    expect(edit).toHaveTextContent("Edit Details")
    expect(more).toHaveTextContent("More actions")
    expect(container.firstElementChild).toHaveClass("relative")
    expect(more.parentElement).toHaveClass("max-sm:absolute", "max-sm:-top-3")
    // The actions' box gives way on a phone, so desktop-only actions leave no gap under the title.
    expect(more.parentElement!.parentElement).toHaveClass("max-sm:contents")
  })

  it("with no breadcrumb, lifts the More menu beside the title on a phone", () => {
    render(<PageHeader title="Month End" more={<button>More</button>} />)
    const more = screen.getByRole("button", { name: "More" })
    expect(more.parentElement).toHaveClass("max-sm:absolute", "max-sm:-top-1.5")
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("max-sm:pr-12")
  })

  it("sets a list title smaller than a detail title", () => {
    render(<PageHeader title="Clients" />)
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("sm:text-3xl")
  })
})

describe("StatusDot, StatusPill, TagChip", () => {
  it("a dot is decorative and always sits beside its word", () => {
    render(
      <MetaRow>
        <StatusDot tone="danger">Overdue</StatusDot>
        <StatusDot outline>Not started</StatusDot>
      </MetaRow>,
    )
    const overdue = screen.getByText("Overdue")
    expect(overdue.querySelector("[aria-hidden]")).toHaveClass("bg-danger")
    expect(screen.getByText("Not started").querySelector("[aria-hidden]")).toHaveClass("border-[1.5px]")
  })

  it("a pill takes the soft pair of its tone", () => {
    render(<StatusPill tone="success">Paid</StatusPill>)
    expect(screen.getByText("Paid")).toHaveClass("rounded-full", "bg-success-soft", "text-success-soft-foreground")
  })

  it("a chip is mono unless told otherwise, and can carry a colour dot", () => {
    render(
      <>
        <TagChip>INV-2026-014</TagChip>
        <TagChip mono={false} dot="#f97316">
          Groceries
        </TagChip>
      </>,
    )
    expect(screen.getByText("INV-2026-014")).toHaveClass("font-mono")
    const groceries = screen.getByText("Groceries")
    expect(groceries).not.toHaveClass("font-mono")
    expect(groceries.querySelector("[aria-hidden]")).toHaveStyle({ backgroundColor: "#f97316" })
  })

  it("a tag list stops at max and counts the rest", () => {
    render(<TagList items={["neo4j", "gds", "kafka", "debezium", "airflow"]} max={3} />)
    expect(screen.getByText("kafka")).toBeInTheDocument()
    expect(screen.queryByText("debezium")).toBeNull()
    // "+2" on screen, "+2 more" to a screen reader.
    expect(screen.getByText("+2")).toHaveTextContent("+2 more")
  })
})

describe("ContentCard", () => {
  it("is an article named by its title, and the stretched title link covers it", () => {
    render(
      <ContentCard labelledBy="cc-1">
        <Link id="cc-1" href="/solutions/1" className={stretchedLink}>
          Product knowledge graph
        </Link>
        <button className="relative z-10">More</button>
      </ContentCard>,
    )
    const card = screen.getByRole("article", { name: "Product knowledge graph" })
    expect(card).toHaveClass("relative", "rounded-xl", "p-(--card-padding)")
    expect(within(card).getByRole("link")).toHaveClass("after:absolute", "after:inset-0")
  })

  it("draws empty content dashed, without a shadow", () => {
    render(<ContentCard as="div" variant="dashed" data-testid="c" />)
    const card = screen.getByTestId("c")
    expect(card).toHaveClass("border-dashed", "border-border-strong", "bg-surface-subtle")
    expect(card).not.toHaveClass("shadow-xs")
  })
})

describe("SectionHeader", () => {
  it("is an h2 by default, with its description and actions", () => {
    render(<SectionHeader title="Recurring" description="4" actions={<button>Add</button>} />)
    expect(screen.getByRole("heading", { level: 2, name: "Recurring" })).toBeInTheDocument()
    expect(screen.getByText("4")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument()
  })

  it("takes another level and an id for anchors", () => {
    render(<SectionHeader title="Data Model" level={3} id="data-model" variant="card" />)
    expect(screen.getByRole("heading", { level: 3, name: "Data Model" })).toHaveAttribute("id", "data-model")
  })
})

describe("EmptyPrompt", () => {
  it("asks one question with one action", () => {
    render(<EmptyPrompt title="No budgets yet" description="Track spending." action={<button>New Budget</button>} />)
    expect(screen.getByRole("heading", { level: 2, name: "No budgets yet" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "New Budget" })).toBeInTheDocument()
  })

  it("can name the section it stands in for", () => {
    render(
      <section aria-labelledby="steps-title">
        <EmptyPrompt titleId="steps-title" title="Steps" description="How did you build it, in order?" />
      </section>,
    )
    expect(screen.getByRole("region", { name: "Steps" })).toHaveTextContent("How did you build it, in order?")
  })

  it("inline, it is a line in a list, not a heading", () => {
    render(<EmptyPrompt variant="inline" title="No movements this month." />)
    expect(screen.queryByRole("heading")).toBeNull()
    expect(screen.getByText("No movements this month.")).toBeInTheDocument()
  })
})

describe("StatusTabs", () => {
  function Tabs({ onChange = () => {} }: { onChange?: (v: string) => void }) {
    const [value, setValue] = useState("all")
    return (
      <StatusTabs
        aria-label="Status"
        value={value}
        onValueChange={(v) => {
          setValue(v)
          onChange(v)
        }}
        items={[
          { value: "all", label: "All", count: 9 },
          { value: "active", label: "Active", count: 7 },
          { value: "archived", label: "Archived" },
        ]}
      >
        <p>{value} list</p>
      </StatusTabs>
    )
  }

  it("the selected tab controls the panel holding the filtered list", () => {
    render(<Tabs />)
    const selected = screen.getByRole("tab", { selected: true })
    const panel = screen.getByRole("tabpanel")
    expect(selected).toHaveAttribute("aria-controls", panel.id)
    expect(panel).toHaveTextContent("all list")
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Active 7" }))
    expect(screen.getByRole("tab", { name: "Active 7" })).toHaveAttribute("aria-controls", screen.getByRole("tabpanel").id)
    expect(screen.getByRole("tabpanel")).toHaveTextContent("active list")
  })

  // A phone's tabs over columns that sit side by side from sm up (the task board).
  it("with no children, renders no panel, and each tab controls what its item names", () => {
    render(
      <StatusTabs
        aria-label="Status"
        value="a"
        onValueChange={() => {}}
        items={[
          { value: "a", label: "A", controls: "column-a" },
          { value: "b", label: "B", controls: "column-b" },
        ]}
      />,
    )
    expect(document.querySelector('[role="tabpanel"]')).toBeNull()
    expect(screen.getByRole("tab", { name: "A" })).toHaveAttribute("aria-controls", "column-a")
    expect(screen.getByRole("tab", { name: "B" })).toHaveAttribute("aria-controls", "column-b")
  })

  it("puts the count in the accessible name and marks the selected tab", () => {
    render(<Tabs />)
    expect(screen.getByRole("tablist", { name: "Status" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "All 9" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: "Active 7" })).toHaveAttribute("aria-selected", "false")
    expect(screen.getByRole("tab", { name: "Archived" })).toBeInTheDocument()
  })

  it("moves with the arrow keys and selects on focus", async () => {
    const onChange = vi.fn()
    render(<Tabs onChange={onChange} />)
    const all = screen.getByRole("tab", { name: "All 9" })
    all.focus()
    fireEvent.keyDown(all, { key: "ArrowRight" })
    // Radix moves focus a tick later.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Active 7" })))
    expect(onChange).toHaveBeenLastCalledWith("active")
    expect(screen.getByRole("tab", { name: "Active 7" })).toHaveAttribute("aria-selected", "true")
  })

  it("selects on a click", () => {
    const onChange = vi.fn()
    render(<Tabs onChange={onChange} />)
    // Radix selects on mousedown, so a tab switches before a blur elsewhere saves.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Archived" }))
    expect(onChange).toHaveBeenLastCalledWith("archived")
  })
})

describe("FilterSelect and FilterBar", () => {
  const clients = [
    { value: "c1", label: "Nordwind Retail S.p.A." },
    { value: "c2", label: "Lumen Srl" },
  ]

  function Client({ onChange = () => {} }: { onChange?: (v: string | null) => void }) {
    const [value, setValue] = useState<string | null>(null)
    return (
      <FilterSelect
        label="Client"
        allLabel="All clients"
        value={value}
        options={clients}
        onValueChange={(v) => {
          setValue(v)
          onChange(v)
        }}
      />
    )
  }

  /** Radix Select by keyboard: happy-dom has no pointer capture. */
  async function pick(option: string) {
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Client" }), { key: "Enter" })
    fireEvent.keyDown(await screen.findByRole("option", { name: option }), { key: "Enter" })
  }

  it("is a combobox labelled by its label, reading 'Client: All' until one is picked", async () => {
    const onChange = vi.fn()
    render(<Client onChange={onChange} />)
    const combobox = screen.getByRole("combobox", { name: "Client" })
    expect(combobox).toHaveTextContent("Client: All")

    await pick("Lumen Srl")
    expect(onChange).toHaveBeenLastCalledWith("c2")
    expect(combobox).toHaveTextContent("Client: Lumen Srl")

    await pick("All clients")
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(combobox).toHaveTextContent("Client: All")
  })

  it("shows a value missing from the options as set, and All still clears it", async () => {
    const onChange = vi.fn()
    render(<FilterSelect label="Client" allLabel="All clients" value="gone" options={clients} onValueChange={onChange} />)
    // A stale deep link: the page still filters by it, so the trigger must not read "All".
    expect(screen.getByRole("combobox", { name: "Client" })).toHaveTextContent("Client: gone")
    await pick("All clients")
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it("puts a labelled 44 px search before the selects", () => {
    const onSearch = vi.fn()
    render(
      <FilterBar search={{ value: "", onChange: onSearch, label: "Search solutions", placeholder: "Search names…" }}>
        <Client />
      </FilterBar>,
    )
    const search = screen.getByRole("searchbox", { name: "Search solutions" })
    expect(search).toHaveClass("h-11", "text-base")
    fireEvent.change(search, { target: { value: "graph" } })
    expect(onSearch).toHaveBeenCalledWith("graph")
    expect(screen.getByRole("combobox", { name: "Client" })).toBeInTheDocument()
  })

  it("folds the selects into the Filters sheet on a phone when asked", () => {
    render(
      <FilterBar sheet={{ active: 1 }}>
        <Client />
      </FilterBar>,
    )
    // Inline from sm up, CSS-hidden below it; the phone opens them in the sheet.
    expect(screen.getByRole("combobox", { name: "Client" }).closest(".hidden.sm\\:contents")).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Filters (1)" }))
    const sheet = screen.getByRole("dialog", { name: "Filters" })
    expect(within(sheet).getByRole("combobox", { name: "Client" })).toBeInTheDocument()
  })
})

describe("SegmentedButtons", () => {
  it("is a named group of buttons with the chosen one pressed, and reports a click", () => {
    const onChange = vi.fn()
    render(
      <SegmentedButtons
        aria-label="What to count"
        value="a"
        onChange={onChange}
        options={[
          { value: "a", label: "Contracts Only" },
          { value: "b", label: "With Weighted Pipeline" },
        ]}
      />,
    )
    const group = screen.getByRole("group", { name: "What to count" })
    expect(within(group).getByRole("button", { name: "Contracts Only" })).toHaveAttribute("aria-pressed", "true")
    expect(within(group).getByRole("button", { name: "With Weighted Pipeline" })).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(within(group).getByRole("button", { name: "With Weighted Pipeline" }))
    expect(onChange).toHaveBeenCalledWith("b")
  })
})

describe("SegmentedProgress", () => {
  it("fills the done segments and says it in words to a screen reader", () => {
    const { container } = render(<SegmentedProgress done={7} total={9} label="7 of 9 sections written" />)
    const segments = container.querySelectorAll("[aria-hidden] > span")
    expect(segments).toHaveLength(9)
    expect([...segments].filter((s) => s.classList.contains("bg-primary"))).toHaveLength(7)
    // "7/9" on screen, the words for a screen reader.
    expect(screen.getByText("7/9")).toHaveAttribute("aria-hidden")
    expect(screen.getByText("7 of 9 sections written")).toHaveClass("sr-only")
  })
})

describe("SegmentedProgress, in percent", () => {
  it("part-fills a segment and shows its own text in place of the fraction", () => {
    const { container } = render(<SegmentedProgress done={1.5} total={10} text="15%" label="15% likely to close" />)
    const segments = [...container.querySelectorAll("[aria-hidden] > span")] as HTMLElement[]
    expect(segments).toHaveLength(10)
    expect(segments.filter((s) => s.classList.contains("bg-primary"))).toHaveLength(1)
    expect(segments[1].style.background).toContain("50%")
    expect(segments[2].style.background).toBe("")
    expect(screen.getByText("15%")).toHaveAttribute("aria-hidden")
    expect(screen.queryByText("1.5/10")).toBeNull()
  })
})

describe("SegmentedProgress, by tone", () => {
  it("colours each segment by its tone, full width, and says the states in words", () => {
    const { container } = render(
      <SegmentedProgress size="bar" tones={["danger", "success", "warning", "neutral"]} label="Steps in order: Hours to do, Bank done." />,
    )
    const bar = container.firstElementChild!
    expect(bar).toHaveAttribute("aria-hidden")
    expect(bar).toHaveClass("grid")
    expect([...bar.children].map((s) => s.className.match(/\bbg-\S+/)?.[0])).toEqual(["bg-danger", "bg-success", "bg-warning", undefined])
    // Not needed is hollow, in the muted text colour: 3:1 on the card, like StatusDot outline.
    expect(bar.children[3]).toHaveClass("border-muted-foreground")
    expect(screen.getByText("Steps in order: Hours to do, Bank done.")).toHaveClass("sr-only")
  })
})

describe("MonthStepper", () => {
  it("steps with its two named buttons, disabled at the ends, and says the month as it changes", () => {
    const prev = vi.fn()
    render(<MonthStepper label="September 2026" prev={prev} />)
    const group = screen.getByRole("group", { name: "Month" })
    fireEvent.click(within(group).getByRole("button", { name: "Previous month" }))
    expect(prev).toHaveBeenCalledOnce()
    expect(within(group).getByRole("button", { name: "Next month" })).toBeDisabled()
    expect(within(group).getByText("September 2026")).toHaveAttribute("aria-live", "polite")
  })
})

describe("MonthStepper by link", () => {
  it("steps by links in a named group, and a missing end is a disabled button", () => {
    render(<MonthStepper groupLabel="Week" label="12–18 Oct" prevHref="/plan?week=a" prevLabel="Previous week" nextLabel="Next week" />)
    const group = screen.getByRole("group", { name: "Week" })
    expect(within(group).getByRole("link", { name: "Previous week" })).toHaveAttribute("href", "/plan?week=a")
    expect(within(group).getByRole("button", { name: "Next week" })).toBeDisabled()
  })
})

describe("StatCard and StatStrip", () => {
  it("puts label, value and detail as siblings in that order", () => {
    render(<StatCard label="Open deals" value="4" detail="€14,360/month if all four close" />)
    const label = screen.getByText("Open deals")
    expect(label.nextElementSibling).toHaveTextContent("4")
    expect(label.nextElementSibling!.nextElementSibling).toHaveTextContent("€14,360/month if all four close")
  })

  it("is one named region: the hero stays a card, the rest fold into rows on a phone", () => {
    render(
      <StatStrip hero={<StatCard label="Weighted pipeline" value="€6,254" />}>
        <StatCard label="Open deals" value="4" />
        <StatCard label="Next follow-up" value="17 Oct" tone="warning" />
      </StatStrip>,
    )
    const strip = screen.getByRole("region", { name: "Summary" })
    const hero = within(strip).getByText("Weighted pipeline").parentElement!
    const rows = within(strip).getByText("Open deals").parentElement!.parentElement!
    expect(hero.parentElement).toBe(strip)
    expect(rows).not.toBe(strip)
    expect(rows).toHaveClass("sm:contents")
    expect(screen.getByText("17 Oct")).toHaveClass("text-warning-soft-foreground")
  })

  // The strip is a column on a phone, where a flex basis is a height: 220px left the hero
  // card blank at the bottom when the stage legend was short.
  it("sets the flex basis only in the sm row, and a hero's wider basis replaces it", () => {
    render(
      <StatStrip hero={<StatCard className="sm:flex-[2_1_440px]" label="Weighted pipeline" value="€6,254" />}>
        <StatCard label="Open deals" value="4" />
      </StatStrip>,
    )
    const card = screen.getByText("Open deals").parentElement!
    const hero = screen.getByText("Weighted pipeline").parentElement!
    expect(card.className).not.toMatch(/(^|\s)flex-\[/)
    expect(card).toHaveClass("sm:flex-[1_1_220px]")
    expect(hero.className).not.toMatch(/(^|\s)flex-\[/)
    expect(hero).toHaveClass("sm:flex-[2_1_440px]")
    expect(hero).not.toHaveClass("sm:flex-[1_1_220px]")
  })
})

describe("DataTableCard", () => {
  it("is a padless card around its table, not an article", () => {
    render(
      <DataTableCard>
        <table aria-label="Closed deals" />
      </DataTableCard>,
    )
    const card = screen.getByRole("table", { name: "Closed deals" }).parentElement!
    expect(card.tagName).toBe("DIV")
    expect(card).toHaveClass("overflow-hidden")
    expect(card).not.toHaveClass("p-(--card-padding)")
  })
})

describe("SegmentedProgress, banner", () => {
  it("is decorative, with no fraction: its sentence stands beside it", () => {
    const { container } = render(<SegmentedProgress size="banner" done={4} total={9} />)
    const bar = container.firstElementChild!
    expect(bar).toHaveAttribute("aria-hidden")
    expect(bar.children).toHaveLength(9)
    expect([...bar.children].filter((s) => s.classList.contains("bg-primary"))).toHaveLength(4)
    expect(bar).toHaveTextContent("")
  })
})

describe("OnThisPage", () => {
  const items = [
    { id: "purpose", label: "Purpose and Target", short: "Purpose", state: "done" as const },
    { id: "results", label: "Results", state: "empty" as const },
  ]

  it("is one nav of anchors in order, one name at every width, an empty one said so", () => {
    render(<OnThisPage aria-label="Sections" items={items} />)
    const links = within(screen.getByRole("navigation", { name: "Sections" })).getAllByRole("link")
    expect(links.map((a) => [a.getAttribute("href"), a.getAttribute("aria-label")])).toEqual([
      ["#purpose", "Purpose and Target"],
      ["#results", "Results (empty)"],
    ])
    // The chip's short label shows only below lg, the long one from lg.
    expect(within(links[0]).getByText("Purpose")).toHaveClass("lg:hidden")
    expect(within(links[0]).getByText("Purpose and Target")).toHaveClass("hidden", "lg:inline")
    expect(links[1]).toHaveClass("border-dashed")
  })

  it("marks the first section current, then the one clicked", () => {
    render(<OnThisPage aria-label="Sections" items={items} />)
    const [purpose, results] = screen.getAllByRole("link")
    expect(purpose).toHaveAttribute("aria-current", "location")
    fireEvent.click(results)
    expect(results).toHaveAttribute("aria-current", "location")
    expect(purpose).not.toHaveAttribute("aria-current")
  })

  it("shows a section's count beside its label, outside the link's name", () => {
    render(<OnThisPage aria-label="Sections" items={[{ id: "invoices", label: "Invoices", count: 3 }]} />)
    const link = screen.getByRole("link", { name: "Invoices" })
    expect(link).toHaveTextContent("Invoices3")
    expect(within(link).getByText("3")).toHaveClass("font-mono", "tabular-nums")
  })
})

describe("OnThisPage, with states", () => {
  it("names each link with its state, marks it at every width, under its own eyebrow and note", () => {
    render(
      <OnThisPage
        aria-label="Steps"
        title="Steps"
        footer="Top to bottom is the closing order."
        items={[
          { id: "hours", label: "Hours", status: { tone: "danger", label: "to do" } },
          { id: "bank", label: "Bank", status: { tone: "success", label: "done" } },
        ]}
      />,
    )
    const nav = screen.getByRole("navigation", { name: "Steps" })
    const links = within(nav).getAllByRole("link")
    expect(links.map((a) => a.getAttribute("aria-label"))).toEqual(["Hours, to do", "Bank, done"])
    // Unlike done/empty, a state is the point of the chip: its mark shows on a phone too.
    expect(links[0].querySelector("svg")).not.toHaveClass("hidden")
    expect(within(nav).getByText("Steps")).toHaveClass("hidden", "lg:block")
    expect(within(nav).getByText("Top to bottom is the closing order.")).toHaveClass("hidden", "lg:block")
  })
})

describe("InlineEditor", () => {
  const QUESTION = "What did it have to do, point by point, and under which constraints?"
  function Editor(props: { saving?: boolean; error?: string; onSave?: () => void; onCancel?: () => void }) {
    const [value, setValue] = useState("Every SKU in the graph")
    return (
      <section>
        <h2 id="req">Requirements</h2>
        <InlineEditor
          labelledBy="req"
          question={QUESTION}
          value={value}
          onChange={setValue}
          maxLength={20_000}
          saveLabel="Save Requirements"
          hint="Each line shows as its own line."
          onSave={props.onSave ?? (() => {})}
          onCancel={props.onCancel ?? (() => {})}
          saving={props.saving}
          error={props.error}
        />
      </section>
    )
  }

  it("names the textbox by its section, asks its question, and counts in mono as it is typed", () => {
    render(<Editor />)
    const text = screen.getByRole("textbox", { name: "Requirements" })
    expect(text).toHaveAccessibleDescription(QUESTION)
    expect(text).toHaveFocus()
    expect(screen.getByText("22 / 20,000")).toHaveClass("font-mono")
    fireEvent.change(text, { target: { value: "Every SKU in the graph, within 15 minutes" } })
    expect(screen.getByText("41 / 20,000")).toBeInTheDocument()
    expect(text).toHaveAttribute("maxLength", "20000")
  })

  it("cancels and saves through its two buttons, Save named for what it saves", () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()
    render(<Editor onSave={onSave} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Save Requirements" }))
    expect(onSave).toHaveBeenCalledOnce()
  })

  it("while it saves, holds the text and keeps Save's name; a failure is an alert", () => {
    const { rerender } = render(<Editor saving />)
    expect(screen.getByRole("textbox", { name: "Requirements" })).toHaveAttribute("readonly")
    expect(screen.getByRole("button", { name: "Save Requirements" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Save Requirements" })).toHaveTextContent("Saving…")
    rerender(<Editor error="Save failed. Try again." />)
    expect(screen.getByRole("alert")).toHaveTextContent("Save failed. Try again.")
  })
})

describe("Timeline", () => {
  const items = ["2026-09-01", "2026-07-15", "2026-06-30", "2026-05-12", "2026-02-10"].map((date, i) => ({
    key: date,
    date,
    content: `Entry ${i + 1}`,
    outline: i === 4,
  }))

  it("lists dated entries in the order given, the date in mono", () => {
    render(<Timeline items={items} />)
    const rows = screen.getAllByRole("listitem")
    expect(rows.map((r) => r.textContent)).toEqual(items.map((i) => `${i.date}${i.content}`))
    expect(within(rows[0]).getByText("2026-09-01")).toHaveClass("font-mono")
  })

  it("on a phone shows the newest few, then a button for the older ones", () => {
    render(<Timeline items={items} phoneLimit={3} />)
    const rows = screen.getAllByRole("listitem")
    expect(rows.slice(0, 3).every((r) => !r.className.includes("max-sm:hidden"))).toBe(true)
    expect(rows.slice(3).every((r) => r.className.includes("max-sm:hidden"))).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Show 2 older entries" }))
    expect(screen.getAllByRole("listitem").some((r) => r.className.includes("max-sm:hidden"))).toBe(false)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("colours a dot by its tone and keeps an entry's actions inside its listitem", () => {
    render(
      <Timeline
        items={[
          { key: "a", date: "2026-10-09 10:00", content: "Weekly status", tone: "success", actions: <button>Edit meeting of 9 Oct</button> },
          { key: "b", date: "2026-09-25", content: "Kickoff" },
        ]}
      />,
    )
    const [first, second] = screen.getAllByRole("listitem")
    expect(within(first).getByRole("button", { name: "Edit meeting of 9 Oct" })).toBeInTheDocument()
    expect(first.querySelector("[aria-hidden] > span")).toHaveClass("bg-success")
    expect(second.querySelector("[aria-hidden] > span")).toHaveClass("bg-primary")
  })
})

describe("SignedAmount", () => {
  const fmt = (n: number) => `€${n.toFixed(2)}`

  it("signs money in with a green plus, money out with a minus in the text colour, and zero neither", () => {
    render(
      <>
        <SignedAmount amount={6832} format={fmt} />
        <SignedAmount amount={-480} format={fmt} />
        <SignedAmount amount={620} kind="out" format={fmt} />
        <SignedAmount amount={0} kind="in" format={fmt} />
      </>,
    )
    expect(screen.getByText("+€6832.00")).toHaveClass("text-green-700")
    for (const text of ["−€480.00", "−€620.00", "€0.00"]) expect(screen.getByText(text)).not.toHaveClass("text-green-700")
  })

  it("shows a transfer muted and unsigned, with where it went or came from in words", () => {
    render(
      <>
        <SignedAmount amount={-1000} kind="transfer" counterpart="Reserve Account" format={fmt} />
        <SignedAmount amount={300} kind="transfer" counterpart="Company Bank" format={fmt} />
      </>,
    )
    const [out, into] = screen.getAllByText(/^€\d/)
    expect(out).toHaveTextContent("€1000.00")
    expect(out.parentElement).toHaveClass("text-muted-foreground")
    expect(out.parentElement).not.toHaveClass("text-green-700")
    // The arrow is drawn; a screen reader hears the words.
    expect(out.parentElement).toHaveTextContent("€1000.00 → moved to Reserve Account")
    expect(screen.getByText("→")).toHaveAttribute("aria-hidden")
    expect(screen.getByText("moved to")).toHaveClass("sr-only")
    expect(into.parentElement).toHaveTextContent("€300.00 ← moved from Company Bank")
  })
})

describe("ProgressBar", () => {
  it.each([
    [0.81, 81],
    [1.7, 100],
    [-0.2, 0],
  ])("a value of %s reads %s%% and is named for what it measures", (value, now) => {
    render(<ProgressBar label="Groceries" value={value} />)
    const bar = screen.getByRole("progressbar", { name: "Groceries" })
    expect(bar).toHaveAttribute("aria-valuenow", String(now))
    expect((bar.firstElementChild as HTMLElement).style.width).toBe(`${now}%`)
  })
})

describe("StatStrip on a phone", () => {
  it("is rows without their detail by default, and a two-column grid that keeps it for phone=grid", () => {
    const cards = <StatCard label="In" value="€1" detail="Same as May" />
    const { rerender } = render(<StatStrip>{cards}</StatStrip>)
    expect(screen.getByText("Same as May").parentElement!.parentElement!.className).toContain("data-[slot=stat-detail]:hidden")
    rerender(<StatStrip phone="grid">{cards}</StatStrip>)
    const cell = screen.getByText("Same as May").parentElement!.parentElement!
    expect(cell.className).toContain("max-sm:grid-cols-2")
    expect(cell.className).not.toContain("stat-detail]:hidden")
  })
})

describe("BrandMark", () => {
  it("shows the name beside a decorative tile", () => {
    const { container } = render(<BrandMark withName />)
    expect(screen.getByText("Alter Ego")).not.toHaveClass("sr-only")
    expect(container.querySelector("svg")!.parentElement).toHaveAttribute("aria-hidden")
  })

  it("keeps the name for a screen reader when the tile stands alone", () => {
    render(<BrandMark />)
    expect(screen.getByText("Alter Ego")).toHaveClass("sr-only")
  })
})

describe("the kit's imports", () => {
  // Plan §0.1: the kit is shared by both products, so it builds only on the UI library.
  const ALLOWED = /^(react|next\/link|lucide-react|\.\.\/utils|\.\.\/ui\/[\w-]+|\.\.\/filters-sheet|\.\/[\w-]+)$/
  const dir = join(__dirname, "..")

  it("imports only react, next/link, lucide-react, the UI library, utils, FiltersSheet and itself", () => {
    const outside = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx"))
      .flatMap((f) => [...readFileSync(join(dir, f), "utf8").matchAll(/from "([^"]+)"/g)].map((m) => `${f}: ${m[1]}`))
      .filter((line) => !ALLOWED.test(line.split(": ")[1]))
    expect(outside).toEqual([])
  })
})
