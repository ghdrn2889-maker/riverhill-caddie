// 골프장 위치 날씨 — Open-Meteo(무료·API키 없음) 시간별 예보를 캐시해 제공.
//  근무는 골프장에서 하므로 '집'이 아니라 '코스 좌표' 기준. 좌표는 env로 조정 가능.
//  리버힐(경북 안동시 풍천면 풍일로 1572) 인근 기본 좌표 = 36.505, 128.537.
const LAT = Number(process.env.COURSE_LAT ?? 36.505);
const LON = Number(process.env.COURSE_LON ?? 128.537);
const TZ = process.env.COURSE_TZ || 'Asia/Seoul';
const TTL = Number(process.env.WEATHER_TTL_MIN ?? 30) * 60 * 1000; // 기본 30분 캐시(외부 호출 최소화)

let cache = { at: 0, data: null };

// 시간별 예보(오늘·내일). 반환: { updatedAt, lat, lon, hours:[{iso,date,hour,temp,pop,precip,wind,code,day}] }
export async function getHourly() {
  if (cache.data && Date.now() - cache.at < TTL) return cache.data;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}`
    + `&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,is_day`
    + `&timezone=${encodeURIComponent(TZ)}&forecast_days=2`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('weather ' + r.status);
  const j = await r.json();
  const H = j.hourly || {};
  const hours = (H.time || []).map((t, i) => ({
    iso: t,                                   // "2026-07-26T13:00"
    date: t.slice(0, 10),
    hour: Number(t.slice(11, 13)),
    temp: Math.round(H.temperature_2m?.[i] ?? 0),
    pop: Math.round(H.precipitation_probability?.[i] ?? 0),  // 강수확률 %
    precip: Number(H.precipitation?.[i] ?? 0),               // 강수량 mm
    wind: Math.round(H.wind_speed_10m?.[i] ?? 0),            // km/h
    code: Number(H.weather_code?.[i] ?? 0),                  // WMO 코드
    day: (H.is_day?.[i] ?? 1) === 1,
  }));
  cache = { at: Date.now(), data: { updatedAt: Date.now(), lat: LAT, lon: LON, hours } };
  return cache.data;
}

// 특정 날짜의 [startH, endH] 구간 시간별 예보. 너무 길면 균등 샘플(최대 max개).
export function windowFor(wx, date, startH, endH, max = 8) {
  const rows = (wx.hours || []).filter((h) => h.date === date && h.hour >= startH && h.hour <= endH);
  if (rows.length <= max) return rows;
  const step = Math.ceil(rows.length / max);
  const out = rows.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== rows[rows.length - 1]) out.push(rows[rows.length - 1]); // 끝 시각은 항상 포함
  return out;
}

// 구간 요약(우산 판단용). rows는 샘플 전 '전체' 구간을 넘기는 게 정확.
export function summarize(rows) {
  if (!rows || !rows.length) return { text: '예보 정보가 아직 없어요.', rain: false };
  const temps = rows.map((r) => r.temp);
  const hi = Math.max(...temps), lo = Math.min(...temps);
  const maxPop = Math.max(...rows.map((r) => r.pop));
  const maxWind = Math.max(...rows.map((r) => r.wind));
  const rainRow = rows.find((r) => r.pop >= 60 || r.precip >= 0.5);
  let text;
  if (rainRow) text = `${rainRow.hour}시경 비 예상 (강수확률 ${maxPop}%) — 우산 챙기세요 ☔`;
  else if (maxPop >= 30) text = `한때 비 가능성 ${maxPop}% · 기온 ${lo}~${hi}°`;
  else text = `대체로 맑음 · 기온 ${lo}~${hi}°`;
  if (maxWind >= 25) text += ` · 바람 강함(${maxWind}km/h)`;
  return { text, hi, lo, maxPop, maxWind, rain: !!rainRow };
}
