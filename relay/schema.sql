-- URLguard anonīmā statistika. Tikai dienas kopsummas – nav saišu, nav identifikatoru.
CREATE TABLE IF NOT EXISTS daily (
  day TEXT NOT NULL,             -- YYYY-MM-DD (UTC)
  browser TEXT NOT NULL,         -- chrome | firefox | other
  installs INTEGER NOT NULL DEFAULT 0,     -- cik paplašinājumu tajā dienā atsūtīja statistiku
  blocked INTEGER NOT NULL DEFAULT 0,      -- bloķētas bīstamās lapas
  warned INTEGER NOT NULL DEFAULT 0,       -- brīdinājumi par aizdomīgām lapām
  serp_marked INTEGER NOT NULL DEFAULT 0,  -- atzīmētas krāpnieku saites meklētājā
  serp_hidden INTEGER NOT NULL DEFAULT 0,  -- paslēptas krāpnieku saites meklētājā
  bypassed INTEGER NOT NULL DEFAULT 0,     -- lietotājs tomēr atvēra
  reports INTEGER NOT NULL DEFAULT 0,      -- nosūtīti ziņojumi
  PRIMARY KEY (day, browser)
);

-- Pret ļaunprātīgu skaitļu uzpūšanu: IP hash ar dienas sāli. Abas tabulas tīra pēc 2 dienām,
-- pēc tam hash vairs nav iespējams sasaistīt ar IP adresi.
CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ratelimit (
  day TEXT NOT NULL,
  key TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key)
);

-- Parakstītā krāpnieku bāze, ko izplata /bundle.json (+ .sig).
-- Relejs pieņem tikai bāzi ar derīgu Ed25519 parakstu un jaunāku "generated" datumu.
CREATE TABLE IF NOT EXISTS bundle (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generated TEXT NOT NULL,
  body TEXT NOT NULL,
  sig TEXT NOT NULL,
  updated TEXT NOT NULL
);
