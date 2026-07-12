// 글 하나의 본문(텍스트) + 첨부이미지 + 댓글을 가져온다. (검증된 v2.1 read API)
function cfg() {
  return {
    club: process.env.CAFE_CLUB_ID || '31185658',
    nidAut: process.env.NID_AUT,
    nidSes: process.env.NID_SES,
  };
}

function extractImages(html) {
  const urls = new Set();
  const re = /<img[^>]+src="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const u = m[1];
    // 캐디 프로필/기본이미지 제외, 실제 첨부(cafeptthumb/phinf)만
    if (u.includes('cafeptthumb') || u.includes('phinf')) urls.add(u);
  }
  return [...urls];
}

function htmlToText(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|​|ㅤ/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchArticle(id) {
  const { club, nidAut, nidSes } = cfg();
  const url = `https://apis.naver.com/cafe-web/cafe-articleapi/v2.1/cafes/${club}/articles/${id}?query=&useCafeId=true&requestFrom=A`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Referer': `https://cafe.naver.com/f-e/cafes/${club}/articles/${id}`,
      'Cookie': `NID_AUT=${nidAut}; NID_SES=${nidSes}`,
      'Accept': 'application/json, text/plain, */*',
    },
  });
  if (!res.ok) throw new Error(`글 읽기 HTTP ${res.status}`);
  const data = await res.json();
  const art = data?.result?.article;
  if (!art) throw new Error('글 본문을 찾지 못함 (쿠키 만료 가능성)');

  const html = art.contentHtml || '';
  const comments = (data.result.comments?.items || [])
    .filter((c) => !c.isDeleted)
    .map((c) => ({ nick: c.writer?.nick || '', content: c.content || '', date: c.updateDate || null }));

  return {
    id: String(id),
    subject: art.subject || '',
    writer: art.writer?.nick || art.writer?.nickname || art.writerNick || '',
    menuId: art.menu?.id != null ? String(art.menu.id) : '',
    menuName: art.menu?.name || '',
    head: art.head || '',                       // 말머리 (당일추가/당일취소/휴무신청 등)
    writeDate: art.writeDate || null,
    text: htmlToText(html),
    images: extractImages(html),
    comments,
    url: `https://cafe.naver.com/f-e/cafes/${club}/articles/${id}`,
  };
}
