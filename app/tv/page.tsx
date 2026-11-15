import type { Metadata } from "next";
import { Suspense } from "react";
import { TvApp } from "../../components/TvApp";

export const metadata: Metadata = { title: "Channels" };
export const dynamic = "force-dynamic";

export default async function TvPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const { v } = await searchParams;
  return (
    <Suspense>
      <TvApp variant={v === "b" ? "b" : "a"} />
    </Suspense>
  );
}
