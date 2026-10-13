import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { publicHttpGet, withPublicHttpsProxy } from "./public-http.js";

type CaptionTrack = { url: string; ext: string };
type VideoMetadata = {
  id: string;
  title?: string;
  language?: string;
  formats?: Array<{ language?: string; language_preference?: number }>;
  subtitles?: Record<string, CaptionTrack[]>;
  automatic_captions?: Record<string, CaptionTrack[]>;
};

export function youtubeVideoId(rawUrl: string): string | null {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  const id = host === "youtu.be" ? url.pathname.slice(1) :
    ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host) ?
      url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)$/)?.[1] : null;
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

export async function fetchYoutubeTranscript(requestedUrl: string, videoId: string) {
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const metadata = await withPublicHttpsProxy(async (proxy) => {
    const { stdout } = await promisify(execFile)(process.env.YT_DLP_PATH || "yt-dlp", [
      "--ignore-config", "--no-cache-dir", "--no-playlist", "--skip-download",
      "--print", '{"id":%(id)j,"title":%(title)j,"language":%(language)j,"formats":%(formats.:.{language,language_preference})j,"subtitles":%(subtitles)j,"automatic_captions":%(automatic_captions)j}', "--js-runtimes", "node", "--proxy", proxy,
      "--output-na-placeholder", "null",
      "--socket-timeout", "30", "--retries", "0", "--", canonicalUrl
    ], { windowsHide: true, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
    try { return JSON.parse(stdout) as VideoMetadata; }
    catch { throw new Error("yt-dlp returned invalid caption metadata JSON"); }
  });
  if (metadata.id !== videoId) throw new Error("YouTube metadata video ID mismatch");
  const selected = selectCaptionTrack(metadata);
  if (!selected) throw new Error("no original-language captions available for this video");
  const response = await publicHttpGet(selected.track.url);
  if (response.status !== 200) throw new Error(`caption HTTP status ${response.status}`);
  const text = decodeJson3Transcript(response.body);
  if (!text) throw new Error("caption track contains no transcript text");
  return {
    requestedUrl, finalUrl: canonicalUrl, canonicalUrl, public: true as const,
    retrievalUrl: response.finalUrl,
    status: response.status, contentType: "text/plain; source=youtube-captions",
    title: metadata.title ?? null, text,
    transcript: { language: selected.language, automatic: selected.automatic }
  };
}

export function selectCaptionTrack(metadata: VideoMetadata): { track: CaptionTrack; language: string; automatic: boolean } | null {
  const auto = metadata.automatic_captions ?? {};
  const originalKeys = Object.keys(auto).filter((language) => language.endsWith("-orig"));
  // yt-dlp's YouTube extractor marks original audio with language_preference=10.
  // A dubbed track can also have an '-orig' caption key, so the first key is not
  // necessarily the video's original language.
  const originalLanguage = metadata.formats?.find((format) => format.language_preference === 10)?.language ?? metadata.language ?? (originalKeys.length === 1 ? originalKeys[0]?.replace(/-orig$/, "") : undefined);
  const creator = metadata.subtitles ?? {};
  const languageMatches = (language: string) => originalLanguage !== undefined &&
    (language === originalLanguage || language.split("-")[0] === originalLanguage.split("-")[0]);
  const originalKey = originalKeys.find((key) => key === `${originalLanguage}-orig`) ?? originalKeys.find((key) => languageMatches(key.replace(/-orig$/, "")));
  const creatorKeys = Object.keys(creator).filter((language) => language !== "live_chat");
  const creatorKey = creatorKeys.find(languageMatches) ?? (!originalLanguage && creatorKeys.length === 1 ? creatorKeys[0] : undefined);
  const choices = [
    creatorKey ? { language: creatorKey, automatic: false, tracks: creator[creatorKey] } : null,
    originalKey ? { language: originalKey.replace(/-orig$/, ""), automatic: true, tracks: auto[originalKey] } : null,
    originalLanguage ? { language: originalLanguage, automatic: true, tracks: auto[originalLanguage] } : null
  ];
  for (const choice of choices) {
    const track = choice?.tracks?.find((item) => item.ext === "json3");
    if (choice && track) return { track, language: choice.language, automatic: choice.automatic };
  }
  return null;
}

export function decodeJson3Transcript(body: string): string {
  const parsed = JSON.parse(body) as { events?: Array<{ tStartMs?: number; segs?: Array<{ utf8?: string }> }> };
  return (parsed.events ?? []).flatMap((event) => {
    const text = (event.segs ?? []).map((segment) => segment.utf8 ?? "").join("").replace(/\s+/g, " ").trim();
    if (!text) return [];
    const seconds = Math.floor((event.tStartMs ?? 0) / 1000);
    const timestamp = `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    return [`[${timestamp}] ${text}`];
  }).join("\n");
}
