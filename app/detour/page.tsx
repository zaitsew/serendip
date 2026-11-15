import type { Metadata } from "next";
import { DetourView } from "../../components/Detour";

export const metadata: Metadata = { title: "Detour" };
export const dynamic = "force-dynamic";

export default async function DetourPage({ searchParams }: { searchParams: Promise<{ yt?: string; reason?: string }> }) {
  const { yt, reason } = await searchParams;
  return <DetourView connectStatus={yt ? { kind: yt, reason: reason ?? null } : null} />;
}
