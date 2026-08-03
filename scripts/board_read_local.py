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
        "format": "json", "options": {"temperature": 0, "num_ctx": 8192}}).encode()
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


def crop_up(im, x0f, x1f, y0f=0.0, y1f=1.0, scale=5):
    from PIL import Image
    W, H = im.size
    c = im.crop((int(x0f * W), int(y0f * H), int(x1f * W), int(y1f * H)))
    return c.resize((c.width * scale, c.height * scale), Image.LANCZOS)


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


def main():
    cfg = json.loads(sys.stdin.read() or "{}")
    reads = int(cfg.get("reads", 3))
    known = [str(x).strip() for x in (cfg.get("known") or []) if str(x).strip()]
    im = load_image(cfg["image"])

    # 폐쇄어휘: 알려진 캐디 명단을 프롬프트에 주입 → 오독을 '존재하는 이름'으로 억제(김수영 같은 유령 방지).
    name_prompt = NAME_PROMPT
    if known:
        name_prompt = NAME_PROMPT + " ★이름은 되도록 다음 캐디 명단에서 골라라(오독 방지). 명단에 없는 새 이름이면 보이는 대로 적어라. 명단: " + ", ".join(known[:150])

    # 1) 명단 — 좌/우 열을 다시 상/하로 쪼갠 '4분할'(각 줄 해상도↑ → 흐린 셀 오독 최소화). 순번(인쇄숫자)로 병합.
    merged = {}
    quads = [
        (0.0, 0.38, 0.0, 0.56),    # 좌열 상(순번 1~10, 헤더 포함)
        (0.0, 0.38, 0.48, 1.0),    # 좌열 하(11~20)
        (0.32, 0.72, 0.0, 0.56),   # 우열 상(21~30)
        (0.32, 0.72, 0.48, 1.0),   # 우열 하(31~40)
    ]
    for (a, b, y0, y1) in quads:
        for n, nm in read_names(im, a, b, reads, name_prompt, y0, y1).items():
            merged[n] = nm
    # 2) 픽셀분석: 각 순번 셀 배경색(근무/스페어) + 텍스트 유무
    bg = read_status(im, rows=20)

    # 3) 티오프표 — OUT열([순번][시간])과 IN열([시간][순번])을 '따로' 크롭해 좌우 혼동 제거. 각 열=순번↔시각.
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
    tees = []
    tmap = {}
    tmap.update(read_tee_col(0.66, 0.885, "OUT"))    # OUT 숫자 + 시간
    tmap.update(read_tee_col(0.78, 1.0, "IN"))       # 시간 + IN 숫자
    for n in sorted(tmap):
        tees.append({"n": n, "time": tmap[n][0], "course": tmap[n][1]})
    # 인턴(초록/노란 티오프칸, 순번 없음) = 그리드 OUT/IN열에서 색칸 픽셀 카운트(연속 색밴드 = 1개).
    interns = count_color_cells(im, 0.66, 0.78) + count_color_cells(im, 0.90, 1.0)

    # 4) 커트라인·명단·근무 확정
    #  · 커트 = 티오프표 최대순번(가장 신뢰: 근무팀만 티오프가 있음). 없으면 회색경계 폴백.
    grid_max = max((t["n"] for t in tees), default=0)
    #  · 실제 명단 끝 = '텍스트가 있는' 마지막 순번(빈 슬롯 31~40의 가짜 이름 배제).
    real_max = 0
    for n in range(1, 41):
        _, has_text = bg.get(n, ("unknown", False))
        if has_text and merged.get(n):
            real_max = n
    if not real_max:
        real_max = max(merged) if merged else 0
    cut = grid_max
    if not cut:                                    # 폴백: 회색 아닌(근무) 마지막 순번
        for n in range(1, real_max + 1):
            c, ht = bg.get(n, ("unknown", False))
            if ht and c in ("white", "green"):
                cut = max(cut, n)
    roster, assign, status = [], {}, {}
    for n in range(1, real_max + 1):
        c, has_text = bg.get(n, ("unknown", False))
        raw = merged.get(n, "")                        # real_max 이내는 VLM 이름 신뢰(개별 텍스트게이트로 실명 지우지 않음)
        m = re.search(r"\(([\d,\s]+)\)\s*$", raw)
        if m:
            assign[n] = m.group(1).replace(" ", "")
            raw = raw[:m.start()].strip()
        roster.append(raw)
        if raw:
            status[n] = "work" if (cut and n <= cut) else ("work" if c in ("white", "green") else "spare")

    print(json.dumps({"roster": roster, "assign": assign, "status": status, "cutPos": cut,
        "teeGrid": tees, "internCount": interns, "source": "local:%s" % MODEL}, ensure_ascii=False))


if __name__ == "__main__":
    main()
