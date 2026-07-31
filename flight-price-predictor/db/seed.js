// Generates a plausible historical dataset so the prediction endpoint has
// something real to aggregate over. Run with: npm run seed
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool();

const airports = [
  ['DEL', 'Delhi', 'Indira Gandhi International Airport'],
  ['BOM', 'Mumbai', 'Chhatrapati Shivaji Maharaj International Airport'],
  ['BLR', 'Bengaluru', 'Kempegowda International Airport'],
  ['MAA', 'Chennai', 'Chennai International Airport'],
  ['CCU', 'Kolkata', 'Netaji Subhas Chandra Bose International Airport'],
  ['HYD', 'Hyderabad', 'Rajiv Gandhi International Airport'],
  ['GOI', 'Goa', 'Manohar International Airport'],
  ['PNQ', 'Pune', 'Pune Airport'],
  ['JAI', 'Jaipur', 'Jaipur International Airport'],
  ['NAG', 'Nagpur', 'Dr. Babasaheb Ambedkar International Airport']
];

const airlines = ['IndiGo', 'Air India', 'Vistara', 'SpiceJet', 'Akasa Air'];
const travelClasses = ['economy', 'premium_economy', 'business'];

// Base fare (₹) per unordered route pair — rough distance proxy.
function baseFare(a, b) {
  const idxA = airports.findIndex(x => x[0] === a);
  const idxB = airports.findIndex(x => x[0] === b);
  const distanceProxy = Math.abs(idxA - idxB) + 1;
  return 3200 + distanceProxy * 650;
}

function randn(mean, sd) {
  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + sd * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function classMultiplier(cls) {
  if (cls === 'business') return 3.4;
  if (cls === 'premium_economy') return 1.7;
  return 1.0;
}

function airlineMultiplier(airline) {
  return { IndiGo: 0.95, 'Air India': 1.05, Vistara: 1.15, SpiceJet: 0.9, 'Akasa Air': 0.97 }[airline];
}

// Last-minute prices rise sharply inside ~14 days, and there's a small dip
// around 45-60 days out, mirroring real fare curves.
function daysBeforeMultiplier(days) {
  if (days <= 3) return 2.3;
  if (days <= 7) return 1.8;
  if (days <= 14) return 1.4;
  if (days <= 30) return 1.05;
  if (days <= 60) return 0.92;
  return 1.0;
}

function weekendMultiplier(dow) {
  // Fri (5), Sat (6), Sun (0) travel is pricier
  return [1.1, 0.95, 0.93, 0.93, 0.95, 1.12, 1.15][dow];
}

async function seed() {
  console.log('Seeding airports...');
  for (const [code, city, name] of airports) {
    await pool.query(
      'INSERT INTO airports (code, city, name) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING',
      [code, city, name]
    );
  }

  console.log('Generating historical flight prices (this may take a moment)...');
  const rows = [];
  const today = new Date();

  for (const [origin] of airports) {
    for (const [destination] of airports) {
      if (origin === destination) continue;
      const base = baseFare(origin, destination);

      // ~180 days of history, a handful of samples per day per route
      for (let d = 0; d < 180; d++) {
        const flightDate = new Date(today);
        flightDate.setDate(flightDate.getDate() - d + 60); // spans past and near future
        const dow = flightDate.getDay();

        const samplesPerDay = 3;
        for (let s = 0; s < samplesPerDay; s++) {
          const daysBefore = Math.floor(Math.random() * 90);
          const airline = airlines[Math.floor(Math.random() * airlines.length)];
          const travelClass = travelClasses[Math.floor(Math.random() * travelClasses.length)];

          const price =
            base *
            daysBeforeMultiplier(daysBefore) *
            weekendMultiplier(dow) *
            classMultiplier(travelClass) *
            airlineMultiplier(airline);

          const noisy = Math.max(1500, randn(price, price * 0.08));

          rows.push([
            origin,
            destination,
            airline,
            travelClass,
            flightDate.toISOString().slice(0, 10),
            daysBefore,
            Math.round(noisy * 100) / 100
          ]);
        }
      }
    }
  }

  console.log(`Inserting ${rows.length} rows...`);
  const chunkSize = 1000;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = [];
    const placeholders = chunk
      .map((row, idx) => {
        const base = idx * 7;
        values.push(...row);
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`;
      })
      .join(',');

    await pool.query(
      `INSERT INTO flight_prices
        (origin, destination, airline, travel_class, flight_date, days_before_departure, price)
       VALUES ${placeholders}`,
      values
    );
    process.stdout.write(`  ${Math.min(i + chunkSize, rows.length)}/${rows.length}\r`);
  }

  console.log('\nDone seeding.');
  await pool.end();
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
