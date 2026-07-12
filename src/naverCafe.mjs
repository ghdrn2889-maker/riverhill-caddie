// 네이버 카페 '전체글' 최신 목록을 내부 JSON API로 가져온다.
// (검증된 엔드포인트: ArticleListV2.json + queryType=lastArticle)

function cfg() {
  const club = process.env.CAFE_CLUB_ID || '31185658';
  const nidAut = process.env.NID_AUT;
  const nidSes = process.env.NID_SES;
  return { club, nidAut, nidSes };
}

export async function fetchLatestArticles(perPage = 20) {
  const { club, nidAut, nidSes } = cfg();
  if (!nidAut || !nidSes) throw new Error('.env 에 NID_AUT / NID_SES 쿠키가 없습니다.');

  const url = 'https://apis.naver.com/cafe-web/cafe2/ArticleListV2.json'
    + `?search.clubid=${club}`
    + '&search.queryType=lastArticle'
    + '&search.page=1'
    + `&search.perPage=${perPage}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Referer': `https://cafe.naver.com/f-e/cafes/${club}/menus/0?viewType=L`,
      'Cookie': `NID_AUT=${nidAut}; NID_SES=${nidSes}`,
      'Accept': 'application/json, text/plain, */*',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  const list = data?.message?.result?.articleList;
  if (!Array.isArray(list)) {
    throw new Error('예상과 다른 응답 (쿠키 만료 가능성): ' + JSON.stringify(data).slice(0, 200));
  }

  return list
    .filter((a) => a.articleId && a.subject)      // 공지/구분선 등 잡항목 제거
    .map((a) => ({
      id: String(a.articleId),
      subject: a.subject,
      writer: a.writerNickname ?? a.writerInfo?.nickName ?? a.writerInfo?.nickname ?? '',
      writeDate: a.writeDate ?? '',
      ts: a.writeDateTimestamp ?? null,
      menuId: a.menuId != null ? String(a.menuId) : '',
      menuName: a.menuName ?? '',
      commentCount: a.commentCount ?? 0,
      url: `https://cafe.naver.com/f-e/cafes/${club}/articles/${a.articleId}`,
    }));
}
