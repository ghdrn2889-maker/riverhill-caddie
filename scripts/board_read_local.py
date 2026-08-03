#!/usr/bin/env python3
# 로컬 VLM 배치표 판독(타일링) — 홈서버 GPU ollama(qwen2.5vl). ★API 비용 0.
#  배치표는 세로로 긴 2단(순번1~20 | 21~40) 리스트라 통이미지론 아래가 뭉개진다(truncate).
#  → 폭을 좌/우 열로 크롭 + 4배 업스케일 + 타일당 표결 → 순번(인쇄된 숫자) 기준 병합.
#  실측(2026-08-03, 26955): 통이미지 50% → 타일링 30/30 이름·괄호점유자 정확(≈100%).
#  입력: stdin JSON {"image": "<url|dataURI|base64>", "reads": 2}
#  출력: stdout JSON {"roster": ["이름(점유자)", ...순번순서], "assign": {순번: "54"}, "source": "..."}
import sys, io, json, base64, urllib.request, re

OLLAMA = "http://localhost:11434/api/generate"
MODEL = "qwen2.5vl:7b"
PROMPT = ("이 이미지는 골프 배치표의 한 열이다. 각 줄은 [순번숫자][이름] 형식이다. "
    "★이름에 괄호가 붙어 있으면 반드시 '이름(점유자)' 원문 그대로 포함하라(예: 신지현(오동현)). 괄호를 빠뜨리지 마라. "
    "이름 옆 (54) 같은 근무배정 숫자는 그대로 둬라. 빈 이름줄은 건너뛴다. 글자를 추측 말고 보이는 대로. "
    'JSON만: {"rows":[{"n":순번, "name":"이름"}]}')


def load_image(src):
    from PIL import Image
    if src.startswith("data:"):
        raw = base64.b64decode(src.split(",", 1)[1])
    elif re.match(r"^https?:", src):
        raw = urllib.request.urlopen(src, timeout=20).read()
    else:
        raw = base64.b64decode(src)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def ask(img):
    buf = io.BytesIO(); img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    body = json.dumps({"model": MODEL, "prompt": PROMPT, "images": [b64], "stream": False,
        "format": "json", "options": {"temperature": 0, "num_ctx": 8192}}).encode()
    req = urllib.request.Request(OLLAMA, body, {"Content-Type": "application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=120).read())
    try:
        return json.loads(r["response"]).get("rows", [])
    except Exception:
        return []


def crop_up(im, x0f, x1f, scale=4):
    from PIL import Image
    W, H = im.size
    c = im.crop((int(x0f * W), 0, int(x1f * W), H))
    return c.resize((c.width * scale, c.height * scale), Image.LANCZOS)


def ask_vote(im, x0f, x1f, reads):
    tally = {}
    for _ in range(reads):
        for row in ask(crop_up(im, x0f, x1f)):
            try:
                n = int(row["n"]); nm = str(row.get("name", "")).strip()
            except Exception:
                continue
            if nm:
                tally.setdefault(n, {})
                tally[n][nm] = tally[n].get(nm, 0) + 1
    return {n: max(d.items(), key=lambda x: x[1])[0] for n, d in tally.items()}


def main():
    cfg = json.loads(sys.stdin.read() or "{}")
    reads = int(cfg.get("reads", 2))
    im = load_image(cfg["image"])
    # 폭 비율 크롭(2단 배치표): 좌열 0~38%, 우열 32~72%. 해상도 무관 일반화.
    merged = {}
    for (a, b) in [(0.0, 0.38), (0.32, 0.72)]:
        for n, nm in ask_vote(im, a, b, reads).items():
            merged[n] = nm
    if not merged:
        print(json.dumps({"roster": [], "source": "local:%s" % MODEL})); return
    N = max(merged)
    roster, assign = [], {}
    for n in range(1, N + 1):
        raw = merged.get(n, "")
        # 근무배정 숫자태그 (54)/(1,3) 분리 — 이름엔 한글 점유자 괄호만 남긴다.
        m = re.search(r"\(([\d,\s]+)\)\s*$", raw)
        if m:
            assign[n] = m.group(1).replace(" ", "")
            raw = raw[:m.start()].strip()
        roster.append(raw)
    print(json.dumps({"roster": roster, "assign": assign, "source": "local:%s" % MODEL}, ensure_ascii=False))


if __name__ == "__main__":
    main()
