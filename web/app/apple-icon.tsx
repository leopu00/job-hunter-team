import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Wordmark "JHT" (JetBrains Mono Bold, outlines) — "JH" black, "T" green, white bg.
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
        }}
      >
        <svg width="180" height="180" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M7.34 21.15Q5.8 21.15 4.9 20.3Q4 19.45 4 18H5.74Q5.74 18.76 6.16 19.19Q6.59 19.63 7.34 19.63Q8.08 19.63 8.51 19.2Q8.94 18.77 8.94 18.02V10.85H10.68V18.02Q10.68 19.47 9.78 20.31Q8.89 21.15 7.34 21.15Z M13.01 21.01V10.85H14.75V14.97H17.48V10.85H19.22V21.01H17.48V16.54H14.75V21.01Z"
            fill="#060608"
          />
          <path
            d="M23.59 21.01V12.42H20.93V10.85H28V12.42H25.34V21.01Z"
            fill="#00e87a"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
