import { loader } from "fumadocs-core/source"

import { docs } from "@/.source/server"
import { i18n } from "@/app/i18n"

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: "/docs",
  i18n,
})
