import { tmdbToken } from "../src/catalog";

export function SampleBanner() {
  if (tmdbToken()) return null;
  return (
    <div className="banner" role="status">
      Sample catalog — add TMDB_READ_TOKEN
    </div>
  );
}

export function Attribution() {
  return (
    <footer className="attribution">
      This product uses the TMDB API but is not endorsed or certified by TMDB. Availability data by JustWatch.
    </footer>
  );
}
