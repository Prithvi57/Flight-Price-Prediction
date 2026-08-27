const path = require('path');
const fs = require('fs');

const AIRPORTS_DATA = [
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

const AIRLINES_DATA = ['IndiGo', 'Air India', 'Vistara', 'SpiceJet', 'Akasa Air'];
const TRAVEL_CLASSES = ['economy', 'premium_economy', 'business'];

function baseFare(a, b) {
  const idxA = AIRPORTS_DATA.findIndex(x => x[0] === a);
  const idxB = AIRPORTS_DATA.findIndex(x => x[0] === b);
  const distanceProxy = Math.abs(idxA - idxB) + 1;
  return 3200 + distanceProxy * 650;
}

function randn(mean, sd) {
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
  return { IndiGo: 0.95, 'Air India': 1.05, Vistara: 1.15, SpiceJet: 0.9, 'Akasa Air': 0.97 }[airline] || 1.0;
}

function daysBeforeMultiplier(days) {
  if (days <= 3) return 2.3;
  if (days <= 7) return 1.8;
  if (days <= 14) return 1.4;
  if (days <= 30) return 1.05;
  if (days <= 60) return 0.92;
  return 1.0;
}

function weekendMultiplier(dow) {
  return [1.1, 0.95, 0.93, 0.93, 0.95, 1.12, 1.15][dow] || 1.0;
}

function generateHistoricalDataset() {
  const rows = [];
  const today = new Date();

  for (const [origin] of AIRPORTS_DATA) {
    for (const [destination] of AIRPORTS_DATA) {
      if (origin === destination) continue;
      const base = baseFare(origin, destination);

      for (let d = 0; d < 180; d++) {
        const flightDate = new Date(today);
        flightDate.setDate(flightDate.getDate() - d + 60);
        const dow = flightDate.getDay();

        const samplesPerDay = 3;
        for (let s = 0; s < samplesPerDay; s++) {
          const daysBefore = Math.floor(Math.random() * 90);
          const airline = AIRLINES_DATA[Math.floor(Math.random() * AIRLINES_DATA.length)];
          const travelClass = TRAVEL_CLASSES[Math.floor(Math.random() * TRAVEL_CLASSES.length)];

          const price =
            base *
            daysBeforeMultiplier(daysBefore) *
            weekendMultiplier(dow) *
            classMultiplier(travelClass) *
            airlineMultiplier(airline);

          const noisy = Math.max(1500, randn(price, price * 0.08));

          rows.push({
            origin,
            destination,
            airline,
            travel_class: travelClass,
            flight_date: flightDate.toISOString().slice(0, 10),
            days_before_departure: daysBefore,
            price: Math.round(noisy * 100) / 100
          });
        }
      }
    }
  }
  return rows;
}

class DatabaseAdapter {
  constructor() {
    this.engine = 'sqlite';
    this.isReady = false;
    this.sqliteDb = null;
    this.pgPool = null;
    this.initPromise = null;
  }

  async init() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const usePostgres =
        process.env.DB_CLIENT === 'postgres' ||
        Boolean(process.env.DATABASE_URL) ||
        Boolean(process.env.PGDATABASE && process.env.PGUSER && process.env.PGPASSWORD);

      if (usePostgres) {
        try {
          const { Pool } = require('pg');
          this.pgPool = new Pool({
            connectionString: process.env.DATABASE_URL,
            host: process.env.PGHOST || 'localhost',
            port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
            database: process.env.PGDATABASE || 'flight_predictor',
            user: process.env.PGUSER || 'postgres',
            password: process.env.PGPASSWORD || 'postgres',
            connectionTimeoutMillis: 3000
          });
          // Test connection
          await this.pgPool.query('SELECT 1');
          this.engine = 'postgres';
          console.log('[DB] Connected to PostgreSQL');
          await this.initPostgresSchema();
          await this.seedIfEmpty();
          this.isReady = true;
          return;
        } catch (err) {
          console.warn('[DB] PostgreSQL connection failed. Falling back to embedded SQLite:', err.message);
          this.pgPool = null;
        }
      }

      // Fallback or default: SQLite
      this.engine = 'sqlite';
      const sqlite3 = require('sqlite3').verbose();
      const dbDir = path.join(__dirname);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      const dbPath = path.join(dbDir, 'flight_predictor.sqlite');
      console.log(`[DB] Using SQLite database at: ${dbPath}`);

      await new Promise((resolve, reject) => {
        this.sqliteDb = new sqlite3.Database(dbPath, err => {
          if (err) reject(err);
          else resolve();
        });
      });

      await this.initSqliteSchema();
      await this.seedIfEmpty();
      this.isReady = true;
    })();

    return this.initPromise;
  }

  async initSqliteSchema() {
    const run = sql =>
      new Promise((resolve, reject) => {
        this.sqliteDb.run(sql, err => (err ? reject(err) : resolve()));
      });

    await run(`CREATE TABLE IF NOT EXISTS airports (
      code TEXT PRIMARY KEY,
      city TEXT NOT NULL,
      name TEXT NOT NULL
    )`);

    await run(`CREATE TABLE IF NOT EXISTS flight_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      airline TEXT NOT NULL,
      travel_class TEXT NOT NULL,
      flight_date TEXT NOT NULL,
      days_before_departure INTEGER NOT NULL,
      price REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    await run(`CREATE INDEX IF NOT EXISTS idx_flight_prices_route_class
      ON flight_prices (origin, destination, travel_class)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_flight_prices_route_class_airline
      ON flight_prices (origin, destination, travel_class, airline)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_flight_prices_dow
      ON flight_prices (origin, destination, travel_class, flight_date)`);
  }

  async initPostgresSchema() {
    await this.pgPool.query(`
      CREATE TABLE IF NOT EXISTS airports (
        code CHAR(3) PRIMARY KEY,
        city TEXT NOT NULL,
        name TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS flight_prices (
        id BIGSERIAL PRIMARY KEY,
        origin CHAR(3) NOT NULL,
        destination CHAR(3) NOT NULL,
        airline TEXT NOT NULL,
        travel_class TEXT NOT NULL,
        flight_date DATE NOT NULL,
        days_before_departure INT NOT NULL,
        price NUMERIC(10, 2) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_flight_prices_route_class
        ON flight_prices (origin, destination, travel_class);
      CREATE INDEX IF NOT EXISTS idx_flight_prices_route_class_airline
        ON flight_prices (origin, destination, travel_class, airline);
      CREATE INDEX IF NOT EXISTS idx_flight_prices_dow
        ON flight_prices (origin, destination, travel_class, flight_date);
    `);
  }

  async seedIfEmpty() {
    const airportsCount = await this.getAirportsCount();
    const flightCount = await this.getFlightPricesCount();

    if (airportsCount === 0 || flightCount === 0) {
      console.log('[DB] Database is empty. Seeding initial flight data...');
      await this.seed();
      console.log('[DB] Seeding completed successfully.');
    } else {
      console.log(`[DB] Database ready with ${airportsCount} airports and ${flightCount.toLocaleString()} flight records.`);
    }
  }

  async getAirportsCount() {
    if (this.engine === 'postgres') {
      const { rows } = await this.pgPool.query('SELECT COUNT(*)::int AS count FROM airports');
      return rows[0]?.count || 0;
    } else {
      return new Promise((resolve, reject) => {
        this.sqliteDb.get('SELECT COUNT(*) AS count FROM airports', (err, row) => {
          if (err) reject(err);
          else resolve(row?.count || 0);
        });
      });
    }
  }

  async getFlightPricesCount() {
    if (this.engine === 'postgres') {
      const { rows } = await this.pgPool.query('SELECT COUNT(*)::int AS count FROM flight_prices');
      return rows[0]?.count || 0;
    } else {
      return new Promise((resolve, reject) => {
        this.sqliteDb.get('SELECT COUNT(*) AS count FROM flight_prices', (err, row) => {
          if (err) reject(err);
          else resolve(row?.count || 0);
        });
      });
    }
  }

  async seed() {
    // 1. Seed airports
    for (const [code, city, name] of AIRPORTS_DATA) {
      if (this.engine === 'postgres') {
        await this.pgPool.query(
          'INSERT INTO airports (code, city, name) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING',
          [code, city, name]
        );
      } else {
        await new Promise((resolve, reject) => {
          this.sqliteDb.run(
            'INSERT OR IGNORE INTO airports (code, city, name) VALUES (?, ?, ?)',
            [code, city, name],
            err => (err ? reject(err) : resolve())
          );
        });
      }
    }

    // 2. Generate and seed flight prices
    const rows = generateHistoricalDataset();
    console.log(`[DB] Inserting ${rows.length} flight records...`);

    const chunkSize = 1000;
    if (this.engine === 'postgres') {
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const values = [];
        const placeholders = chunk
          .map((row, idx) => {
            const base = idx * 7;
            values.push(
              row.origin,
              row.destination,
              row.airline,
              row.travel_class,
              row.flight_date,
              row.days_before_departure,
              row.price
            );
            return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`;
          })
          .join(',');

        await this.pgPool.query(
          `INSERT INTO flight_prices (origin, destination, airline, travel_class, flight_date, days_before_departure, price)
           VALUES ${placeholders}`,
          values
        );
      }
    } else {
      // SQLite batch insertion in transactions
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        await new Promise((resolve, reject) => {
          this.sqliteDb.serialize(() => {
            this.sqliteDb.run('BEGIN TRANSACTION');
            const stmt = this.sqliteDb.prepare(
              `INSERT INTO flight_prices (origin, destination, airline, travel_class, flight_date, days_before_departure, price)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            );
            for (const r of chunk) {
              stmt.run(
                r.origin,
                r.destination,
                r.airline,
                r.travel_class,
                r.flight_date,
                r.days_before_departure,
                r.price
              );
            }
            stmt.finalize();
            this.sqliteDb.run('COMMIT', err => (err ? reject(err) : resolve()));
          });
        });
      }
    }
  }

  async getAirports() {
    await this.init();
    if (this.engine === 'postgres') {
      const { rows } = await this.pgPool.query('SELECT code, city, name FROM airports ORDER BY city');
      return rows;
    } else {
      return new Promise((resolve, reject) => {
        this.sqliteDb.all('SELECT code, city, name FROM airports ORDER BY city', (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
    }
  }

  async getAirlines() {
    await this.init();
    if (this.engine === 'postgres') {
      const { rows } = await this.pgPool.query(
        'SELECT DISTINCT airline FROM flight_prices ORDER BY airline'
      );
      return rows.map(r => r.airline);
    } else {
      return new Promise((resolve, reject) => {
        this.sqliteDb.all(
          'SELECT DISTINCT airline FROM flight_prices ORDER BY airline',
          (err, rows) => {
            if (err) reject(err);
            else resolve((rows || []).map(r => r.airline));
          }
        );
      });
    }
  }

  async getRegressionStats(origin, destination, travelClass, airline = null) {
    await this.init();

    if (this.engine === 'postgres') {
      const query = `
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
      const { rows } = await this.pgPool.query(query, [origin, destination, travelClass, airline]);
      const stats = rows[0];
      if (!stats) return null;
      return {
        n: Number(stats.n) || 0,
        slope: Number(stats.slope) || 0,
        intercept: Number(stats.intercept) || Number(stats.avg_price) || 0,
        avg_price: Number(stats.avg_price) || 0,
        stddev_price: Number(stats.stddev_price) || (Number(stats.avg_price) * 0.1)
      };
    } else {
      const query = `
        SELECT
          COUNT(*) AS n,
          AVG(price) AS avg_price,
          SUM(days_before_departure) AS sum_x,
          SUM(price) AS sum_y,
          SUM(days_before_departure * days_before_departure) AS sum_xx,
          SUM(days_before_departure * price) AS sum_xy,
          SUM(price * price) AS sum_yy
        FROM flight_prices
        WHERE origin = ? AND destination = ? AND travel_class = ?
          AND (? IS NULL OR airline = ?)
      `;
      return new Promise((resolve, reject) => {
        this.sqliteDb.get(
          query,
          [origin, destination, travelClass, airline, airline],
          (err, row) => {
            if (err) return reject(err);
            if (!row || !row.n || row.n === 0) return resolve(null);

            const n = Number(row.n);
            const sumX = Number(row.sum_x) || 0;
            const sumY = Number(row.sum_y) || 0;
            const sumXX = Number(row.sum_xx) || 0;
            const sumXY = Number(row.sum_xy) || 0;
            const sumYY = Number(row.sum_yy) || 0;
            const avgPrice = Number(row.avg_price) || 0;

            const denom = n * sumXX - sumX * sumX;
            let slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
            let intercept = n > 0 ? (sumY - slope * sumX) / n : avgPrice;

            const variance = n > 1 ? Math.max(0, (sumYY - (sumY * sumY) / n) / (n - 1)) : 0;
            const stddev = Math.sqrt(variance) || avgPrice * 0.1;

            resolve({
              n,
              slope,
              intercept,
              avg_price: avgPrice,
              stddev_price: stddev
            });
          }
        );
      });
    }
  }

  async getDayOfWeekAvg(origin, destination, travelClass, dow) {
    await this.init();

    if (this.engine === 'postgres') {
      const query = `
        SELECT AVG(price) AS dow_avg
        FROM flight_prices
        WHERE origin = $1 AND destination = $2 AND travel_class = $3
          AND EXTRACT(DOW FROM flight_date) = $4
      `;
      const { rows } = await this.pgPool.query(query, [origin, destination, travelClass, dow]);
      return rows[0]?.dow_avg ? Number(rows[0].dow_avg) : null;
    } else {
      const query = `
        SELECT AVG(price) AS dow_avg
        FROM flight_prices
        WHERE origin = ? AND destination = ? AND travel_class = ?
          AND CAST(strftime('%w', flight_date) AS INTEGER) = ?
      `;
      return new Promise((resolve, reject) => {
        this.sqliteDb.get(query, [origin, destination, travelClass, dow], (err, row) => {
          if (err) reject(err);
          else resolve(row?.dow_avg ? Number(row.dow_avg) : null);
        });
      });
    }
  }

  async getTrendBuckets(origin, destination, travelClass) {
    await this.init();

    if (this.engine === 'postgres') {
      const query = `
        SELECT
          width_bucket(days_before_departure, 0, 90, 9) AS bucket,
          AVG(price)::int AS avg_price
        FROM flight_prices
        WHERE origin = $1 AND destination = $2 AND travel_class = $3
        GROUP BY bucket
        ORDER BY bucket
      `;
      const { rows } = await this.pgPool.query(query, [origin, destination, travelClass]);
      return rows.map(r => ({ bucket: Number(r.bucket), avgPrice: Number(r.avg_price) }));
    } else {
      const query = `
        SELECT
          MIN(9, MAX(1, CAST(days_before_departure / 10 AS INTEGER) + 1)) AS bucket,
          ROUND(AVG(price)) AS avg_price
        FROM flight_prices
        WHERE origin = ? AND destination = ? AND travel_class = ?
        GROUP BY bucket
        ORDER BY bucket
      `;
      return new Promise((resolve, reject) => {
        this.sqliteDb.all(query, [origin, destination, travelClass], (err, rows) => {
          if (err) reject(err);
          else resolve((rows || []).map(r => ({ bucket: Number(r.bucket), avgPrice: Number(r.avg_price) })));
        });
      });
    }
  }

  async getStatus() {
    await this.init();
    const airportsCount = await this.getAirportsCount();
    const flightCount = await this.getFlightPricesCount();

    return {
      status: 'connected',
      engine: this.engine,
      totalRecords: flightCount,
      airportsCount,
      airlinesCount: AIRLINES_DATA.length,
      timestamp: new Date().toISOString()
    };
  }
}

const db = new DatabaseAdapter();
module.exports = db;
