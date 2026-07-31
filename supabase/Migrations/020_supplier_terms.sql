-- Supplier buying terms.
--
-- The back-office design shows suppliers as a buying relationship rather than
-- a contact card: who you speak to, which town they are in, and on what terms
-- you pay them. Three of its columns had nowhere to live.
--
-- The rest of that screen — brands supplied, last order, spend this year — is
-- derived from `purchases` and needs no storage. Only what cannot be computed
-- is added here.
--
-- All nullable with no default: a shop that has not recorded terms for a
-- supplier should see an empty cell, not an invented "30 days" that somebody
-- might then rely on when paying an invoice.

ALTER TABLE suppliers
    ADD COLUMN IF NOT EXISTS contact_name   TEXT,
    ADD COLUMN IF NOT EXISTS town           TEXT,
    ADD COLUMN IF NOT EXISTS payment_terms  TEXT;

COMMENT ON COLUMN suppliers.contact_name IS
    'The person you deal with, not the company. Null when unrecorded.';
COMMENT ON COLUMN suppliers.town IS
    'Shown beside the supplier name. Free text — Mauritius has no postcode.';
COMMENT ON COLUMN suppliers.payment_terms IS
    'How you pay them, e.g. "30 days", "On delivery". Free text on purpose: '
    'terms are negotiated per supplier and an enum here would be wrong within '
    'a year.';
