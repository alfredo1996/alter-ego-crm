import { redirect } from "next/navigation"

import { i18n } from "@/app/i18n"

/**
 * The site root. The main app resolves the language with middleware, which a
 * static export cannot run, so the entry point is a plain redirect into the
 * default language instead.
 */
export default function Home() {
  redirect(`/${i18n.defaultLanguage}/docs`)
}
