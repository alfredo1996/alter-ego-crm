/**
 * A module is one switchable slice of the app. Manifests are plain data and import
 * nothing.
 */
export type ModuleId = "crm" | "invoicing" | "books" | "solutions" | "rent"

export interface ModuleManifest {
  id: ModuleId
  label: string
  /** What it adds, in the Settings list. */
  summary: string
  /** Modules that must be on for this one to work. */
  requires: ModuleId[]
  /** The connector tools it serves (`ping` belongs to no module). */
  tools: string[]
  /** Shown in Settings; false until the module ships (rent). */
  listed: boolean
}

export function defineModule(manifest: ModuleManifest): ModuleManifest {
  return manifest
}
