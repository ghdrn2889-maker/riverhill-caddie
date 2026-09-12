#!/bin/bash
# ══════════════════════════════════════════════════════════════
#  날마다 — 짐을 싸고, 집 밖으로 한 벌 보낸다.
#  새벽에 저절로 돈다(crontab). 사람 손이 안 간다.
#    · 날마다   알맹이(프로그램+설정+데이터)
#    · 일요일   사진까지
#  집 밖 보내기는 /home/ada/.riverhill-offsite 에 한 줄 적혀 있을 때만 한다.
# ══════════════════════════════════════════════════════════════
set -uo pipefail

HERE=$(dirname "$(readlink -f "$0")")
OUT="${OUT:-/home/ada/riverhill-backup}"
OFFCONF="${OFFCONF:-/home/ada/.riverhill-offsite}"
RCLONE="${RCLONE:-/home/ada/bin/rclone}"
STATUS="$OUT/STATUS.txt"
KEEP_OFFSITE_DAYS="${KEEP_OFFSITE_DAYS:-180}"

mkdir -p "$OUT"
now(){ date '+%Y-%m-%d %H:%M:%S'; }
say(){ echo "[$(now)] $*"; }

say "── 날마다 짐 싸기 시작"
kind=core
[ "$(date +%u)" = 7 ] && kind=all          # 일요일엔 사진까지
packok=1
"$HERE/backup-pack.sh" "$kind" || packok=0
[ "$packok" = 1 ] && say "짐 싸기 됨($kind)" || say "★짐 싸기 실패($kind)"

# ── 집 밖으로 한 벌
offline="안 함(보낼 곳이 아직 없음)"
if [ -s "$OFFCONF" ] && [ -x "$RCLONE" ]; then
  TARGET=$(head -1 "$OFFCONF" | tr -d '\r\n')
  if [ -n "$TARGET" ]; then
    # ★보내기만 하고 지우지는 않는다 — 여기 것이 통째로 날아가도 저쪽은 남는다
    if "$RCLONE" copy "$OUT" "$TARGET" --include 'riverhill-*.tar.zst.gpg' \
         --transfers 2 --retries 3 --stats-one-line --stats 0 2>&1; then
      # 저쪽에서 아주 오래된 것만 걷는다
      "$RCLONE" delete "$TARGET" --include 'riverhill-*.tar.zst.gpg' \
         --min-age "${KEEP_OFFSITE_DAYS}d" 2>&1 || true
      n=$("$RCLONE" lsf "$TARGET" --include 'riverhill-*.tar.zst.gpg' 2>/dev/null | wc -l)
      offline="됨 — $TARGET 에 $n 개"
      say "집 밖으로 보냄: $offline"
    else
      offline="★실패 — $TARGET"
      say "$offline"
    fi
  fi
fi

# ── 지금 어떤지 한 장으로 적어 둔다 (물어보면 이것만 보면 된다)
cores=$(ls -1 "$OUT"/riverhill-core-*.tar.zst.gpg 2>/dev/null | wc -l)
medias=$(ls -1 "$OUT"/riverhill-media-*.tar.zst.gpg 2>/dev/null | wc -l)
last=$(ls -1t "$OUT"/riverhill-core-*.tar.zst.gpg 2>/dev/null | head -1)
{
  echo "마지막으로 돈 때 : $(now)"
  echo "짐 싸기          : $([ "$packok" = 1 ] && echo 됨 || echo ★실패)"
  echo "알맹이 묶음      : $cores 개"
  echo "사진 묶음        : $medias 개"
  echo "가장 최근 알맹이 : $([ -n "$last" ] && echo "$(basename "$last")  $(du -h "$last" | cut -f1)" || echo 없음)"
  echo "여기 쌓인 크기   : $(du -sh "$OUT" 2>/dev/null | cut -f1)"
  echo "집 밖 한 벌      : $offline"
} > "$STATUS"
say "── 끝"
[ "$packok" = 1 ]
