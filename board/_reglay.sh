#!/bin/bash
# 근무표 레이아웃 고치기 — 짝지어 대보기.
# 폰 빌드는 한 글자도 안 바뀌었다(cmp 로 확인) — PC 프로브만 돈다.
cd "$(dirname "$0")"
P="_probeRoundClash _probeWkQ _probeBulkFind _probeCarryOpt _probePcPartMove _probePcCellRm _probePcDayTag _probePcCatchUp _probePcDays _probePcAbs _probePcCarry _probePcBu3 _probePcWk _probePcLn _probePcRot _probeBulkPc"
n=0
run(){ PYTHONIOENCODING=utf-8 python runm.py $1.html 1600 1000 "$2" 2>&1 | grep -c '✗\|터짐\|ERROR\|PROBE 없음'; }
for f in $P; do
  a=$(run $f "C:/Users/ghdrn/Documents/board16_laybefore.html")
  b=$(run $f "C:/Users/ghdrn/Documents/board16.html")
  if [ "$a" != "$b" ]; then echo "PC $f  전$a 후$b  ★달라짐"; n=$((n+1));
  else echo "PC $f  전$a 후$b  같음"; fi
done
echo "── 달라진 프로브 $n 개 / PC 16개"
