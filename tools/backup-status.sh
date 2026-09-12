#!/bin/bash
# 백업이 어떻게 돌고 있는지 한눈에.
OUT="${OUT:-/home/ada/riverhill-backup}"
echo "── 백업 상태"
if [ -s "$OUT/STATUS.txt" ]; then sed 's/^/  /' "$OUT/STATUS.txt"; else echo "  아직 한 번도 저절로 안 돌았습니다"; fi
echo "── 최근 묶음 5개"
ls -1lt "$OUT"/riverhill-*.tar.zst.gpg 2>/dev/null | head -5 | awk '{printf "  %-46s %6s  %s %s %s\n", $9, $5, $6, $7, $8}' | sed "s|$OUT/||"
echo "── 언제 도나"
crontab -l 2>/dev/null | grep -E "backup-nightly" | sed 's/^/  /' || echo "  아직 안 걸렸습니다"
echo "── 마지막 기록 5줄"
tail -5 "$OUT/backup.log" 2>/dev/null | sed 's/^/  /' || echo "  없음"
