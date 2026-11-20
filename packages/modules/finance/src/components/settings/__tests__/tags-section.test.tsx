import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { TagsSection } from "../tags-section"

const deleteTag = vi.fn().mockResolvedValue(undefined)
vi.mock("../../../hooks/use-tags", () => ({
  useTags: () => ({ data: [{ id: "t1", userId: "u1", name: "vacation", color: "#f59e0b" }], isLoading: false }),
  useCreateTag: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteTag: () => ({ mutateAsync: deleteTag, isPending: false }),
}))
vi.mock("@alter-ego/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }))

describe("TagsSection", () => {
  it("asks before deleting a tag: one tap on the trash deleted it outright", async () => {
    render(<TagsSection userId="u1" />)
    fireEvent.click(screen.getByRole("button", { name: "Delete tag vacation" }))
    expect(deleteTag).not.toHaveBeenCalled()
    const confirm = screen.getByRole("alertdialog", { name: "Delete Tag" })
    fireEvent.click(confirm.querySelector("button:last-of-type")!)
    await waitFor(() => expect(deleteTag).toHaveBeenCalledWith("t1"))
  })
})
