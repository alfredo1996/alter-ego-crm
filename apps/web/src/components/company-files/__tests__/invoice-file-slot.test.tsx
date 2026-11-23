import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NO_FILE_CHANGE, type FileDraft } from "@/hooks/use-company-files"

import { InvoiceFileSlot } from "../invoice-file-slot"

import type { InvoiceFile } from "@/types"

const download = vi.fn()
vi.mock("@/lib/backend", () => ({ getBackend: () => ({ files: { download } }) }))

const stored = (name: string, kind: InvoiceFile["kind"], size = 14 * 1024): InvoiceFile => ({
  path: `users/u1/company-files/${name}`, name, kind, size, uploadedAt: new Date(2026, 8, 4),
})

function Harness({
  file, initial = NO_FILE_CHANGE, viewHref, unsaved, disabled,
}: { file: InvoiceFile | null; initial?: FileDraft; viewHref?: string; unsaved?: boolean; disabled?: boolean }) {
  const [draft, setDraft] = useState(initial)
  return <InvoiceFileSlot stored={file} draft={draft} onDraftChange={setDraft} noun="invoice" viewHref={viewHref} unsaved={unsaved} disabled={disabled} />
}

const slot = () => screen.getByRole("group", { name: "Invoice File" })

describe("InvoiceFileSlot", () => {
  it("is empty without a file: a drop zone with Choose File and what it takes", () => {
    render(<Harness file={null} />)
    expect(slot()).toHaveTextContent("Drop the invoice file here, orChoose FileXML, signed XML (.p7m) or PDF · up to 10 MB")
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
    expect(within(slot()).queryByRole("button", { name: "View" }) !== null).toBe(view)
    expect(within(slot()).getByRole("button", { name: "Download file" })).toBeInTheDocument()
  })

  it.each([
    ["XML", "IT01.xml", "xml"],
    ["signed XML", "IT01.xml.p7m", "p7m"],
  ] as const)("opens a %s as the readable invoice: View is a link to the invoice page", (_, name, kind) => {
    render(<Harness file={stored(name, kind)} viewHref="/costs/c1/file" />)
    expect(within(slot()).getByRole("link", { name: "View" })).toHaveAttribute("href", "/costs/c1/file")
  })

  it.each([
    ["the form has unsaved changes", { unsaved: true }],
    ["the form is saving", { disabled: true }],
  ])("disables View with a hint while %s", (_, flags) => {
    render(<Harness file={stored("IT01.xml", "xml")} viewHref="/costs/c1/file" {...flags} />)
    expect(within(slot()).queryByRole("link", { name: "View" })).toBeNull()
    const view = within(slot()).getByRole("button", { name: "View" })
    expect(view).toBeDisabled()
    expect(view).toHaveAccessibleDescription("Save first to view the invoice.")
  })

  it("notes that the app opened the invoice page, so its Back can return here", () => {
    render(<Harness file={stored("IT01.xml", "xml")} viewHref="/costs/c1/file" />)
    const link = within(slot()).getByRole("link", { name: "View" })
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
    fireEvent.click(within(slot()).getByRole("button", { name: "Download file" }))
    await waitFor(() => expect(clicked).toEqual(["IT01.xml.p7m"]))
  })

  it("offers Replace File and Remove File behind the ⋯ menu", async () => {
    render(<Harness file={stored("IT01.xml", "xml")} />)
    fireEvent.keyDown(within(slot()).getByRole("button", { name: "More file actions" }), { key: "Enter" })
    expect((await screen.findAllByRole("menuitem")).map((i) => i.textContent)).toEqual(["Replace File…", "Remove File"])
  })

  it("shows a picked file as waiting to be saved, and Remove takes it back", () => {
    render(<Harness file={null} />)
    fireEvent.change(within(slot()).getByLabelText("Choose invoice file"), { target: { files: [new File(["x"], "inv.pdf")] } })
    expect(within(slot()).getByText("PDF · 1 KB · saved with the invoice")).toBeInTheDocument()
    fireEvent.click(within(slot()).getByRole("button", { name: "Remove" }))
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
      fireEvent.click(within(slot()).getByRole("button", { name: "View" }))
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
      fireEvent.click(within(slot()).getByRole("button", { name: "View" }))
      await waitFor(() => expect(tab.close).toHaveBeenCalled())
    })

    it("downloads the file instead when the browser refuses the tab", async () => {
      createUrl()
      download.mockResolvedValue(new Blob(["%PDF"]))
      vi.spyOn(window, "open").mockReturnValue(null)
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
      render(<Harness file={stored("EU-1.pdf", "pdf")} />)
      fireEvent.click(within(slot()).getByRole("button", { name: "View" }))
      await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    })
  })
})
