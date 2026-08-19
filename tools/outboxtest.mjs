// 발송 대기함 — 보내기 전 단계가 실제로 지켜지는지. 특히 '고른 사람만' 덮는지.
//  ★알림은 거둘 수 없다. 그러니 '누구에게 갈지'를 정하는 규칙은 눈으로 보지 말고 검사로 못 박는다.
import { stage, peek, editItem, bulkEdit, drop, merge } from '../src/outbox.mjs';

let bad = 0;
const check = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '  OK ' : '  X  '} ${name}${detail ? '   ' + detail : ''}`); };
const mk = () => stage({
  kind: '검사', part: '3',
  items: [
    { id: 101, name: '가', title: '3부 근무 배정', body: '가 본문', meta: { part: '3' } },
    { id: 102, name: '나', title: '3부 스페어 전환', body: '나 본문', meta: { part: '3' } },
    { id: 103, name: '다', title: '3부 휴무', body: '다 본문', meta: { part: '2' } },
  ],
});
const byId = (t) => Object.fromEntries(peek(t).items.map((x) => [x.id, x]));

// ── 1. 기본 ──
{
  const t = mk();
  const v = peek(t);
  check('초안이 선다', !!t && v.items.length === 3);
  check('기본은 전원 선택', v.items.every((x) => x.pick));
  check('부는 회원마다 따로 기억한다', byId(t)[103].part === '2', byId(t)[103].part);
  check('없는 토큰은 아무것도 안 준다', peek('ob_없음') === null);
  drop(t);
  check('버리면 사라진다', peek(t) === null);
}

// ── 2. 한 명만 고치기 ──
{
  const t = mk();
  editItem(t, 102, { body: '나만 고친 본문' });
  const m = byId(t);
  check('고친 사람만 바뀐다', m[102].body === '나만 고친 본문' && m[101].body === '가 본문');
  check('고친 표시가 붙는다', m[102].edited === true && m[101].edited === false);
  drop(t);
}

// ── 3. ★함께 쓰기 — 고른 사람만 덮는다 ──
{
  const t = mk();
  editItem(t, 103, { pick: false });                    // 다는 뺀다
  const r = bulkEdit(t, { title: '공통 제목', body: '공통 본문' });
  const m = byId(t);
  check('체크된 사람 수만큼만 덮는다', r.changed === 2, `${r.changed}명`);
  check('가·나는 같은 문구가 된다', m[101].title === '공통 제목' && m[102].title === '공통 제목' && m[101].body === m[102].body);
  check('★뺀 사람은 글자도 안 받는다', m[103].title === '3부 휴무' && m[103].body === '다 본문', m[103].title);
  check('뺀 사람은 여전히 빠져 있다', m[103].pick === false);
  check('손으로 쓴 문구는 자유 문구로 표시된다', m[101].kind === 'free' && m[102].kind === 'free');
  drop(t);
}

// ── 4. 함께 쓴 뒤에도 한 명씩 다시 고칠 수 있다 ──
{
  const t = mk();
  bulkEdit(t, { title: '공통', body: '공통' });
  editItem(t, 101, { body: '가만 다시' });
  const m = byId(t);
  check('덮은 뒤 한 명만 다시 고쳐진다', m[101].body === '가만 다시' && m[102].body === '공통');
  drop(t);
}

// ── 5. 대상을 직접 지정하면 그 사람들만 ──
{
  const t = mk();
  const r = bulkEdit(t, { ids: [103], title: '다만', body: '다만 본문' });
  const m = byId(t);
  check('지정한 사람만 덮는다', r.changed === 1 && m[103].title === '다만' && m[101].title === '3부 근무 배정');
  drop(t);
}

// ── 6. 아무도 안 골랐으면 아무 일도 안 일어난다 ──
{
  const t = mk();
  for (const id of [101, 102, 103]) editItem(t, id, { pick: false });
  const r = bulkEdit(t, { title: 'x', body: 'y' });
  check('전원 해제 상태에선 덮지 않는다', r.changed === 0, `${r.changed}명`);
  check('글자도 그대로', byId(t)[101].title === '3부 근무 배정');
  drop(t);
}

// ── 7. 없는 토큰 ──
check('없는 토큰에 함께 쓰기는 실패한다', bulkEdit('ob_없음', { title: 'a', body: 'b' }) === null);

// ── 8. 합치기 — 한 사람이 두 장에 걸리면 나중 것이 이긴다 ──
{
  const a = stage({ kind: 'A', part: '1', items: [{ id: 201, name: '가', title: 'A제목', body: 'A' }] });
  const b = stage({ kind: 'B', part: '2', items: [{ id: 201, name: '가', title: 'B제목', body: 'B' }, { id: 202, name: '나', title: 'B2', body: 'B2' }] });
  const t = merge([a, b]);
  const v = peek(t);
  check('두 장이 한 장이 된다', v.items.length === 2, `${v.items.length}명`);
  check('겹치면 나중 것이 이긴다', v.items.find((x) => x.id === 201).title === 'B제목');
  check('합친 뒤 원본은 사라진다', peek(a) === null && peek(b) === null);
  check('부를 둘 다 적는다', v.part === '1·2', v.part);
  drop(t);
}

console.log(bad ? `\n${bad}건 실패` : '\n전부 통과');
process.exit(bad ? 1 : 0);
