import {
  Box,
  Heading,
  HStack,
  Icon,
  Text,
  VStack,
  Spinner,
  Button,
  Badge,
} from "@hope-ui/solid"
import {
  For,
  Show,
  createSignal,
  onCleanup,
  onMount,
  createMemo,
  batch,
} from "solid-js"
import { useT, useRouter } from "~/hooks"
import { getMainColor, password } from "~/store"
import { Obj, ObjType } from "~/types"
import { fsList, pathJoin, fetchText } from "~/utils"
import { getLinkByDirAndObj } from "~/hooks/useLink"
import { getIconByObj } from "~/utils/icon"
import { BiRegularFolderOpen } from "solid-icons/bi"
import { BsChevronDown, BsChevronRight, BsFileText } from "solid-icons/bs"
import lightGallery from "lightgallery"
import lgThumbnail from "lightgallery/plugins/thumbnail"
import lgZoom from "lightgallery/plugins/zoom"
import lgFullscreen from "lightgallery/plugins/fullscreen"
import "lightgallery/css/lightgallery-bundle.css"
import { LightGallery } from "lightgallery/lightgallery"

// ── Types ──────────────────────────────────────────────────

interface MediaItem {
  obj: Obj
  dir: string
}

interface FolderGroup {
  name: string
  path: string
  images: MediaItem[]
  videos: MediaItem[]
  texts: MediaItem[]
}

// ── Extension sets ─────────────────────────────────────────

const VIDEO_EXTS = new Set([
  "mp4",
  "mkv",
  "avi",
  "mov",
  "wmv",
  "flv",
  "webm",
  "m4v",
  "ts",
  "rmvb",
  "rm",
])
const IMAGE_EXTS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "bmp",
  "webp",
  "svg",
  "ico",
  "tiff",
  "tif",
])
const TEXT_EXTS = new Set([
  "txt",
  "log",
  "md",
  "json",
  "xml",
  "yaml",
  "yml",
  "ini",
  "conf",
  "cfg",
  "csv",
  "html",
  "css",
  "js",
  "ts",
  "jsx",
  "tsx",
  "py",
  "sh",
  "bat",
  "ps1",
])

function getExt(name: string): string {
  const i = name.lastIndexOf(".")
  return i > 0 ? name.slice(i + 1).toLowerCase() : ""
}

function isMediaObj(obj: Obj): boolean {
  if (obj.is_dir) return false
  const e = getExt(obj.name)
  return (
    obj.type === ObjType.IMAGE ||
    obj.type === ObjType.VIDEO ||
    obj.type === ObjType.TEXT ||
    IMAGE_EXTS.has(e) ||
    VIDEO_EXTS.has(e) ||
    TEXT_EXTS.has(e)
  )
}

function mediaType(obj: Obj): "image" | "video" | "text" | null {
  const e = getExt(obj.name)
  if (obj.type === ObjType.IMAGE || IMAGE_EXTS.has(e)) return "image"
  if (obj.type === ObjType.VIDEO || VIDEO_EXTS.has(e)) return "video"
  if (obj.type === ObjType.TEXT || TEXT_EXTS.has(e)) return "text"
  return null
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B"
  const u = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${u[i]}`
}

const PAGE_SIZE = 50

// ── CSS ────────────────────────────────────────────────────

const GALLERY_CSS = `
.gallery-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}
.gallery-card {
  border-radius: 10px;
  border: 2px solid transparent;
  overflow: hidden;
  flex-shrink: 0;
  cursor: pointer;
  transition: all 0.2s ease;
}
.gallery-card:hover {
  border-color: var(--hope-colors-primary7, #3b82f6);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  transform: translateY(-2px);
}
.gallery-card img {
  display: block;
  width: 100%;
  object-fit: cover;
  border-radius: 6px;
}
.gallery-card .card-label {
  font-size: 11px;
  text-align: center;
  padding: 4px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gallery-video-card {
  border-radius: 10px;
  border: 2px solid transparent;
  overflow: hidden;
  flex-shrink: 0;
  transition: all 0.2s ease;
}
.gallery-video-card:hover {
  border-color: var(--hope-colors-danger7, #ef4444);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}
.gallery-video-wrap {
  position: relative;
  width: 100%;
  height: 160px;
  background: #000;
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.gallery-video-wrap .play-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}
.gallery-video-wrap .play-btn:hover {
  background: #ef4444;
  transform: scale(1.1);
}
.gallery-video-wrap .play-btn::after {
  content: '';
  display: block;
  width: 0;
  height: 0;
  border-top: 10px solid transparent;
  border-bottom: 10px solid transparent;
  border-left: 16px solid white;
  margin-left: 3px;
}
.gallery-video-wrap .close-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(0,0,0,0.6);
  border: none;
  color: white;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}
.gallery-video-wrap .close-btn:hover {
  background: #ef4444;
}
.gallery-video-wrap video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.gallery-text-card {
  border-radius: 10px;
  border: 2px solid transparent;
  overflow: hidden;
  flex-shrink: 0;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--hope-colors-neutral3, #f5f5f5);
}
.gallery-text-card:hover {
  border-color: var(--hope-colors-success7, #22c55e);
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
.gallery-text-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
}
.gallery-text-header .text-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gallery-text-header .text-size {
  font-size: 11px;
  opacity: 0.6;
  flex-shrink: 0;
}
.gallery-text-header .text-arrow {
  font-size: 10px;
  opacity: 0.5;
  flex-shrink: 0;
}
.gallery-text-content {
  border-top: 1px solid var(--hope-colors-neutral6, #e5e5e5);
  max-height: 300px;
  overflow-y: auto;
  padding: 10px 12px;
}
.gallery-text-content pre {
  margin: 0;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}
.gallery-placeholder {
  width: 180px;
  height: 170px;
  border-radius: 10px;
  background: var(--hope-colors-neutral3, #f0f0f0);
  flex-shrink: 0;
}
`

// ── Main Gallery Component ─────────────────────────────────

const Gallery = () => {
  const t = useT()
  const { pathname, isShare } = useRouter()

  const [loading, setLoading] = createSignal(true)
  const [progress, setProgress] = createSignal("")
  const [groups, setGroups] = createSignal<FolderGroup[]>([])
  const [totalItems, setTotalItems] = createSignal(0)
  const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(
    new Set(),
  )
  let abortCtrl: AbortController | null = null

  const linkFor = (item: MediaItem, type: "direct" | "proxy" = "direct") =>
    getLinkByDirAndObj(item.dir, item.obj, type, isShare())

  // ── Recursive fetch ──
  const recursiveFetch = async (
    currentPath: string,
    depth: number,
    ctrl: AbortController,
  ): Promise<MediaItem[]> => {
    if (ctrl.signal.aborted || depth > 10) return []
    try {
      const resp = await fsList(currentPath, password(), 1, 0, false)
      if (ctrl.signal.aborted) return []
      if (resp.code !== 200) return []

      const content = resp.data?.content ?? []
      const items: MediaItem[] = []
      const subdirs: string[] = []

      for (const obj of content) {
        if (ctrl.signal.aborted) break
        if (obj.is_dir) {
          subdirs.push(pathJoin(currentPath, obj.name))
        } else if (isMediaObj(obj)) {
          items.push({ obj, dir: currentPath })
        }
      }

      const BATCH = 4
      for (let i = 0; i < subdirs.length; i += BATCH) {
        if (ctrl.signal.aborted) break
        const batch = subdirs.slice(i, i + BATCH)
        setProgress(
          `${t("home.gallery.scanning")} ... (${subdirs.length} ${t("home.gallery.subdirs")}, ${items.length} ${t("home.gallery.found")})`,
        )
        const results = await Promise.all(
          batch.map((p) => recursiveFetch(p, depth + 1, ctrl)),
        )
        for (const r of results) items.push(...r)
      }
      return items
    } catch {
      return []
    }
  }

  const loadGallery = async () => {
    abortCtrl?.abort()
    abortCtrl = new AbortController()
    const ctrl = abortCtrl
    setLoading(true)
    setProgress(t("home.gallery.scanning_root"))
    setGroups([])
    setTotalItems(0)

    const root = pathname()
    const items = await recursiveFetch(root, 0, ctrl)
    if (ctrl.signal.aborted) return

    const map = new Map<string, FolderGroup>()
    for (const item of items) {
      if (!map.has(item.dir)) {
        const rel =
          item.dir === root
            ? ""
            : item.dir.slice(root.length).replace(/^\//, "")
        map.set(item.dir, {
          name: rel || ".",
          path: item.dir,
          images: [],
          videos: [],
          texts: [],
        })
      }
      const g = map.get(item.dir)!
      const tp = mediaType(item.obj)
      if (tp === "image") g.images.push(item)
      else if (tp === "video") g.videos.push(item)
      else if (tp === "text") g.texts.push(item)
    }

    const sorted = Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    batch(() => {
      setGroups(sorted)
      setTotalItems(items.length)
      setExpandedFolders(new Set(sorted.map((g) => g.path)))
      setLoading(false)
      setProgress("")
    })
  }

  onMount(loadGallery)
  onCleanup(() => abortCtrl?.abort())

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  const counts = createMemo(() => {
    let images = 0,
      videos = 0,
      texts = 0
    for (const g of groups()) {
      images += g.images.length
      videos += g.videos.length
      texts += g.texts.length
    }
    return { images, videos, texts }
  })

  // ── LightGallery ──
  let lgInstance: LightGallery | null = null
  const allImages = createMemo(() => groups().flatMap((g) => g.images))

  const openLightbox = (item: MediaItem) => {
    const imgs = allImages()
    const idx = imgs.findIndex(
      (i) => i.obj.name === item.obj.name && i.dir === item.dir,
    )
    if (lgInstance) {
      lgInstance.destroy()
      lgInstance = null
    }
    lgInstance = lightGallery(document.createElement("div"), {
      addClass: "lightgallery-container",
      dynamic: true,
      thumbnail: true,
      plugins: [lgZoom, lgThumbnail, lgFullscreen],
      dynamicEl: imgs.map((img) => {
        const src = linkFor(img)
        return {
          src,
          thumb: img.obj.thumb === "" ? src : img.obj.thumb,
          subHtml: `<h4>${img.obj.name}</h4><p style="opacity:0.6;font-size:12px">${img.dir}</p>`,
        }
      }),
    })
    lgInstance.openGallery(Math.max(0, idx))
  }

  onCleanup(() => lgInstance?.destroy())

  // ── Render ──
  return (
    <VStack w="$full" spacing="$4" p="$2">
      {/* Inject CSS */}
      <style>{GALLERY_CSS}</style>

      {/* Stats bar */}
      <HStack w="$full" justifyContent="space-between" flexWrap="wrap" gap="$2">
        <Show when={!loading()}>
          <HStack spacing="$2" flexWrap="wrap">
            <Show when={counts().images > 0}>
              <Badge colorScheme="info">
                {counts().images} {t("home.gallery.images")}
              </Badge>
            </Show>
            <Show when={counts().videos > 0}>
              <Badge colorScheme="danger">
                {counts().videos} {t("home.gallery.videos")}
              </Badge>
            </Show>
            <Show when={counts().texts > 0}>
              <Badge colorScheme="success">
                {counts().texts} {t("home.gallery.texts")}
              </Badge>
            </Show>
          </HStack>
        </Show>
        <Button
          size="sm"
          colorScheme="accent"
          onClick={loadGallery}
          disabled={loading()}
        >
          {loading() ? t("home.gallery.loading") : t("home.gallery.refresh")}
        </Button>
      </HStack>

      {/* Loading */}
      <Show when={loading()}>
        <VStack spacing="$4" my="$8">
          <Spinner size="xl" color={getMainColor()} />
          <Text color="$neutral11">{progress()}</Text>
        </VStack>
      </Show>

      {/* Empty */}
      <Show when={!loading() && totalItems() === 0}>
        <VStack my="$8" spacing="$2">
          <Heading size="md" color="$neutral11">
            {t("home.gallery.empty")}
          </Heading>
        </VStack>
      </Show>

      {/* Groups */}
      <Show when={!loading()}>
        <For each={groups()}>
          {(group) => (
            <FolderGroupSection
              group={group}
              expanded={expandedFolders().has(group.path)}
              onToggle={() => toggleFolder(group.path)}
              onImageClick={openLightbox}
              linkFor={linkFor}
            />
          )}
        </For>
      </Show>
    </VStack>
  )
}

// ── Folder Group Section ──────────────────────────────────

const FolderGroupSection = (props: {
  group: FolderGroup
  expanded: boolean
  onToggle: () => void
  onImageClick: (item: MediaItem) => void
  linkFor: (item: MediaItem, type?: "direct" | "proxy") => string
}) => {
  const g = props.group
  const total = g.images.length + g.videos.length + g.texts.length

  return (
    <Box w="$full">
      {/* Folder header */}
      <HStack
        w="$full"
        cursor="pointer"
        p="$2"
        rounded="$lg"
        _hover={{ bgColor: "$neutral3" }}
        onClick={props.onToggle}
        justifyContent="space-between"
        mb="$2"
      >
        <HStack spacing="$2">
          <Icon as={BiRegularFolderOpen} boxSize="$6" color={getMainColor()} />
          <Text fontWeight="$bold" fontSize="$lg">
            {g.name}
          </Text>
          <Badge colorScheme="neutral">{total}</Badge>
        </HStack>
        <Icon
          as={props.expanded ? BsChevronDown : BsChevronRight}
          boxSize="$5"
          color="$neutral11"
        />
      </HStack>

      {/* Content */}
      <Show when={props.expanded}>
        <VStack w="$full" spacing="$4" pl="$2">
          <Show when={g.images.length > 0}>
            <PaginatedGrid
              items={g.images}
              renderItem={(item) => (
                <ImageCard
                  item={item}
                  src={props.linkFor(item)}
                  onClick={() => props.onImageClick(item)}
                />
              )}
            />
          </Show>
          <Show when={g.videos.length > 0}>
            <PaginatedGrid
              items={g.videos}
              renderItem={(item) => (
                <VideoCard item={item} src={props.linkFor(item)} />
              )}
            />
          </Show>
          <Show when={g.texts.length > 0}>
            <PaginatedGrid
              items={g.texts}
              renderItem={(item) => (
                <TextCard item={item} src={props.linkFor(item)} />
              )}
            />
          </Show>
        </VStack>
      </Show>
    </Box>
  )
}

// ── Paginated Grid ────────────────────────────────────────

const PaginatedGrid = <T,>(props: {
  items: T[]
  renderItem: (item: T) => any
}) => {
  const t = useT()
  const [visible, setVisible] = createSignal(PAGE_SIZE)
  const shown = createMemo(() => props.items.slice(0, visible()))
  const hasMore = createMemo(() => visible() < props.items.length)

  return (
    <Box w="$full">
      <div class="gallery-grid">
        <For each={shown()}>
          {(item) => <LazySlot>{props.renderItem(item)}</LazySlot>}
        </For>
      </div>
      <Show when={hasMore()}>
        <Button
          size="sm"
          variant="ghost"
          colorScheme="neutral"
          mt="$2"
          onClick={() => setVisible((v) => v + PAGE_SIZE)}
        >
          {t("home.load_more")} ({visible()}/{props.items.length})
        </Button>
      </Show>
    </Box>
  )
}

// ── LazySlot (IntersectionObserver) ───────────────────────

const LazySlot = (props: { children: any }) => {
  const [ready, setReady] = createSignal(false)
  let ref: HTMLDivElement | undefined

  onMount(() => {
    if (!ref) return
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setReady(true)
            obs.disconnect()
          }
        }
      },
      { rootMargin: "300px" },
    )
    obs.observe(ref)
    onCleanup(() => obs.disconnect())
  })

  return (
    <div ref={ref} style={{ display: "contents" }}>
      <Show when={ready()} fallback={<div class="gallery-placeholder" />}>
        {props.children}
      </Show>
    </div>
  )
}

// ── Image Card (plain HTML) ───────────────────────────────

const ImageCard = (props: {
  item: MediaItem
  src: string
  onClick: () => void
}) => {
  return (
    <div
      class="gallery-card"
      style={{ width: "180px" }}
      onClick={props.onClick}
    >
      <img
        src={props.src}
        alt={props.item.obj.name}
        loading="lazy"
        style={{ height: "140px" }}
      />
      <div class="card-label" title={props.item.obj.name}>
        {props.item.obj.name}
      </div>
    </div>
  )
}

// ── Video Card (plain HTML) ───────────────────────────────

const VideoCard = (props: { item: MediaItem; src: string }) => {
  const [playing, setPlaying] = createSignal(false)
  let videoEl: HTMLVideoElement | undefined

  const play = () => {
    setPlaying(true)
    setTimeout(() => videoEl?.play().catch(() => {}), 50)
  }

  const stop = () => {
    videoEl?.pause()
    if (videoEl) videoEl.currentTime = 0
    setPlaying(false)
  }

  onCleanup(() => {
    if (videoEl) {
      videoEl.pause()
      videoEl.removeAttribute("src")
      videoEl.load()
    }
  })

  return (
    <div class="gallery-video-card" style={{ width: "280px" }}>
      <div class="gallery-video-wrap">
        <Show
          when={playing()}
          fallback={
            <>
              <Show when={props.item.obj.thumb}>
                <img
                  src={props.item.obj.thumb}
                  alt=""
                  loading="lazy"
                  style={{
                    position: "absolute",
                    width: "100%",
                    height: "100%",
                    "object-fit": "cover",
                  }}
                />
              </Show>
              <div class="play-btn" onClick={play} />
            </>
          }
        >
          <video
            ref={videoEl}
            src={props.src}
            controls
            preload="none"
            onEnded={stop}
          />
          <button class="close-btn" onClick={stop}>
            ✕
          </button>
        </Show>
      </div>
      <div
        style={{
          display: "flex",
          "justify-content": "space-between",
          padding: "4px 8px",
          "font-size": "11px",
        }}
      >
        <span
          style={{
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
            flex: 1,
          }}
          title={props.item.obj.name}
        >
          {props.item.obj.name}
        </span>
        <span style={{ opacity: 0.6, "margin-left": "8px", "flex-shrink": 0 }}>
          {formatSize(props.item.obj.size)}
        </span>
      </div>
    </div>
  )
}

// ── Text Card (plain HTML) ────────────────────────────────

const TextCard = (props: { item: MediaItem; src: string }) => {
  const [expanded, setExpanded] = createSignal(false)
  const [content, setContent] = createSignal<string | null>(null)
  const [fetching, setFetching] = createSignal(false)

  const loadContent = async () => {
    if (content() !== null) return
    setFetching(true)
    try {
      const result = await fetchText(props.src)
      if (result.content instanceof ArrayBuffer) {
        setContent(new TextDecoder("utf-8").decode(result.content))
      } else {
        setContent(String(result.content))
      }
    } catch (e) {
      setContent(`Error: ${e}`)
    }
    setFetching(false)
  }

  const toggle = async () => {
    const next = !expanded()
    setExpanded(next)
    if (next) await loadContent()
  }

  return (
    <div class="gallery-text-card" style={{ width: "320px" }}>
      <div class="gallery-text-header" onClick={toggle}>
        <span style={{ "font-size": "16px" }}>📄</span>
        <span class="text-name" title={props.item.obj.name}>
          {props.item.obj.name}
        </span>
        <span class="text-size">{formatSize(props.item.obj.size)}</span>
        <span class="text-arrow">{expanded() ? "▼" : "▶"}</span>
      </div>
      <Show when={expanded()}>
        <div class="gallery-text-content">
          <Show
            when={!fetching()}
            fallback={
              <div style={{ "text-align": "center", padding: "16px" }}>
                Loading...
              </div>
            }
          >
            <pre>{content()}</pre>
          </Show>
        </div>
      </Show>
    </div>
  )
}

export default Gallery
