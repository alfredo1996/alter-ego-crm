import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { RevenueCliffPanel } from "../revenue-cliff-panel"

import type { RevenueCliff } from "@/lib/engagement-burndown"

const cliff = (yearMonth: string, client: string, lost: number, remaining: number): RevenueCliff => ({
  yearMonth,
  sources: [{ sourceId: client, clientName: client, monthlyGrossLost: lost }],
  grossLostPerMonth: lost,
  grossRemainingPerMonth: remaining,
})

describe("RevenueCliffPanel", () => {
  it("leads with the loss, then walks the months down from the level before it", () => {
    render(
      <RevenueCliffPanel
        cliffs={[
          cliff("2027-02", "Vela Analytics Srl", 1920, 8660),
          cliff("2027-05", "Nordwind Retail S.p.A.", 4160, 4500),
        ]}
        pipelineRecovery={5894}
        levelBefore={11620}
      />,
    );
    const card = screen.getByRole("region", { name: "When billing drops" });
    expect(
      within(card).getByText("From February 2027 you bill €1,920 a month less"),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        /Billing stops for Vela Analytics Srl\. The weighted pipeline could win back €5,894 a month\./,
      ),
    ).toBeInTheDocument();
    // The month before the first drop shows the level it fell from; then one step per cliff.
    const steps = within(card).getAllByRole("listitem").filter((li) => li.textContent)
    expect(steps.map((li) => li.textContent)).toEqual([
      "January 2027€11,620 a monthBefore billing stops",
      "February 2027€8,660 a month−€1,920 · Vela Analytics Srl, billing stops",
      "May 2027€4,500 a month−€4,160 · Nordwind Retail S.p.A., billing stops",
    ])
  })

  it("says nothing about the pipeline when it wins nothing back, and nothing at all with no cliff", () => {
    const { rerender } = render(
      <RevenueCliffPanel
        cliffs={[cliff("2027-02", "Vela", 1920, 8660)]}
        pipelineRecovery={0}
        levelBefore={null}
      />,
    );
    expect(screen.queryByText(/weighted pipeline/)).toBeNull();
    // No month before the cliff in the timeline: no invented level.
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    rerender(
      <RevenueCliffPanel cliffs={[]} pipelineRecovery={0} levelBefore={null} />,
    );
    expect(screen.queryByRole("region")).toBeNull();
    expect(
      screen.getByText("No budget runs out in the next 12 months."),
    ).toBeInTheDocument();
  });
});
