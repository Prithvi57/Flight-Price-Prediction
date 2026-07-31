# Fare Forecast — Flight Price Predictor

A small full-stack app: vanilla JS/HTML/CSS frontend, Node/Express backend, PostgreSQL for storage and for the prediction math itself.

## How the prediction works

There's no external ML library. Instead, historical fares are stored in Postgres, and the backend asks Postgres to fit a linear regression directly, using the built-in `regr_slope` / `regr_intercept` aggregate functions over `(price, days_before_departure)`:

1. Fit `price ≈ intercept + slope × days_before_departure` for the requested route + class (and airline, if given — falling back to all airlines if that airline has too little data).
2. Adjust for the requested day of week, based on how much that weekday's historical average deviates from the route's overall average.
3. Report a price range using the sample's standard deviation, and a confidence label based on sample size.

This is a legitimate trend-based estimate, not a guarantee — real fares also depend on live seat inventory the app doesn't have access to.

## Requirements

- Node.js 18+
- PostgreSQL 13+ (needs `regr_slope`/`regr_intercept`, which are standard aggregates, plus `width_bucket`)

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create the database
createdb flight_predictor

# 3. Copy env config and adjust credentials if needed
cp .env.example .env

# 4. Create the schema
psql -U postgres -d flight_predictor -f db/schema.sql

# 5. Seed ~180 days of synthetic-but-realistic historical fares
npm run seed

# 6. Start the server
npm start
```

Then open **http://localhost:3000**.

## Project layout

```
flight-price-predictor/
├── server.js           # Express API + prediction SQL
├── db/
│   ├── schema.sql       # airports + flight_prices tables
│   └── seed.js          # generates historical fare data
├── public/
│   ├── index.html
│   ├── style.css        # departure-board styling
│   └── app.js           # form handling, flip-board animation, trend chart
├── package.json
└── .env.example
```

## API

- `GET /api/airports` → `[{ code, city, name }]`
- `GET /api/airlines` → `["IndiGo", ...]`
- `POST /api/predict`
  ```json
  {
    "origin": "DEL",
    "destination": "BOM",
    "travelDate": "2026-09-01",
    "travelClass": "economy",
    "airline": null
  }
  ```
  →
  ```json
  {
    "predictedPrice": 5230,
    "priceRangeLow": 4680,
    "priceRangeHigh": 5780,
    "currency": "INR",
    "daysBeforeDeparture": 33,
    "sampleSize": 812,
    "confidence": "high",
    "trend": [{ "bucket": 1, "avgPrice": 6100 }, ...]
  }
  ```

## Using your own real fare data instead of the synthetic seed

Swap out `npm run seed` for your own loader — anything that lands rows in `flight_prices` with `(origin, destination, airline, travel_class, flight_date, days_before_departure, price)` will work with the existing prediction queries unchanged. The included airports list (10 major Indian cities) is just a starting point; add rows to the `airports` table for any others you need.
