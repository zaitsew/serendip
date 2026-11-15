"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp, isOwnerKey, lockout, ownerKey, safeNextPath } from "../../src/server/auth";
import { clearSessionCookie, setSessionCookie } from "../../src/server/session";

export async function signInAction(formData: FormData): Promise<void> {
  const next = safeNextPath(formData.get("next"));
  const fail = (code: string): never => redirect(`/signin?error=${code}${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`);
  if (!ownerKey()) fail("nokey");
  const ip = clientIp(await headers());
  if (lockout().locked(ip)) fail("throttled");
  const key = formData.get("key");
  if (typeof key !== "string" || !isOwnerKey(key.trim())) {
    lockout().fail(ip);
    fail("wrong");
  }
  await setSessionCookie();
  redirect(next);
}

export async function signOutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/signin");
}
