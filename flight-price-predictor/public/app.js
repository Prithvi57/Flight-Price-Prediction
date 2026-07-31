const originSelect = document.getElementById('origin');
const destinationSelect = document.getElementById('destination');
const airlineSelect = document.getElementById('airline');
const dateInput = document.getElementById('travel-date');
const classSelect = document.getElementById('travel-class');
const form = document.getElementById('predict-form');
const formError = document.getElementById('form-error');
const boardWrap = document.getElementById('board-wrap');
const emptyState = document.getElementById('empty-state');
const flapPriceEl = document.getElementById('flap-price');

let airportsByCode = {};
let lastRenderedDigits = [];

// Default the date picker to two weeks out.
(function setDefaultDate() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  dateInput.value = d.toISOString().slice(0, 10);
  dateInput.min = new Date().toISOString().slice(0, 10);
})();

async function loadAirports() {
  const res = await fetch('/api/airports');
  const airports = await res.json();
  airports.forEach(a => (airportsByCode[a.code] = a));

  [originSelect, destinationSelect].forEach(select => {
    airports.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.code;
      opt.textContent = `${a.city} (${a.code})`;
      select.appendChild(opt);
    });
  });

  if (airports.length > 1) {
    originSelect.value = airports[0].code;
    destinationSelect.value = airports[1].code;
  }
}

async function loadAirlines() {
  const res = await fetch('/api/airlines');
  const airlines = await res.json();
  airlines.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    airlineSelect.appendChild(opt);
  });
}

function buildFlaps(text) {
  // (Re)builds the flap slots to match the string length, reusing existing
  // slots where possible so unchanged digits don't re-flip.
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
        setTimeout(() => { flap.textContent = ch; }, 190);
        setTimeout(() => { flap.classList.remove('flap-flipping'); }, 420);
      }, i * 45);
    } else {
      flap.textContent = ch;
    }
  });
  lastRenderedDigits = chars;
}

function renderTrend(trend) {
  const svg = document.getElementById('trend-svg');
  svg.innerHTML = '';
  if (!trend || trend.length < 2) return;

  const w = 300, h = 60, pad = 4;
  const prices = trend.map(t => t.avgPrice);
  const min = Math.min(...prices), max = Math.max(...prices);
  const range = max - min || 1;

  const points = trend.map((t, i) => {
    const x = pad + (i / (trend.length - 1)) * (w - pad * 2);
    const y = h - pad - ((t.avgPrice - min) / range) * (h - pad * 2);
    return [x, y];
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
}

function setConfidenceTag(level) {
  const el = document.getElementById('board-confidence');
  el.textContent = level.toUpperCase() + ' CONFIDENCE';
  el.className = 'board-tag confidence-' + level;
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  formError.textContent = '';

  const origin = originSelect.value;
  const destination = destinationSelect.value;
  if (origin === destination) {
    formError.textContent = 'Origin and destination must be different.';
    return;
  }

  const submitBtn = form.querySelector('.predict-btn');
  submitBtn.disabled = true;
  submitBtn.querySelector('span').textContent = 'Checking the board…';

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
      formError.textContent = data.error || 'Something went wrong.';
      return;
    }

    emptyState.hidden = true;
    boardWrap.hidden = false;

    const originCity = airportsByCode[origin]?.city || origin;
    const destCity = airportsByCode[destination]?.city || destination;
    document.getElementById('board-route').textContent = `${originCity} → ${destCity}`;
    document.getElementById('board-date').textContent = new Date(dateInput.value).toDateString();
    setConfidenceTag(data.confidence);

    revealPrice(data.predictedPrice);

    document.getElementById('board-range').textContent =
      `₹${data.priceRangeLow.toLocaleString('en-IN')} – ₹${data.priceRangeHigh.toLocaleString('en-IN')}`;
    document.getElementById('board-sample').textContent =
      `Based on ${data.sampleSize.toLocaleString('en-IN')} historical fares${data.usedAirlineFallback ? ' (all airlines — too few for that one alone)' : ''}`;
    document.getElementById('board-lead').textContent =
      `${data.daysBeforeDeparture} day${data.daysBeforeDeparture === 1 ? '' : 's'} before departure`;

    renderTrend(data.trend);
  } catch (err) {
    console.error(err);
    formError.textContent = 'Could not reach the server.';
  } finally {
    submitBtn.disabled = false;
    submitBtn.querySelector('span').textContent = 'Predict fare';
  }
});

loadAirports();
loadAirlines();
