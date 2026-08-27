// Generates a plausible historical dataset so the prediction endpoint has
// something real to aggregate over. Run with: npm run seed
require('dotenv').config();
const db = require('./index');

async function main() {
  console.log('--- Seeding Flight Price Predictor Database ---');
  await db.init();
  console.log(`Database engine: ${db.engine}`);
  console.log('Seeding airports and historical fares...');
  await db.seed();
  const status = await db.getStatus();
  console.log('Done seeding!');
  console.log(`Total airports: ${status.airportsCount}`);
  console.log(`Total flight fare records: ${status.totalRecords.toLocaleString()}`);
  process.exit(0);
}

main().catch(err => {
  console.error('Seeding error:', err);
  process.exit(1);
});
