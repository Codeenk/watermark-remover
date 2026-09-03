import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WatermarkRemover — Free AI Watermark Removal",
  description:
    "Remove watermarks from images and videos instantly. AI-powered, free, and runs entirely in your browser. No uploads required.",
  keywords: [
    "watermark remover",
    "remove watermark",
    "AI inpainting",
    "free watermark removal",
    "image editor",
    "video editor",
  ],
  openGraph: {
    title: "WatermarkRemover — Free AI Watermark Removal",
    description:
      "Remove watermarks from images and videos instantly. 100% free, private, and runs in your browser.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased min-h-screen bg-zinc-950 text-white">
        {children}
      </body>
    </html>
  );
}
