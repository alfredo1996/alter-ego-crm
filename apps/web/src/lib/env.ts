import { z } from "@/lib/zod"

const envSchema = z.object({
  NEXT_PUBLIC_BACKEND: z.enum(["mock", "firebase"]).default("mock"),
  /** Comma-separated module ids this deployment leaves out (see src/modules). Everything is on otherwise. */
  NEXT_PUBLIC_DISABLED_MODULES: z.string().default(""),
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().optional(),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().optional(),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().optional(),
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: z.string().optional(),
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: z.string().optional(),
  NEXT_PUBLIC_FIREBASE_APP_ID: z.string().optional(),
  NEXT_PUBLIC_USE_EMULATOR: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((v) => v === "true"),
})

function validateEnv() {
  const result = envSchema.safeParse({
    NEXT_PUBLIC_BACKEND: process.env.NEXT_PUBLIC_BACKEND,
    NEXT_PUBLIC_DISABLED_MODULES: process.env.NEXT_PUBLIC_DISABLED_MODULES,
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    NEXT_PUBLIC_USE_EMULATOR: process.env.NEXT_PUBLIC_USE_EMULATOR,
  })

  if (!result.success) {
    console.error("Invalid environment variables:", result.error.issues)
    throw new Error("Invalid environment variables. Check console for details.")
  }

  return result.data
}

export const env = validateEnv()
