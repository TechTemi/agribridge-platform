-- 001_init.sql - baseline schema for the AgriBridge marketplace.
--
-- Applied by src/migrate.js under a Postgres advisory lock, so it is safe for
-- several API replicas to start at once: exactly one runs the migration and
-- the rest wait, then find nothing to do.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------- users -----
CREATE TABLE IF NOT EXISTS users (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email          TEXT        NOT NULL UNIQUE,
    password_hash  TEXT        NOT NULL,
    full_name      TEXT        NOT NULL,
    role           TEXT        NOT NULL CHECK (role IN ('farmer', 'buyer', 'agent')),
    organisation   TEXT,
    state          TEXT,                       -- Nigerian state, for farmers
    phone          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- ----------------------------------------------------------------- lots -----
-- A lot is a quantity of produce a farmer has offered for sale.
CREATE TABLE IF NOT EXISTS lots (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farmer_id              UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    crop                   TEXT        NOT NULL CHECK (crop IN ('maize', 'sorghum', 'soybean', 'paddy_rice')),
    tonnage                NUMERIC(10, 2) NOT NULL CHECK (tonnage > 0),
    moisture_grade         CHAR(1)     NOT NULL CHECK (moisture_grade IN ('A', 'B', 'C')),
    state                  TEXT        NOT NULL,
    price_per_tonne_naira  BIGINT      NOT NULL CHECK (price_per_tonne_naira > 0),
    status                 TEXT        NOT NULL DEFAULT 'OPEN'
                                       CHECK (status IN ('OPEN', 'RESERVED', 'SOLD', 'WITHDRAWN')),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Supports the buyer browse screen, which filters on crop, state and status.
CREATE INDEX IF NOT EXISTS idx_lots_browse ON lots (status, crop, state);
CREATE INDEX IF NOT EXISTS idx_lots_farmer ON lots (farmer_id, created_at DESC);

-- --------------------------------------------------------------- orders -----
CREATE TABLE IF NOT EXISTS orders (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_id               UUID        NOT NULL REFERENCES lots (id) ON DELETE RESTRICT,
    buyer_id             UUID        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    tonnage              NUMERIC(10, 2) NOT NULL CHECK (tonnage > 0),
    total_naira          BIGINT      NOT NULL CHECK (total_naira >= 0),
    platform_fee_naira   BIGINT      NOT NULL DEFAULT 0,
    farmer_payout_naira  BIGINT      NOT NULL DEFAULT 0,
    status               TEXT        NOT NULL DEFAULT 'PENDING'
                                     CHECK (status IN ('PENDING', 'MATCHED', 'IN_TRANSIT',
                                                       'DELIVERED', 'SETTLED', 'CANCELLED')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_buyer  ON orders (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_lot    ON orders (lot_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status, created_at DESC);
-- Powers the "orders created today" dashboard panel without a full scan.
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at DESC);

-- --------------------------------------------------------- order_events -----
-- Append-only audit of every lifecycle transition. This is what lets you
-- answer "who moved this order, and when?" - the F-14 auditability finding.
CREATE TABLE IF NOT EXISTS order_events (
    id          BIGSERIAL PRIMARY KEY,
    order_id    UUID        NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    from_status TEXT,
    to_status   TEXT        NOT NULL,
    actor_id    UUID        REFERENCES users (id) ON DELETE SET NULL,
    request_id  TEXT,                            -- correlates with the Loki logs
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events (order_id, created_at);
