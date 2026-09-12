#!/bin/bash
# 마샬→배치 맞추개 + 줄 문구 — 짝지어 대보기. core 가 바뀌었으니 폰도 다 돈다.
cd "$(dirname "$0")"
M="_probeTee3 _probeTee _probeTeamDel _probeBu3In2 _probeClear _probeMove39 _probeExact _probeAddTeam _probeFlow2 _probeJoIn _probeSwapOff _probeAddBack2 _probeRoundClash _probeWkQ _probeEmptySeat _probeLnWait _probeSeatVac _probeLnOrder _probeCartLend2 _probeCart _probePool _probeCarryOpt _probeCarryDiag _probeNoSeat _probeDupFix _probeSwapList _probeAbs _probeWhy23 _probeRestUI _probeSeatTag _probeJochul _probeBu3Set _probeWipe _probeWkBadge _probeDayTag _probeDraftUndo _probeCatchUp _probeDayTap _probeMigrate _probeDays _probeSave _probePmStay _probeUnplaced _probePartMove _probeCarryUI _probeCarry _probeBu3UI _probeBu3 _probeWkOrder _probeLnUI _probeLineup _probeBulk"
P="_probeRoundClash _probeWkQ _probeCarryOpt _probePcPartMove _probePcCellRm _probePcDayTag _probePcCatchUp _probePcDays _probePcAbs _probePcCarry _probePcBu3 _probePcWk _probePcLn _probePcRot _probeBulkPc"
n=0
run(){ PYTHONIOENCODING=utf-8 python runm.py $1.html $2 2>&1 | grep -c '✗\|터짐\|ERROR\|PROBE 없음'; }
for f in $M; do
  a=$(run $f "390 844 C:/Users/ghdrn/Documents/board16m_wtbefore.html")
  b=$(run $f "390 844 C:/Users/ghdrn/Documents/board16m.html")
  [ "$a" != "$b" ] && { echo "폰 $f  전$a 후$b  ★달라짐"; n=$((n+1)); }
done
for f in $P; do
  a=$(run $f "1600 1000 C:/Users/ghdrn/Documents/board16_wtbefore.html")
  b=$(run $f "1600 1000 C:/Users/ghdrn/Documents/board16.html")
  [ "$a" != "$b" ] && { echo "PC $f  전$a 후$b  ★달라짐"; n=$((n+1)); }
done
echo "── 달라진 프로브 $n 개 / 총 66개 — 대기 칩과 3부반 세로 띠 걷기"
