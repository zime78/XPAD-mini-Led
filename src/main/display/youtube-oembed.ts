/** 키 없는 oEmbed로 제목·채널을 채운다. 실패해도 추가는 막지 않는다. */
export async function fetchYoutubeOembed(
  videoId: string
): Promise<{ title: string; channel: string }> {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`
  )}&format=json`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return { title: '', channel: '' };
    const data = (await response.json()) as { title?: unknown; author_name?: unknown };
    return {
      title: typeof data.title === 'string' ? data.title : '',
      channel: typeof data.author_name === 'string' ? data.author_name : '',
    };
  } catch {
    return { title: '', channel: '' };
  }
}
