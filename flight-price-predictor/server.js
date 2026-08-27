require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db/index');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// GET /api/status — database health & record stats
// ---------------------------------------------------------------------------
app.get('/api/status', async (req, res) => {
  try {
    const status = await db.getStatus();
    res.json(status);
  } catch (err) {
    console.error('[API /api/status error]:', err);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/airports — populate the origin/destination dropdowns
// ---------------------------------------------------------------------------
app.get('/api/airports', async (req, res) => {
  try {
    const airports = await db.getAirports();
    res.json(airports);
  } catch (err) {
    console.error('[API /api/airports error]:', err);
    res.status(500).json({ error: 'Could not load airports.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/airlines — populate airline filter dropdown
// ---------------------------------------------------------------------------
app.get('/api/airlines', async (req, res) => {
  try {
    const airlines = await db.getAirlines();
    res.json(airlines);
  } catch (err) {
    console.error('[API /api/airlines error]:', err);
    res.status(500).json({ error: 'Could not load airlines.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/predict
// body: { origin, destination, travelDate, travelClass, airline? }
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
    let stats = await db.getRegressionStats(origin, destination, travelClass, airline || null);

    // Fall back to all airlines on this route if a specific airline is too thin on data
    let usedFallback = false;
    if (airline && (!stats || stats.n < 20)) {
      stats = await db.getRegressionStats(origin, destination, travelClass, null);
      usedFallback = true;
    }

    if (!stats || !stats.n || stats.n < 5) {
      return res.status(404).json({
        error: 'Not enough historical data for that route and class yet.'
      });
    }

    const slope = stats.slope || 0;
    const intercept = stats.intercept || stats.avg_price;
    const sampleSize = stats.n;
    const stddev = stats.stddev_price || stats.avg_price * 0.1;

    let basePrediction = intercept + slope * daysBeforeDeparture;
    // Guard against a pathological regression on sparse/noisy data
    if (!isFinite(basePrediction) || basePrediction <= 0) {
      basePrediction = stats.avg_price;
    }

    // Day-of-week adjustment: how this weekday's historical average compares to route average
    const dowAvg = await db.getDayOfWeekAvg(origin, destination, travelClass, dayOfWeek);
    const effectiveDowAvg = dowAvg || stats.avg_price;
    const dowMultiplier = stats.avg_price > 0 ? effectiveDowAvg / stats.avg_price : 1;

    const predictedPrice = Math.round(basePrediction * dowMultiplier);
    const margin = Math.round(stddev * 0.6);

    // Trend series for sparkline
    const trendRows = await db.getTrendBuckets(origin, destination, travelClass);

    res.json({
      predictedPrice,
      priceRangeLow: Math.max(500, predictedPrice - margin),
      priceRangeHigh: predictedPrice + margin,
      currency: 'INR',
      daysBeforeDeparture,
      sampleSize,
      usedAirlineFallback: usedFallback,
      confidence: sampleSize > 200 ? 'high' : sampleSize > 50 ? 'medium' : 'low',
      trend: trendRows
    });
  } catch (err) {
    console.error('[API /api/predict error]:', err);
    res.status(500).json({ error: 'Prediction failed.' });
  }
});

// Initialize database then start listening
db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✈ Fare Forecast server running on http://localhost:${PORT}`);
      console.log(`Database ready (${db.engine})`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
