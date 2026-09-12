#!/bin/bash
cd "$(dirname "$0")"
A="C:/Users/ghdrn/Documents/board16_before.html"
B="C:/Users/ghdrn/Documents/board16.html"
P="_probeRoundClash _probeWkQ _probeBulkFind _probeCarryOpt _probePcPartMove _probePcCellRm _probePcDayTag _probePcCatchUp _probePcDays _probePcAbs _probePcCarry _probePcBu3 _probePcWk _probePcLn _probePcRot _probeBulkPc"
run(){ PYTHONIOENCODING=utf-8 python runm.py $1.html 1600 1000 "$2" 2>&1 | grep -c '✗\|터짐\|ERROR\|PROBE 없음'; }
for f in $P; do
  a=$(run $f "$A"); b=$(run $f "$B")
  m="같음"; [ "$a" != "$b" ] && m="★달라짐"
  echo "$f  전$a  후$b  $m"
done
