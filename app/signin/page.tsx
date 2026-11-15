import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ownerKey, safeNextPath } from "../../src/server/auth";
import { isSignedIn } from "../../src/server/session";
import { signInAction } from "./actions";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  wrong: "That key is not right.",
  throttled: "Too many attempts. Wait ten minutes.",
  nokey: "This server has no owner key. Set SERENDIP_OWNER_KEY and restart.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next: nextParam } = await searchParams;
  const next = safeNextPath(nextParam);
  if (await isSignedIn()) redirect(next);
  if (!ownerKey()) {
    return (
      <main className="center-page">
        <p className="notice notice-error" role="alert">Set SERENDIP_OWNER_KEY in .env and restart the server.</p>
      </main>
    );
  }
  return (
    <main className="center-page">
      <form action={signInAction} className="card" aria-labelledby="t">
        <h1 id="t">Serendip</h1>
        <p className="muted">Sign in with the owner key.</p>
        {error && ERRORS[error] ? <p role="alert" className="notice notice-error">{ERRORS[error]}</p> : null}
        <input type="hidden" name="next" value={next} />
        <div className="field">
          <label htmlFor="key">Owner key</label>
          <input id="key" name="key" type="password" autoComplete="current-password" required autoFocus />
        </div>
        <button type="submit" className="btn btn-primary">Sign in</button>
      </form>
    </main>
  );
}
