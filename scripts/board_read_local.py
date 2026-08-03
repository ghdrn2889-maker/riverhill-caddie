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
# ★티오프표 전체를 '행 단위'로 읽는다 — [OUT팀번호][시간][IN팀번호]. OUT/IN을 따로 크롭하면 빈칸에서 행이
#  어긋나(팀↔시각 오매칭·IN열 통째 누락) → 한 크롭에서 행마다 좌/우 팀번호를 함께 읽어 정렬을 보존한다.
TEE_ROW_PROMPT = ("이 이미지는 골프 티오프표다. 세로로 여러 행이 있고, 각 행은 왼쪽부터 [OUT팀번호][시간 HH:MM][IN팀번호] 구조다. "
    "가운데가 시간(HH:MM)이다. 왼쪽 칸 숫자=그 팀이 OUT코스, 오른쪽 칸 숫자=그 팀이 IN코스로 출발. "
    "칸이 비어 있으면 그 값은 null(추측 금지). 각 행마다 시간과, 있으면 왼쪽·오른쪽 팀번호를 보이는 그대로. 빈 행(시간 없음)은 건너뛴다. "
    'JSON만: {"rows":[{"out":OUT팀번호_또는_null, "time":"HH:MM", "in":IN팀번호_또는_null}]}')


def _to_pos(val):
    try:
        n = int(str(val).strip())
        return n if n > 0 else None
    except Exception:
        return None


def read_tee_block(im, x0f, x1f, part, reads_t=3):
    # 티오프표(OUT|시간|IN) 전체를 한 크롭·행단위로 읽어 순번↔시각을 정렬 보존해 뽑는다(OUT·IN 모두).
    #  상/하 2분할로 밀도 truncation 방지. 순번(인쇄숫자)로 표결 병합. 부 시간대 밖 시각은 옆 부 오염 → 제거.
    lo, hi = {1: (5, 11), 2: (10, 16), 3: (14, 21)}.get(part, (0, 24))
    tally = {}  # pos -> {(time,course): votes}
    for (y0, y1) in [(0.0, 0.56), (0.48, 1.0)]:
        for _ in range(reads_t):
            for row in ask(crop_up(im, x0f, x1f, y0, y1), TEE_ROW_PROMPT, "rows"):
                tm = str(row.get("time", "")).strip()
                if not re.match(r"^\d{1,2}:\d{2}$", tm):
                    continue
                if not (lo <= int(tm.split(":")[0]) < hi):     # 옆 부 시각 오염 제거
                    continue
                for key, course in (("out", "OUT"), ("in", "IN")):
                    pos = _to_pos(row.get(key))
                    if pos is None:
                        continue
                    tally.setdefault(pos, {})
                    k = (tm, course)
                    tally[pos][k] = tally[pos].get(k, 0) + 1
    # ★1회성 환각(있지도 않은 19:15 등)은 버리고, 2표 이상 득표한 팀만 채택(reads_t>=3일 때).
    min_v = 2 if reads_t >= 3 else 1
    tees = []
    for pos, d in tally.items():
        (tm, course), v = max(d.items(), key=lambda x: x[1])
        if v >= min_v:
            tees.append({"n": pos, "time": tm, "course": course})
    return sorted(tees, key=lambda x: x["n"])


def load_image(src):
    import os
    from PIL import Image
    if src.startswith("data:"):
        raw = base64.b64decode(src.split(",", 1)[1])
    elif re.match(r"^https?:", src):
        raw = urllib.request.urlopen(src, timeout=20).read()
    elif os.path.exists(src):                       # 로컬 파일 경로(부별 크롭 테스트 등)
        return Image.open(src).convert("RGB")
    else:
        raw = base64.b64decode(src)
    return Image.open(io.BytesIO(raw)).convert("RGB")


import time as _time


def ask(img, prompt, key):
    buf = io.BytesIO(); img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    body = json.dumps({"model": MODEL, "prompt": prompt, "images": [b64], "stream": False,
        "format": "json", "keep_alive": "10m", "options": {"temperature": 0, "num_ctx": 4096}}).encode()
    # ollama 재로드/메모리압박(15GB 모델/16GB)으로 500이 날 수 있음 → 재시도. 끝내 실패해도 []로 계속(전체 판독은 살림).
    for attempt in range(5):
        try:
            req = urllib.request.Request(OLLAMA, body, {"Content-Type": "application/json"})
            r = json.loads(urllib.request.urlopen(req, timeout=180).read())
            try:
                return json.loads(r["response"]).get(key, [])
            except Exception:
                return []
        except urllib.error.HTTPError as e:
            if e.code >= 500 and attempt < 4:
                _time.sleep(3 * (attempt + 1)); continue
            return []          # 5회 실패 → 이 호출만 포기(raise 안 함, 나머지 판독 계속)
        except Exception:
            if attempt < 4:
                _time.sleep(2 * (attempt + 1)); continue
            return []
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


_HEADER_WORDS = {"이름", "순번", "성명", "번호", "구분", "비고", "카트", "근무"}


def _valid_name(nm):
    # 헤더/환각 배제: 표 머리글("이름" 등) 제거 + 괄호 앞 본체가 2~4 한글이어야 이름으로 인정.
    s = str(nm or "").strip()
    if not s or s in _HEADER_WORDS:
        return False
    base = re.sub(r"\([^)]*\)", "", s).strip()
    if base in _HEADER_WORDS:
        return False
    return bool(re.match(r"^[가-힣]{2,4}$", base))


def read_names(im, x0f, x1f, reads, prompt=NAME_PROMPT, y0f=0.0, y1f=1.0, min_votes=1):
    tally = {}
    for _ in range(reads):
        for row in ask(crop_up(im, x0f, x1f, y0f, y1f), prompt, "rows"):
            try:
                n = int(row["n"]); nm = str(row.get("name", "")).strip()
            except Exception:
                continue
            if nm and _valid_name(nm):
                tally.setdefault(n, {})
                tally[n][nm] = tally[n].get(nm, 0) + 1
    # ★다수결 필터 — 최다 득표 이름이 min_votes 이상일 때만 채택(환각은 대개 1회성 → 배제).
    out = {}
    for n, d in tally.items():
        nm, v = max(d.items(), key=lambda x: x[1])
        if v >= min_votes:
            out[n] = nm
    return out


def _base_name(nm):
    return re.sub(r"\([^)]*\)", "", str(nm or "")).strip()


def read_names_gated(im, x0f, x1f, prompt, known_set, y0f=0.0, y1f=1.0, max_reads=3):
    # ★확신게이트: 크롭을 1회 읽고, '불확실'할 때만 추가 판독(최대 max_reads). 정확도 유지·호출 감축.
    #  불확실 = 표결이 갈리는 칸이 있거나(len>1), 명단대조 집합이 있는데 그 안에 없는 이름이 있음(오독 의심).
    crop = crop_up(im, x0f, x1f, y0f, y1f)
    tally = {}

    def one():
        for row in ask(crop, prompt, "rows"):
            try:
                n = int(row["n"]); nm = str(row.get("name", "")).strip()
            except Exception:
                continue
            if nm:
                tally.setdefault(n, {})
                tally[n][nm] = tally[n].get(nm, 0) + 1

    def uncertain():
        for n, d in tally.items():
            if len(d) > 1:
                return True                       # 표결 불일치 → 더 읽어 확정
            if known_set:
                nm = max(d.items(), key=lambda x: x[1])[0]
                b = _base_name(nm)
                if len(b) >= 2 and b not in known_set:
                    return True                   # 명단에 없는 이름 → 오독 의심 → 재확인
        return False

    one()
    done = 1
    while done < max_reads and uncertain():
        one(); done += 1
    return {n: max(d.items(), key=lambda x: x[1])[0] for n, d in tally.items()}, done


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


def read_one_part(im, part, parts, reads, name_prompt, known_set=None):
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
    # 명단 — 명단 구간 전체(순번 이름 | 순번 이름 2단)를 상/하로만 쪼개 해상도↑. 순번(인쇄숫자)로 병합.
    #  ★확신게이트: 각 반쪽을 1회 읽고 불확실(명단에 없거나 표 갈림)할 때만 추가 판독 → 깨끗하면 호출↓, 애매하면 재확인.
    merged = {}
    for (a, b, y0, y1) in [(r_x0, r_x1, 0.0, 0.56), (r_x0, r_x1, 0.48, 1.0)]:
        res, _done = read_names_gated(im, a, b, name_prompt, known_set, y0, y1, max_reads=reads)
        for n, nm in res.items():
            if n not in merged:
                merged[n] = nm
    # 티오프 — 이 부 티오프표 전체를 행단위로 읽어 OUT·IN 팀 모두·정렬 보존(빈칸에도 안 어긋남).
    tees = read_tee_block(im, tee_x0, tee_x1, part, reads_t=2)
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

    # 티오프표(우측 OUT|시간|IN) 전체를 행단위로 읽어 정렬 보존(part=0 → 시간대 필터 없음, 단일부).
    tees = read_tee_block(im, 0.66, 1.0, 0, reads_t=3)
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


def region_text_density(im, x0f, x1f, y0f, y1f):
    # 영역의 '어두운 글자 픽셀' 비율 — 빈 칸/빈 열 판별(결정적). 이름 칸이 비면 0에 가깝다.
    W, H = im.size
    box = im.crop((int(x0f * W), int(y0f * H), int(x1f * W), int(y1f * H)))
    px = list(box.getdata())
    if not px:
        return 0.0
    dark = sum(1 for (r, g, b) in px if (r + g + b) / 3 < 110)
    return dark / len(px)


def _snap_known(nm, known_set):
    # 명단 최근접 스냅 — 같은 길이 1글자차 후보가 '유일'하면 교정(장미화→장미희). 괄호 태그 보존.
    if not known_set:
        return nm
    b = _base_name(nm)
    if len(b) < 2 or b in known_set:
        return nm
    cands = [k for k in known_set if len(k) == len(b) and sum(1 for i in range(len(b)) if b[i] != k[i]) == 1]
    if len(cands) == 1:
        tag = re.search(r"(\([^)]*\))\s*$", str(nm))
        return cands[0] + (tag.group(1) if tag else "")
    return nm


def _band_text_extent(im, x0f, x1f, y0f=0.0, y1f=1.0, bands=64, thr=0.012):
    # 열의 '글자 있는' 세로 범위(첫~마지막 텍스트 밴드 중심). 행 그리드 보정용.
    W, H = im.size
    x0, x1 = int(x0f * W), int(x1f * W)
    ys = []
    for k in range(bands):
        a = y0f + (y1f - y0f) * k / bands; b = y0f + (y1f - y0f) * (k + 1) / bands
        box = im.crop((x0, int(a * H), x1, int(b * H))); px = list(box.getdata())
        if not px:
            continue
        dark = sum(1 for (r, g, bl) in px if (r + g + bl) / 3 < 110) / len(px)
        if dark >= thr:
            ys.append((a + b) / 2)
    return (min(ys), max(ys)) if ys else None


def single_crop_read(im, part, reads, name_prompt, known_set, cut_override=0):
    # ★단일 부(部) 크롭 전용 — 위치탐색 없이 고정 기하로 바로 판독(변동 크롭 업로드·부별 잘라읽기).
    #  깨끗한 단일부 이미지: 좌측=명단(순번 이름 | 순번 이름 2단), 우측=티오프표(OUT|시간|IN).
    #  ★완전성·정확성 우선(단일부는 빠름): ①좌/우열 분리 ②세로 3분할 ③빈 열 스킵 ④명단 최근접 스냅
    #   ⑤행-단위 빈칸 후행절단(부분만 찬 열의 빈 하단 환각 제거) ⑥한 부 내 이름 중복 제거.
    NAME_COLS = [(0.0, 0.33), (0.31, 0.63)]        # 좌열(순번 이름) · 우열(순번 이름)
    TEE_X = (0.56, 1.0)
    Y_BANDS = [(0.0, 0.40), (0.35, 0.72), (0.68, 1.0)]
    merged = {}
    col_of = {}                                    # 순번 → 어느 열(0=좌,1=우)에서 읽혔나
    for ci, (cx0, cx1) in enumerate(NAME_COLS):
        # ★빈 열 가드 — 이 열의 '이름 칸'(우측 55%) 글자밀도가 낮으면 빈 열 → 읽지 않는다(1부 24~46 빈칸 환각 차단).
        name_sub = (cx0 + 0.45 * (cx1 - cx0), cx1)
        dens = region_text_density(im, name_sub[0], name_sub[1], 0.07, 0.98)
        if dens < 0.006:
            continue
        for (y0, y1) in Y_BANDS:                    # 세로 3분할 — 밀집 열(2부 25행) 하단까지 포착
            for n, nm in read_names(im, cx0, cx1, reads, name_prompt, y0, y1, min_votes=2).items():
                if n not in merged and nm:
                    merged[n] = nm; col_of[n] = ci
    # ── ⑤ 행-단위 빈칸 후행절단 — '부분만 찬 열'(예: 3부 우열 21~29, 30~40 빈칸)의 환각 꼬리 제거. ──
    right = sorted([n for n in merged if col_of.get(n) == 1])
    left = sorted([n for n in merged if col_of.get(n) == 0])
    if right and left:
        R = min(right) - 1                          # 열당 물리 행 수(우열 시작=R+1)
        ext = _band_text_extent(im, NAME_COLS[0][0] + 0.45 * (NAME_COLS[0][1] - NAME_COLS[0][0]), NAME_COLS[0][1])
        if R >= 1 and ext:
            y_top, y_bot = ext
            rh = (y_bot - y_top) / max(1, R - 1)    # 좌열 첫~끝 텍스트가 R행에 걸침
            nsub = (NAME_COLS[1][0] + 0.45 * (NAME_COLS[1][1] - NAME_COLS[1][0]), NAME_COLS[1][1])
            for p in reversed(right):               # 높은 순번부터: 빈 셀이면 절단, 실이 나오면 멈춤
                row = p - (R + 1)                   # 우열 내 0-기준 행
                if row < 0:
                    continue
                cy = y_top + row * rh
                d = region_text_density(im, nsub[0], nsub[1], max(0.0, cy - rh * 0.4), min(1.0, cy + rh * 0.4))
                if d < 0.008:                       # 셀에 글자 없음 = 환각 → 제거
                    merged.pop(p, None); col_of.pop(p, None)
                else:
                    break
    tees = read_tee_block(im, TEE_X[0], TEE_X[1], part, reads_t=4)   # part 시간대 필터로 옆부 오염 방지
    cut = cut_override or max((t["n"] for t in tees), default=0)     # 요약숫자(있으면) 우선 = 신뢰도↑
    real_max = max(merged) if merged else 0
    interns = count_color_cells(im, TEE_X[0], TEE_X[1])
    roster, assign, status = [], {}, {}
    for n in range(1, real_max + 1):
        raw = merged.get(n, "")
        m = re.search(r"\(([\d,\s]+)\)\s*$", raw)
        if m:
            assign[n] = m.group(1).replace(" ", "")
            raw = raw[:m.start()].strip()
        raw = _snap_known(raw, known_set) if raw else raw          # 명단 최근접 스냅
        roster.append(raw)
        if raw:
            status[n] = "work" if (cut and n <= cut) else "spare"
    return {"roster": roster, "assign": assign, "status": status, "cutPos": cut,
            "teeGrid": tees, "internCount": interns}


SUMMARY_PROMPT = ("이 이미지에는 '1부 N   2부 M   3부 K   총 T팀' 처럼 부별 팀 수가 큰 글씨로 적혀 있다. "
    "'N부'는 부 번호, 그 옆 숫자가 그 부의 팀 수다. '총'/'팀'/'조'/'명'은 무시. 보이는 그대로 읽어라(추측 금지). "
    'JSON만: {"parts":[{"part":부번호, "teams":팀수}]}')


def read_summary_counts(im, reads=3):
    # ★배치표 상단 요약에서 부별 '팀 수'(=커트)를 확정 — 티오프 행을 세는 것보다 신뢰도 높음(하단 누락 무관).
    #  전체 합본 배치표에만 있음(부별 크롭엔 없을 수 있음). '1부 21 2부 4 3부 16'만 좁게·고해상도로.
    tally = {}
    for _ in range(reads):
        for row in ask(crop_up(im, 0.55, 0.90, 0.0, 0.05, scale=6, max_side=2000), SUMMARY_PROMPT, "parts"):
            pm = re.search(r"\d+", str(row.get("part", "")))   # "1부" → 1
            p = int(pm.group()) if pm else None
            t = _to_pos(str(row.get("teams", "")).replace("팀", "").strip())
            if p in (1, 2, 3) and t and t <= 40:
                tally.setdefault(p, {}); tally[p][t] = tally[p].get(t, 0) + 1
    return {p: max(d.items(), key=lambda x: x[1])[0] for p, d in tally.items()}


def _emit(obj):
    # 스트리밍 출력 — 한 줄(NDJSON) 즉시 flush. 호출부(Node)가 부 단위로 바로 처리·저장·발송할 수 있게.
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    cfg = json.loads(sys.stdin.read() or "{}")
    reads = int(cfg.get("reads", 3))
    want = str(cfg.get("part", "3")).replace("부", "").strip() or "3"
    known = [str(x).strip() for x in (cfg.get("known") or []) if str(x).strip()]
    known_set = set(_base_name(x) for x in known if len(_base_name(x)) >= 2)
    im = load_image(cfg["image"])
    t0 = _time.time()

    name_prompt = NAME_PROMPT
    if known:
        name_prompt = NAME_PROMPT + " ★이름은 되도록 다음 캐디 명단에서 골라라(오독 방지). 명단에 없는 새 이름이면 보이는 대로 적어라. 명단: " + ", ".join(known[:150])

    # ── single=true: 위치탐색 없이 '이 크롭은 단일 부'로 보고 고정 기하 판독(부별 잘라읽기·변동 크롭). ──
    if cfg.get("single"):
        npart = int(want) if want.isdigit() else 0
        out = single_crop_read(im, npart, reads, name_prompt, known_set, cut_override=int(cfg.get("cut", 0) or 0))
        out.update({"part": want, "_layout": "single", "_ms": int((_time.time() - t0) * 1000),
                    "source": "local:%s" % MODEL})
        print(json.dumps(out, ensure_ascii=False))
        return

    parts = find_part_tees(im)                     # ★위치탐색 1회 — 이 결과를 모든 부 판독이 공유.
    layout = "multi:%s" % ",".join(str(p) for p in sorted(parts)) if parts else "none"

    # ── want=="all": 이미지에 있는 '모든 부'를 부별로 판독하고 각 부를 즉시 내보낸다(스트리밍). ──
    if want == "all":
        present = sorted(parts)
        if not present:                            # 부 못 찾음 → 단일부 폴백 1건
            out = legacy_read(im, reads, name_prompt)
            out.update({"part": "?", "_layout": "legacy", "_ms": int((_time.time() - t0) * 1000),
                        "source": "local:%s" % MODEL})
            _emit({"_stream": "part", **out})
            _emit({"_done": True, "_layout": "legacy", "parts_read": ["?"],
                   "_ms": int((_time.time() - t0) * 1000), "source": "local:%s" % MODEL})
            return
        done_parts = []
        for p in present:                          # 아침/낮/오후 순으로 1→2→3
            try:
                out = read_one_part(im, p, parts, reads, name_prompt, known_set)
            except Exception as e:                 # 한 부 실패는 그 부만 격리(나머지 부는 계속)
                out = {"roster": [], "assign": {}, "status": {}, "cutPos": 0, "teeGrid": [],
                       "internCount": 0, "_error": str(e)[:120]}
            out.update({"part": str(p), "_layout": layout, "_ms": int((_time.time() - t0) * 1000),
                        "source": "local:%s" % MODEL})
            _emit({"_stream": "part", **out})      # ★그 부 즉시 내보냄
            done_parts.append(str(p))
        _emit({"_done": True, "_layout": layout, "parts_read": done_parts,
               "_ms": int((_time.time() - t0) * 1000), "source": "local:%s" % MODEL})
        return

    # ── 단일 부 요청(변동 업데이트: 보통 한 부만 잘려 올라옴) — 그 부만 판독(하위호환: 단일 JSON). ──
    npart = int(want) if want.isdigit() else 3
    if npart in parts:
        out = read_one_part(im, npart, parts, reads, name_prompt, known_set)
        out["_layout"] = layout
    elif len(parts) <= 1:
        out = legacy_read(im, reads, name_prompt)
        out["_layout"] = "legacy"
    else:
        out = {"roster": [], "assign": {}, "status": {}, "cutPos": 0, "teeGrid": [], "internCount": 0}
        out["_layout"] = "multi-no-part:%s" % ",".join(str(p) for p in sorted(parts))
    out["part"] = want
    out["_ms"] = int((_time.time() - t0) * 1000)
    out["source"] = "local:%s" % MODEL
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
