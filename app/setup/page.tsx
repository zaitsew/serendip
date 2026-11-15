import type { Metadata } from "next";
import { SetupForm } from "../../components/SetupForm";

export const metadata: Metadata = { title: "Setup" };
export const dynamic = "force-dynamic";

export default function SetupPage() {
  return <SetupForm />;
}
