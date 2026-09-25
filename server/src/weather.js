const CACHE_TTL = 10 * 60 * 1000;
const cache = new Map();

export async function getWeatherAt(lat, lng) {
  const key = `${lat.toFixed(1)},${lng.toFixed(1)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lng.toFixed(2)}&current=wind_speed_10m,wind_gusts_10m,precipitation,weather_code&timezone=auto`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return defaultWeather();
    const json = await resp.json();
    const current = json.current || {};
    const data = {
      windSpeed: current.wind_speed_10m || 0,
      windGusts: current.wind_gusts_10m || 0,
      precipitation: current.precipitation || 0,
      weatherCode: current.weather_code || 0,
      adverse: isAdverse(current),
      description: describeWeather(current.weather_code || 0),
    };
    cache.set(key, { ts: Date.now(), data });
    return data;
  } catch {
    return defaultWeather();
  }
}

function isAdverse(current) {
  const ws = current.wind_speed_10m || 0;
  const wg = current.wind_gusts_10m || 0;
  const precip = current.precipitation || 0;
  const code = current.weather_code || 0;
  if (ws > 40 || wg > 60 || precip > 5) return true;
  if (code >= 63 && code <= 67) return true;
  if (code >= 73 && code <= 77) return true;
  if (code >= 95) return true;
  return false;
}

function describeWeather(code) {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Unknown';
}

function defaultWeather() {
  return {
    windSpeed: 10,
    windGusts: 15,
    precipitation: 0,
    weatherCode: 0,
    adverse: false,
    description: 'Clear',
  };
}

export async function batchWeatherUpdate(ships) {
  const results = new Map();
  const promises = ships.map(async (ship) => {
    const w = await getWeatherAt(ship.position[0], ship.position[1]);
    results.set(ship.shipId, w);
  });
  await Promise.allSettled(promises);
  return results;
}
