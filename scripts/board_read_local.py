#!/usr/bin/env python3
# 로컬 VLM 배치표 판독(타일링+픽셀분석) — 홈서버 GPU ollama(qwen2.5vl). ★API 비용 0.
#  배치표 = 세로로 긴 2단 명단(순번1~20 | 21~40) + 우측 티오프표(OUT|시간|IN). 폭이 좁아 통이미지는 truncate.
#  전략:
#   1) 명단: 좌/우 열 크롭 + 4배 업스케일 + 타일당 N회 표결 → 인쇄된 순번으로 병합.  (VLM)
#   2) 근무/스페어(커트라인): 각 순번 셀 배경색 픽셀분석(흰=근무, 회색=스페어, 초록=근무배정). (결정론적, 공짜)
#   3) 티오프표: 우측 그리드 크롭 → 순번↔시각·OUT/IN. (VLM)
#  입력(stdin JSON): {"image":"<url|dataURI|base64>", "reads":3}
#  출력(stdout JSON): {roster[], assign{}, status{순번:work|spare}, cutPos, teeGrid[{n,time,course}], interns[], source}
import sys, io, json, base64, urllib.request, re

OLLAMA = "http://localhost:11434/api/generate"
MODEL = "qwen2.5vl:7b"
NAME_PROMPT = ("이 이미지는 골프 배치표의 한 열이다. 각 줄은 [순번숫자][이름] 형식이다. "
    "★이름에 괄호가 붙어 있으면 반드시 '이름(점유자)' 원문 그대로 포함하라(예: 신지현(오동현)). 괄호를 빠뜨리지 마라. "
    "이름 옆 (54) 같은 근무배정 숫자는 그대로 둬라. 빈 이름줄은 건너뛴다. 글자를 추측 말고 보이는 대로. "
    'JSON만: {"rows":[{"n":순번, "name":"이름"}]}')
TEE_PROMPT = ("이 이미지는 골프 티오프표의 한 쪽 열이다. 각 행은 [팀순번 숫자]와 [시간 HH:MM]이 짝지어 있다. "
    "순번 숫자가 있는 행만 뽑아라(빈칸·색만 있는 칸 제외). 시간은 HH:MM. "
    'JSON만: {"rows":[{"n":팀순번, "time":"HH:MM"}]}')


def load_image(src):
    from PIL import Image
    if src.startswith("data:"):
        raw = base64.b64decode(src.split(",", 1)[1])
    elif re.match(r"^https?:", src):
        raw = urllib.request.urlopen(src, timeout=20).read()
    else:
        raw = base64.b64decode(src)
    return Image.open(io.BytesIO(raw)).convert("RGB")


import time as _time


def ask(img, prompt, key):
    buf = io.BytesIO(); img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    body = json.dumps({"model": MODEL, "prompt": prompt, "images": [b64], "stream": False,
        "format": "json", "keep_alive": "10m", "options": {"temperature": 0, "num_ctx": 8192}}).encode()
    # ollama 재로드/일시 과부하로 500이 날 수 있음 → 최대 3회 재시도(모델 웜업 대기).
    for attempt in range(3):
        try:
            req = urllib.request.Request(OLLAMA, body, {"Content-Type": "application/json"})
            r = json.loads(urllib.request.urlopen(req, timeout=180).read())
            try:
                return json.loads(r["response"]).get(key, [])
            except Exception:
                return []
        except urllib.error.HTTPError as e:
            if e.code >= 500 and attempt < 2:
                _time.sleep(3 * (attempt + 1)); continue
            raise
    return []


def crop_up(im, x0f, x1f, y0f=0.0, y1f=1.0, scale=4, max_side=2400):
    from PIL import Image
    W, H = im.size
    c = im.crop((int(x0f * W), int(y0f * H), int(x1f * W), int(y1f * H)))
    w, h = c.width * scale, c.height * scale
    m = max(w, h)
    if m > max_side:                       # 큰 원본 배치표에서 업스케일이 거대해져 VLM이 느려지는 것 방지(캡)
        f = max_side / m; w = int(w * f); h = int(h * f)
    return c.resize((max(1, w), max(1, h)), Image.LANCZOS)


def read_names(im, x0f, x1f, reads, prompt=NAME_PROMPT, y0f=0.0, y1f=1.0):
    tally = {}
    for _ in range(reads):
        for row in ask(crop_up(im, x0f, x1f, y0f, y1f), prompt, "rows"):
            try:
                n = int(row["n"]); nm = str(row.get("name", "")).strip()
            except Exception:
                continue
            if nm:
                tally.setdefault(n, {})
                tally[n][nm] = tally[n].get(nm, 0) + 1
    return {n: max(d.items(), key=lambda x: x[1])[0] for n, d in tally.items()}


# ── 픽셀분석: 각 순번 셀 배경색으로 근무/스페어/근무배정 판정(결정론적) ──
def classify_bg(im, x0f, x1f, row_top_f, row_bot_f):
    # 반환 (배경색분류, 텍스트유무). 텍스트유무 = 어두운 픽셀 비율(빈 슬롯의 가짜 이름 제거용).
    W, H = im.size
    box = im.crop((int(x0f * W), int(row_top_f * H), int(x1f * W), int(row_bot_f * H)))
    px = list(box.getdata())
    if not px:
        return ("unknown", False)
    dark = sum(1 for (r, g, b) in px if (r + g + b) / 3 < 110)
    has_text = (dark / len(px)) > 0.02
    bg = [(r, g, b) for (r, g, b) in px if (r + g + b) / 3 > 140]
    if not bg:
        return ("unknown", has_text)
    ar = sum(p[0] for p in bg) / len(bg); ag = sum(p[1] for p in bg) / len(bg); ab = sum(p[2] for p in bg) / len(bg)
    if ag > ar + 12 and ag > ab + 12:
        cls = "green"                        # 초록 = 54 근무배정
    elif ar > 235 and ag > 235 and ab > 235:
        cls = "white"                        # 흰색 = 근무
    elif 175 < ar < 225 and abs(ar - ag) < 15 and abs(ar - ab) < 15:
        cls = "gray"                         # 회색 = 스페어
    else:
        cls = "white" if (ar + ag + ab) / 3 > 228 else "gray"
    return (cls, has_text)


# 세로 스트립에서 '초록칸'(인턴 티오프) 연속 밴드 수를 센다. 순번 있는 보라칸(팀)은 제외(초록만).
def count_color_cells(im, x0f, x1f, bands=90):
    W, H = im.size
    x0, x1 = int(x0f * W), int(x1f * W)
    prev_green = False; count = 0
    for k in range(bands):
        y0 = int(k / bands * H); y1 = int((k + 1) / bands * H)
        box = im.crop((x0, y0, x1, y1)); px = list(box.getdata())
        if not px:
            prev_green = False; continue
        ar = sum(p[0] for p in px) / len(px); ag = sum(p[1] for p in px) / len(px); ab = sum(p[2] for p in px) / len(px)
        is_green = ag > ar + 15 and ag > ab + 15 and ag > 150
        if is_green and not prev_green:
            count += 1
        prev_green = is_green
    return count


def read_status(im, header_f=0.052, rows=20):
    # 좌열(순번1-20) x≈[0.02,0.34], 우열(21-40) x≈[0.34,0.68]. 헤더 아래를 20행으로 등분.
    rh = (1.0 - header_f) / rows
    status = {}
    for k in range(rows):
        top = header_f + k * rh; bot = header_f + (k + 1) * rh
        pad = rh * 0.04                                                          # 거의 전체 행(텍스트 놓침 방지)
        status[k + 1] = classify_bg(im, 0.02, 0.34, top + pad, bot - pad)        # 좌 → 순번 k+1
        status[k + 21] = classify_bg(im, 0.34, 0.67, top + pad, bot - pad)       # 우 → 순번 k+21
    return status


# ── 티오프 시각으로 각 부(部) 위치 찾기 ───────────────────────────────────
#  배치표 레이아웃은 날마다 다르다(단일 부 / 1·2·3부 통합 10칼럼 등). 좌표를 VLM에 물으면 못 짚는다.
#  대신 '내가' 세로 스트립으로 크롭해 각 조각의 티오프 '시각'을 읽는다 — 시간대가 부를 확정한다:
#   1부=아침(6~9시), 2부=낮(11~14시), 3부=오후(16~19시). 각 부 티오프표의 x중심을 얻는다.
def crop_fast(im, x0f, x1f, scale=2, max_side=1300):
    # 저해상 크롭 — 위치탐색(티오프 시각만)용. 빠르게 여러 스트립을 훑는다.
    from PIL import Image
    W, H = im.size
    c = im.crop((int(x0f * W), 0, int(x1f * W), H))
    w, h = c.width * scale, c.height * scale
    m = max(w, h)
    if m > max_side:
        f = max_side / m; w = int(w * f); h = int(h * f)
    return c.resize((max(1, w), max(1, h)), Image.LANCZOS)


def _strip_hours(im, x0, x1):
    hrs = []
    for row in ask(crop_fast(im, x0, x1), TEE_PROMPT, "rows"):
        t = str(row.get("time", "")).strip()
        if re.match(r"^\d{1,2}:\d{2}$", t):
            hrs.append(int(t.split(":")[0]))
    return hrs


def find_part_tees(im):
    # 반환 {part(int): (tee_x0, tee_x1)}. 저해상 스트립 스캔 → 시간대 tight한 것만 부로 채택.
    W = 0.16; STEP = 0.11                 # 스트립 수 최소화(속도) — ~9개
    strips = []
    x = 0.0
    while x < 1.0 - 1e-6:
        x1 = min(1.0, x + W)
        hrs = _strip_hours(im, x, x1)
        strips.append((x, x1, hrs))
        x += STEP
    # 각 부에 속하는 스트립 중심 모으기(시간대 범위≤6, 개수 3~40 = 진짜 티오프표; 조편성 노이즈 n=90+ 배제)
    buckets = {1: [], 2: [], 3: []}
    for (a, b, hrs) in strips:
        if not (3 <= len(hrs) <= 40):
            continue
        hs = sorted(hrs)
        if hs[-1] - hs[0] > 6:            # 여러 부 섞이거나 조편성 잡음 → 스킵
            continue
        med = hs[len(hs) // 2]
        part = 1 if med < 10 else 2 if med < 15 else 3
        buckets[part].append((a + b) / 2.0)
    parts = {}
    for p, cs in buckets.items():
        if cs:
            c = sum(cs) / len(cs)          # 부 티오프표 중심
            parts[p] = (max(0.0, c - 0.05), min(1.0, c + 0.09))   # OUT|N부|IN 대략 폭
    return parts


def read_one_part(im, part, parts, reads, name_prompt):
    # part의 명단(순번↔이름) + 티오프(순번↔시각) + 커트 판독. '이전 부 티오프'와 '이 부 티오프' 사이가 명단.
    centers = {p: (a + b) / 2.0 for p, (a, b) in parts.items()}
    tee_x0, tee_x1 = parts[part]
    tee_c = centers[part]
    prev_c = max([c for p, c in centers.items() if c < tee_c], default=None)
    r_x1 = tee_x0 - 0.005
    r_x0 = (prev_c + 0.05) if prev_c is not None else 0.0     # 이전 부 티오프 오른쪽 ~ 이 부 티오프 왼쪽 = 명단
    if r_x1 - r_x0 < 0.12:                                    # 너무 좁으면 최소 폭 확보
        r_x0 = max(0.0, r_x1 - 0.20)
    if r_x1 - r_x0 > 0.34:                                    # 너무 넓으면(단일 부 등) 그대로 두되 좌우 2단으로 읽음
        pass
    # 명단 — 명단 구간 전체(순번 이름 | 순번 이름 2단)를 상/하로만 쪼개 해상도↑. 순번(인쇄숫자)로 병합
    #  (좌우 2단은 한 크롭에 담아 read_names가 순번으로 알아서 합침 → 호출 수 절반).
    merged = {}
    for (a, b, y0, y1) in [(r_x0, r_x1, 0.0, 0.56), (r_x0, r_x1, 0.48, 1.0)]:
        for n, nm in read_names(im, a, b, reads, name_prompt, y0, y1).items():
            if n not in merged:
                merged[n] = nm
    # 티오프 — 이 부 티오프표 구간에서 순번↔시각(OUT/IN 두 열 표결)
    def read_tee_col(x0f, x1f, course, reads_t=2):
        tally = {}
        for _ in range(reads_t):
            for row in ask(crop_up(im, x0f, x1f), TEE_PROMPT, "rows"):
                try:
                    n = int(row["n"]); tm = str(row.get("time", "")).strip()
                except Exception:
                    continue
                if re.match(r"^\d{1,2}:\d{2}$", tm):
                    tally.setdefault(n, {}); tally[n][tm] = tally[n].get(tm, 0) + 1
        return {n: (max(d.items(), key=lambda x: x[1])[0], course) for n, d in tally.items()}
    tw = tee_x1 - tee_x0
    tmap = {}
    tmap.update(read_tee_col(tee_x0, tee_x0 + tw * 0.62, "OUT"))
    tmap.update(read_tee_col(tee_x0 + tw * 0.38, tee_x1, "IN"))
    tees = [{"n": n, "time": tmap[n][0], "course": tmap[n][1]} for n in sorted(tmap)]
    cut = max((t["n"] for t in tees), default=0)
    real_max = max(merged) if merged else 0
    interns = count_color_cells(im, tee_x0, tee_x1)
    roster, assign, status = [], {}, {}
    for n in range(1, real_max + 1):
        raw = merged.get(n, "")
        m = re.search(r"\(([\d,\s]+)\)\s*$", raw)
        if m:
            assign[n] = m.group(1).replace(" ", "")
            raw = raw[:m.start()].strip()
        roster.append(raw)
        if raw:
            status[n] = "work" if (cut and n <= cut) else "spare"
    return {"roster": roster, "assign": assign, "status": status, "cutPos": cut,
            "teeGrid": tees, "internCount": interns}


def legacy_read(im, reads, name_prompt):
    # 폴백 — 단일 부(2단) 배치표 전용 고정 기하(부 티오프를 못 찾았을 때).
    merged = {}
    for (a, b, y0, y1) in [(0.0, 0.38, 0.0, 0.56), (0.0, 0.38, 0.48, 1.0), (0.32, 0.72, 0.0, 1.0)]:
        for n, nm in read_names(im, a, b, reads, name_prompt, y0, y1).items():
            merged[n] = nm
    bg = read_status(im, rows=20)

    def read_tee_col(x0f, x1f, course, reads_t=2):
        tally = {}
        for _ in range(reads_t):
            for row in ask(crop_up(im, x0f, x1f), TEE_PROMPT, "rows"):
                try:
                    n = int(row["n"]); tm = str(row.get("time", "")).strip()
                except Exception:
                    continue
                if re.match(r"^\d{1,2}:\d{2}$", tm):
                    tally.setdefault(n, {}); tally[n][tm] = tally[n].get(tm, 0) + 1
        return {n: (max(d.items(), key=lambda x: x[1])[0], course) for n, d in tally.items()}
    tmap = {}
    tmap.update(read_tee_col(0.66, 0.885, "OUT"))
    tmap.update(read_tee_col(0.78, 1.0, "IN"))
    tees = [{"n": n, "time": tmap[n][0], "course": tmap[n][1]} for n in sorted(tmap)]
    interns = count_color_cells(im, 0.66, 0.78) + count_color_cells(im, 0.90, 1.0)
    grid_max = max((t["n"] for t in tees), default=0)
    real_max = max(merged) if merged else 0
    cut = grid_max
    if not cut:
        for n in range(1, real_max + 1):
            c, ht = bg.get(n, ("unknown", False))
            if ht and c in ("white", "green"):
                cut = max(cut, n)
    roster, assign, status = [], {}, {}
    for n in range(1, real_max + 1):
        c, has_text = bg.get(n, ("unknown", False))
        raw = merged.get(n, "")
        m = re.search(r"\(([\d,\s]+)\)\s*$", raw)
        if m:
            assign[n] = m.group(1).replace(" ", "")
            raw = raw[:m.start()].strip()
        roster.append(raw)
        if raw:
            status[n] = "work" if (cut and n <= cut) else ("work" if c in ("white", "green") else "spare")
    return {"roster": roster, "assign": assign, "status": status, "cutPos": cut,
            "teeGrid": tees, "internCount": interns}


def main():
    cfg = json.loads(sys.stdin.read() or "{}")
    reads = int(cfg.get("reads", 3))
    want = str(cfg.get("part", "3")).replace("부", "").strip() or "3"
    known = [str(x).strip() for x in (cfg.get("known") or []) if str(x).strip()]
    im = load_image(cfg["image"])

    name_prompt = NAME_PROMPT
    if known:
        name_prompt = NAME_PROMPT + " ★이름은 되도록 다음 캐디 명단에서 골라라(오독 방지). 명단에 없는 새 이름이면 보이는 대로 적어라. 명단: " + ", ".join(known[:150])

    parts = find_part_tees(im)
    npart = int(want) if want.isdigit() else 3
    if npart in parts:
        # 요청 부를 정확히 위치시켜 판독(다부/단일 레이아웃 모두). 다른 부도 필요하면 all_parts로.
        out = read_one_part(im, npart, parts, reads, name_prompt)
        out["_layout"] = "multi:%s" % ",".join(str(p) for p in sorted(parts))
    elif len(parts) <= 1:
        # 부 티오프를 못(하나만) 찾음 → 단일 부 고정기하 폴백.
        out = legacy_read(im, reads, name_prompt)
        out["_layout"] = "legacy"
    else:
        # 여러 부는 찾았는데 요청 부는 없음 → 그 부는 이 배치표에 없음(빈 결과).
        out = {"roster": [], "assign": {}, "status": {}, "cutPos": 0, "teeGrid": [], "internCount": 0}
        out["_layout"] = "multi-no-part:%s" % ",".join(str(p) for p in sorted(parts))
    out["part"] = want
    out["source"] = "local:%s" % MODEL
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
