import { StatusPill, TagChip } from "@alter-ego/ui/page/status-pill"

import { SettingsRow, SettingsSection } from "@/components/settings/settings-section"
import { isModuleOn, leftOut as deploymentLeftOut, MODULES, type ModuleId } from "@/modules"

interface ModulesSectionProps {
  /** Defaults to this deployment's registry; a test passes its own. */
  isOn?: (id: ModuleId) => boolean
  leftOut?: { variable: string; value: string }
}

/** Read-only: the deployment chooses its modules, not the user (NEXT_PUBLIC_DISABLED_MODULES). */
export function ModulesSection({ isOn = isModuleOn, leftOut = deploymentLeftOut }: ModulesSectionProps) {
  return (
    <SettingsSection
      id="modules"
      title="Modules"
      description="What this deployment runs. A module switched off leaves the sidebar, its pages and the connector; its data stays."
    >
      {MODULES.filter((m) => m.listed).map((m) => (
        <SettingsRow
          key={m.id}
          label={
            <span className="inline-flex flex-wrap items-center gap-2">
              {m.label}
              {m.requires.map((id) => (
                <TagChip key={id} mono={false}>
                  Needs {MODULES.find((x) => x.id === id)!.label}
                </TagChip>
              ))}
            </span>
          }
          hint={m.summary}
        >
          <StatusPill tone={isOn(m.id) ? "success" : "neutral"}>{isOn(m.id) ? "On" : "Off"}</StatusPill>
        </SettingsRow>
      ))}
      <SettingsRow
        label="Left Out"
        hint={
          <>
            Set by <TagChip>{leftOut.variable}</TagChip> where the app is deployed. A change applies on the next deploy.
          </>
        }
      >
        <TagChip>{leftOut.value}</TagChip>
      </SettingsRow>
    </SettingsSection>
  )
}
