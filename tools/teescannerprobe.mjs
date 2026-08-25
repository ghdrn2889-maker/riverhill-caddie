// 티스캐너 첫 접속 진단 — 로그인되나 · 리버힐이 잡히나 · 응답 모양이 우리가 짐작한 대로인가.
//  ★한 번 돌려보고 그 출력에 맞춰 파서를 굳힌다. 짐작으로 만든 파서를 그대로 라이브에 올리지 않는다.
//  ★토큰·비밀번호는 절대 찍지 않는다.
//  쓰기: node tools/teescannerprobe.mjs [YYYYMMDD]
import { loadEnv } from '../src/env.mjs';
loadEnv();
import * as ts from '../src/teescanner.mjs';
import * as kakao from '../src/kakaogolf.mjs';

const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const DATE = process.argv[2] || ymd(new Date(Date.now() + 86400000));   // 기본은 내일(배치표가 있는 날)

const keys = (o) => Object.keys(o || {}).join(', ');
const line = (s) => console.log(s);

line(`\n조회 날짜: ${DATE}\n`);

// ── 1. 로그인 ──
line('── 1. 로그인 ──');
if (!process.env.TEESCANNER_ID || !process.env.TEESCANNER_PW) {
  line('  X  .env에 TEESCANNER_ID·TEESCANNER_PW가 없습니다. 서버 .env에 직접 넣어주세요.');
  process.exit(1);
}
line(`  아이디: ${String(process.env.TEESCANNER_ID).slice(0, 2)}***   (비밀번호는 찍지 않습니다)`);
try {
  await ts.login();
  line('  ok  토큰 확보');
} catch (e) {
  line(`  X  ${e.message}`);
  process.exit(1);
}

// ── 2. 우리 골프장 ──
line('\n── 2. 안동리버힐 찾기 ──');
let club;
try {
  club = await ts.findClub();
  line(`  ok  ${club.name} · golfclub_seq=${club.golfclub_seq}`);
} catch (e) {
  line(`  X  ${e.message}`);
  line('  → 검색 응답 원문을 봅니다:');
  try {
    const j = await ts.raw('search/getSearchKeywordGolfClubAutoCompleteList', { keyword: '리버힐' });
    line('     ' + JSON.stringify(j).slice(0, 600));
  } catch (e2) { line(`     조회도 실패: ${e2.message}`); }
  process.exit(1);
}

// ── 3. 티오프 목록 원문 ──
line('\n── 3. 티오프 목록 원문(파서를 여기에 맞춘다) ──');
let raw;
try {
  raw = await ts.raw('booking/getTeeTimeListbyGolfclub', { golfclub_seq: club.golfclub_seq, roundDay: `${DATE.slice(0, 4)}-${DATE.slice(4, 6)}-${DATE.slice(6, 8)}` });
} catch (e) {
  line(`  X  ${e.message}`);
  process.exit(1);
}
line(`  바깥 껍데기 키: ${keys(raw)}`);
if (raw && raw.data && !Array.isArray(raw.data)) line(`  data 안의 키   : ${keys(raw.data)}`);
const rows = (() => {
  if (Array.isArray(raw)) return raw;
  const d = raw?.data ?? raw?.list;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') { const a = Object.values(d).filter(Array.isArray); return a.sort((x, y) => y.length - x.length)[0] || []; }
  return [];
})();
line(`  줄 개수: ${rows.length}`);
if (rows.length) {
  line(`  한 줄의 키: ${keys(rows[0])}`);
  line('  첫 세 줄:');
  for (const r of rows.slice(0, 3)) line('    ' + JSON.stringify(r).slice(0, 320));
} else {
  line('  (줄이 없습니다 — 그날 판매중인 칸이 없거나, 응답 모양이 다릅니다)');
  line('  원문 앞부분: ' + JSON.stringify(raw).slice(0, 500));
}

// ── 4. 우리 파서가 읽어내나 ──
line('\n── 4. 우리 파서 결과 ──');
let tee = [];
try {
  tee = await ts.fetchOpen(DATE);
  line(`  ok  ${tee.length}칸 해석`);
  line('  ' + tee.slice(0, 8).map((x) => `${x.time}|${x.course}`).join('  '));
} catch (e) {
  line(`  X  ${e.message}`);
}

// ── 5. 카카오와 대조 — 이게 이 작업의 진짜 목적이다 ──
line('\n── 5. 카카오와 대조 ──');
let kk = [];
try {
  kk = await kakao.fetchOpen(DATE);
  line(`  카카오 판매중 ${kk.length}칸 · 티스캐너 판매중 ${tee.length}칸`);
} catch (e) {
  line(`  카카오 조회 실패: ${e.message}`);
}
if (tee.length && kk.length) {
  const K = new Set(kk.map((x) => `${x.time}|${x.course}`));
  const T = new Set(tee.map((x) => `${x.time}|${x.course}`));
  const onlyTee = [...T].filter((k) => !K.has(k)).sort();
  const onlyKk = [...K].filter((k) => !T.has(k)).sort();
  line(`  양쪽 다: ${[...T].filter((k) => K.has(k)).length}칸`);
  line(`  ★티스캐너에만 (=카카오가 '찼다'고 잘못 볼 칸) ${onlyTee.length}칸: ${onlyTee.slice(0, 12).join(' ') || '없음'}`);
  line(`  카카오에만 ${onlyKk.length}칸: ${onlyKk.slice(0, 12).join(' ') || '없음'}`);
  if (!onlyTee.length && !onlyKk.length) line('  → 두 소스가 완전히 같습니다. 대조로는 새로 알아낼 게 없다는 뜻입니다.');
  else if (onlyTee.length) line('  → 여기가 값어치입니다. 이 칸들은 카카오 혼자서는 영영 못 가릅니다.');
}
line('');
