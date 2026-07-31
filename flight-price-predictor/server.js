require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const pool = new Pool();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// GET /api/airports — populate the origin/destination dropdowns
// ---------------------------------------------------------------------------
app.get('/api/airports', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT code, city, name FROM airports ORDER BY city');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load airports.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/airlines
// ---------------------------------------------------------------------------
app.get('/api/airlines', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT DISTINCT airline FROM flight_prices ORDER BY airline'
    );
    res.json(rows.map(r => r.airline));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load airlines.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/predict
// body: { origin, destination, travelDate, travelClass, airline? }
//
// The model: pull historical (price, days_before_departure) pairs for the
// route/class (optionally narrowed to one airline) and fit a linear
// regression with Postgres's built-in regr_slope/regr_intercept aggregates.
// That gives a base price for the requested lead time. We then nudge it by
// how much that day of week historically deviates from the route's average,
// and report a confidence range from the sample's standard deviation.
// ---------------------------------------------------------------------------
app.post('/api/predict', async (req, res) => {
  const { origin, destination, travelDate, travelClass, airline } = req.body;

  if (!origin || !destination || !travelDate || !travelClass) {
    return res.status(400).json({ error: 'origin, destination, travelDate and travelClass are required.' });
  }
  if (origin === destination) {
    return res.status(400).json({ error: 'Origin and destination must be different.' });
  }

  const daysBeforeDeparture = Math.max(
    0,
    Math.ceil((new Date(travelDate) - new Date()) / (1000 * 60 * 60 * 24))
  );
  const dayOfWeek = new Date(travelDate).getDay();

  try {
    const regressionQuery = `
      SELECT
        regr_slope(price, days_before_departure)     AS slope,
        regr_intercept(price, days_before_departure) AS intercept,
        COUNT(*)                                      AS n,
        AVG(price)                                    AS avg_price,
        STDDEV(price)                                 AS stddev_price
      FROM flight_prices
      WHERE origin = $1 AND destination = $2 AND travel_class = $3
        AND ($4::text IS NULL OR airline = $4)
    `;
    let { rows: [stats] } = await pool.query(regressionQuery, [
      origin,
      destination,
      travelClass,
      airline || null
    ]);

    // Fall back to all airlines on this route if a specific airline is too thin on data.
    let usedFallback = false;
    if (airline && (!stats || Number(stats.n) < 20)) {
      const fallback = await pool.query(regressionQuery, [origin, destination, travelClass, null]);
      stats = fallback.rows[0];
      usedFallback = true;
    }

    if (!stats || !stats.n || Number(stats.n) < 5) {
      return res.status(404).json({
        error: 'Not enough historical data for that route and class yet.'
      });
    }

    const slope = Number(stats.slope) || 0;
    const intercept = Number(stats.intercept) || Number(stats.avg_price);
    const sampleSize = Number(stats.n);
    const stddev = Number(stats.stddev_price) || Number(stats.avg_price) * 0.1;

    let basePrediction = intercept + slope * daysBeforeDeparture;
    // Guard against a pathological regression on sparse/noisy data.
    if (!isFinite(basePrediction) || basePrediction <= 0) {
      basePrediction = Number(stats.avg_price);
    }

    // Day-of-week adjustment: how this weekday's historical average compares
    // to the route's overall average.
    const dowQuery = `
      SELECT AVG(price) AS dow_avg
      FROM flight_prices
      WHERE origin = $1 AND destination = $2 AND travel_class = $3
        AND EXTRACT(DOW FROM flight_date) = $4
    `;
    const { rows: [dowRow] } = await pool.query(dowQuery, [origin, destination, travelClass, dayOfWeek]);
    const dowAvg = dowRow && dowRow.dow_avg ? Number(dowRow.dow_avg) : Number(stats.avg_price);
    const dowMultiplier = Number(stats.avg_price) > 0 ? dowAvg / Number(stats.avg_price) : 1;

    const predictedPrice = Math.round(basePrediction * dowMultiplier);
    const margin = Math.round(stddev * 0.6);

    // Small trend series for the sparkline: average price by lead-time bucket.
    const trendQuery = `
      SELECT
        width_bucket(days_before_departure, 0, 90, 9) AS bucket,
        AVG(price)::int AS avg_price
      FROM flight_prices
      WHERE origin = $1 AND destination = $2 AND travel_class = $3
      GROUP BY bucket
      ORDER BY bucket
    `;
    const { rows: trendRows } = await pool.query(trendQuery, [origin, destination, travelClass]);

    res.json({
      predictedPrice,
      priceRangeLow: Math.max(500, predictedPrice - margin),
      priceRangeHigh: predictedPrice + margin,
      currency: 'INR',
      daysBeforeDeparture,
      sampleSize,
      usedAirlineFallback: usedFallback,
      confidence: sampleSize > 200 ? 'high' : sampleSize > 50 ? 'medium' : 'low',
      trend: trendRows.map(r => ({ bucket: Number(r.bucket), avgPrice: Number(r.avg_price) }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Prediction failed.' });
  }
});

app.listen(PORT, () => {
  console.log(`Flight price predictor running on http://localhost:${PORT}`);
});
