import Link from "next/link";
import { catalog } from "../src/catalog";
import { store } from "../src/server/store";
import { signOutAction } from "./signin/actions";

export const dynamic = "force-dynamic";

export default function Home() {
  const s = store();
  const u = s.usage();
  const mode = catalog().mode;
  return (
    <main className="page">
      <header>
        <h1>Serendip</h1>
        <p className="muted">Films worth watching tonight. Zap through channels instead of scrolling a grid.</p>
      </header>
      {!s.hasPrefs() ? (
        <p className="notice">First, <Link href="/setup">pick your services in Spain</Link> and a few films you love.</p>
      ) : null}
      <nav className="nav" aria-label="Main">
        <Link className="btn btn-primary" href="/tv">Open the channels</Link>
        <Link className="btn" href="/tv?v=b">Variant B</Link>
        <Link className="btn" href="/detour">Detour</Link>
        <Link className="btn" href="/setup">Setup</Link>
        <Link className="btn" href="/log">Evening log</Link>
      </nav>
      <section className="card" aria-label="Status">
        <p>Catalog: <strong>{mode === "tmdb" ? "TMDB" : "sample (add TMDB_READ_TOKEN for the real one)"}</strong></p>
        <p className="muted">{String(u.seeds)} loved, {String(u.seen)} seen, {String(u.evenings_logged)} evenings logged.</p>
      </section>
      <form action={signOutAction}><button className="btn" type="submit">Sign out</button></form>
    </main>
  );
}
