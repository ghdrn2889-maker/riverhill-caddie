# -*- coding: utf-8 -*-
# 배지 사진에서 바탕색과 글씨색을 그대로 뽑는다.
#   쓰기: python pickcolor.py <그림파일>
# 가장 넓은 자리를 차지한 색이 바탕, 그 바탕과 가장 먼 색이 글씨다.
import sys
from collections import Counter
from PIL import Image

im = Image.open(sys.argv[1]).convert('RGB')
w, h = im.size
px = list(im.getdata())
cnt = Counter(px)
bg, n = cnt.most_common(1)[0]

def far(c):
    return (c[0]-bg[0])**2 + (c[1]-bg[1])**2 + (c[2]-bg[2])**2

# 글씨는 드물지만 뭉쳐 있다 — 스무 번 이상 나온 색 중 바탕에서 가장 먼 것
ink = max((c for c, k in cnt.items() if k >= 20), key=far, default=bg)
hx = lambda c: '#%02x%02x%02x' % c
print(u'그림       %dx%d · 색 %d가지' % (w, h, len(cnt)))
print(u'바탕(넓은) %s   %s   %d칸 (%.0f%%)' % (hx(bg), bg, n, 100.0*n/len(px)))
print(u'글씨(먼)   %s   %s' % (hx(ink), ink))
print(u'\n--- 그림 한가운데 가로줄 ---')
y = h // 2
seen = []
for x in range(0, w, max(1, w // 24)):
    c = im.getpixel((x, y))
    if not seen or seen[-1] != c: seen.append(c)
print('  ' + '  '.join(hx(c) for c in seen[:14]))
