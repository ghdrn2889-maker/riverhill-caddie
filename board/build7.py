# -*- coding: utf-8 -*-
# 배치표 빌드 — 기계 하나에 화면 둘.
#   데스크톱: tpl6_head  + core + store + view6
#   폰      : tpl6m_head + core + store + view6m
import sys, io, os
base = os.path.dirname(os.path.abspath(__file__)) + "/"
def rd(f): return open(base + f, encoding='utf-8').read()

BOARD = rd("board16_data.json").strip()
core  = rd("core6.js").replace("//__BOARD__", "var BOARD = " + BOARD + ";", 1)
store = rd("store6.js")
TAIL  = "\n</script>\n</body>\n</html>\n"

def build(head, view, outs):
    body = rd(head) + core + "\n" + store + "\n" + rd(view) + TAIL
    for p in outs:
        os.makedirs(os.path.dirname(p), exist_ok=True) if os.path.dirname(p) else None
        open(p, 'w', encoding='utf-8').write(body)
    return len(body)

want = sys.argv[1] if len(sys.argv) > 1 else 'all'
if want in ('all', 'pc'):
    n = build("tpl6_head.html", "view6.js",
              ["C:/Users/ghdrn/Documents/board16.html",
               "C:/Users/ghdrn/Documents/리버힐 캐디 일정 앱/_sample_board16.html"])
    print("pc  ", n)
if want in ('all', 'mob') and os.path.exists(base + "view6m.js"):
    n = build("tpl6m_head.html", "view6m.js",
              ["C:/Users/ghdrn/Documents/board16m.html",
               "C:/Users/ghdrn/Documents/리버힐 캐디 일정 앱/_sample_board16m.html"])
    print("mob ", n)
