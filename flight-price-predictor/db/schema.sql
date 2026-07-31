-- Flight Price Predictor — schema
-- Run with: psql -U <user> -d flight_predictor -f db/schema.sql

DROP TABLE IF EXISTS flight_prices;
DROP TABLE IF EXISTS airports;

CREATE TABLE airports (
    code CHAR(3) PRIMARY KEY,
    city TEXT NOT NULL,
    name TEXT NOT NULL
);

CREATE TABLE flight_prices (
    id BIGSERIAL PRIMARY KEY,
    origin CHAR(3) NOT NULL REFERENCES airports(code),
    destination CHAR(3) NOT NULL REFERENCES airports(code),
    airline TEXT NOT NULL,
    travel_class TEXT NOT NULL CHECK (travel_class IN ('economy', 'premium_economy', 'business')),
    flight_date DATE NOT NULL,
    days_before_departure INT NOT NULL CHECK (days_before_departure >= 0),
    price NUMERIC(10, 2) NOT NULL CHECK (price > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (origin <> destination)
);

-- Indexes for the aggregate queries the prediction endpoint runs
CREATE INDEX idx_flight_prices_route_class
    ON flight_prices (origin, destination, travel_class);

CREATE INDEX idx_flight_prices_route_class_airline
    ON flight_prices (origin, destination, travel_class, airline);

CREATE INDEX idx_flight_prices_dow
    ON flight_prices (origin, destination, travel_class, flight_date);
