CREATE TABLE IF NOT EXISTS places_cache (
  query      text         NOT NULL,
  lat        numeric(5,2) NOT NULL,
  lng        numeric(5,2) NOT NULL,
  results    jsonb        NOT NULL,
  fetched_at timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (query, lat, lng)
);
