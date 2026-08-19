// 1·2부 '수정배치표' 자동 판독 잠금.
//
//  ★관리자 요청(2026-08-19): 전날 올라오는 본배치표에서 1·2부는 그대로 읽되, 그 뒤에 올라오는
//   수정·변동 배치표가 1·2부를 다시 읽어 덮는 것만 멈춘다. 그 과정이 계속 사고를 냈다 —
//   본배치표가 2부 명단 31명을 제대로 읽어놨는데 뒤이은 "2부 8팀 시간표입니다"가 8명으로 덮었다.
//
//  판정은 추측이 아니라 계수다 — 그 부에 '이 근무일의 판독본'이 이미 있으면 이번 글은 수정본이다.
//   · 판독본 없음 / 지난 근무일       → 아직 첫 판독이다. 읽는다.
//   · 근무일이 다르다(내일 본배치표)  → 새 날의 본배치표다. 읽는다.
//   · 같은 근무일에 이미 판독본이 있다 → 수정본이다. 3부만 읽고 1·2부는 그대로 둔다.
//
//  ★막는 것은 '자동 판독'뿐이다. 관리자 교정(board-correct)·대조판 반영은 이 문을 안 지나므로
//   손으로 고치는 길은 그대로 열려 있다. /api/simulate?minor=1(minorOverride)도 통과시킨다.
//  ★3부는 한 줄도 안 건드린다.
//
//  ★판정을 server.mjs 안에 두지 않은 이유: 서버를 띄우지 않고는 한 줄도 검증할 수 없기 때문이다.
//   여기 있는 frozenBy는 파일도 시계도 안 읽는 순수 함수라 표로 세워 확인할 수 있다.
import { loadBoardPartsStore } from './boardparts.mjs';

export const minorUpdateOn = (env = process.env) =>
  !['0', 'false', 'no', 'off'].includes(String(env.MINOR_PART_UPDATE ?? '1').toLowerCase());

// 순수 판정 — 파일도 시계도 안 본다.
//  pd: 저장소의 그 부 데이터(없으면 null) · newISO: 이번 배치표가 가리키는 근무일(모르면 '')
export function frozenBy({ part, pd, newISO = '', todayISO = '', on = true, override = false }) {
  if (String(part) === '3') return false;                    // 3부는 이 문을 안 지난다
  if (on || override) return false;                          // 잠금이 꺼져 있거나 관리자가 일부러 다시 읽힘
  const roster = (pd && Array.isArray(pd.roster) ? pd.roster : []).filter((x) => String(x || '').trim());
  if (!roster.length) return false;                          // 아직 첫 판독 전 → 읽어야 한다
  const iso = String((pd && pd._targetISO) || '');
  if (!iso) return false;                                    // 근무일 미상 저장본 → 첫 판독으로 본다
  if (todayISO && iso < todayISO) return false;              // 지난 근무일 → 낡음, 새로 읽어야 한다
  if (newISO && newISO !== iso) return false;                // 새 근무일의 본배치표
  return true;                                               // 같은 근무일 + 이미 판독본 = 수정본
}

const kstTodayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

// 저장소를 읽어 판정한다(서버가 부르는 얇은 껍데기).
export function minorReadFrozen(part, newISO = '', opts = {}, env = process.env) {
  let pd = null;
  try { pd = (loadBoardPartsStore()?.parts || {})[String(part)] || null; } catch { return false; }
  return frozenBy({ part, pd, newISO, todayISO: kstTodayISO(), on: minorUpdateOn(env), override: !!opts.minorOverride });
}

// 잠겨 있을 때 '무엇을 지켰는지' — 로그에 쓴다. 조용히 막으면 관리자가 낡은 화면을 최신으로 오해한다.
export function keptCount(part) {
  try { return ((loadBoardPartsStore()?.parts || {})[String(part)]?.roster || []).filter((x) => String(x || '').trim()).length; }
  catch { return 0; }
}
