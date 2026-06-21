import { ImageResponse } from "next/og";

export const runtime = "edge";
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
          background: "#ffffff",
          fontSize: 104,
          fontWeight: 700,
          letterSpacing: "-6px",
          fontFamily: "Helvetica, Arial, sans-serif",
        }}
      >
        <span style={{ color: "#060608" }}>jh</span>
        <span style={{ color: "#00e87a" }}>t</span>
      </div>
    ),
    { ...size },
  );
}
