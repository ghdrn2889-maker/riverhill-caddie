# -*- coding: utf-8 -*-
# PC 화면을 '진짜 브라우저 확대'로 돌린다.
#   --force-device-scale-factor 가 곧 브라우저 확대다 — CSS 기준 창이 그만큼 좁아지고
#   devicePixelRatio 가 그만큼 커진다. 틀(iframe) 안에서는 확대를 흉내 못 낸다.
# 쓰기: python runpc.py <probe> <창가로> <창세로> <확대> [SRC] [SHOT]
import sys, os, re, html, subprocess, shutil

BASE = os.path.dirname(os.path.abspath(__file__)) + "/"
CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"

probe = sys.argv[1] if len(sys.argv) > 1 else '-'
W     = int(sys.argv[2]) if len(sys.argv) > 2 else 1920
H     = int(sys.argv[3]) if len(sys.argv) > 3 else 1080
Z     = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
SRC   = sys.argv[5] if len(sys.argv) > 5 else "C:/Users/ghdrn/Documents/board16.html"
SHOT  = sys.argv[6] if len(sys.argv) > 6 else ''

page = open(SRC, encoding='utf-8').read()
hook = ('<body>\n<script>window.__E=[];window.addEventListener("error",'
        'function(e){window.__E.push(e.message+" @\uc904"+e.lineno);});</script>')
page = page.replace('<body>', hook, 1)
if probe != '-':
    page = page.replace('</body>', open(BASE + probe, encoding='utf-8').read() + '</body>', 1)
inner = BASE + "_pcinner.html"
open(inner, 'w', encoding='utf-8').write(page)

prof = BASE + "cprunpc"
shutil.rmtree(prof, ignore_errors=True)
cmd = [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
       "--allow-file-access-from-files", "--user-data-dir=" + prof,
       "--force-device-scale-factor=%g" % Z,
       "--virtual-time-budget=12000",
       "--window-size=%d,%d" % (int(W / Z), int(H / Z))]
if SHOT:
    cmd += ["--screenshot=" + SHOT]
cmd += ["--dump-dom", "file:///" + inner]
out = subprocess.run(cmd, capture_output=True).stdout.decode('utf-8', 'replace')
m = re.search(r'<div id="PROBE"[^>]*>(.*?)</div>', out, re.S)
txt = html.unescape(re.sub(r'<[^>]+>', '', m.group(1))) if m else '(PROBE \ubabb \ucc3e\uc74c)'
print(txt)
