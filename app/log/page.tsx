import type { Metadata } from "next";
import { LogForm } from "../../components/LogForm";

export const metadata: Metadata = { title: "Evening log" };
export const dynamic = "force-dynamic";

export default async function LogPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { day } = await searchParams;
  return <LogForm initialDay={day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null} />;
}
