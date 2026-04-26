import { ImageResponse } from "next/og";

// Apple devices request a 180×180 PNG for the Safari tab on Mac, iOS home
// screen "Add to Home Screen", and the macOS Sonoma+ app-icon dock entry.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#047857",
          color: "white",
          fontSize: 110,
          fontWeight: 700,
          fontFamily: "ui-sans-serif, system-ui",
          letterSpacing: -2,
        }}
      >
        ₹
      </div>
    ),
    size,
  );
}
