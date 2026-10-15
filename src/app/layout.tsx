import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ER Insight — 이터널 리턴 전적 분석",
  description: "기간과 실험체를 골라 이터널 리턴 전적을 살펴보세요.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
