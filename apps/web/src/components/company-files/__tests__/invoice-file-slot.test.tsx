import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NO_FILE_CHANGE, type FileDraft } from "@/hooks/use-company-files"
import { INVOICE_FILES_MAX } from "@/types/schemas"

import { InvoiceFileSlot } from "../invoice-file-slot"

import type { InvoiceFile } from "@/types"

const download = vi.fn()
vi.mock("@/lib/backend", () => ({ getBackend: () => ({ files: { download } }) }))

const stored = (name: string, kind: InvoiceFile["kind"], size = 14 * 1024): InvoiceFile => ({
  path: `users/u1/company-files/${name}`, name, kind, size, uploadedAt: new Date(2026, 8, 4),
})

function Harness({
  file, files, initial = NO_FILE_CHANGE, viewHref, unsaved, disabled, noun = "invoice", onDraft,
}: {
  file?: InvoiceFile | null; files?: InvoiceFile[]; initial?: FileDraft; viewHref?: string; unsaved?: boolean; disabled?: boolean
  noun?: "cost" | "invoice"; onDraft?: (d: FileDraft) => void
}) {
  const [draft, setDraft] = useState(initial)
  return (
    <InvoiceFileSlot
      stored={files ?? (file ? [file] : [])}
      draft={draft}
      onDraftChange={(d) => (setDraft(d), onDraft?.(d))}
      noun={noun}
      viewHref={viewHref}
      unsaved={unsaved}
      disabled={disabled}
    />
  )
}

const slot = () => screen.getByRole("group", { name: "Invoice Files" })
const choose = (name: string) => fireEvent.change(within(slot()).getByLabelText("Choose invoice file"), { target: { files: [new File(["<a/>"], name)] } })
const more = async (name: string) => {
  fireEvent.keyDown(within(slot()).getByRole("button", { name: `More actions for ${name}` }), { key: "Enter" })
  return screen.findAllByRole("menuitem")
}

describe("InvoiceFileSlot", () => {
  it("is empty without a file: a drop zone with Choose File and what it takes", () => {
    render(<Harness file={null} />)
    expect(slot()).toHaveTextContent("Drop the invoice file here, orChoose FileXML, signed XML (.p7m) or PDF · up to 10 MB")
    expect(within(slot()).queryByText("Drop another file here, or")).toBeNull()
  })

  it.each([
    ["XML", "IT01.xml", "xml", "FatturaPA XML · 14 KB · added 4 Sep", false],
    ["XML", "IT01.xml.p7m", "p7m", "Signed FatturaPA XML · 14 KB · added 4 Sep", false],
    ["PDF", "EU-1.pdf", "pdf", "PDF · 14 KB · added 4 Sep", true],
  ] as const)("shows an attached %s with its name, kind, size and date; View only for a PDF", (badge, name, kind, meta, view) => {
    render(<Harness file={stored(name, kind)} />)
    expect(within(slot()).getByText(name)).toBeInTheDocument()
    expect(within(slot()).getByText(badge)).toBeInTheDocument()
    expect(within(slot()).getByText(meta)).toBeInTheDocument()
    expect(within(slot()).queryByRole("button", { name: `View ${name}` }) !== null).toBe(view)
    expect(within(slot()).getByRole("button", { name: `Download ${name}` })).toBeInTheDocument()
    // One file already: the add zone sits below it, in one line.
    expect(slot()).toHaveTextContent("Drop another file here, orAdd File")
    expect(within(slot()).queryByText("Drop the invoice file here, or")).toBeNull()
  })

  it.each([
    ["XML", "IT01.xml", "xml"],
    ["signed XML", "IT01.xml.p7m", "p7m"],
  ] as const)("opens a %s as the readable invoice: View is a link to the invoice page", (_, name, kind) => {
    render(<Harness file={stored(name, kind)} viewHref="/costs/c1/file" />)
    expect(within(slot()).getByRole("link", { name: `View ${name}` })).toHaveAttribute("href", `/costs/c1/file?file=${name.replace(/\.(xml\.p7m|xml)$/, "")}`)
  })

  it.each([
    ["the form has unsaved changes", { unsaved: true }],
    ["the form is saving", { disabled: true }],
  ])("disables View with a hint while %s", (_, flags) => {
    render(<Harness file={stored("IT01.xml", "xml")} viewHref="/costs/c1/file" {...flags} />)
    expect(within(slot()).queryByRole("link", { name: "View IT01.xml" })).toBeNull()
    const view = within(slot()).getByRole("button", { name: "View IT01.xml" })
    expect(view).toBeDisabled()
    expect(view).toHaveAccessibleDescription("Save first to view the invoice.")
  })

  it("notes that the app opened the invoice page, so its Back can return here", () => {
    render(<Harness file={stored("IT01.xml", "xml")} viewHref="/costs/c1/file" />)
    const link = within(slot()).getByRole("link", { name: "View IT01.xml" })
    link.addEventListener("click", (e) => e.preventDefault())
    fireEvent.click(link)
    expect(sessionStorage.getItem("alter-ego:opened-from-app")).toBe("1")
  })

  it("downloads the stored bytes under the file's name", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x")
    URL.revokeObjectURL = vi.fn()
    download.mockResolvedValue(new Blob(["signed"]))
    const clicked: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download)
    })
    render(<Harness file={stored("IT01.xml.p7m", "p7m")} />)
    fireEvent.click(within(slot()).getByRole("button", { name: "Download IT01.xml.p7m" }))
    await waitFor(() => expect(clicked).toEqual(["IT01.xml.p7m"]))
  })

  it("offers Replace File and Remove File behind the ⋯ menu", async () => {
    render(<Harness file={stored("IT01.xml", "xml")} />)
    expect((await more("IT01.xml")).map((i) => i.textContent)).toEqual(["Replace File…", "Remove File"])
  })

  it("shows a picked file as waiting to be saved, and Remove takes it back", () => {
    render(<Harness file={null} />)
    fireEvent.change(within(slot()).getByLabelText("Choose invoice file"), { target: { files: [new File(["x"], "inv.pdf")] } })
    expect(within(slot()).getByText("PDF · 1 KB · saved with the invoice")).toBeInTheDocument()
    fireEvent.click(within(slot()).getByRole("button", { name: "Remove inv.pdf" }))
    expect(within(slot()).getByRole("button", { name: "Choose File" })).toBeInTheDocument()
  })

  it("takes a file dropped on the zone, and refuses a wrong one in words", () => {
    render(<Harness file={null} />)
    const zone = within(slot()).getByText("Drop the invoice file here, or").closest("div")!.parentElement!
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "notes.docx")] } })
    expect(within(slot()).getByRole("alert")).toHaveTextContent("notes.docx can't be attached: use the XML, the signed .p7m, or a PDF.")
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["<a/>"], "a.xml")] } })
    expect(within(slot()).queryByRole("alert")).not.toBeInTheDocument()
    expect(within(slot()).getByText("a.xml")).toBeInTheDocument()
  })

  describe("several files", () => {
    const three = [stored("IT01_00118.xml", "xml"), stored("IT01_00121.xml.p7m", "p7m"), stored("IT01_NC009.xml", "xml")]

    it("draws one row per file, each with its own View, Download and ⋯, named after the file", () => {
      render(<Harness files={three} viewHref="/costs/c1/file" noun="cost" />)
      for (const f of three) {
        expect(within(slot()).getByRole("link", { name: `View ${f.name}` })).toBeInTheDocument()
        expect(within(slot()).getByRole("button", { name: `Download ${f.name}` })).toBeInTheDocument()
        expect(within(slot()).getByRole("button", { name: `More actions for ${f.name}` })).toBeInTheDocument()
      }
      expect(within(slot()).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual([
        "/costs/c1/file?file=IT01_00118",
        "/costs/c1/file?file=IT01_00121",
        "/costs/c1/file?file=IT01_NC009",
      ])
      expect(slot()).toHaveTextContent("Drop another file here, orAdd File")
    })

    it("a picked file is a row after the stored ones, with its own Remove, and shows 'Save first' once for all the Views", () => {
      render(<Harness files={three} viewHref="/costs/c1/file" noun="cost" unsaved />)
      choose("IT01_00124.xml")
      expect(within(slot()).getByText("FatturaPA XML · 1 KB · saved with the cost")).toBeInTheDocument()
      expect(within(slot()).getAllByText("Save first to view the invoice.")).toHaveLength(1)
      expect(within(slot()).getAllByRole("button", { name: /^View / })).toHaveLength(3)
      fireEvent.click(within(slot()).getByRole("button", { name: "Remove IT01_00124.xml" }))
      expect(within(slot()).queryByText("IT01_00124.xml")).toBeNull()
    })

    it("Remove File marks only that file, with its line and Undo, and leaves the others as they are", async () => {
      render(<Harness files={three} />)
      fireEvent.click((await more("IT01_00121.xml.p7m"))[1])
      expect(within(slot()).getByText("IT01_00121.xml.p7m is removed when you save.")).toBeInTheDocument()
      expect(within(slot()).getByRole("button", { name: "Download IT01_00118.xml" })).toBeInTheDocument()
      expect(within(slot()).queryByRole("button", { name: "Download IT01_00121.xml.p7m" })).toBeNull()
      fireEvent.click(within(slot()).getByRole("button", { name: "Undo" }))
      expect(within(slot()).getByRole("button", { name: "Download IT01_00121.xml.p7m" })).toBeInTheDocument()
    })

    it("Replace File… marks the old file only once a new one is picked, and the new one goes last; cancelling changes nothing", async () => {
      const drafts: FileDraft[] = []
      render(<Harness files={three} onDraft={(d) => drafts.push(d)} />)
      fireEvent.click((await more("IT01_00121.xml.p7m"))[0]) // opens the chooser; nobody picks
      expect(drafts).toEqual([])
      expect(within(slot()).queryByText(/is removed when you save/)).toBeNull()
      choose("IT01_00124.xml")
      expect(drafts.at(-1)?.removed).toEqual([three[1].path])
      expect(drafts.at(-1)?.picked.map((f) => f.name)).toEqual(["IT01_00124.xml"])
      expect(within(slot()).getByText("IT01_00121.xml.p7m is removed when you save.")).toBeInTheDocument()
      const rows = within(slot()).getAllByText(/^IT01_/).map((e) => e.textContent)
      expect(rows.at(-1)).toBe("IT01_00124.xml")
    })

    it("a plain pick after a cancelled Replace File… does not mark the old file", async () => {
      const drafts: FileDraft[] = []
      render(<Harness files={three.slice(0, 2)} onDraft={(d) => drafts.push(d)} />)
      fireEvent.click((await more("IT01_00118.xml"))[0])
      fireEvent.click(within(slot()).getByRole("button", { name: "Add File" }))
      choose("IT01_00130.xml")
      expect(drafts.at(-1)?.removed).toEqual([])
    })

    it("a file dropped after a cancelled Replace File… is an add, and does not mark the old file", async () => {
      const drafts: FileDraft[] = []
      render(<Harness files={three.slice(0, 2)} onDraft={(d) => drafts.push(d)} />)
      fireEvent.click((await more("IT01_00118.xml"))[0])
      const zone = within(slot()).getByText("Drop another file here, or").closest("div")!
      fireEvent.drop(zone, { dataTransfer: { files: [new File(["<a/>"], "dropped.xml")] } })
      expect(drafts.at(-1)?.removed).toEqual([])
      expect(drafts.at(-1)?.picked.map((f) => f.name)).toEqual(["dropped.xml"])
    })

    const full = Array.from({ length: INVOICE_FILES_MAX }, (_, i) => stored(`F${i}.xml`, "xml"))

    it.each([
      ["cost", "A cost holds up to 4 files: remove one to add another."],
      ["invoice", "An invoice holds up to 4 files: remove one to add another."],
    ] as const)("at the cap the add zone goes and one line says so, for %s", (noun, line) => {
      render(<Harness files={full} noun={noun} />)
      expect(within(slot()).queryByRole("button", { name: "Add File" })).toBeNull()
      expect(within(slot()).getByText(line)).toBeInTheDocument()
    })

    it("counts the picked and the removed: a removal gives the zone back, a pick takes it again", async () => {
      render(<Harness files={full} noun="cost" />)
      fireEvent.click((await more("F0.xml"))[1])
      expect(within(slot()).getByRole("button", { name: "Add File" })).toBeInTheDocument()
      choose("extra.xml")
      expect(within(slot()).queryByRole("button", { name: "Add File" })).toBeNull()
    })

    it("refuses a plain pick past the cap in words, naming the cost, and adds nothing", () => {
      const drafts: FileDraft[] = []
      render(<Harness files={full} noun="cost" onDraft={(d) => drafts.push(d)} />)
      choose("late.xml")
      expect(within(slot()).getByRole("alert")).toHaveTextContent("late.xml can't be attached: a cost holds up to 4 files.")
      expect(drafts).toEqual([])
    })

    it("takes a file dropped on the add zone, one at a time", () => {
      render(<Harness files={three.slice(0, 1)} />)
      const zone = within(slot()).getByText("Drop another file here, or").closest("div")!
      fireEvent.drop(zone, { dataTransfer: { files: [new File(["<a/>"], "second.xml"), new File(["<b/>"], "third.xml")] } })
      expect(within(slot()).getByText("second.xml")).toBeInTheDocument()
      expect(within(slot()).queryByText("third.xml")).toBeNull()
    })

    it("downloads and views each file on its own", async () => {
      URL.createObjectURL = vi.fn(() => "blob:x")
      URL.revokeObjectURL = vi.fn()
      download.mockClear().mockResolvedValue(new Blob(["x"]))
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
      render(<Harness files={three} />)
      fireEvent.click(within(slot()).getByRole("button", { name: "Download IT01_NC009.xml" }))
      await waitFor(() => expect(download).toHaveBeenCalledWith(three[2]))
      expect(download).toHaveBeenCalledTimes(1)
    })
  })

  describe("View", () => {
    afterEach(() => vi.restoreAllMocks())
    const createUrl = () => {
      URL.createObjectURL = vi.fn(() => "blob:pdf")
      URL.revokeObjectURL = vi.fn()
    }

    it("opens the tab on the click, before the download, so Safari does not block it", async () => {
      createUrl()
      let release!: (b: Blob) => void
      download.mockReturnValue(new Promise<Blob>((r) => (release = r)))
      const tab = { location: { href: "" }, opener: {}, close: vi.fn() }
      const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window)
      render(<Harness file={stored("EU-1.pdf", "pdf")} />)
      fireEvent.click(within(slot()).getByRole("button", { name: "View EU-1.pdf" }))
      expect(open).toHaveBeenCalledWith("about:blank", "_blank")
      expect(tab.opener).toBeNull()
      expect(tab.location.href).toBe("")
      release(new Blob(["%PDF"]))
      await waitFor(() => expect(tab.location.href).toBe("blob:pdf"))
    })

    it("closes the empty tab when the download fails", async () => {
      createUrl()
      download.mockRejectedValue(new Error("gone"))
      const tab = { location: { href: "" }, opener: {}, close: vi.fn() }
      vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window)
      render(<Harness file={stored("EU-1.pdf", "pdf")} />)
      fireEvent.click(within(slot()).getByRole("button", { name: "View EU-1.pdf" }))
      await waitFor(() => expect(tab.close).toHaveBeenCalled())
    })

    it("downloads the file instead when the browser refuses the tab", async () => {
      createUrl()
      download.mockResolvedValue(new Blob(["%PDF"]))
      vi.spyOn(window, "open").mockReturnValue(null)
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
      render(<Harness file={stored("EU-1.pdf", "pdf")} />)
      fireEvent.click(within(slot()).getByRole("button", { name: "View EU-1.pdf" }))
      await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    })
  })
})
