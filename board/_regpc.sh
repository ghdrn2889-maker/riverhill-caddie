#!/bin/bash
cd "$(dirname "$0")"
SRC="$1"; OUT="$2"
P="_probeRoundClash _probeWkQ _probeBulkFind _probeCarryOpt _probePcPartMove _probePcCellRm _probePcDayTag _probePcCatchUp _probePcDays _probePcAbs _probePcCarry _probePcBu3 _probePcWk _probePcLn _probePcRot _probeBulkPc"
: > "$OUT"
for f in $P; do
  r=$(PYTHONIOENCODING=utf-8 python runm.py $f.html 1600 1000 "$SRC" 2>&1)
  bad=$(printf '%s' "$r" | grep -c '✗\|터짐\|ERROR\|PROBE 없음')
  echo "$f 문제$bad" >> "$OUT"
done
echo DONE >> "$OUT"
