import type { Film, Provider } from "../core/types";

/**
 * The labelled sample catalog: 32 well-known films with our own one-line descriptions.
 * Services are assigned for the demo and are NOT real Spanish availability.
 * No trailer keys: none is certain, so the TV view falls back to a poster card.
 */

export const FIXTURE_PROVIDERS: Provider[] = [
  { id: 8, name: "Netflix" },
  { id: 119, name: "Prime Video" },
  { id: 337, name: "Disney+" },
  { id: 149, name: "Movistar Plus+" },
  { id: 63, name: "Filmin" },
  { id: 1899, name: "Max" },
  { id: 350, name: "Apple TV+" },
  { id: 1773, name: "SkyShowtime" },
];

const B = 9_000_000;

type Row = [
  n: number,
  title: string,
  year: number,
  runtime: number,
  country: string,
  lang: string,
  genres: string[],
  provider: number,
  line: string,
  votes: number,
  avg: number,
  pop: number,
  keywords: string[],
  recs: number[],
];

const ROWS: Row[] = [
  [1, "Arrival", 2016, 116, "US", "en", ["Science Fiction", "Drama"], 63, "A linguist learns an alien language and her sense of time starts to bend.", 17000, 7.6, 62, ["aliens", "language", "time"], [14, 22, 27, 12]],
  [2, "Parasite", 2019, 132, "KR", "ko", ["Thriller", "Drama", "Comedy"], 149, "A poor family slides into a rich household and the house starts to push back.", 20000, 8.5, 88, ["class", "heist", "family"], [16, 23, 25, 19]],
  [3, "Spirited Away", 2001, 125, "JP", "ja", ["Animation", "Fantasy"], 337, "A girl works in a bathhouse for spirits to free her parents.", 16000, 8.5, 72, ["spirits", "coming of age"], [18, 7, 29]],
  [4, "The Godfather", 1972, 175, "US", "en", ["Crime", "Drama"], 119, "A crime family changes hands and the quiet son pays for it.", 21000, 8.7, 95, ["mafia", "family"], [21, 9, 28]],
  [5, "Cinema Paradiso", 1988, 155, "IT", "it", ["Drama"], 63, "A film director remembers the village projectionist who taught him to love cinema.", 4500, 8.4, 30, ["cinema", "nostalgia"], [6, 31, 32]],
  [6, "Amélie", 2001, 122, "FR", "fr", ["Comedy", "Romance"], 8, "A shy waitress quietly rearranges the lives of the people around her.", 11500, 7.9, 55, ["paris", "whimsy"], [30, 5, 31]],
  [7, "Pan's Labyrinth", 2006, 118, "ES", "es", ["Fantasy", "War", "Drama"], 149, "In 1944 Spain a girl meets a faun while her stepfather hunts rebels.", 9800, 7.8, 50, ["civil war", "fairy tale"], [3, 29, 18]],
  [8, "Seven Samurai", 1954, 207, "JP", "ja", ["Action", "Drama"], 63, "Villagers hire seven masterless warriors to stop a bandit raid.", 3600, 8.5, 28, ["samurai", "village"], [24, 32, 12]],
  [9, "City of God", 2002, 130, "BR", "pt", ["Crime", "Drama"], 119, "Two boys grow up in a Rio favela, one with a camera and one with a gun.", 7300, 8.4, 45, ["favela", "gangs"], [25, 4, 28]],
  [10, "In the Mood for Love", 2000, 98, "HK", "cn", ["Romance", "Drama"], 63, "Two neighbours in 1960s Hong Kong find their spouses are having an affair.", 2900, 8.1, 24, ["hong kong", "longing"], [30, 15, 20]],
  [11, "The Lives of Others", 2006, 137, "DE", "de", ["Drama", "Thriller"], 1899, "A secret-police captain listens to an artist's flat and slowly changes sides.", 4200, 8.3, 29, ["surveillance", "east germany"], [19, 12, 17]],
  [12, "Stalker", 1979, 162, "SU", "ru", ["Science Fiction", "Drama"], 63, "A guide leads two men through a forbidden zone toward a room that grants wishes.", 1900, 8.0, 15, ["the zone", "philosophy"], [14, 1, 8]],
  [13, "Whiplash", 2014, 107, "US", "en", ["Drama", "Music"], 1773, "A young drummer is pushed to the edge by a ruthless conductor.", 15500, 8.4, 58, ["jazz", "obsession"], [21, 22, 2]],
  [14, "Blade Runner", 1982, 117, "US", "en", ["Science Fiction", "Thriller"], 350, "A hunter chases four rogue androids through a rainy future Los Angeles.", 13500, 7.9, 60, ["androids", "noir"], [1, 12, 27, 22]],
  [15, "Y tu mamá también", 2001, 106, "MX", "es", ["Drama", "Romance"], 149, "Two teenagers and an older woman take a road trip to a beach that may not exist.", 3000, 7.6, 22, ["road trip", "youth"], [25, 10, 29]],
  [16, "Oldboy", 2003, 120, "KR", "ko", ["Thriller", "Mystery"], 119, "A man freed after fifteen years of captivity has five days to find out why.", 9400, 8.3, 55, ["revenge", "captivity"], [2, 23, 21]],
  [17, "The Secret in Their Eyes", 2009, 129, "AR", "es", ["Mystery", "Crime", "Drama"], 149, "A retired clerk returns to an unsolved murder case that never let him go.", 2500, 8.2, 18, ["cold case", "justice"], [11, 9, 4]],
  [18, "Persepolis", 2007, 96, "FR", "fr", ["Animation", "Drama"], 63, "A girl grows up through the Iranian revolution and exile in Europe.", 2700, 7.9, 19, ["iran", "memoir"], [3, 6, 28]],
  [19, "Toni Erdmann", 2016, 162, "DE", "de", ["Comedy", "Drama"], 63, "A prankster father invades the corporate life of his workaholic daughter.", 1500, 7.4, 16, ["father daughter", "awkward"], [2, 11, 31]],
  [20, "Cold War", 2018, 88, "PL", "pl", ["Drama", "Romance"], 63, "A pianist and a singer love each other across borders and decades.", 1700, 7.5, 14, ["music", "iron curtain"], [26, 10, 5]],
  [21, "Taxi Driver", 1976, 114, "US", "en", ["Crime", "Drama"], 1899, "A lonely night-shift cabbie in New York drifts toward violence.", 12500, 8.2, 65, ["new york", "loneliness"], [4, 16, 13]],
  [22, "Her", 2013, 126, "US", "en", ["Science Fiction", "Romance", "Drama"], 350, "A lonely writer falls in love with his operating system.", 13500, 7.9, 52, ["ai", "loneliness"], [1, 14, 13]],
  [23, "The Handmaiden", 2016, 145, "KR", "ko", ["Thriller", "Romance"], 149, "A maid, a con man and an heiress play three-way tricks in 1930s Korea.", 4400, 8.1, 33, ["con", "period"], [2, 16, 10]],
  [24, "Rashomon", 1950, 88, "JP", "ja", ["Mystery", "Drama"], 63, "A murder is told four times, and each version flatters its teller.", 2400, 8.2, 20, ["perspective", "samurai"], [8, 32, 17]],
  [25, "Amores perros", 2000, 154, "MX", "es", ["Drama", "Thriller"], 349, "Three stories in Mexico City collide in one car crash.", 3800, 7.6, 26, ["car crash", "dogs"], [9, 15, 2]],
  [26, "Ida", 2013, 82, "PL", "pl", ["Drama"], 63, "A novice nun learns her family history from her aunt in 1960s Poland.", 1300, 7.4, 13, ["convent", "memory"], [20, 11, 12]],
  [27, "Moon", 2009, 97, "GB", "en", ["Science Fiction", "Mystery"], 1773, "A lone miner on the moon finds out he is not alone.", 6800, 7.6, 34, ["moon base", "clones"], [1, 14, 22]],
  [28, "La haine", 1995, 98, "FR", "fr", ["Crime", "Drama"], 63, "Twenty-four hours in the Paris suburbs after a night of riots.", 3200, 8.1, 23, ["banlieue", "black and white"], [9, 4, 18]],
  [29, "Embrace of the Serpent", 2015, 125, "CO", "es", ["Adventure", "Drama"], 63, "Two scientists, decades apart, search the Amazon with the same shaman.", 800, 7.9, 10, ["amazon", "colonialism"], [15, 3, 7]],
  [30, "Chungking Express", 1994, 102, "HK", "cn", ["Romance", "Comedy"], 63, "Two lovelorn Hong Kong policemen cross paths with two very different women.", 2600, 7.8, 25, ["hong kong", "neon"], [10, 6, 15]],
  [31, "The Apartment", 1960, 125, "US", "en", ["Comedy", "Romance"], 119, "A clerk lends his flat to his bosses for affairs and falls for the elevator girl.", 2500, 8.3, 19, ["office", "new york"], [6, 5, 19]],
  [32, "Tokyo Story", 1953, 136, "JP", "ja", ["Drama"], 63, "An elderly couple visit their grown children in Tokyo and find little time for them.", 1200, 8.2, 12, ["family", "ageing"], [5, 24, 8]],
];

export const FIXTURE_FILMS: Film[] = ROWS.map(([n, title, year, runtime, country, lang, genres, provider, line, votes, avg, pop, keywords, recs]) => ({
  id: B + n,
  title,
  year,
  runtime,
  genres,
  country,
  originalLanguage: lang,
  providers: [provider],
  trailerKey: null,
  backdrop: null,
  poster: null,
  line,
  voteCount: votes,
  voteAverage: avg,
  popularity: pop,
  keywords,
  recommendations: recs.map((r) => B + r),
  sample: true,
}));
