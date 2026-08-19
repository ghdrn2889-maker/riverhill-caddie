// 알림 문구 카탈로그 — 규칙이 '적혀만' 있는지, 실제로 지켜지는지 본다.
//  ★규칙을 주석으로 두면 다음 사람이 어긴다. 그래서 검사로 못 박는다.
import { KINDS, compose, contextOf, kindFromState, partLabel } from '../src/notifytext.mjs';

let bad = 0;
const check = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '  OK ' : '  X  '} ${name}${detail ? '   ' + detail : ''}`); };

const T = {
  work: contextOf('2', '조하빈', { date: '2026년 8월 20일 목요일', myPosition: 9, teeTime: '12:53', course: 'OUT', cutLine: 16, status: 'assigned' }),
  tee: contextOf('3', '연승준', { date: '2026년 8월 20일 목요일', myPosition: 9, teeTime: '17:07', course: 'OUT', cutLine: 20, status: 'assigned' }),
  spare: contextOf('3', '박시윤', { date: '2026년 8월 20일 목요일', myPosition: 23, teeTime: '', course: '', cutLine: 20, status: 'spare' }),
  off: contextOf('3', '최재영', { date: '2026년 8월 20일 목요일', status: 'off' }),
  one: contextOf('1', '김홍구', { date: '2026년 8월 20일 목요일', myPosition: 5, teeTime: '07:12', course: 'OUT', cutLine: 15, status: 'assigned' }),
  bare: contextOf('3', '아무개', {}),
};

// ── 규칙 검사 — 모든 종류 × 모든 상황 ──
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
for (const k of KINDS.map((x) => x.key)) {
  for (const [nm, ctx] of Object.entries(T)) {
    const { title, body } = compose(k, ctx);
    if (k === 'free') { check(`자유 문구는 비워 둔다(${nm})`, title === '' && body === ''); continue; }
    const at = `${k}/${nm}`;
    check(`이모지 없음 ${at}`, !EMOJI.test(title + body), title);
    check(`느낌표 없음 ${at}`, !/[!！]/.test(title + body), title + ' / ' + body);
    check(`제목이 부로 시작 ${at}`, title.startsWith(partLabel(ctx.part)), title);
    check(`본문은 서술형으로 끝난다 ${at}`, /(입니다|습니다|됩니다)\.$/.test(body), body);
    check(`연도를 안 쓴다 ${at}`, !/\d{4}\s*년/.test(body), body);
  }
}

// ── 실제 문구가 말이 되는가 ──
check('근무 배정', compose('work', T.work).body === '8월 20일 목요일 2부 9번 · 12:53 OUT 입니다. 커트 16번까지 근무입니다.', compose('work', T.work).body);
check('티오프 변경', compose('tee', T.tee).body === '8월 20일 목요일 3부 9번 · 17:07 OUT으로 바뀌었습니다.', compose('tee', T.tee).body);
check('스페어 — 티오프가 없어도 말이 된다', compose('spare', T.spare).body === '8월 20일 목요일 3부 23번 · 대기입니다. 커트 20번까지라 오늘은 스페어입니다.', compose('spare', T.spare).body);
check('휴무', compose('off', T.off).body === '8월 20일 목요일 3부 휴무로 확인됩니다.', compose('off', T.off).body);
check('1부는 조출을 붙여 부른다', compose('work', T.one).title === '1부(조출) 근무 배정', compose('work', T.one).title);

// ── 티오프가 '무엇에서' 바뀌었는지 아는 날 ──
{
  const c = contextOf('3', '연승준', { date: '2026년 8월 20일 목요일', myPosition: 9, teeTime: '17:07', course: 'OUT', status: 'assigned' }, { teeFrom: '17:14' });
  const b = compose('tee', c);
  check('전 → 후를 말한다', b.body === '8월 20일 목요일 3부 티오프가 17:14 → 17:07 OUT(으)로 바뀌었습니다.', b.body);
  check('그래도 규칙을 지킨다', /(입니다|습니다|됩니다)\.$/.test(b.body) && !/[!！]/.test(b.title + b.body));
  check('앞 시각을 모르면 예전처럼 말한다', compose('tee', T.tee).body === '8월 20일 목요일 3부 9번 · 17:07 OUT으로 바뀌었습니다.', compose('tee', T.tee).body);
}

// ── 아는 게 없을 때 지어내지 않는가 ──
{
  const b = compose('work', T.bare);
  check('재료가 없으면 순번·시각을 지어내지 않는다', !/\d+번|\d{1,2}:\d{2}/.test(b.body), b.body);
  check('그래도 문장은 성립한다', /(입니다|습니다|됩니다)\.$/.test(b.body), b.body);
}

// ── '지금 상태 그대로'가 상태를 제대로 읽는가 ──
check('assigned + 티오프 → 근무 배정', kindFromState(T.work) === 'work');
check('spare → 스페어 전환', kindFromState(T.spare) === 'spare');
check('off → 휴무', kindFromState(T.off) === 'off');
check('티오프 없는 근무는 배치표 수정으로', kindFromState(contextOf('3', 'x', { status: 'assigned' })) === 'board');
check('모르는 상태는 배치표 수정으로', kindFromState(T.bare) === 'board');
check("'지금 상태 그대로'는 그 종류와 같은 말을 한다", compose('state', T.spare).title === compose('spare', T.spare).title);

// ── 없는 종류를 넣어도 깨지지 않는가 ──
check('모르는 종류는 상태로 떨어진다', compose('없는종류', T.off).title === compose('off', T.off).title);

console.log(bad ? `\n${bad}건 실패` : '\n전부 통과');
process.exit(bad ? 1 : 0);
