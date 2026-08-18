import {
  createDefaultYoutubeLibrary,
  YOUTUBE_LIBRARY_MAX_ITEMS,
  type YoutubeLibrary,
  type YoutubePlaybackInfo,
  type YoutubeVideoItem,
} from '../../shared/types';

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export const EMPTY_YOUTUBE_LIBRARY: YoutubeLibrary = {
  items: [],
  currentIndex: -1,
};

/** 저장·표시에 쓸 큐를 고친다. 입력이 없으면 기본 샘플, 빈 배열은 빈 목록이다. */
export function normalizeYoutubeLibrary(input: unknown): YoutubeLibrary {
  if (!input || typeof input !== 'object') return createDefaultYoutubeLibrary();
  const source = input as Partial<YoutubeLibrary>;
  if (!Array.isArray(source.items)) return createDefaultYoutubeLibrary();
  const items: YoutubeVideoItem[] = [];
  for (const item of source.items) {
    const normalized = normalizeYoutubeVideoItem(item);
    if (!normalized) continue;
    if (items.some((existing) => existing.videoId === normalized.videoId)) continue;
    items.push(normalized);
    if (items.length >= YOUTUBE_LIBRARY_MAX_ITEMS) break;
  }
  if (items.length === 0) return { ...EMPTY_YOUTUBE_LIBRARY };
  const rawIndex = Number(source.currentIndex);
  const currentIndex = Number.isInteger(rawIndex)
    ? Math.min(items.length - 1, Math.max(0, rawIndex))
    : 0;
  return { items, currentIndex };
}

export function currentYoutubeItem(library: YoutubeLibrary): YoutubeVideoItem | null {
  if (library.currentIndex < 0 || library.currentIndex >= library.items.length) return null;
  return library.items[library.currentIndex] ?? null;
}

export function addYoutubeVideo(
  library: YoutubeLibrary,
  item: YoutubeVideoItem
): YoutubeLibrary {
  if (!VIDEO_ID_PATTERN.test(item.videoId)) {
    throw new Error('YouTube 영상 URL 또는 ID를 입력하세요.');
  }
  if (library.items.some((existing) => existing.videoId === item.videoId)) {
    throw new Error('이미 목록에 있는 영상입니다.');
  }
  if (library.items.length >= YOUTUBE_LIBRARY_MAX_ITEMS) {
    throw new Error(`영상은 최대 ${YOUTUBE_LIBRARY_MAX_ITEMS}개까지 추가할 수 있습니다.`);
  }
  const items = [...library.items, item];
  return {
    items,
    currentIndex: library.currentIndex < 0 ? 0 : library.currentIndex,
  };
}

export function removeYoutubeVideo(library: YoutubeLibrary, index: number): YoutubeLibrary {
  if (!Number.isInteger(index) || index < 0 || index >= library.items.length) {
    throw new Error('목록에서 해당 영상을 찾지 못했습니다.');
  }
  const items = library.items.filter((_, itemIndex) => itemIndex !== index);
  if (items.length === 0) return { ...EMPTY_YOUTUBE_LIBRARY };
  let currentIndex = library.currentIndex;
  if (index < currentIndex) currentIndex -= 1;
  else if (index === currentIndex) currentIndex = Math.min(index, items.length - 1);
  return { items, currentIndex };
}

export function moveYoutubeVideo(
  library: YoutubeLibrary,
  index: number,
  direction: -1 | 1
): YoutubeLibrary {
  const target = index + direction;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    target < 0 ||
    index >= library.items.length ||
    target >= library.items.length
  ) {
    return library;
  }
  const items = [...library.items];
  const [moved] = items.splice(index, 1);
  items.splice(target, 0, moved);
  let currentIndex = library.currentIndex;
  if (currentIndex === index) currentIndex = target;
  else if (currentIndex === target) currentIndex = index;
  return { items, currentIndex };
}

export function selectYoutubeIndex(library: YoutubeLibrary, index: number): YoutubeLibrary {
  if (library.items.length === 0) return { ...EMPTY_YOUTUBE_LIBRARY };
  if (!Number.isInteger(index) || index < 0 || index >= library.items.length) {
    throw new Error('재생할 영상을 찾지 못했습니다.');
  }
  return { ...library, currentIndex: index };
}

export function stepYoutubeIndex(library: YoutubeLibrary, step: -1 | 1): YoutubeLibrary {
  if (library.items.length === 0) return { ...EMPTY_YOUTUBE_LIBRARY };
  const current = library.currentIndex < 0 ? 0 : library.currentIndex;
  const next = (current + step + library.items.length) % library.items.length;
  return { ...library, currentIndex: next };
}

export function rememberYoutubeMetadata(
  library: YoutubeLibrary,
  info: Pick<YoutubePlaybackInfo, 'videoId' | 'title' | 'channel'>
): YoutubeLibrary {
  if (!info.videoId || (!info.title.trim() && !info.channel.trim())) return library;
  let changed = false;
  const items = library.items.map((item) => {
    if (item.videoId !== info.videoId) return item;
    const title = info.title.trim() || item.title;
    const channel = info.channel.trim() || item.channel;
    if (title === item.title && channel === item.channel) return item;
    changed = true;
    return { ...item, title, channel };
  });
  return changed ? { ...library, items } : library;
}

/** 플레이어 스냅샷에 로컬 큐 위치를 붙인다. */
export function withYoutubeQueue(
  info: Omit<YoutubePlaybackInfo, 'queueIndex' | 'queueCount'>,
  library: YoutubeLibrary
): YoutubePlaybackInfo {
  return {
    ...info,
    queueIndex: library.currentIndex,
    queueCount: library.items.length,
  };
}

export function sameYoutubePlayback(
  left: YoutubePlaybackInfo | null,
  right: YoutubePlaybackInfo | null
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.videoId === right.videoId &&
    left.title === right.title &&
    left.channel === right.channel &&
    left.state === right.state &&
    left.signedIn === right.signedIn &&
    left.adPlaying === right.adPlaying &&
    left.queueIndex === right.queueIndex &&
    left.queueCount === right.queueCount &&
    Math.floor(left.duration) === Math.floor(right.duration) &&
    Math.floor(left.position) === Math.floor(right.position)
  );
}

function normalizeYoutubeVideoItem(input: unknown): YoutubeVideoItem | null {
  if (!input || typeof input !== 'object') return null;
  const source = input as Partial<YoutubeVideoItem>;
  const videoId = String(source.videoId ?? '').trim();
  if (!VIDEO_ID_PATTERN.test(videoId)) return null;
  const addedAt =
    typeof source.addedAt === 'string' && source.addedAt
      ? source.addedAt
      : '2026-01-01T00:00:00.000Z';
  return {
    videoId,
    title: typeof source.title === 'string' ? source.title : '',
    channel: typeof source.channel === 'string' ? source.channel : '',
    addedAt,
  };
}
