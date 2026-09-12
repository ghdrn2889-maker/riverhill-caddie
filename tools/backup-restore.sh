#!/bin/bash
# ══════════════════════════════════════════════════════════════
#  세우기 — 묶음 하나로 앱을 어느 자리에나 다시 세운다.
#  고장 나서 되살리는 것과 다른 컴퓨터로 옮기는 것은 같은 일이다.
#
#      backup-restore.sh <목적지 폴더> [옵션]
#
#  옵션
#      --core <파일>    쓸 알맹이 묶음        (기본: 가장 최근 것)
#      --media <파일>   사진도 같이           (auto = 가장 최근 · 기본: 안 넣음)
#      --port N         앱이 설 자리          (기본: 시험 3200 · 진짜 3000)
#      --monitor-port N 모니터 자리           (기본: 시험 3210 · 진짜 3100)
#      --name NAME      돌릴 때 붙일 이름     (기본: riverhill-<폴더이름>)
#      --live           ★진짜로 세운다 — 열쇠를 그대로 두고 알림도 나간다
#      --no-start       풀기만 하고 안 켠다
#      --force          목적지에 뭐가 있어도 밀고 간다
#
#  ★기본은 '시험'이다: 열쇠를 다 빼고 알림을 끈 채로 선다.
#    사본이 회원에게 알림을 두 번 보내거나 카페를 두 번 긁는 일이 없어야 한다.
# ══════════════════════════════════════════════════════════════
set -euo pipefail

OUT="${OUT:-/home/ada/riverhill-backup}"
PASS="${PASS:-/home/ada/.riverhill-backup-pass}"
LIVEAPP="${LIVEAPP:-/home/ada/riverhill-caddie}"
GPG=(gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$PASS")

log(){ echo "  $*"; }
die(){ echo "✗ $*" >&2; exit 1; }

DEST=""; CORE=""; MEDIA=""; PORT=""; MPORT=""; NAME=""
MODE=safe; START=1; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --core)  CORE="$2"; shift 2 ;;
    --media) MEDIA="$2"; shift 2 ;;
    --port)  PORT="$2"; shift 2 ;;
    --monitor-port) MPORT="$2"; shift 2 ;;
    --name)  NAME="$2"; shift 2 ;;
    --live)  MODE=live; shift ;;
    --no-start) START=0; shift ;;
    --force) FORCE=1; shift ;;
    -*) die "모르는 옵션: $1" ;;
    *)  [ -z "$DEST" ] || die "목적지는 하나만"; DEST="$1"; shift ;;
  esac
done
[ -n "$DEST" ] || die "쓰는 법: backup-restore.sh <목적지 폴더> [옵션]"
DEST="$(readlink -m "$DEST")"
[ "$DEST" != "$(readlink -m "$LIVEAPP")" ] || die "★돌고 있는 앱 자리에는 못 풉니다: $DEST"
case "$DEST" in /|/home|"$HOME") die "★여기에는 못 풉니다: $DEST" ;; esac
[ "$(echo "$DEST" | tr -cd / | wc -c)" -ge 2 ] || die "★너무 얕은 자리입니다: $DEST"
[ -s "$PASS" ] || die "암호 파일이 없습니다: $PASS"

[ -n "$CORE" ] || CORE=$(ls -1t "$OUT"/riverhill-core-*.tar.zst.gpg 2>/dev/null | head -1 || true)
[ -s "${CORE:-}" ] || die "쓸 알맹이 묶음이 없습니다"
if [ "$MEDIA" = auto ]; then MEDIA=$(ls -1t "$OUT"/riverhill-media-*.tar.zst.gpg 2>/dev/null | head -1 || true); fi

if [ "$MODE" = safe ]; then PORT="${PORT:-3200}"; MPORT="${MPORT:-3210}"
else                        PORT="${PORT:-3000}"; MPORT="${MPORT:-3100}"; fi
BASE=$(basename "$DEST")
case "$BASE" in riverhill*) NAME="${NAME:-$BASE}" ;; *) NAME="${NAME:-riverhill-$BASE}" ;; esac
[ "$MODE" = live ] || case "$NAME" in riverhill|riverhill-monitor) die "시험인데 본판 이름을 씁니다: $NAME" ;; esac

if [ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ] && [ "$FORCE" = 0 ]; then
  die "목적지가 비어 있지 않습니다: $DEST  (밀고 가려면 --force)"
fi

echo "── 세우기 시작"
log "묶음    : $(basename "$CORE")  $(du -h "$CORE" | cut -f1)"
[ -n "$MEDIA" ] && log "사진    : $(basename "$MEDIA")  $(du -h "$MEDIA" | cut -f1)"
log "목적지  : $DEST"
log "자리    : 앱 $PORT · 모니터 $MPORT"
log "이름    : $NAME"
log "방식    : $([ "$MODE" = safe ] && echo '시험 — 열쇠 빼고 알림 끔' || echo '★진짜 — 열쇠 그대로, 알림 나감')"

TMP=$(mktemp -d /tmp/rhrest.XXXXXX); trap 'rm -rf "$TMP"' EXIT
"${GPG[@]}" --decrypt "$CORE" 2>/dev/null | zstd -dq -c | tar -C "$TMP" -xf - || die "묶음을 못 풀었습니다"
[ -s "$TMP/app/src/server.mjs" ] || die "묶음 속에 프로그램이 없습니다"
cat "$TMP/WHAT.txt" 2>/dev/null | sed 's/^/    │ /'

rm -rf "$DEST"; mkdir -p "$DEST"
rsync -a "$TMP/app/" "$DEST/"
mkdir -p "$DEST/data"
rsync -a "$TMP/data/" "$DEST/data/"
log "푼 것    : 파일 $(find "$DEST" -type f | wc -l) 개"

if [ -n "$MEDIA" ]; then
  rm -rf "$TMP/m"; mkdir -p "$TMP/m"
  "${GPG[@]}" --decrypt "$MEDIA" 2>/dev/null | zstd -dq -c | tar -C "$TMP/m" -xf - || die "사진 묶음을 못 풀었습니다"
  rsync -a "$TMP/m/data/" "$DEST/data/"
  log "사진     : 넣음"
fi

# ── 설정 손질
setenv(){                              # setenv <키> <값>
  local k="$1" v="$2" f="$DEST/.env"
  if grep -qE "^$k=" "$f" 2>/dev/null; then
    sed -i "s|^$k=.*|$k=$v|" "$f"
  else
    printf '%s=%s\n' "$k" "$v" >> "$f"
  fi
}
[ -s "$DEST/.env" ] || die "설정 파일이 없습니다"
setenv HOST 127.0.0.1
setenv PORT "$PORT"
setenv MONITOR_PORT "$MPORT"
if [ "$MODE" = safe ]; then
  setenv PUSH_DISABLED 1
  touch "$DEST/data/push-disabled"
  setenv MONITOR_TOKEN "$(openssl rand -hex 16)"
  for k in NID_AUT NID_SES GEMINI_API_KEY INGEST_TOKEN \
           NAVER_CLIENT_SECRET GOOGLE_CLIENT_SECRET; do
    grep -qE "^$k=" "$DEST/.env" && setenv "$k" ""
  done
  # ★알림 열쇠는 비우면 앱이 아예 안 뜬다(연습에서 드러났다). 대신 시험용으로 새로 만든다 —
  #   열쇠가 다르니 진짜 구독자에게는 어차피 못 간다. 알림 끄기와 두 겹이 된다
  V=$(cd "$DEST" && node -e 'const w=require("web-push"); const k=w.generateVAPIDKeys(); console.log(k.publicKey+" "+k.privateKey);' 2>/dev/null) \
    || die "시험용 알림 열쇠를 못 만들었습니다"
  setenv VAPID_PUBLIC_KEY  "${V%% *}"
  setenv VAPID_PRIVATE_KEY "${V##* }"
  log "설정     : 바깥 열쇠 6개 비움 · 알림 열쇠는 시험용 새것 · 알림 끔(두 겹)"
fi

if [ "$START" = 0 ]; then echo "── 풀기까지 끝. 켜지는 않았습니다"; exit 0; fi

command -v pm2 >/dev/null || die "pm2 가 없습니다"
pm2 delete "$NAME" >/dev/null 2>&1 || true
( cd "$DEST" && pm2 start src/server.mjs --name "$NAME" --time >/dev/null )
log "켰습니다 : $NAME"

# ── 확인
ok=0
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$PORT/" || true)
  [ "$code" = 200 ] && { ok=1; break; }
  sleep 1
done
if [ "$ok" = 1 ]; then
  log "확인     : http://127.0.0.1:$PORT 가 열립니다 (200)"
  n=$(node -e '
    const {DatabaseSync}=require("node:sqlite");
    const d=new DatabaseSync(process.argv[1],{readOnly:true});
    console.log(d.prepare("SELECT count(*) c FROM users").get().c); d.close();
  ' "$DEST/data/app.db" 2>/dev/null || echo '?')
  log "회원     : $n 명이 그대로 따라왔습니다"
  echo "── 다 섰습니다"
else
  echo "✗ 켜기는 했는데 $PORT 가 안 열립니다 — pm2 logs $NAME 로 까닭을 봅니다" >&2
  pm2 logs "$NAME" --lines 15 --nostream 2>/dev/null | tail -18
  exit 1
fi
