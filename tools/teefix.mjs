// 티오프 복구 — "근무권 안인데 티오프가 빈" 상황판을, 순번표(teeGrid)의 사실로 채운다.
//
//  왜 필요한가: 교정 재계산이 순번은 확정하면서 teeTime을 안 채우고 그 빈 값을 _adminLock으로
//  잠가버린 적이 있다(8/18 실사고 — 표에는 10번 18:03 OUT이 또렷이 있었다). 잠긴 빈 값은
//  자동 판독도 못 고치고, 앱은 티오프가 있어야 보드를 그리므로 대시보드가 세 줄로 쪼그라든다.
//  원인은 src/boardcorrect.mjs에서 막았지만, 이미 잠긴 기록은 사람이 한 번 풀어줘야 한다.
//
//  안전장치
//   · 순번표에 그 순번의 시각이 '있을 때만' 채운다 — 시간을 지어내지 않는다.
//   · 근무권(myPosition <= cutLine) 안일 때만. 스페어에 티오프를 붙이지 않는다.
//   · 이미 티오프가 있으면 건드리지 않는다. 잠금(_adminLock)은 형태 그대로 둔다
//     (배치표 잠금은 새 배치표가 오면 스스로 풀린다 — 값만 옳게 만들면 된다).
//   · 기본은 미리보기. 실제로 쓰려면 --save. 쓸 때는 파일마다 백업을 남긴다.
//
//  사용: node tools/teefix.mjs            (미리보기)
//        node tools/teefix.mjs --save     (복구)
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, userDataDir, appendJSONL } from '../src/store.mjs';

const SAVE = process.argv.includes('--save');
const WORKISH = ['work', 'assigned', 'your_turn'];
const HHMM = /\d{1,2}:\d{2}/;

const usersDir = path.join(DATA_DIR, 'users');
if (!fs.existsSync(usersDir)) { console.error('data/users 가 없습니다.'); process.exit(1); }

let found = 0, fixed = 0;
for (const uid of fs.readdirSync(usersDir).sort((a, b) => Number(a) - Number(b))) {
  // 3부(today.json)·2부·1부 슬롯 모두 본다 — 어느 부에서든 같은 사고가 날 수 있다.
  for (const file of ['today.json', 'today2.json', 'today1.json']) {
    const f = path.join(userDataDir(uid), file);
    if (!fs.existsSync(f)) continue;
    let t; try { t = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }

    const pos = Number(t.myPosition) || 0;
    const cut = Number(t.cutLine) || 0;
    if (!WORKISH.includes(String(t.status))) continue;
    if (HHMM.test(String(t.teeTime || ''))) continue;          // 이미 있음
    if (!pos) continue;
    if (cut && pos > cut) continue;                            // 근무권 밖 — 붙이지 않는다

    const g = (Array.isArray(t.teeGrid) ? t.teeGrid : []).find((x) => Number(x.pos) === pos);
    found++;
    const where = `회원 ${uid} · ${file} · ${t.date || '(날짜없음)'} · 순번 ${pos}${cut ? `/커트 ${cut}` : ''}`;
    if (!g || !HHMM.test(String(g.time || ''))) { console.log(`· 건너뜀  ${where} — 순번표에 그 순번의 시각이 없음`); continue; }

    const tee = String(g.time).match(HHMM)[0];
    const course = /IN/i.test(String(g.course || '')) ? 'IN' : 'OUT';
    console.log(`${SAVE ? '· 복구  ' : '· 복구예정'} ${where} → ${tee} ${course} (status ${t.status} → assigned)`);
    if (!SAVE) { fixed++; continue; }

    const bak = `${f}.bak-teefix-${Date.now()}`;
    fs.copyFileSync(f, bak);
    const from = { status: t.status, teeTime: t.teeTime || '', course: t.course || '' };
    t.teeTime = tee; t.course = course; t.status = 'assigned'; t.updatedAt = Date.now();
    // 저장은 원본과 같은 방식(임시파일 → rename)으로 원자적으로.
    const tmp = `${f}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(t));
    fs.renameSync(tmp, f);
    appendJSONL('admin-corrections.jsonl', {
      at: Date.now(), userId: Number(uid), name: t.name || '', date: t.date || '',
      boardArticleId: t.articleId || '', by: 'teefix',
      note: '교정 재계산이 순번표의 티오프를 안 채운 것을 복구(tools/teefix.mjs)',
      changes: [
        { field: 'teeTime', from: from.teeTime, to: t.teeTime },
        { field: 'course', from: from.course, to: t.course },
        { field: 'status', from: from.status, to: t.status },
      ],
    });
    fixed++;
    console.log(`  백업 ${path.basename(bak)}`);
  }
}
console.log(`\n대상 ${found}건 · ${SAVE ? '복구' : '복구예정'} ${fixed}건${SAVE ? '' : '  (실제로 고치려면 --save)'}`);
