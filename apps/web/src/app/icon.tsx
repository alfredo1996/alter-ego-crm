import { ImageResponse } from "next/og"

// App icon (also used as favicon). Generated at build time.
export const size = { width: 512, height: 512 }
export const contentType = "image/png"

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #111111, #3a3a3a)",
          color: "#ffffff",
          fontSize: 240,
          fontWeight: 700,
          fontFamily: "sans-serif",
        }}
      >
        Æ
      </div>
    ),
    { ...size },
  )
}
