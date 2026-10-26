CREATE TABLE IF NOT EXISTS places_cache (
  query      text         NOT NULL,
  lat        numeric(5,2) NOT NULL,
  lng        numeric(5,2) NOT NULL,
  results    jsonb        NOT NULL,
  fetched_at timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (query, lat, lng)
);

CREATE TABLE IF NOT EXISTS news_items (
  link         text        PRIMARY KEY,
  title        text        NOT NULL,
  source       text        NOT NULL,
  published_at timestamptz NOT NULL,
  first_seen   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS news_items_published ON news_items (published_at DESC);
