import { StatusPill, TagChip } from "@alter-ego/ui/page/status-pill"

import { SettingsRow, SettingsSection } from "@/components/settings/settings-section"
import { isModuleOn, selection as deploymentSelection, MODULES, type ModuleId } from "@/modules"

interface ModulesSectionProps {
  /** Defaults to this deployment's registry; a test passes its own. */
  isOn?: (id: ModuleId) => boolean
  selection?: { variable: string; value: string }
}

/** Read-only: the deployment chooses its plugins, not the user (NEXT_PUBLIC_PLUGINS). */
export function ModulesSection({ isOn = isModuleOn, selection = deploymentSelection }: ModulesSectionProps) {
  return (
    <SettingsSection
      id="modules"
      title="Plugins"
      description="What this deployment runs. A plugin that is off leaves the sidebar, its pages and the connector; its data stays."
    >
      {MODULES.map((m) => (
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
        label="Plugins Listed"
        hint={
          <>
            Set by <TagChip>{selection.variable}</TagChip> where the app is deployed. A change applies on the next deploy.
          </>
        }
      >
        <TagChip>{selection.value}</TagChip>
      </SettingsRow>
    </SettingsSection>
  )
}
