// DOM Elements
const originSelect = document.getElementById('origin');
const destinationSelect = document.getElementById('destination');
const airlineSelect = document.getElementById('airline');
const dateInput = document.getElementById('travel-date');
const classSelect = document.getElementById('travel-class');
const form = document.getElementById('predict-form');
const submitBtn = document.getElementById('submit-btn');
const formError = document.getElementById('form-error');
const swapBtn = document.getElementById('swap-btn');
const boardWrap = document.getElementById('board-wrap');
const emptyState = document.getElementById('empty-state');
const flapPriceEl = document.getElementById('flap-price');
const dbStatusBadge = document.getElementById('db-status-badge');
const dbStatusText = document.getElementById('db-status-text');
const dbRecordCount = document.getElementById('db-record-count');
const dbEngineBadge = document.getElementById('db-engine-badge');
const metricDatasetCount = document.getElementById('metric-dataset-count');
const metricAirportCount = document.getElementById('metric-airport-count');

let airportsByCode = {};
let lastRenderedDigits = [];

// Initialize default departure date (14 days from today)
(function setDefaultDate() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  dateInput.value = d.toISOString().slice(0, 10);
  dateInput.min = new Date().toISOString().slice(0, 10);
})();

// ---------------------------------------------------------------------------
// Database Health & Status Check
// ---------------------------------------------------------------------------
async function checkDatabaseStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error('Status endpoint returned ' + res.status);
    const data = await res.json();

    if (data.status === 'connected') {
      dbStatusBadge.className = 'db-status-badge connected';
      const engineLabel = data.engine === 'postgres' ? 'PostgreSQL' : 'SQLite Database';
      dbStatusText.textContent = `Connected (${engineLabel})`;
      dbRecordCount.style.display = 'inline-block';
      dbRecordCount.textContent = `${Number(data.totalRecords).toLocaleString('en-IN')} records`;

      if (dbEngineBadge) dbEngineBadge.textContent = `${engineLabel.toUpperCase()}`;
      if (metricDatasetCount) metricDatasetCount.textContent = `${Number(data.totalRecords).toLocaleString('en-IN')}`;
      if (metricAirportCount) metricAirportCount.textContent = `${data.airportsCount} Cities`;
    } else {
      throw new Error(data.error || 'Database unavailable');
    }
  } catch (err) {
    console.warn('[DB Status Check]:', err);
    dbStatusBadge.className = 'db-status-badge error';
    dbStatusText.textContent = 'Database Disconnected';
    dbRecordCount.style.display = 'none';
  }
}

// ---------------------------------------------------------------------------
// Load Airports from Database API
// ---------------------------------------------------------------------------
async function loadAirports() {
  try {
    const res = await fetch('/api/airports');
    if (!res.ok) throw new Error('Failed to load airports');
    const airports = await res.json();

    originSelect.innerHTML = '';
    destinationSelect.innerHTML = '';
    airportsByCode = {};

    airports.forEach(a => {
      airportsByCode[a.code] = a;

      const optOrig = document.createElement('option');
      optOrig.value = a.code;
      optOrig.textContent = `${a.city} (${a.code}) — ${a.name}`;
      originSelect.appendChild(optOrig);

      const optDest = document.createElement('option');
      optDest.value = a.code;
      optDest.textContent = `${a.city} (${a.code}) — ${a.name}`;
      destinationSelect.appendChild(optDest);
    });

    if (airports.length > 1) {
      originSelect.value = 'DEL';
      destinationSelect.value = 'BOM';
    }
  } catch (err) {
    console.error('Error loading airports:', err);
    formError.textContent = 'Unable to load airport list from database. Retrying…';
    setTimeout(loadAirports, 3000);
  }
}

// ---------------------------------------------------------------------------
// Load Airlines from Database API
// ---------------------------------------------------------------------------
async function loadAirlines() {
  try {
    const res = await fetch('/api/airlines');
    if (!res.ok) throw new Error('Failed to load airlines');
    const airlines = await res.json();

    airlineSelect.innerHTML = '<option value="">All Airlines (Market Average)</option>';
    airlines.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      airlineSelect.appendChild(opt);
    });
  } catch (err) {
    console.error('Error loading airlines:', err);
  }
}

// ---------------------------------------------------------------------------
// Swap Origin & Destination
// ---------------------------------------------------------------------------
swapBtn.addEventListener('click', () => {
  const temp = originSelect.value;
  originSelect.value = destinationSelect.value;
  destinationSelect.value = temp;
  swapBtn.style.transform = 'rotate(180deg)';
  setTimeout(() => {
    swapBtn.style.transform = '';
  }, 300);
});

// ---------------------------------------------------------------------------
// Quick Route Chips
// ---------------------------------------------------------------------------
document.querySelectorAll('.route-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const origin = chip.dataset.origin;
    const dest = chip.dataset.destination;
    if (origin && dest) {
      originSelect.value = origin;
      destinationSelect.value = dest;
      form.dispatchEvent(new Event('submit'));
    }
  });
});

// ---------------------------------------------------------------------------
// Mechanical Split-Flap Animation
// ---------------------------------------------------------------------------
function buildFlaps(text) {
  flapPriceEl.innerHTML = '';
  lastRenderedDigits = [];
  [...text].forEach(ch => {
    const span = document.createElement('span');
    span.className = ch === ',' ? 'flap separator' : 'flap';
    span.textContent = ch;
    flapPriceEl.appendChild(span);
    lastRenderedDigits.push(ch);
  });
}

function revealPrice(price) {
  const formatted = Math.round(price).toLocaleString('en-IN');
  const chars = [...formatted];

  if (lastRenderedDigits.length !== chars.length) {
    buildFlaps(' '.repeat(chars.length));
  }

  const flaps = flapPriceEl.querySelectorAll('.flap');
  chars.forEach((ch, i) => {
    const flap = flaps[i];
    const changed = lastRenderedDigits[i] !== ch;
    flap.className = ch === ',' ? 'flap separator' : 'flap';
    if (changed) {
      setTimeout(() => {
        flap.classList.add('flap-flipping');
        setTimeout(() => { flap.textContent = ch; }, 180);
        setTimeout(() => { flap.classList.remove('flap-flipping'); }, 420);
      }, i * 50);
    } else {
      flap.textContent = ch;
    }
  });
  lastRenderedDigits = chars;
}

// ---------------------------------------------------------------------------
// 90-Day Trend Chart SVG Renderer
// ---------------------------------------------------------------------------
function renderTrend(trend) {
  const svg = document.getElementById('trend-svg');
  svg.innerHTML = '';
  if (!trend || trend.length < 2) return;

  const w = 450, h = 90, pad = 12;
  const prices = trend.map(t => t.avgPrice);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  // Defs for gradient
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  grad.setAttribute('id', 'trend-gradient');
  grad.setAttribute('x1', '0');
  grad.setAttribute('y1', '0');
  grad.setAttribute('x2', '0');
  grad.setAttribute('y2', '1');

  const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  stop1.setAttribute('offset', '0%');
  stop1.setAttribute('stop-color', '#38bdf8');
  stop1.setAttribute('stop-opacity', '0.6');

  const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  stop2.setAttribute('offset', '100%');
  stop2.setAttribute('stop-color', '#38bdf8');
  stop2.setAttribute('stop-opacity', '0.0');

  grad.appendChild(stop1);
  grad.appendChild(stop2);
  defs.appendChild(grad);
  svg.appendChild(defs);

  // Horizontal Grid Lines
  for (let i = 1; i <= 3; i++) {
    const yGrid = pad + (i / 4) * (h - pad * 2);
    const gridLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    gridLine.setAttribute('x1', '0');
    gridLine.setAttribute('x2', w.toString());
    gridLine.setAttribute('y1', yGrid.toString());
    gridLine.setAttribute('y2', yGrid.toString());
    gridLine.setAttribute('class', 'grid-line');
    svg.appendChild(gridLine);
  }

  // Calculate points
  const points = trend.map((t, i) => {
    const x = pad + (i / (trend.length - 1)) * (w - pad * 2);
    const y = h - pad - ((t.avgPrice - min) / range) * (h - pad * 2);
    return [x, y, t.avgPrice];
  });

  const linePath = points.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  const fillPath = `${linePath} L${points[points.length - 1][0]},${h} L${points[0][0]},${h} Z`;

  const fillEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  fillEl.setAttribute('d', fillPath);
  fillEl.setAttribute('class', 'fill');
  svg.appendChild(fillEl);

  const lineEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  lineEl.setAttribute('d', linePath);
  lineEl.setAttribute('class', 'line');
  svg.appendChild(lineEl);

  // Circles on points with title tooltips
  points.forEach(p => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', p[0].toString());
    circle.setAttribute('cy', p[1].toString());
    circle.setAttribute('class', 'point');
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `₹${p[2].toLocaleString('en-IN')}`;
    circle.appendChild(title);
    svg.appendChild(circle);
  });
}

function setConfidenceTag(level) {
  const el = document.getElementById('board-confidence');
  el.textContent = `${level.toUpperCase()} CONFIDENCE`;
  el.className = `board-tag confidence-${level}`;
}

// ---------------------------------------------------------------------------
// Form Submission & Fare Prediction Request
// ---------------------------------------------------------------------------
form.addEventListener('submit', async e => {
  e.preventDefault();
  formError.textContent = '';

  const origin = originSelect.value;
  const destination = destinationSelect.value;
  if (!origin || !destination) {
    formError.textContent = 'Please select origin and destination airports.';
    return;
  }
  if (origin === destination) {
    formError.textContent = 'Origin and destination must be different cities.';
    return;
  }

  submitBtn.disabled = true;
  submitBtn.querySelector('.btn-text').textContent = 'Querying Historical Data…';

  try {
    const res = await fetch('/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin,
        destination,
        travelDate: dateInput.value,
        travelClass: classSelect.value,
        airline: airlineSelect.value || null
      })
    });

    const data = await res.json();
    if (!res.ok) {
      formError.textContent = data.error || 'Prediction failed.';
      return;
    }

    emptyState.hidden = true;
    boardWrap.hidden = false;

    const originCity = airportsByCode[origin]?.city || origin;
    const destCity = airportsByCode[destination]?.city || destination;
    document.getElementById('board-route').textContent = `${originCity} (${origin}) → ${destCity} (${destination})`;
    document.getElementById('board-date').textContent = new Date(dateInput.value).toLocaleDateString('en-IN', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
    setConfidenceTag(data.confidence);

    revealPrice(data.predictedPrice);

    document.getElementById('board-range').textContent =
      `₹${data.priceRangeLow.toLocaleString('en-IN')} – ₹${data.priceRangeHigh.toLocaleString('en-IN')}`;
    
    document.getElementById('board-sample').textContent =
      `Based on ${data.sampleSize.toLocaleString('en-IN')} historical database flights${data.usedAirlineFallback ? ' (multi-airline model)' : ''}`;
    
    document.getElementById('board-lead').textContent =
      `${data.daysBeforeDeparture} day${data.daysBeforeDeparture === 1 ? '' : 's'} before departure`;

    renderTrend(data.trend);

    // Smooth scroll to board on mobile
    boardWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  } catch (err) {
    console.error('Prediction request error:', err);
    formError.textContent = 'Could not communicate with prediction server.';
  } finally {
    submitBtn.disabled = false;
    submitBtn.querySelector('.btn-text').textContent = 'Predict Flight Fare';
  }
});

// Initial boot sequence
checkDatabaseStatus();
loadAirports();
loadAirlines();
setInterval(checkDatabaseStatus, 30000); // Polling health every 30s
