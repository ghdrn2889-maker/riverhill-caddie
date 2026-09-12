# -*- coding: utf-8 -*-
# 폰 화면을 진짜 폰 폭에 넣고 프로브를 돌린다.
# 헤드리스 크롬 창은 500px 아래로 안 줄어든다 — 틀(iframe) 안에 넣어야 390px 가 나온다.
import sys, os, re, html, subprocess, shutil

BASE = os.path.dirname(os.path.abspath(__file__)) + "/"
CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"

probe = sys.argv[1] if len(sys.argv) > 1 else '-'
W = int(sys.argv[2]) if len(sys.argv) > 2 else 390
H = int(sys.argv[3]) if len(sys.argv) > 3 else 844
SRC = sys.argv[4] if len(sys.argv) > 4 else "C:/Users/ghdrn/Documents/board16m.html"
SHOT = sys.argv[5] if len(sys.argv) > 5 else ''

page = open(SRC, encoding='utf-8').read()
hook = ('<body>\n<script>window.__E=[];window.addEventListener("error",'
        'function(e){window.__E.push(e.message+" @\uc904"+e.lineno);});</script>')
page = page.replace('<body>', hook, 1)
if probe != '-':
    page = page.replace('</body>', open(BASE + probe, encoding='utf-8').read() + '</body>', 1)
open(BASE + "_inner.html", 'w', encoding='utf-8').write(page)

ES = '</' + 'script>'
outer = (
 '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#8a929b">'
 '<iframe id="F" src="_inner.html" style="width:%dpx;height:%dpx;border:0;display:block"></iframe>'
 '<pre id="OUT" style="font:12px monospace;white-space:pre-wrap"></pre>'
 '<script>setTimeout(function(){var w=F.contentWindow,d=F.contentDocument;'
 'var p=d.getElementById("PROBE");'
 'document.getElementById("OUT").textContent='
 '  (p?p.textContent:"(PROBE 없음)")+"\\n\\n부팅에러: "+((w.__E||[]).join(" ||| ")||"없음")'
 '  +"\\n틀 안 폭: "+w.innerWidth+"x"+w.innerHeight;'
 '},3200);%s' % (W, H, ES)) + '</body>'
open(BASE + "_outer.html", 'w', encoding='utf-8').write(outer)

prof = BASE + "cprun"
shutil.rmtree(prof, ignore_errors=True)
cmd = [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
       "--allow-file-access-from-files", "--user-data-dir=" + prof,
       "--virtual-time-budget=12000", "--window-size=%d,%d" % (W + 30, H + 260)]
if SHOT:
    cmd += ["--screenshot=" + SHOT]
cmd += ["--dump-dom", "file:///" + BASE + "_outer.html"]
out = subprocess.run(cmd, capture_output=True).stdout.decode('utf-8', 'replace')
m = re.search(r'<pre id="OUT"[^>]*>(.*?)</pre>', out, re.S)
txt = html.unescape(m.group(1)) if m else '(OUT 못 찾음)'
open(BASE + "_probeout.txt", 'w', encoding='utf-8').write(txt)
print(txt)
