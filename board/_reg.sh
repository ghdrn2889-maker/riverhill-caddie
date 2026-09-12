#!/bin/bash
cd "$(dirname "$0")"
M="_probeTee3 _probeTee _probeTeamDel _probeStray _probeBu3In2 _probeClear _probeMove39 _probeExact _probeAddTeam _probeFlow2 _probeJoIn _probeSwapOff _probeAddBack2 _probeRoundClash _probeWkQ _probeEmptySeat _probeLnWait _probeSeatVac _probeLnOrder _probeCartLend2 _probeCart _probePool _probeCarryOpt _probeCarryDiag _probeBulkFind _probeNoSeat _probeDupFix _probeSwapList _probeAbs _probeWhy23 _probeRestUI _probeSeatTag _probeJochul _probeBu3Set _probeWipe _probeWkBadge _probeDayTag _probeDraftUndo _probeCatchUp _probeDayTap _probeMigrate _probeDays _probeSave _probePmStay _probeUnplaced _probePartMove _probeCarryUI _probeCarry _probeBu3UI _probeBu3 _probeWkOrder _probeLnUI _probeLineup _probeBulk"
P="_probeRoundClash _probeWkQ _probeBulkFind _probeCarryOpt _probePcPartMove _probePcCellRm _probePcDayTag _probePcCatchUp _probePcDays _probePcAbs _probePcCarry _probePcBu3 _probePcWk _probePcLn _probePcRot _probeBulkPc"
for f in $M; do
  r=$(PYTHONIOENCODING=utf-8 python runm.py $f.html 2>&1)
  bad=$(printf '%s' "$r" | grep -c '✗\|터짐\|ERROR\|PROBE 없음')
  err=$(printf '%s' "$r" | grep -o 'errs: .*' | head -1)
  echo "폰  $f  문제 $bad  $err"
done
for f in $P; do
  r=$(PYTHONIOENCODING=utf-8 python runm.py $f.html 1600 1000 "C:/Users/ghdrn/Documents/board16.html" 2>&1)
  bad=$(printf '%s' "$r" | grep -c '✗\|터짐\|ERROR\|PROBE 없음')
  err=$(printf '%s' "$r" | grep -o 'errs: .*' | head -1)
  echo "PC  $f  문제 $bad  $err"
done
