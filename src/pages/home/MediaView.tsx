import {
  createSignal,
  createMemo,
  createEffect,
  onMount,
  onCleanup,
  For,
  Show,
} from "solid-js"
import {
  Box,
  Text,
  Input,
  InputGroup,
  InputLeftElement,
  InputRightElement,
  IconButton,
  Button,
  Center,
  Image,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverBody,
  Spinner,
  Tooltip,
  Kbd,
} from "@hope-ui/solid"
import {
  BsArrowLeft,
  BsX,
  BsChevronLeft,
  BsChevronRight,
  BsQuestionCircle,
  BsDownload,
} from "solid-icons/bs"
import {
  AiOutlineSearch,
  AiOutlineFolder,
  AiOutlineReload,
} from "solid-icons/ai"
import { FiImage, FiFilm, FiType } from "solid-icons/fi"
import { FullLoading } from "~/components"
import axios from "axios"
import { useRouter } from "~/hooks"
import { password } from "~/store"
import { ObjType } from "~/types"
import {
  fsList,
  handleRespWithoutNotify,
  ext,
  pathJoin,
  notify,
  encodePath,
} from "~/utils"
import { getLinkByDirAndObj } from "~/hooks/useLink"
import { createVirtualizer } from "@tanstack/solid-virtual"
import "~/components/markdown.css"

/* ──────────────────── Types ──────────────────── */

interface MediaItem {
  name: string
  path: string
  type: "image" | "video" | "gif" | "text"
  objType: ObjType
  size: number
  modified: string
  sign?: string
  thumb: string
}

interface FolderGroup {
  path: string
  displayName: string
  items: MediaItem[]
}

/* ──────────────────── Constants ──────────────────── */

const IMAGE_EXTS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "bmp",
  "svg",
  "ico",
  "tiff",
  "tif",
  "avif",
])
const VIDEO_EXTS = new Set([
  "mp4",
  "mkv",
  "avi",
  "mov",
  "flv",
  "wmv",
  "webm",
  "m4v",
  "ts",
  "m2ts",
  "mpg",
  "mpeg",
  "3gp",
  "ogv",
])
const GIF_EXTS = new Set(["gif"])
const TEXT_EXTS = new Set([
  "txt",
  "md",
  "log",
  "json",
  "xml",
  "yaml",
  "yml",
  "csv",
  "ini",
  "conf",
  "cfg",
  "sh",
  "bash",
  "zsh",
  "py",
  "js",
  "ts",
  "jsx",
  "tsx",
  "html",
  "css",
  "java",
  "c",
  "cpp",
  "h",
  "go",
  "rs",
  "rb",
  "php",
  "sql",
  "toml",
  "env",
  "dockerfile",
  "makefile",
  "gitignore",
])

const MIN_CARD_W = 180
const CARD_GAP = 12

/* responsive breakpoints — everything is driven by the live container width
   (ResizeObserver), never by a one-shot UA check, so tablets, rotation,
   split-screen and window resize all behave correctly */
const PHONE_W = 640 // below: phone layout (full-width search, swipe-only lightbox)
// fine pointer (mouse/trackpad) → keyboard hints make sense
const FINE_POINTER =
  typeof matchMedia !== "undefined" && matchMedia("(pointer: fine)").matches
// user asked the OS to calm motion down — all decorative animation is skipped
const REDUCED_MOTION =
  typeof matchMedia !== "undefined" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches

/* minimum card width tiers: phone / tablet / desktop */
const minCardW = (w: number) => (w < 480 ? 130 : w < 900 ? 160 : MIN_CARD_W)

/* macOS frosted-white palette (Photos-inspired). The media view is a fixed
   light overlay by design, so these are hardcoded instead of theme tokens. */
const MV = {
  bg: "#F5F5F7",
  surface: "#FFFFFF",
  glass: "rgba(255,255,255,0.72)",
  hairline: "rgba(0,0,0,0.08)",
  label: "rgba(60,60,67,0.92)",
  label2: "rgba(60,60,67,0.58)",
  label3: "rgba(60,60,67,0.34)",
  accent: "#007AFF",
  dot: {
    image: "#34C759",
    video: "#FF3B30",
    gif: "#FF9500",
    text: "#5E5CE6",
  } as Record<MediaItem["type"], string>,
  // blur without saturate: the combined filter was the compositor's most
  // expensive per-frame cost wherever content scrolls under the glass
  glassBlur: "blur(16px)",
  shadowCard: "0 1px 2px rgba(0,0,0,0.04), 0 4px 14px rgba(0,0,0,0.05)",
  shadowCardHover: "0 2px 6px rgba(0,0,0,0.05), 0 12px 30px rgba(0,0,0,0.10)",
  shadowPop: "0 2px 8px rgba(0,0,0,0.06), 0 16px 48px rgba(0,0,0,0.16)",
  // lightbox stage — a whisper of depth instead of flat paper
  stageGrad:
    "radial-gradient(120% 90% at 50% 38%, #FBFBFD 0%, #F4F4F7 55%, #EAEAEF 100%)",
  shadowStage: "0 6px 32px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.06)",
}

const getMediaType = (name: string): MediaItem["type"] | null => {
  const e = ext(name).toLowerCase()
  if (IMAGE_EXTS.has(e)) return "image"
  if (GIF_EXTS.has(e)) return "gif"
  if (VIDEO_EXTS.has(e)) return "video"
  if (TEXT_EXTS.has(e)) return "text"
  return null
}

const formatSize = (bytes: number): string => {
  if (!bytes) return ""
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
  if (bytes < 1024 * 1024 * 1024)
    return (bytes / (1024 * 1024)).toFixed(1) + " MB"
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB"
}

const formatDate = (iso: string): string => (iso ? iso.slice(0, 10) : "")

/* ──────────────────── Component ──────────────────── */

const MediaView = () => {
  const { pathname, isShare, to } = useRouter()

  const folderPath = createMemo(() => {
    const rawPath = pathname()
    const prefix = rawPath.startsWith("/@s")
      ? rawPath.match(/^\/@s\/@media/)?.[0] || "/@media"
      : "/@media"
    return rawPath.slice(prefix.length) || "/"
  })

  /* ─── State ─── */
  const [items, setItems] = createSignal<MediaItem[]>([])
  const [loading, setLoading] = createSignal(true)
  const [scanning, setScanning] = createSignal(false)
  const [scanMsg, setScanMsg] = createSignal("")
  // set when a scan failed outright (backend timeout/error) so the empty
  // state can say so instead of claiming the folder has no media
  const [scanError, setScanError] = createSignal<string | null>(null)
  const [search, setSearch] = createSignal("")
  const [subDirs, setSubDirs] = createSignal<string[]>([])
  const [dirFilter, setDirFilter] = createSignal("")
  const filteredSubDirs = createMemo(() => {
    const q = dirFilter().toLowerCase().trim()
    if (!q) return subDirs()
    return subDirs().filter((d) =>
      (d.split("/").pop() || d).toLowerCase().includes(q),
    )
  })
  const [focusIndex, setFocusIndex] = createSignal(-1)
  const [lightboxIndex, setLightboxIndex] = createSignal<number | null>(null)
  const [navDir, setNavDir] = createSignal<"prev" | "next" | "open">("open")

  /* ─── Feed mode (TikTok-style vertical feed) ───
     The lightbox can switch to an immersive black feed: media fills the
     screen, one item per page, and paging FOLLOWS THE FINGER — the current
     slot and its neighbours slide live with the drag (rubber-banded at the
     ends), then settle to a page on release. Videos autoplay and chain. */

  const [lbMode, setLbMode] = createSignal<"normal" | "feed">("normal")
  // live drag offset applied to every slot (px); settle target while snapping
  const [feedShift, setFeedShift] = createSignal(0)
  // transition enabled only while settling — never during the drag itself
  const [feedSettle, setFeedSettle] = createSignal(false)
  let feedVelocity = 0 // px/ms, from the last drag samples
  let feedLastY = 0
  let feedLastT = 0
  let feedDragPid = -1 // mouse drag pointer id
  let feedSettleTimer: ReturnType<typeof setTimeout> | undefined
  let feedWheelTimer: ReturnType<typeof setTimeout> | undefined
  let feedWheelAt = 0
  let feedWheelAcc = 0
  let feedScrubbing = false
  // removes the scrub's window-level release fallback; owned at component
  // scope so feedReset and onCleanup can tear it down if the lightbox dies
  // mid-scrub
  let scrubFallbackCleanup: (() => void) | null = null

  const feedCount = () => flatItems().length

  /* history sentinel: an accidental browser-back (edge swipe, trackpad
     history swipe) while the lightbox is open pops this dummy entry instead
     of leaving the page — it becomes "close the lightbox". The user's real
     back intent on the grid still works. */
  let pushedGuard = false
  const pushGuard = () => {
    if (!pushedGuard) {
      history.pushState({ mvGuard: true }, "")
      pushedGuard = true
    }
  }
  const popGuard = () => {
    if (pushedGuard) {
      pushedGuard = false
      // only step back when OUR entry is still the current one — if some
      // other code pushed a state above the sentinel, back() would pop
      // theirs instead
      if (history.state?.mvGuard) history.back()
    }
  }
  const onPopState = () => {
    pushedGuard = false // the sentinel entry just got popped
    if (lightboxIndex() !== null) closeLightbox()
  }

  const feedReset = () => {
    clearTimeout(feedSettleTimer)
    setFeedSettle(false)
    setFeedShift(0)
    feedVelocity = 0
    feedDragPid = -1
    feedScrubbing = false
    scrubFallbackCleanup?.()
    scrubFallbackCleanup = null
  }

  // cancel an in-flight settle: a new gesture or a scrub jump must not leave
  // the old timer to advance from a stale index later
  const feedCancelSettle = () => {
    clearTimeout(feedSettleTimer)
    setFeedSettle(false)
    setFeedShift(0)
  }

  // cancel the settle TIMER but keep the current mid-animation position — a
  // drag taking over a snap continues from where the animation froze, no
  // jump to rest
  // cancel the settle TIMER but keep the page exactly where the compositor
  // has it RIGHT NOW: while a transition runs, feedShift holds the settle
  // ENDPOINT, so the visible mid-animation offset must be read back from the
  // DOM — otherwise dropping the transition snaps the slots to the endpoint
  const feedInterruptSettle = () => {
    clearTimeout(feedSettleTimer)
    let captured = feedShift()
    // the CURRENT slot's base is 0%, so its resolved translateY IS the
    // interpolated shift — neighbour slots would mix their ±100% base in
    const el = document.querySelector(".mv-feed-cur") as HTMLElement | null
    if (el) {
      const t = getComputedStyle(el).transform
      if (t && t !== "none") {
        try {
          captured = new DOMMatrixReadOnly(t).m42
        } catch {
          /* keep the signal value */
        }
      }
    }
    setFeedSettle(false)
    setFeedShift(captured)
  }

  // entering the feed from the normal lightbox: the normal mode's pending
  // tap-close timer and half-finished double-tap must not leak in here
  const enterFeed = () => {
    clearTimeout(tapTimer)
    lastTapAt = 0
    feedReset()
    setLbMode("feed")
    wakeChrome()
  }

  // settle the current drag into a page turn (or back to rest) — dir is the
  // signed slot movement: -1 = next (content moves up), +1 = prev
  const feedSettleTo = (dir: 0 | 1 | -1) => {
    const idx = lightboxIndex()
    if (dir !== 0 && idx !== null) {
      const target = idx + (dir === -1 ? 1 : -1)
      if (target < 0 || target >= feedCount()) dir = 0
    }
    setFeedSettle(true)
    // dir -1 = next = content continues UP: the slots slide one full page in
    // the SAME direction the finger was dragging, not the opposite
    setFeedShift(dir * window.innerHeight)
    clearTimeout(feedSettleTimer)
    feedSettleTimer = setTimeout(() => {
      setFeedSettle(false)
      setFeedShift(0)
      if (dir !== 0) {
        const idx2 = lightboxIndex()
        if (idx2 !== null) {
          const target = idx2 + (dir === -1 ? 1 : -1)
          if (target >= 0 && target < feedCount()) gotoLightbox(target)
        }
      }
    }, 290)
  }

  const feedNext = () => {
    const i = lightboxIndex()
    if (i !== null && i < feedCount() - 1) feedSettleTo(-1)
  }
  const feedPrev = () => {
    const i = lightboxIndex()
    if (i !== null && i > 0) feedSettleTo(1)
  }

  /* apply a live drag: raw px, rubber-banded when there is no page beyond */
  const feedApplyDrag = (raw: number) => {
    const i = lightboxIndex() ?? 0
    let shift = raw
    if ((raw < 0 && i >= feedCount() - 1) || (raw > 0 && i <= 0))
      shift = raw * 0.3 // no neighbour there — resist
    setFeedShift(shift)
  }

  // decide the page from displacement + fling velocity (TikTok-feel tuning);
  // a velocity sample only counts while it is fresh — a fast move followed
  // by a stationary hold must not page as a fling
  const feedDecide = () => {
    const dy = feedShift()
    const h = window.innerHeight
    const far = Math.abs(dy) > h * 0.25
    const fling =
      performance.now() - feedLastT < 80 &&
      Math.abs(feedVelocity) > 0.35 &&
      Math.sign(feedVelocity) === Math.sign(dy)
    if (dy < 0 && (far || fling)) feedSettleTo(-1)
    else if (dy > 0 && (far || fling)) feedSettleTo(1)
    else feedSettleTo(0)
  }
  // the item currently sliding out during a prev/next transition (TikTok-style)
  const [outgoing, setOutgoing] = createSignal<{
    item: MediaItem
    dir: "prev" | "next"
  } | null>(null)
  const [showHelp, setShowHelp] = createSignal(false)
  const [showJump, setShowJump] = createSignal(false)
  // toolbar search: collapsed to an icon until invoked — a filter that is
  // not filtering should not occupy the bar
  const [searchOpen, setSearchOpen] = createSignal(false)
  const [jumpInput, setJumpInput] = createSignal("")
  const [textCache, setTextCache] = createSignal<Record<string, string>>({})
  const [cols, setCols] = createSignal(
    typeof window !== "undefined" && window.innerWidth < PHONE_W ? 2 : 4,
  )
  const [containerWidth, setContainerWidth] = createSignal(0)
  // actual measured row heights (via our own ResizeObserver) — index → px.
  // Lets variable-height rows (full text) be positioned correctly without
  // relying on exact estimates.
  const [measuredHeights, setMeasuredHeights] = createSignal<
    Record<number, number>
  >({})

  /* ─── Refs ─── */
  let scrollRef: HTMLDivElement | undefined
  let abortCtrl: AbortController | undefined
  let jumpInputRef: HTMLInputElement | undefined
  let searchInputRef: HTMLInputElement | undefined
  let resizeObserver: ResizeObserver | undefined
  let touchStartX = 0
  let touchStartY = 0
  let touchMoved = false
  let touchStartTarget: HTMLElement | null = null
  // two-finger pinch (zoom) / single-finger drag (pan while zoomed) tracking
  let multiTouch = false // latched until ALL fingers are up, so the tail of a
  // pinch can never be misread as a swipe/tap
  let pinchFingers = 0
  let pinchStart: {
    d: number
    z: number
    pan: { x: number; y: number }
    mx: number
    my: number
    cx: number // media center (un-zoomed) in client coords, for focal anchoring
    cy: number
  } | null = null
  let touchPanBase: {
    x: number
    y: number
    px: number
    py: number
  } | null = null
  // touch tap timing — double-tap zoom + delayed single-tap close. The close
  // delay must exceed the double-tap window so the second tap can always
  // cancel it; the timer is scoped to the current slide and cleared on every
  // open/close/turn so a stray close can never land on a new item.
  const TAP_WINDOW_MS = 300
  const TAP_CLOSE_MS = 360
  let lastTapAt = 0
  let lastTapPt = { x: 0, y: 0 }
  let tapTimer: ReturnType<typeof setTimeout> | undefined
  let lastTouchAt = 0
  let lastTouchClickPt = { x: 0, y: 0 }
  let outTimer: ReturnType<typeof setTimeout> | undefined
  let scanItems: MediaItem[] = []
  let scanFlushPending = false
  let scanFlushTimer: ReturnType<typeof setTimeout> | undefined

  // True when the current touch began on the video's bottom control bar, so the
  // native seek bar can be dragged without triggering a browse swipe.
  const startedOnVideoControls = () => {
    const el = touchStartTarget
    if (!el) return false
    // The seek bar can surface as an <input> in some browsers.
    if (el.tagName === "INPUT") return true
    if (el.tagName !== "VIDEO") return false
    const r = el.getBoundingClientRect()
    return (
      r.height > 0 && touchStartY > r.bottom - Math.max(48, r.height * 0.16)
    )
  }

  /* ─── Computed: filtered flat list ─── */
  const filteredItems = createMemo(() => {
    let result = items()
    const q = search().toLowerCase().trim()
    if (q) result = result.filter((i) => i.name.toLowerCase().includes(q))
    return result
  })

  /* ─── Computed: group by folder, sorted ─── */
  const folderGroups = createMemo<FolderGroup[]>(() => {
    const all = filteredItems()
    const map = new Map<string, MediaItem[]>()

    for (const item of all) {
      const group = map.get(item.path) || []
      group.push(item)
      map.set(item.path, group)
    }

    const groups: FolderGroup[] = []
    for (const [path, groupItems] of map) {
      groupItems.sort((a, b) => {
        if (a.type === "text" && b.type !== "text") return -1
        if (a.type !== "text" && b.type === "text") return 1
        return a.name.localeCompare(b.name)
      })

      let displayName: string
      if (path === folderPath()) {
        displayName = folderPath() || "/"
      } else {
        displayName = path.slice(folderPath().length + 1) || path
      }

      groups.push({ path, displayName, items: groupItems })
    }

    groups.sort((a, b) => a.displayName.localeCompare(b.displayName))
    return groups
  })

  /* flat list in DISPLAY order (groups → items); drives lightbox + keyboard nav */
  const flatItems = createMemo(() => {
    const flat: MediaItem[] = []
    for (const g of folderGroups()) for (const it of g.items) flat.push(it)
    return flat
  })

  /* O(1) item → display-order index */
  const indexMap = createMemo(() => {
    const map = new Map<MediaItem, number>()
    const flat = flatItems()
    for (let i = 0; i < flat.length; i++) map.set(flat[i], i)
    return map
  })
  const getIndex = (item: MediaItem) => indexMap().get(item) ?? -1

  const currentItem = createMemo(() => {
    const idx = lightboxIndex()
    return idx !== null ? flatItems()[idx] : null
  })

  /* ─── Lightbox zoom & pan (still images only) ───
     Wheel / trackpad-pinch zooms toward the cursor, double-click toggles
     1×↔2.5× at the clicked point, and a zoomed image can be dragged around.
     transform = translate(pan)·scale(zoom) around the media's center. */
  const [zoom, setZoom] = createSignal(1)
  const [pan, setPan] = createSignal({ x: 0, y: 0 })
  const [panning, setPanning] = createSignal(false)
  // true while a touch pinch / zoomed drag is in flight (mouse drags use
  // `panning`; touch gestures bypass the pointer path)
  const [touchGesture, setTouchGesture] = createSignal(false)
  // true for the duration of a lightbox page-turn slide — covers video
  // slides too, which intentionally carry no outgoing snapshot
  const [sliding, setSliding] = createSignal(false)
  // transition duration (s) applied to the transform while a programmatic
  // zoom plays; false while dragging so the image tracks the pointer 1:1
  const [zoomAnim, setZoomAnim] = createSignal<number | false>(false)
  let zoomAnimTimer: ReturnType<typeof setTimeout> | undefined
  let mediaEl: HTMLDivElement | undefined
  let dragPid = -1
  // removes the window-level drag fallback (set when setPointerCapture
  // failed); hoisted here so resetZoom can tear it down if the lightbox
  // closes mid-drag
  let dragWinCleanup: (() => void) | null = null
  let panStartPt = { x: 0, y: 0 }
  let panStartVal = { x: 0, y: 0 }

  const canZoom = () => {
    const it = currentItem()
    return it !== null && (it.type === "image" || it.type === "gif")
  }
  const zoomScale = () => zoom()

  // media base size (measured lazily: on mount, at gesture start, and only
  // again if the viewport changed since) — reading offsetWidth on every
  // pointer event would churn layout, and the size cannot change while a
  // gesture is in flight
  let mediaBaseSize = { w: 0, h: 0 }
  let mediaBaseVp = { w: 0, h: 0 }
  const measureMedia = () => {
    if (mediaEl) {
      mediaBaseSize = { w: mediaEl.offsetWidth, h: mediaEl.offsetHeight }
      mediaBaseVp = { w: window.innerWidth, h: window.innerHeight }
    }
  }
  const measureMediaIfStale = () => {
    if (
      mediaBaseVp.w !== window.innerWidth ||
      mediaBaseVp.h !== window.innerHeight ||
      !mediaBaseSize.w
    )
      measureMedia()
  }

  // keep the dragged image roughly over the stage: the pan never exceeds half
  // the extra size the zoom created
  const clampPan = (x: number, y: number, z: number) => {
    const w = mediaBaseSize.w || window.innerWidth
    const h = mediaBaseSize.h || window.innerHeight
    const maxX = Math.max(0, (w * z - w) / 2)
    const maxY = Math.max(0, (h * z - h) / 2)
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    }
  }

  // coalesce high-frequency pan/zoom writes (pointermove / touchmove) into
  // one signal update per frame — pan and zoom land in the SAME frame so the
  // two never disagree visually
  let panRafId = 0
  let panRafVal: { x: number; y: number } | null = null
  let zoomRafVal = -1
  const scheduleSetPan = (p: { x: number; y: number }, z?: number) => {
    panRafVal = p
    if (z !== undefined) zoomRafVal = z
    if (!panRafId) {
      panRafId = requestAnimationFrame(() => {
        panRafId = 0
        if (panRafVal) {
          if (zoomRafVal > 0) setZoom(zoomRafVal)
          setPan(panRafVal)
        }
        // committed — clear so a later flush can't replay this frame and a
        // pan-only schedule can't inherit a stale zoom payload
        panRafVal = null
        zoomRafVal = -1
      })
    }
  }
  const cancelPanRaf = () => {
    cancelAnimationFrame(panRafId)
    panRafId = 0
    panRafVal = null
    zoomRafVal = -1
  }
  // apply any pending rAF pan/zoom write right now — needed when deciding
  // based on the just-scheduled state (e.g. the snap-home check at gesture
  // end must see the final pinch zoom, not the previous frame's)
  const flushPanRaf = () => {
    if (panRafId) {
      cancelAnimationFrame(panRafId)
      panRafId = 0
    }
    if (panRafVal) {
      if (zoomRafVal > 0) setZoom(zoomRafVal)
      setPan(panRafVal)
      panRafVal = null
      zoomRafVal = -1
    }
  }

  const applyZoom = (
    target: number,
    cx: number,
    cy: number,
    dur: number | false,
  ) => {
    const z0 = zoom()
    const z1 = Math.max(1, Math.min(8, target))
    if (z1 === z0) return
    // keep the point under the cursor stationary:
    // pan' = c − (c − pan)·(z1/z0)
    const p0 = pan()
    const p1 =
      z1 === 1
        ? { x: 0, y: 0 }
        : {
            x: cx - (cx - p0.x) * (z1 / z0),
            y: cy - (cy - p0.y) * (z1 / z0),
          }
    cancelPanRaf()
    clearTimeout(zoomAnimTimer)
    setZoomAnim(dur !== false && !REDUCED_MOTION ? dur : false)
    setZoom(z1)
    setPan(clampPan(p1.x, p1.y, z1))
    if (dur !== false && !REDUCED_MOTION)
      zoomAnimTimer = setTimeout(() => setZoomAnim(false), dur * 1000 + 40)
  }

  // a gesture ending just above 1× snaps home — avoids an awkward hairline
  // zoom the user can't meaningfully pan. Flushes the pending frame first so
  // the decision sees the gesture's final zoom, not the previous frame's.
  const snapZoomHome = () => {
    flushPanRaf()
    const z = zoomScale()
    if (z > 1 && z < 1.05) resetZoom(0.25)
  }
  let wheelSnapTimer: ReturnType<typeof setTimeout> | undefined

  const resetZoom = (dur: number | false = 0.32) => {
    cancelPanRaf()
    clearTimeout(zoomAnimTimer)
    dragPid = -1
    setPanning(false)
    setTouchGesture(false)
    dragWinCleanup?.()
    dragWinCleanup = null
    if (dur === false || REDUCED_MOTION) {
      setZoomAnim(false)
      setZoom(1)
      setPan({ x: 0, y: 0 })
      return
    }
    setZoomAnim(dur)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    zoomAnimTimer = setTimeout(() => setZoomAnim(false), dur * 1000 + 40)
  }

  /* ─── Lightbox chrome auto-hide (fine pointers only) ───
     macOS Photos behaviour: after a moment of stillness the bars melt away
     so the media owns the screen; any movement brings them back. Touch
     devices keep the bars — a tap there means "close", not "show chrome". */
  const [chromeHidden, setChromeHidden] = createSignal(false)
  let chromeTimer: ReturnType<typeof setTimeout> | undefined
  let chromeArmAt = 0
  // true while something is actively transforming on screen (slide / zoom /
  // pan, mouse or touch): the glass bars drop their backdrop-filter for the
  // duration — re-blurring live content every frame is the most expensive
  // thing the compositor does here, and a hairline-solid bar is
  // indistinguishable mid-motion
  const motionActive = createMemo(
    () =>
      panning() ||
      touchGesture() ||
      sliding() ||
      zoomAnim() !== false ||
      outgoing() !== null ||
      feedShift() !== 0 ||
      feedSettle(),
  )
  // `arm`: finger movement wakes the bars but never arms the hide timer — on
  // touch the bars stay put (a tap there means "close", not "show chrome");
  // on hybrid devices whichever input was used last decides. Re-arming is
  // throttled: high-Hz pointer streams would otherwise churn timers all day.
  const wakeChrome = (arm = true) => {
    if (lightboxIndex() === null) return
    setChromeHidden(false)
    if (FINE_POINTER && arm) {
      const now = Date.now()
      // re-arm at most every 150ms; the handle must be nulled whenever the
      // timer is cleared or fires, or a stale truthy handle inside the
      // window would skip re-arming and never hide the chrome again
      if (chromeTimer === undefined || now - chromeArmAt > 150) {
        chromeArmAt = now
        if (chromeTimer !== undefined) clearTimeout(chromeTimer)
        chromeTimer = undefined
        chromeTimer = setTimeout(() => {
          chromeTimer = undefined
          if (lightboxIndex() !== null) setChromeHidden(true)
        }, 2600)
      }
    } else if (chromeTimer !== undefined) {
      clearTimeout(chromeTimer)
      chromeTimer = undefined
    }
  }

  // a viewport resize or rotation while zoomed shrinks the rendered media —
  // re-measure and pull the pan back inside the new bounds instead of
  // leaving the image stranded off-stage until the next gesture
  let resizeClampTimer: ReturnType<typeof setTimeout> | undefined
  const onViewportResize = () => {
    if (lightboxIndex() === null) return
    clearTimeout(resizeClampTimer)
    resizeClampTimer = setTimeout(() => {
      // consume any frame queued under the old dimensions first — otherwise
      // it would fire after the clamp and overwrite the corrected pan
      flushPanRaf()
      measureMedia()
      if (zoomScale() > 1) setPan(clampPan(pan().x, pan().y, zoomScale()))
    }, 120)
  }

  /* ─── Filmstrip: windowed thumbnails around the current index ─── */
  const filmstripWindow = createMemo(() => {
    const i = lightboxIndex()
    const len = flatItems().length
    if (i === null || len < 2) return []
    const R = 12
    const out: number[] = []
    for (let k = Math.max(0, i - R); k <= Math.min(len - 1, i + R); k++)
      out.push(k)
    return out
  })
  let stripRef: HTMLDivElement | undefined
  createEffect(() => {
    const i = lightboxIndex()
    if (i === null || !stripRef) return
    queueMicrotask(() => {
      // instant, not smooth: an animated strip scroll is a repaint under the
      // glass bar on every single flip
      stripRef?.querySelector(`[data-fs-index="${i}"]`)?.scrollIntoView({
        inline: "center",
        block: "nearest",
      })
    })
  })

  /* ─── Virtualized rows: flatten groups into Header / CardRow / TextRow ─── */
  type Row =
    | { key: string; kind: "header"; group: FolderGroup; est: number }
    | {
        key: string
        kind: "cards"
        group: FolderGroup
        items: MediaItem[]
        est: number
      }
    | {
        key: string
        kind: "text"
        group: FolderGroup
        item: MediaItem
        est: number
      }

  /* exact height of a cards row (image aspect + caption + padding) — keeps
     the virtualizer's estimate correct so image rows never overlap */
  const cardRowHeight = createMemo(() => {
    const w = containerWidth()
    const c = cols()
    if (w <= 0 || c <= 0) return 210
    const gridW = Math.max(0, w - 24) // scroll container px=$3 padding
    const cardW = (gridW - (c - 1) * CARD_GAP) / c
    return cardW * 0.75 + 62 // rough fallback; real height measured by ResizeObserver
  })

  const rows = createMemo<Row[]>(() => {
    const c = cols()
    const cardEst = cardRowHeight()
    const out: Row[] = []
    for (const g of folderGroups()) {
      out.push({ key: `h:${g.path}`, kind: "header", group: g, est: 72 })
      const texts = g.items.filter((i) => i.type === "text")
      const media = g.items.filter((i) => i.type !== "text")
      for (const t of texts)
        out.push({
          key: `t:${g.path}:${t.name}`,
          kind: "text",
          group: g,
          item: t,
          est: 200,
        })
      for (let i = 0; i < media.length; i += c)
        out.push({
          key: `c:${g.path}:${i}`,
          kind: "cards",
          group: g,
          items: media.slice(i, i + c),
          est: cardEst,
        })
    }
    return out
  })

  /* display-order item index → row index (keyboard nav / lightbox sync) */
  const itemToRow = createMemo(() => {
    const m = new Map<number, number>()
    const flat = flatItems()
    const itemToFlat = new Map<MediaItem, number>()
    for (let i = 0; i < flat.length; i++) itemToFlat.set(flat[i], i)
    const rs = rows()
    for (let r = 0; r < rs.length; r++) {
      const row = rs[r]
      if (row.kind === "cards")
        for (const it of row.items) m.set(itemToFlat.get(it)!, r)
      else if (row.kind === "text") m.set(itemToFlat.get(row.item)!, r)
    }
    return m
  })

  /* the virtualizer — only viewport rows are mounted (scales to tens of thousands) */
  const virtualizer = createVirtualizer({
    get count() {
      return rows().length
    },
    getScrollElement: () => scrollRef ?? null,
    estimateSize: (i: number) => measuredHeights()[i] ?? rows()[i]?.est ?? 200,
    getItemKey: (i: number) => rows()[i]?.key ?? String(i),
    overscan: 8,
  })

  /* Our own ResizeObserver measures each rendered row's real height (including
     full, variable-height text) and feeds it back via estimateSize. Unlike the
     built-in measureElement it isn't skipped during scroll, so rows mounted
     while scrolling get measured too (no overlap).
     Updates are coalesced through rAF: during fast scroll many ResizeObserver
     batches fire, and each signal write + virtualizer.measure() is O(rows) —
     flushing once per frame instead of per batch is what keeps large libraries
     scrolling smoothly. */
  const pendingRowHeights = new Map<number, number>()
  let rowHeightFlushScheduled = false
  const rowResizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver((entries) => {
          for (const entry of entries) {
            const el = entry.target as HTMLElement
            const idxStr = el.dataset.index
            if (idxStr == null) continue
            const idx = parseInt(idxStr, 10)
            if (Number.isNaN(idx)) continue
            if (!el.isConnected) {
              rowResizeObserver?.unobserve(el)
              continue
            }
            const h = el.getBoundingClientRect().height
            if (h > 0) pendingRowHeights.set(idx, h)
          }
          if (pendingRowHeights.size === 0 || rowHeightFlushScheduled) return
          rowHeightFlushScheduled = true
          requestAnimationFrame(() => {
            rowHeightFlushScheduled = false
            const updates: Record<number, number> = {}
            let changed = false
            const prev = measuredHeights()
            pendingRowHeights.forEach((h, idx) => {
              // ignore sub-pixel jitter to avoid measure feedback loops
              if (Math.abs((prev[idx] ?? -1) - h) >= 1) {
                updates[idx] = h
                changed = true
              }
            })
            pendingRowHeights.clear()
            if (changed) {
              setMeasuredHeights((p) => ({ ...p, ...updates }))
              virtualizer.measure()
            }
          })
        })
      : undefined

  /* the entrance cascade runs during the scan plus a 1s grace after loading
     ends (setLoading(false) and setScanning(false) land in the same turn, so
     a scan-only gate would strip mv-enter before the first rows ever paint).
     Everything mounted later — scrolling, filtering — never animates: the
     virtualizer remounts rows as you scroll, and repaint-on-mount during
     scroll is exactly the jank we don't want. No seen-keys bookkeeping: the
     virtualizer re-creates row subtrees on its first measure, which would
     strip the class mid-cascade; replays inside the 1s window are harmless. */
  let entranceAfterLoad = 0
  const entranceActive = () => scanning() || Date.now() < entranceAfterLoad

  const recomputeCols = () => {
    const w = scrollRef?.clientWidth ?? 0
    if (w > 0) {
      setContainerWidth(w)
      const gridW = Math.max(0, w - 24) // px=$3 padding
      const minW = minCardW(w)
      setCols(Math.max(1, Math.floor((gridW + CARD_GAP) / (minW + CARD_GAP))))
    }
  }

  /* ─── Fetch Logic ─── */
  const getItemLink = (item: MediaItem) => {
    return getLinkByDirAndObj(
      item.path,
      {
        name: item.name,
        size: item.size,
        is_dir: false,
        created: "",
        modified: item.modified,
        sign: item.sign,
        thumb: item.thumb,
        type: item.objType,
      },
      "direct",
      isShare(),
    )
  }

  const fetchFolder = async (
    path: string,
    signal: AbortSignal,
  ): Promise<string[]> => {
    if (signal.aborted) return []
    const isRoot = path === folderPath()
    setScanMsg(`Scanning: ${path}`)

    // per-request timeout + supersession: the cancel token is linked to the
    // scan's AbortSignal, so a newer scan cancels in-flight requests for the
    // superseded one immediately instead of leaving them to land later
    const cancelSrc = axios.CancelToken.source()
    const onScanAbort = () => cancelSrc.cancel("scan superseded")
    if (signal.aborted) onScanAbort()
    else signal.addEventListener("abort", onScanAbort)
    const timeoutId = setTimeout(
      () => cancelSrc.cancel(`timeout scanning ${path}`),
      15000,
    )
    let resp
    try {
      resp = await fsList(path, password(), 1, 0, false, cancelSrc.token)
    } finally {
      clearTimeout(timeoutId)
      signal.removeEventListener("abort", onScanAbort)
    }
    if (signal.aborted) return []

    let data: any
    handleRespWithoutNotify(
      resp,
      (d) => {
        data = d
      },
      (msg) => {
        notify.error(`Failed to scan ${path}: ${msg}`)
      },
    )

    if (!data?.content) {
      if (isRoot) setSubDirs([])
      return []
    }
    const content = data.content as any[]

    const newItems: MediaItem[] = []
    const dirs: string[] = []

    for (const obj of content) {
      if (signal.aborted) return []
      if (obj.is_dir) {
        dirs.push(pathJoin(path, obj.name))
        continue
      }
      const mediaType = getMediaType(obj.name)
      if (mediaType) {
        newItems.push({
          name: obj.name,
          path,
          type: mediaType,
          objType: obj.type,
          size: obj.size,
          modified: obj.modified,
          sign: obj.sign,
          thumb: obj.thumb,
        })
      }
    }

    // first-level subdirectories (top-level only) power the quick-nav dropdown
    dirs.sort((a, b) => a.localeCompare(b))
    if (isRoot) setSubDirs(dirs)

    if (newItems.length > 0) {
      for (const it of newItems) scanItems.push(it)
      scheduleScanFlush()
    }

    return dirs
  }

  /* breadth-first parallel descent: six workers drain a shared queue.
     Workers that find it empty WAIT while requests are still in flight
     (a naive poll-once loop would let five workers exit before the first
     response enqueues its subfolders, silently degrading to sequential).
     A single folder failing is isolated — its siblings keep scanning. */
  const scanAll = async (root: string, signal: AbortSignal) => {
    const queue: string[] = [root]
    let inFlight = 0
    const waiters = new Set<() => void>()
    const waitForWork = () =>
      new Promise<void>((resolve) => waiters.add(resolve))
    const wakeAll = () => {
      const ws = [...waiters]
      waiters.clear()
      for (const w of ws) w()
    }
    const worker = async () => {
      while (!signal.aborted) {
        const path = queue.shift()
        if (path === undefined) {
          if (inFlight === 0) return // drained: nothing queued, nothing flying
          await waitForWork()
          continue
        }
        inFlight++
        try {
          const dirs = await fetchFolder(path, signal)
          queue.push(...dirs)
        } catch (e) {
          if (!signal.aborted) {
            console.error("Media scan folder failed:", path, e)
            setScanError(
              e instanceof Error
                ? e.message
                : axios.isCancel(e)
                  ? "timeout"
                  : "",
            )
          }
        } finally {
          inFlight--
          wakeAll()
        }
      }
    }
    await Promise.all(Array.from({ length: 6 }, () => worker()))
  }

  const startScan = async () => {
    abortCtrl?.abort()
    // invocation-local ownership: this scan's controller is captured so its
    // catch/finally only mutate shared state while THIS scan is still the
    // current one — a superseded scan terminating late must not flush the
    // newer scan's items or clear its loading state
    const myCtrl = new AbortController()
    abortCtrl = myCtrl
    scanItems = []
    scanFlushPending = false
    clearTimeout(scanFlushTimer)
    setSubDirs([])
    setItems([])
    setTextCache({})
    setScanError(null)
    setLoading(true)
    setScanning(true)
    setFocusIndex(-1)

    try {
      await scanAll(folderPath(), myCtrl.signal)
    } catch (e) {
      // only the owner reports: superseded scans abort by design
      if (abortCtrl === myCtrl && !myCtrl.signal.aborted) {
        console.error("Media scan error:", e)
        setScanError(
          e instanceof Error ? e.message : axios.isCancel(e) ? "timeout" : "",
        )
      }
    } finally {
      if (abortCtrl !== myCtrl) return // a newer scan owns the state now
      // final flush so the last batch isn't held back by the throttle
      clearTimeout(scanFlushTimer)
      scanFlushPending = false
      setItems(scanItems.slice())
      // stamp the entrance deadline BEFORE the loading flip: Solid settles
      // reactive updates synchronously, so the row classes must not be able
      // to evaluate against a stale deadline
      entranceAfterLoad = Date.now() + 1000
      setLoading(false)
      setScanning(false)
      setScanMsg("")
    }
  }

  /* ─── Lazy Text Fetch (only when card becomes visible) ─── */
  const fetchingKeys = new Set<string>()

  const fetchTextContent = async (item: MediaItem) => {
    const key = `${item.path}/${item.name}`
    if (textCache()[key] !== undefined || fetchingKeys.has(key)) return
    fetchingKeys.add(key)

    try {
      const url = getItemLink(item)
      const resp = await fetch(url)
      const text = await resp.text()
      setTextCache((prev) => ({ ...prev, [key]: text.slice(0, 65536) }))
    } catch {
      setTextCache((prev) => ({ ...prev, [key]: "" }))
    } finally {
      fetchingKeys.delete(key)
    }
  }

  /* ─── Lazy text observer: fetch text when a text card scrolls into view ─── */
  let textObserver: IntersectionObserver | undefined

  /* thumb-less video cards only mount their metadata-<video> (first-frame
     fallback) once the card is near the viewport — a library full of videos
     with no server thumbnails would otherwise spin up dozens of decoder
     pipelines at once, which is exactly the "very janky" report */
  const cardVideoCallbacks = new WeakMap<Element, () => void>()
  const cardVideoObserver =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                cardVideoCallbacks.get(entry.target)?.()
                cardVideoObserver?.unobserve(entry.target)
              }
            }
          },
          { rootMargin: "300px" },
        )
      : undefined

  onMount(() => {
    textObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const key = entry.target.getAttribute("data-text-key")
            if (key) {
              const item = items().find((i) => `${i.path}/${i.name}` === key)
              if (item) fetchTextContent(item)
            }
            textObserver?.unobserve(entry.target)
          }
        }
      },
      { rootMargin: "300px" },
    )
  })

  /* ─── Throttled scan flush: batch item updates to avoid re-render churn ─── */
  const scheduleScanFlush = () => {
    if (scanFlushPending) return
    scanFlushPending = true
    scanFlushTimer = setTimeout(() => {
      scanFlushPending = false
      setItems(scanItems.slice())
    }, 300)
  }

  /* ─── Navigation ─── */
  const navigate = (newIndex: number) => {
    const len = flatItems().length
    if (len === 0) return
    const clamped = Math.max(0, Math.min(newIndex, len - 1))
    setFocusIndex(clamped)
    const r = itemToRow().get(clamped)
    if (r !== undefined) virtualizer.scrollToIndex(r, { align: "auto" })
  }

  // Keep the grid scrolled to the item shown in the lightbox, so closing
  // returns you to the right place.
  const syncGridTo = (index: number) => {
    if (!flatItems()[index]) return
    setFocusIndex(index)
    const r = itemToRow().get(index)
    if (r !== undefined) virtualizer.scrollToIndex(r, { align: "auto" })
  }

  // scroll the grid to a folder's group header (quick-nav "locate", not navigate)
  const scrollToFolder = (folder: string) => {
    const rs = rows()
    const r = rs.findIndex(
      (row) => row.kind === "header" && row.group.path === folder,
    )
    if (r >= 0) virtualizer.scrollToIndex(r, { align: "start" })
  }

  /* warm the adjacent images so the first view of the next/prev page is
     instant (fetched at low priority so it never competes with the current
     one; videos are skipped — preloading those would waste bandwidth) */
  const preloadAdjacent = (index: number) => {
    const flat = flatItems()
    for (const off of [-2, -1, 1, 2]) {
      const it = flat[index + off]
      if (!it || (it.type !== "image" && it.type !== "gif")) continue
      // document.createElement instead of `new Image()` — the Hope UI Image
      // import shadows the DOM constructor
      const img = document.createElement("img")
      img.decoding = "async"
      img.setAttribute("fetchpriority", "low")
      img.src = getItemLink(it)
    }
  }

  const openLightbox = (index: number) => {
    clearTimeout(outTimer)
    clearTimeout(tapTimer) // a pending tap-close belongs to the previous slide
    clearTimeout(wheelSnapTimer)
    lastTapAt = 0 // …and so does any half-finished double-tap
    setOutgoing(null)
    setNavDir("open")
    resetZoom(false)
    pushGuard() // an accidental browser-back should close, not leave
    setLightboxIndex(index)
    setFocusIndex(index)
    const item = flatItems()[index]
    if (item?.type === "text") fetchTextContent(item)
    preloadAdjacent(index)
  }

  const closeLightbox = () => {
    clearTimeout(outTimer)
    clearTimeout(tapTimer)
    clearTimeout(wheelSnapTimer)
    lastTapAt = 0
    setOutgoing(null)
    // closing mid-slide must not strand the slide signal (its timer was just
    // cancelled) — the glass bars would stay solid after the next open
    setSliding(false)
    resetZoom(false)
    feedReset()
    setLbMode("normal")
    // sync the grid once on exit instead of on every flip — scrolling the
    // hidden grid per page turn mounted rows and churned the virtualizer,
    // which made flipping janky
    const idx = lightboxIndex()
    if (idx !== null) syncGridTo(idx)
    setLightboxIndex(null)
    popGuard() // release the back-guard entry (popstate handler no-ops)
  }

  // one entry point for every way of turning pages (keys, arrows, swipe,
  // filmstrip) — sets the slide direction and the outgoing snapshot
  const gotoLightbox = (ni: number) => {
    const idx = lightboxIndex()
    if (idx === null || ni === idx) return
    const cur = flatItems()[idx]
    const dir = ni < idx ? "prev" : "next"
    clearTimeout(tapTimer) // never close a slide the user just turned to
    clearTimeout(wheelSnapTimer)
    lastTapAt = 0 // the new slide starts with a clean tap slate
    // snapshot the item being left so it can slide out while the new one
    // slides in (dual-layer vertical page-turn, TikTok-style).
    // the outgoing snapshot only pays off for stills — a second mounted
    // video doubles decode cost during the slide for no visual gain
    setOutgoing(cur && cur.type !== "video" ? { item: cur, dir } : null)
    setNavDir(dir)
    setSliding(true)
    resetZoom(false)
    setLightboxIndex(ni)
    setFocusIndex(ni)
    clearTimeout(outTimer)
    outTimer = setTimeout(() => {
      setOutgoing(null)
      setSliding(false)
    }, 360)
    const item = flatItems()[ni]
    if (item?.type === "text") fetchTextContent(item)
    preloadAdjacent(ni)
  }

  const lightboxPrev = () => {
    const idx = lightboxIndex()
    if (idx !== null && idx > 0) gotoLightbox(idx - 1)
  }

  const lightboxNext = () => {
    const idx = lightboxIndex()
    const len = flatItems().length
    if (idx !== null && idx < len - 1) gotoLightbox(idx + 1)
  }

  /* ─── Jump ─── */
  const executeJump = () => {
    const input = jumpInput().trim()
    if (!input) return
    const num = parseInt(input)
    const len = flatItems().length
    if (!isNaN(num) && num >= 1 && num <= len) {
      navigate(num - 1)
    } else {
      const idx = flatItems().findIndex((i) =>
        i.name.toLowerCase().includes(input.toLowerCase()),
      )
      if (idx >= 0) navigate(idx)
    }
    setShowJump(false)
    setJumpInput("")
  }

  /* ─── Keyboard Handler ─── */
  const onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
    const len = flatItems().length
    const lb = lightboxIndex()

    if (lb !== null) {
      wakeChrome()
      if (lbMode() === "feed") {
        // feed mode owns the arrows: up/down page, Esc exits the feed
        switch (e.key) {
          case "ArrowUp":
            e.preventDefault()
            feedPrev()
            return
          case "ArrowDown":
            e.preventDefault()
            feedNext()
            return
          case "ArrowLeft":
          case "ArrowRight":
            e.preventDefault()
            return
          case "Escape":
            e.preventDefault()
            feedReset()
            setLbMode("normal")
            return
        }
        return
      }
      switch (e.key) {
        case "ArrowLeft":
        case "h":
          e.preventDefault()
          lightboxPrev()
          return
        case "ArrowRight":
        case "l":
          e.preventDefault()
          lightboxNext()
          return
        case "ArrowUp":
        case "ArrowDown":
        case "Escape":
          e.preventDefault()
          closeLightbox()
          return
        case "+":
        case "=":
        case "-":
        case "_":
        case "0":
          // leave Ctrl/Cmd +/- (browser zoom) and friends alone
          if (e.ctrlKey || e.metaKey || e.altKey) return
          if (!canZoom()) return
          e.preventDefault()
          if (e.key === "0") resetZoom()
          else if (e.key === "-" || e.key === "_")
            applyZoom(zoomScale() / 1.5, 0, 0, 0.28)
          else applyZoom(zoomScale() * 1.5, 0, 0, 0.28)
          return
      }
      return
    }
    if (showJump()) {
      if (e.key === "Escape") {
        setShowJump(false)
        setJumpInput("")
      }
      return
    }
    if (showHelp()) {
      if (e.key === "Escape" || e.key === "?") setShowHelp(false)
      return
    }

    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault()
        navigate(focusIndex() - 1)
        break
      case "ArrowRight":
        e.preventDefault()
        navigate(focusIndex() + 1)
        break
      case "ArrowUp":
        e.preventDefault()
        navigate(focusIndex() - 6)
        break
      case "ArrowDown":
        e.preventDefault()
        navigate(focusIndex() + 6)
        break
      case "h":
        navigate(focusIndex() - 1)
        break
      case "l":
        navigate(focusIndex() + 1)
        break
      case "j":
        e.preventDefault()
        navigate(focusIndex() + 6)
        break
      case "k":
        e.preventDefault()
        navigate(focusIndex() - 6)
        break
      case "PageDown":
        e.preventDefault()
        navigate(focusIndex() + 18)
        break
      case "PageUp":
        e.preventDefault()
        navigate(focusIndex() - 18)
        break
      case "g":
        e.preventDefault()
        navigate(0)
        break
      case "G":
        e.preventDefault()
        navigate(len - 1)
        break
      case "Home":
        e.preventDefault()
        navigate(0)
        break
      case "End":
        e.preventDefault()
        navigate(len - 1)
        break
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
      case "7":
      case "8":
      case "9": {
        const n = parseInt(e.key)
        if (n <= len) navigate(n - 1)
        break
      }
      case "Enter":
        e.preventDefault()
        if (focusIndex() >= 0 && focusIndex() < len) openLightbox(focusIndex())
        break
      case "/":
        e.preventDefault()
        setShowJump(true)
        setTimeout(() => jumpInputRef?.focus(), 50)
        break
      case "?":
        setShowHelp((v) => !v)
        break
      case "r":
        if (!scanning()) startScan()
        break
      case "Escape":
        setFocusIndex(-1)
        break
    }
  }

  /* ─── Lifecycle ─── */
  // re-scan whenever the folder path changes (quick-nav navigation reuses the
  // same MediaView instance, so the path is reactive, not a one-shot read)
  createEffect(() => {
    folderPath()
    startScan()
  })
  // lightbox chrome: wake on open, hide after idle (fine pointers only).
  // The most recent input modality decides whether the hide timer is armed —
  // a touch-opened lightbox on a hybrid device keeps its bars until a mouse
  // is actually used. Tracked at component level (onMount) so the very
  // pointerdown that opens the lightbox is already recorded when the effect
  // below first reads it.
  let lastInputTouch = false
  const trackModality = (e: PointerEvent) => {
    lastInputTouch = e.pointerType === "touch"
  }
  createEffect(() => {
    if (lightboxIndex() === null) {
      clearTimeout(chromeTimer)
      chromeTimer = undefined
      setChromeHidden(false)
      return
    }
    wakeChrome(!lastInputTouch)
    const wake = (e: PointerEvent) => {
      trackModality(e)
      // in feed mode a touch tap TOGGLES the chrome; revealing it on
      // pointerdown would immediately undo what the tap hides
      if (lbMode() === "feed" && e.pointerType === "touch") return
      wakeChrome(!lastInputTouch)
    }
    window.addEventListener("pointermove", wake, { passive: true })
    window.addEventListener("pointerdown", wake, { passive: true })
    onCleanup(() => {
      window.removeEventListener("pointermove", wake)
      window.removeEventListener("pointerdown", wake)
      clearTimeout(chromeTimer)
      chromeTimer = undefined
    })
  })
  onMount(() => {
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("pointerdown", trackModality, { passive: true })
    window.addEventListener("resize", onViewportResize, { passive: true })
    window.addEventListener("popstate", onPopState)
    recomputeCols()
    if (scrollRef) {
      resizeObserver = new ResizeObserver(() => recomputeCols())
      resizeObserver.observe(scrollRef)
    }
  })
  onCleanup(() => {
    window.removeEventListener("keydown", onKeyDown)
    window.removeEventListener("pointerdown", trackModality)
    window.removeEventListener("resize", onViewportResize)
    window.removeEventListener("popstate", onPopState)
    clearTimeout(resizeClampTimer)
    clearTimeout(feedSettleTimer)
    clearTimeout(feedWheelTimer)
    scrubFallbackCleanup?.()
    scrubFallbackCleanup = null
    // if a sentinel entry is still ours, hand it back (same ownership check
    // as popGuard — never pop an entry some other code pushed above ours)
    popGuard()
    abortCtrl?.abort()
    textObserver?.disconnect()
    cardVideoObserver?.disconnect()
    resizeObserver?.disconnect()
    rowResizeObserver?.disconnect()
    clearTimeout(outTimer)
    clearTimeout(scanFlushTimer)
    clearTimeout(chromeTimer)
    chromeTimer = undefined
    clearTimeout(zoomAnimTimer)
    clearTimeout(tapTimer)
    clearTimeout(wheelSnapTimer)
    cancelAnimationFrame(panRafId)
    dragWinCleanup?.()
    dragWinCleanup = null
  })

  /* ─── Helpers ─── */
  const TypeIcon = (props: { type: MediaItem["type"]; size?: string }) => {
    const m = { image: FiImage, video: FiFilm, gif: FiImage, text: FiType }
    const c = MV.dot
    return (
      <Box
        as={m[props.type]}
        boxSize={props.size || "$4"}
        color={c[props.type]}
      />
    )
  }

  /* ─── Render a single virtualized row (header / cards / text) ─── */
  const renderRow = (row: Row | undefined) => {
    if (!row) return null
    if (row.kind === "header") {
      return (
        // pt separates GROUPS from the rows above (16px + the previous row's
        // 12px bottom padding reads clearly as a new section, vs the 12px
        // rhythm between rows); the spacer below the hairline gives the
        // divider room to breathe instead of hugging the first card
        <Box pt="$4">
          <Box
            display="flex"
            alignItems="center"
            gap="$2"
            pb="$2_5"
            borderBottom={`1px solid ${MV.hairline}`}
          >
            <Box
              as={AiOutlineFolder}
              boxSize="$5"
              color={MV.accent}
              flexShrink={0}
            />
            <Text
              size="base"
              fontWeight="$semibold"
              color={MV.label}
              flex={1}
              css={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                minWidth: "0",
              }}
            >
              {row.group.displayName}
            </Text>
            <Box
              as="span"
              css={{
                background: "rgba(0,0,0,0.05)",
                color: MV.label2,
                fontSize: "11px",
                fontWeight: "$medium",
                lineHeight: 1,
                padding: "4px 9px",
                borderRadius: "999px",
                flexShrink: 0,
              }}
            >
              {row.group.items.length}
            </Box>
          </Box>
          <Box h="12px" />
        </Box>
      )
    }
    if (row.kind === "text") {
      const item = row.item
      const idx = () => getIndex(item)
      const focused = () => focusIndex() === idx()
      const textKey = `${item.path}/${item.name}`
      const content = () => textCache()[textKey]
      let cardEl: HTMLDivElement | undefined
      onMount(() => {
        if (cardEl && textObserver) {
          cardEl.setAttribute("data-text-key", textKey)
          textObserver.observe(cardEl)
        }
      })
      return (
        <Box pb="$2_5">
          <Box
            ref={cardEl}
            data-media-card={idx().toString()}
            rounded="$xl"
            overflow="hidden"
            cursor="pointer"
            border="1px solid"
            borderColor={focused() ? "rgba(0,122,255,0.45)" : MV.hairline}
            bg={MV.surface}
            pb="$3"
            transition="transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease"
            boxShadow={
              focused()
                ? `0 0 0 3px rgba(0,122,255,0.25), ${MV.shadowCard}`
                : MV.shadowCard
            }
            _hover={{
              transform: "translateY(-2px)",
              boxShadow: MV.shadowCardHover,
              borderColor: "rgba(0,0,0,0.12)",
            }}
            onClick={() => openLightbox(idx())}
          >
            <Box
              display="flex"
              alignItems="center"
              gap="$2"
              px="$4"
              py="$2_5"
              borderBottom={`1px solid ${MV.hairline}`}
              bg="rgba(0,0,0,0.02)"
            >
              <Box
                as={FiType}
                boxSize="16px"
                color={MV.dot.text}
                flexShrink={0}
              />
              <Text
                size="sm"
                fontWeight="$bold"
                color={MV.label}
                flex={1}
                css={{ wordBreak: "break-all", lineHeight: "1.35" }}
              >
                {item.name}
              </Text>
              <Text size="xs" color={MV.label3}>
                {formatSize(item.size)}
              </Text>
            </Box>
            <Box px="$4" pt="$4" css={{ userSelect: "text" }}>
              <Show
                when={content() !== undefined}
                fallback={
                  <Box display="flex" alignItems="center" gap="$2" py="$2">
                    <Spinner size="sm" />
                    <Text size="xs" color={MV.label3}>
                      Loading…
                    </Text>
                  </Box>
                }
              >
                <Show
                  when={content()}
                  fallback={
                    <Text size="sm" color={MV.label3} fontStyle="italic">
                      (empty file)
                    </Text>
                  }
                >
                  <Box
                    class="markdown-body word-wrap"
                    as="pre"
                    m={0}
                    css={{
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontSize: "16px",
                      lineHeight: "1.6",
                      fontFamily:
                        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
                    }}
                  >
                    {content()}
                  </Box>
                </Show>
              </Show>
            </Box>
          </Box>
        </Box>
      )
    }
    // cards row
    return (
      <Box
        css={{
          display: "grid",
          "grid-template-columns": `repeat(${cols()}, 1fr)`,
          gap: "12px",
          paddingBottom: "$3",
        }}
      >
        <For each={row.items}>
          {(item) => {
            const idx = () => getIndex(item)
            const focused = () => focusIndex() === idx()
            const link = () => getItemLink(item)
            // a broken thumbnail swaps to a static type-icon placeholder
            // instead of an empty gray tile
            const [thumbErr, setThumbErr] = createSignal(false)
            const [vidErr, setVidErr] = createSignal(false)
            // first-frame <video> mounts only when the card is near the
            // viewport — see cardVideoObserver above
            const [vidOn, setVidOn] = createSignal(false)
            let vidGate: HTMLDivElement | undefined
            // armed in the ref callback, NOT onMount: a video that shows its
            // thumbnail first has no gate until that image fails — the ref
            // fires exactly when the placeholder element is (re)created,
            // whenever that happens
            const armVidGate = (el: HTMLDivElement) => {
              vidGate = el
              if (item.type === "video" && cardVideoObserver) {
                cardVideoCallbacks.set(el, () => setVidOn(true))
                cardVideoObserver.observe(el)
              }
            }
            onCleanup(() => {
              if (vidGate) cardVideoObserver?.unobserve(vidGate)
            })
            const thumbUrl = () => {
              if (item.type === "gif") return link()
              if (item.type === "image") return item.thumb || link()
              if (item.type === "video") return item.thumb
              return ""
            }
            // plain DOM + precompiled classes — see .mv-card styles above
            return (
              <div
                data-media-card={idx().toString()}
                class={focused() ? "mv-card mv-card-focus" : "mv-card"}
                onClick={() => openLightbox(idx())}
              >
                <div class="mv-card-media">
                  <Show
                    when={thumbUrl() && !thumbErr()}
                    fallback={
                      // a video with no server thumbnail shows its own first
                      // frame — a metadata-only <video> needs no canvas and
                      // no CORS gymnastics. It mounts only once the card is
                      // near the viewport (cardVideoObserver): a library of
                      // thumb-less videos must not spin up every decoder at
                      // once.
                      item.type === "video" && vidOn() && !vidErr() ? (
                        <video
                          src={link() + "#t=0.1"}
                          preload="metadata"
                          muted
                          playsinline
                          onError={() => setVidErr(true)}
                          style={{
                            width: "100%",
                            height: "100%",
                            "object-fit": "cover",
                            "pointer-events": "none",
                          }}
                        />
                      ) : (
                        <div
                          ref={armVidGate}
                          style={{
                            display: "flex",
                            "align-items": "center",
                            "justify-content": "center",
                            width: "100%",
                            height: "100%",
                          }}
                        >
                          <Center h="$full">
                            <TypeIcon type={item.type} />
                          </Center>
                        </div>
                      )
                    }
                  >
                    <img
                      src={thumbUrl()}
                      alt={item.name}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      onError={() => setThumbErr(true)}
                    />
                  </Show>
                  {/* play plate sits outside the thumbnail <Show> so videos
                      showing their first-frame fallback get it too */}
                  <Show when={item.type === "video"}>
                    <div class="mv-card-play" />
                  </Show>
                </div>
                <div class="mv-card-cap">
                  <div class="mv-card-name">{item.name}</div>
                  <div class="mv-card-size">{formatSize(item.size)}</div>
                </div>
              </div>
            )
          }}
        </For>
      </Box>
    )
  }

  /* ─── Render ─── */
  return (
    <Box
      pos="fixed"
      top="0"
      right="0"
      bottom="0"
      left="0"
      bg={MV.bg}
      zIndex={1000}
      display="flex"
      flexDirection="column"
      overflow="hidden"
      css={{
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Helvetica Neue', 'Segoe UI', 'Microsoft YaHei', sans-serif",
      }}
    >
      {/* ═══════ Top Bar ═══════ */}
      {/* minimal-but-not-bare toolbar: icon-only by default; the search
          field exists only while it is being used (or holds a filter), and
          folders live behind their icon with a count badge. One row at
          every size — phones get the expanded search as a full-width row. */}
      <Box
        flexShrink={0}
        zIndex={10}
        bg={MV.glass}
        css={{
          backdropFilter: MV.glassBlur,
          WebkitBackdropFilter: MV.glassBlur,
          // no hard hairline — the frosted glass plus this soft edge shadow
          // separates the bar as content scrolls under it
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        }}
      >
        <Box display="flex" alignItems="center" gap="$1_5" px="$3" py="$2">
          <IconButton
            aria-label="Back"
            icon={<BsArrowLeft />}
            variant="ghost"
            size="sm"
            color={MV.label2}
            onClick={() => to(encodePath(folderPath(), true))}
          />
          <Box flex={1} overflow="hidden">
            <Text
              size="sm"
              fontWeight="$bold"
              color={MV.label}
              css={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Media
            </Text>
            <Text
              size="xs"
              color={MV.label2}
              css={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {folderPath()}
            </Text>
          </Box>
          <Show when={searchOpen() || search()}>
            <Show when={containerWidth() >= PHONE_W}>
              <InputGroup size="sm" w="200px" flexShrink={0}>
                <InputLeftElement pointerEvents="none">
                  <Box as={AiOutlineSearch} color={MV.label3} />
                </InputLeftElement>
                <Input
                  ref={searchInputRef}
                  placeholder="Filter files…"
                  value={search()}
                  onInput={(e) => setSearch(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      if (search()) setSearch("")
                      else {
                        setSearchOpen(false)
                        e.currentTarget.blur()
                      }
                    }
                  }}
                  css={{
                    background: MV.surface,
                    borderColor: MV.hairline,
                    color: MV.label,
                    "&::placeholder": { color: MV.label3 },
                  }}
                />
                <Show when={search()}>
                  <InputRightElement>
                    <Box
                      as="button"
                      type="button"
                      aria-label="Clear filter"
                      color={MV.label3}
                      cursor="pointer"
                      background="none"
                      border="none"
                      padding={0}
                      onClick={() => setSearch("")}
                    >
                      <Box as={BsX} />
                    </Box>
                  </InputRightElement>
                </Show>
              </InputGroup>
            </Show>
          </Show>
          <Tooltip label="Filter files" placement="bottom">
            <IconButton
              aria-label="Filter files"
              icon={<AiOutlineSearch />}
              variant="ghost"
              size="sm"
              color={search() || searchOpen() ? MV.accent : MV.label2}
              onClick={() => {
                setSearchOpen((v) => !v)
                setTimeout(() => searchInputRef?.focus(), 60)
              }}
            />
          </Tooltip>
          <Show when={subDirs().length > 0}>
            <Popover placement="bottom-start">
              {({ onClose }) => (
                <>
                  <Box pos="relative">
                    <PopoverTrigger
                      as={Button}
                      variant="ghost"
                      size="sm"
                      aria-label="Folders"
                      css={{ color: MV.label2, px: "$1" }}
                    >
                      <Box as={AiOutlineFolder} boxSize="16px" />
                    </PopoverTrigger>
                    <Box
                      as="span"
                      pos="absolute"
                      top="-2px"
                      right="-2px"
                      css={{
                        background: MV.accent,
                        color: "#fff",
                        fontSize: "9px",
                        fontWeight: "$bold",
                        lineHeight: 1,
                        padding: "2.5px 5px",
                        borderRadius: "999px",
                        pointerEvents: "none",
                      }}
                    >
                      {subDirs().length}
                    </Box>
                  </Box>
                  <PopoverContent
                    w="280px"
                    css={{
                      background: MV.surface,
                      border: `1px solid ${MV.hairline}`,
                      boxShadow: MV.shadowPop,
                      borderRadius: "14px",
                    }}
                  >
                    <PopoverBody p="$1" display="flex" flexDirection="column">
                      <Input
                        placeholder="Filter folders…"
                        value={dirFilter()}
                        onInput={(e) => setDirFilter(e.currentTarget.value)}
                        size="sm"
                        mb="$1"
                        css={{
                          background: MV.surface,
                          borderColor: MV.hairline,
                          color: MV.label,
                          "&::placeholder": { color: MV.label3 },
                        }}
                      />
                      <Box maxH="50vh" overflowY="auto">
                        <For each={filteredSubDirs()}>
                          {(sub) => {
                            const name = sub.split("/").pop() || sub
                            return (
                              <Box
                                display="flex"
                                alignItems="center"
                                gap="$2"
                                px="$2"
                                py="$1_5"
                                rounded="$md"
                                cursor="pointer"
                                _hover={{ bg: "rgba(0,0,0,0.04)" }}
                                onClick={() => {
                                  onClose()
                                  setDirFilter("")
                                  scrollToFolder(sub)
                                }}
                              >
                                <Box
                                  as={AiOutlineFolder}
                                  boxSize="14px"
                                  color={MV.accent}
                                  flexShrink={0}
                                />
                                <Text
                                  size="sm"
                                  color={MV.label}
                                  css={{ wordBreak: "break-all" }}
                                >
                                  {name}
                                </Text>
                              </Box>
                            )
                          }}
                        </For>
                        <Show when={filteredSubDirs().length === 0}>
                          <Text size="xs" color={MV.label3} px="$2" py="$2">
                            No folders match
                          </Text>
                        </Show>
                      </Box>
                    </PopoverBody>
                  </PopoverContent>
                </>
              )}
            </Popover>
          </Show>
          <Show when={scanning()}>
            <Spinner size="sm" color={MV.accent} />
          </Show>
          <Tooltip label="Refresh (r)" placement="bottom">
            <IconButton
              aria-label="Refresh"
              icon={<AiOutlineReload />}
              variant="ghost"
              size="sm"
              color={MV.label2}
              onClick={startScan}
              disabled={scanning()}
            />
          </Tooltip>
          <Tooltip label="Shortcuts (?)" placement="bottom">
            <IconButton
              aria-label="Help"
              icon={<BsQuestionCircle />}
              variant="ghost"
              size="sm"
              color={MV.label2}
              onClick={() => setShowHelp(true)}
            />
          </Tooltip>
        </Box>

        {/* phones: the expanded filter takes a full-width row of its own */}
        <Show when={(searchOpen() || search()) && containerWidth() < PHONE_W}>
          <Box px="$3" pb="$2">
            <InputGroup size="sm" w="100%">
              <InputLeftElement pointerEvents="none">
                <Box as={AiOutlineSearch} color={MV.label3} />
              </InputLeftElement>
              <Input
                ref={searchInputRef}
                placeholder="Filter files…"
                value={search()}
                onInput={(e) => setSearch(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    if (search()) setSearch("")
                    else {
                      setSearchOpen(false)
                      e.currentTarget.blur()
                    }
                  }
                }}
                css={{
                  background: MV.surface,
                  borderColor: MV.hairline,
                  color: MV.label,
                  "&::placeholder": { color: MV.label3 },
                }}
              />
              <Show when={search()}>
                <InputRightElement>
                  <Box
                    as="button"
                    type="button"
                    aria-label="Clear filter"
                    color={MV.label3}
                    cursor="pointer"
                    background="none"
                    border="none"
                    padding={0}
                    onClick={() => setSearch("")}
                  >
                    <Box as={BsX} />
                  </Box>
                </InputRightElement>
              </Show>
            </InputGroup>
          </Box>
        </Show>
      </Box>

      {/* ═══════ Scanning Progress ═══════ */}
      {/* a slim travelling light under the top bar; the live item count it
          used to report already streams into the header counter */}
      <Show when={scanning()}>
        <Box
          flexShrink={0}
          h="2px"
          pos="relative"
          overflow="hidden"
          bg="rgba(0,122,255,0.10)"
        >
          <Box
            class="mv-scanline"
            pos="absolute"
            top="0"
            bottom="0"
            w="36%"
            css={{
              background: `linear-gradient(90deg, transparent, ${MV.accent}, transparent)`,
            }}
          />
        </Box>
      </Show>

      {/* ═══════ Partial-scan warning ═══════ */}
      {/* a scan that loaded some media and then failed on a nested folder
          must not masquerade as a complete library */}
      <Show when={scanError() && !scanning() && flatItems().length > 0}>
        <Box
          flexShrink={0}
          display="flex"
          alignItems="center"
          gap="$2"
          px="$3"
          py="$1_5"
          bg="rgba(255,149,0,0.10)"
        >
          <Box
            as="span"
            css={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              background: "#FF9500",
              flexShrink: 0,
            }}
          />
          <Text size="xs" color="rgba(130,80,0,0.85)" flex={1}>
            Some folders failed to load ({scanError()}) — the list may be
            incomplete
          </Text>
          <Box
            as="button"
            type="button"
            css={{
              background: "none",
              border: "none",
              padding: 0,
              fontSize: "12px",
              color: "rgba(130,80,0,0.85)",
              cursor: "pointer",
              textDecoration: "underline",
              flexShrink: 0,
            }}
            onClick={startScan}
          >
            Retry
          </Box>
          <Box
            as="button"
            type="button"
            aria-label="Dismiss warning"
            css={{
              background: "none",
              border: "none",
              padding: 0,
              color: "rgba(130,80,0,0.6)",
              cursor: "pointer",
              flexShrink: 0,
              display: "flex",
            }}
            onClick={() => setScanError(null)}
          >
            <Box as={BsX} boxSize="14px" />
          </Box>
        </Box>
      </Show>

      {/* ═══════ Main Content ═══════ */}
      <style>{`
        .mv-grid, .mv-grid * { box-sizing: border-box; }
        /* macOS-style thin overlay scrollbar */
        .mv-grid { scrollbar-width: thin; scrollbar-color: rgba(0,0,0,0.22) transparent; }
        .mv-grid::-webkit-scrollbar { width: 9px; }
        .mv-grid::-webkit-scrollbar-track { background: transparent; }
        .mv-grid::-webkit-scrollbar-thumb {
          background-color: rgba(0,0,0,0.18);
          border-radius: 99px;
          border: 2.5px solid transparent;
          background-clip: content-box;
        }
        .mv-grid::-webkit-scrollbar-thumb:hover { background-color: rgba(0,0,0,0.32); }

        /* lightbox chrome auto-hide */
        .mv-chrome { transition: opacity 0.3s ease, transform 0.3s ease, visibility 0.3s; }
        .mv-chrome-off { opacity: 0 !important; visibility: hidden; }
        .mv-chrome-top.mv-chrome-off { transform: translateY(-10px); }
        .mv-chrome-bottom.mv-chrome-off { transform: translateY(10px); }

        /* during slides / zoom / pan the glass bars go solid: no backdrop
           re-blur per frame, near-identical look mid-motion */
        .mv-glass-off {
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
          background: rgba(246,246,248,0.95) !important;
        }

        /* filmstrip cells — active ring driven by class so reused DOM
           nodes update reactively */
        .mv-fs-cell {
          opacity: 0.55;
          outline: 2px solid transparent;
          outline-offset: 0;
          transition: opacity 0.15s ease, outline-color 0.15s ease;
        }
        .mv-fs-cell:hover { opacity: 0.85; }
        .mv-fs-cell.mv-fs-active, .mv-fs-cell.mv-fs-active:hover {
          opacity: 1;
          outline-color: ${MV.accent};
        }
        .mv-fs-cell:focus-visible { outline-color: ${MV.accent}; }

        /* scan progress: a slim travelling light */
        @keyframes mvScan { from { left: -40%; } to { left: 104%; } }
        .mv-scanline { animation: mvScan 1.1s cubic-bezier(0.45,0.05,0.55,0.95) infinite; }

        /* one-time row entrance — plays once per row key, never on re-mount */
        @keyframes mvRowIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
        .mv-enter { animation: mvRowIn 0.36s cubic-bezier(0.22,0.61,0.36,1) both; }

        /* media cards — plain divs with precompiled classes. A Hope Box per
           node meant a css-in-js compile + extra component per card at every
           virtualized row mount, which is exactly the scroll long-task cost:
           this markup must stay framework-free. */
        .mv-card {
          position: relative;
          background: #fff;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 12px;
          overflow: hidden;
          cursor: pointer;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 4px 14px rgba(0, 0, 0, 0.05);
          transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
        }
        /* media is ALWAYS developed — a photographic grade applied with
           pure CSS functions: exposure/brightness ≈ +12 (restrained:
           brightness() has no highlight rolloff, so we stay well short of
           clipping), contrast +6 (depth/dehaze), vibrance +12, white
           balance ≈ +4 warm via a sepia trace. A true SVG tone curve
           (shadow lift + highlight rolloff) was measured at 6× CPU
           throttle at 14.2ms avg / p95 48.5 / 8 dropped frames vs
           7.8ms / p95 14 / 0 dropped for plain CSS — rejected for a view
           that just recovered from scroll jank. Hover adds motion only:
           a grade must not change color because the pointer arrived. */
        .mv-card-media img,
        .mv-card-media video {
          filter: brightness(1.12) contrast(1.06) saturate(1.12)
            sepia(0.04);
        }
        .mv-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05), 0 12px 30px rgba(0, 0, 0, 0.1);
          border-color: rgba(0, 122, 255, 0.35);
        }
        .mv-card:hover .mv-card-media img,
        .mv-card:hover .mv-card-media video {
          transform: scale(1.05);
        }
        .mv-card-focus {
          border-color: rgba(0, 122, 255, 0.45);
          box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.25),
            0 1px 2px rgba(0, 0, 0, 0.04), 0 4px 14px rgba(0, 0, 0, 0.05);
        }
        .mv-card-media {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.03);
          overflow: hidden;
          aspect-ratio: 4 / 3;
        }
        .mv-card-media img,
        .mv-card-media video {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.35s cubic-bezier(0.22, 0.61, 0.36, 1);
        }
        /* glass-spec: a hairline of light along the media's top edge */
        .mv-card-media::before {
          content: "";
          position: absolute;
          inset: 0;
          border-top: 1px solid rgba(255, 255, 255, 0.38);
          pointer-events: none;
          z-index: 2;
        }
        /* compact play plate — reads on bright frames too, unlike a bare
           triangle; ::after draws the triangle */
        .mv-card-play {
          position: absolute;
          inset: 0;
          margin: auto;
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: rgba(0, 0, 0, 0.28);
          border: 1px solid rgba(255, 255, 255, 0.55);
          box-shadow: 0 1px 5px rgba(0, 0, 0, 0.22);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 3;
          pointer-events: none;
        }
        .mv-card-play::after {
          content: "";
          display: block;
          margin-left: 2px;
          border-top: 6px solid transparent;
          border-bottom: 6px solid transparent;
          border-left: 10px solid rgba(255, 255, 255, 0.95);
        }
        .mv-card-cap { padding: 10px 12px 12px; }
        .mv-card-name {
          font-size: 12px;
          font-weight: 600;
          line-height: 1.35;
          color: rgba(60, 60, 67, 0.92);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          word-break: break-all;
        }
        .mv-card-size { font-size: 12px; line-height: 1.4; color: rgba(60, 60, 67, 0.34); margin-top: 4px; }

        @media (prefers-reduced-motion: reduce) {
          .mv-scanline { animation: none; left: 0; }
          .mv-enter { animation: none; }
          .mv-chrome { transition: none; }
          .mv-card,
          .mv-card-media img,
          .mv-card-media video { transition: none; }
          .mv-card:hover { transform: none; }
          .mv-card:hover .mv-card-media img,
          .mv-card:hover .mv-card-media video { transform: none; }
        }
      `}</style>
      <Box
        ref={scrollRef}
        class="mv-grid"
        flex={1}
        overflowY="auto"
        overflowX="hidden"
        px="$3"
      >
        <Show
          when={!loading()}
          fallback={
            <Center h="$full">
              <Box textAlign="center">
                <FullLoading />
                <Show when={scanMsg()}>
                  <Text size="sm" color={MV.label2} mt="$2">
                    {scanMsg()}
                  </Text>
                </Show>
              </Box>
            </Center>
          }
        >
          <Show
            when={rows().length > 0}
            fallback={
              <Center h="$full">
                <Box textAlign="center">
                  <Box
                    as={AiOutlineFolder}
                    boxSize="$16"
                    color={MV.label3}
                    mx="auto"
                    mb="$3"
                  />
                  <Text size="lg" color={MV.label2}>
                    {items().length === 0
                      ? scanError()
                        ? "Scan failed"
                        : "No media files found"
                      : "No files match filter"}
                  </Text>
                  <Text size="sm" color={MV.label3} mt="$1">
                    {items().length === 0
                      ? scanError()
                        ? `${scanError()} — press ↻ to retry`
                        : "Images, videos, GIFs and text files appear here"
                      : `Nothing matches “${search()}”`}
                  </Text>
                </Box>
              </Center>
            }
          >
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                position: "relative",
                width: "100%",
              }}
            >
              <For each={virtualizer.getVirtualItems()}>
                {(vi) => (
                  <div
                    ref={(el) => {
                      if (el && rowResizeObserver) rowResizeObserver.observe(el)
                      return () => rowResizeObserver?.unobserve(el)
                    }}
                    data-index={vi.index}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vi.start}px)`,
                    }}
                  >
                    <div class={entranceActive() ? "mv-enter" : undefined}>
                      {" "}
                      {renderRow(rows()[vi.index])}
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Box>

      {/* ═══════ Lightbox ═══════ */}
      <Show when={lightboxIndex() !== null}>
        {(() => {
          const item = () => currentItem()
          const idx = () => lightboxIndex()!
          const len = () => flatItems().length

          // cursor point in the media's local (un-zoomed) frame: the rect of a
          // transformed element has its center shifted by pan(), so add it back
          const localPoint = (
            e: { clientX: number; clientY: number },
            el: HTMLElement,
          ) => {
            const r = el.getBoundingClientRect()
            return {
              x: e.clientX - (r.left + r.width / 2) + pan().x,
              y: e.clientY - (r.top + r.height / 2) + pan().y,
            }
          }
          const onMediaWheel = (e: WheelEvent) => {
            if (!canZoom()) return
            e.preventDefault()
            e.stopPropagation()
            wakeChrome()
            measureMediaIfStale()
            const p = localPoint(e, e.currentTarget as HTMLElement)
            // trackpad pinch arrives as ctrl+wheel with tiny deltas — amplify
            const step = e.ctrlKey ? 0.012 : 0.0016
            applyZoom(zoomScale() * Math.exp(-e.deltaY * step), p.x, p.y, 0.12)
            // zooming out in small steps can strand the view just above 1×;
            // settle it home once the wheel goes quiet
            clearTimeout(wheelSnapTimer)
            wheelSnapTimer = setTimeout(snapZoomHome, 180)
          }
          const onMediaDblClick = (e: MouseEvent) => {
            if (!canZoom()) return
            e.stopPropagation()
            wakeChrome()
            measureMedia()
            const p = localPoint(e, e.currentTarget as HTMLElement)
            if (zoomScale() > 1.02) resetZoom()
            else applyZoom(2.5, p.x, p.y, 0.32)
          }
          // when setPointerCapture fails the element handlers stop receiving
          // moves once the pointer leaves the media — window-level fallbacks
          // keep the drag alive for that case (cleanup hoisted to component
          // scope so resetZoom can tear it down mid-drag)
          const dragEnd = () => {
            dragPid = -1
            setPanning(false)
            dragWinCleanup?.()
            dragWinCleanup = null
            snapZoomHome()
          }
          const onMediaPointerDown = (e: PointerEvent) => {
            if (e.pointerType === "touch" || zoomScale() <= 1.01) return
            e.stopPropagation()
            // a fallback from an earlier drag that never saw up/cancel must
            // not survive into this one — matches() reads the live dragPid,
            // so stale listeners would double-process the new pointer
            dragWinCleanup?.()
            dragWinCleanup = null
            dragPid = e.pointerId
            // state first, capture last: setPointerCapture can throw (pointer
            // already released) and must not leave the drag half-initialized
            measureMediaIfStale()
            panStartPt = { x: e.clientX, y: e.clientY }
            panStartVal = pan()
            setPanning(true)
            setZoomAnim(false)
            try {
              ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            } catch {
              const matches = (ev: PointerEvent) => ev.pointerId === dragPid
              const mv = (ev: PointerEvent) => {
                if (matches(ev))
                  scheduleSetPan(
                    clampPan(
                      panStartVal.x + ev.clientX - panStartPt.x,
                      panStartVal.y + ev.clientY - panStartPt.y,
                      zoomScale(),
                    ),
                  )
              }
              const up = (ev: PointerEvent) => {
                if (matches(ev)) dragEnd()
              }
              window.addEventListener("pointermove", mv)
              window.addEventListener("pointerup", up)
              window.addEventListener("pointercancel", up)
              dragWinCleanup = () => {
                window.removeEventListener("pointermove", mv)
                window.removeEventListener("pointerup", up)
                window.removeEventListener("pointercancel", up)
              }
            }
          }
          const onMediaPointerMove = (e: PointerEvent) => {
            if (dragPid !== e.pointerId) return
            scheduleSetPan(
              clampPan(
                panStartVal.x + e.clientX - panStartPt.x,
                panStartVal.y + e.clientY - panStartPt.y,
                zoomScale(),
              ),
            )
          }
          const onMediaPointerUp = (e: PointerEvent) => {
            if (dragPid !== e.pointerId) return
            dragEnd()
          }

          // zoomable still image: blurred thumbnail base that the full image
          // fades in over (blur-up), all wrapped in the pan/zoom transform
          const renderZoomableImage = (it: MediaItem) => {
            const link = getItemLink(it)
            const thumb = it.thumb || link
            const [loaded, setLoaded] = createSignal(false)
            const [failed, setFailed] = createSignal(false)
            const settled = () => loaded() && !failed()
            return (
              <Box
                ref={(el: HTMLDivElement) => {
                  mediaEl = el
                  measureMedia()
                }}
                pos="relative"
                rounded="$lg"
                overflow="hidden"
                onClick={(e: MouseEvent) => e.stopPropagation()}
                onDblClick={onMediaDblClick}
                onWheel={onMediaWheel}
                onPointerDown={onMediaPointerDown}
                onPointerMove={onMediaPointerMove}
                onPointerUp={onMediaPointerUp}
                onPointerCancel={onMediaPointerUp}
                // transform + transition live in `style`, not `css`: they
                // change every frame during a gesture and a plain style write
                // skips re-running the css-in-js pipeline per frame
                style={{
                  transform: `translate3d(${pan().x}px, ${pan().y}px, 0) scale(${zoom()})`,
                  transition:
                    zoomAnim() !== false
                      ? `transform ${zoomAnim()}s cubic-bezier(0.22,0.61,0.36,1)`
                      : "none",
                }}
                css={{
                  transformOrigin: "center",
                  boxShadow: MV.shadowStage,
                  cursor:
                    zoom() > 1.01
                      ? panning()
                        ? "grabbing"
                        : "grab"
                      : "zoom-in",
                  // zoomed: every gesture belongs to the image (pan / pinch).
                  // at rest pan-y keeps the stage's swipe-browse working.
                  touchAction: zoom() > 1.01 ? "none" : "pan-y",
                }}
              >
                <Box
                  as="img"
                  src={thumb}
                  alt=""
                  draggable={false}
                  pos="absolute"
                  top="0"
                  left="0"
                  w="$full"
                  h="$full"
                  objectFit="cover"
                  css={{
                    // the blur is a compositing cost the GPU pays for every
                    // frame of every later animation — once the full image
                    // has landed the base layer leaves the paint tree
                    // entirely (no filter, no visibility). Visibility hides
                    // on a delay so it stays visible through the 300ms
                    // crossfade instead of flashing the stage behind it.
                    opacity: settled() ? 0 : 1,
                    visibility: settled() ? "hidden" : "visible",
                    filter: settled() ? "none" : "blur(18px) saturate(1.2)",
                    transform: "scale(1.12)", // grow past the clip to hide the blur fringe
                    transition:
                      "opacity 0.35s ease, visibility 0s linear 0.35s",
                    pointerEvents: "none",
                  }}
                />
                <Box
                  as="img"
                  src={link}
                  alt={it.name}
                  draggable={false}
                  decoding="async"
                  onLoad={() => setLoaded(true)}
                  onError={() => setFailed(true)}
                  css={{
                    display: "block",
                    maxWidth: "92vw",
                    // keep the media clear of the chrome band (41px top +
                    // 71px bottom + breathing room) — no more overlap
                    maxHeight: "calc(100vh - 128px)",
                    width: "auto",
                    height: "auto",
                    objectFit: "contain",
                    opacity: settled() ? 1 : 0,
                    transition: "opacity 0.3s ease",
                  }}
                />
              </Box>
            )
          }

          // Render a single media item (image / video / text). `exiting`
          // mutes + pauses video so the outgoing copy doesn't double the audio.
          const renderMediaItem = (it: MediaItem, exiting = false) => {
            const link = getItemLink(it)
            if (it.type === "image" || it.type === "gif") {
              // the exiting snapshot is normally already decoded — plain img,
              // no blur-up, no zoom machinery (it is pointer-events:none)
              if (exiting)
                return (
                  <Image
                    src={link}
                    alt={it.name}
                    maxW="92%"
                    maxH="calc(100vh - 128px)"
                    objectFit="contain"
                    rounded="$lg"
                    css={{ boxShadow: MV.shadowStage }}
                    decoding="async"
                    draggable={false}
                    onClick={(e: MouseEvent) => e.stopPropagation()}
                  />
                )
              return renderZoomableImage(it)
            }
            if (it.type === "video") {
              return (
                <Box
                  as="video"
                  src={link}
                  controls={!exiting}
                  autoplay={!exiting}
                  muted={exiting}
                  maxW="92%"
                  maxH="calc(100vh - 128px)"
                  rounded="$lg"
                  onClick={(e: MouseEvent) => e.stopPropagation()}
                  css={{ outline: "none", touchAction: "pan-y" }}
                />
              )
            }
            if (it.type === "text") {
              const key = `${it.path}/${it.name}`
              const content = textCache()[key]
              return (
                <Box
                  w="min(800px, 90%)"
                  maxH="calc(100vh - 148px)"
                  overflowY="auto"
                  bg={MV.surface}
                  rounded="$lg"
                  border={`1px solid ${MV.hairline}`}
                  boxShadow={MV.shadowPop}
                  p="$4"
                  onClick={(e: MouseEvent) => e.stopPropagation()}
                >
                  <Show
                    when={content !== undefined}
                    fallback={
                      <Center py="$8">
                        <Spinner />
                      </Center>
                    }
                  >
                    <Box
                      as="pre"
                      fontFamily="$mono"
                      fontSize="14px"
                      lineHeight="1.7"
                      color={MV.label}
                      m={0}
                      css={{
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {content}
                    </Box>
                  </Show>
                </Box>
              )
            }
            return null
          }

          /* ─── Feed mode (TikTok-style vertical feed) ───
             One item per black full-bleed page. The three neighbouring
             slots slide live under the finger (rubber-banded at the ends)
             and settle to a page on release; videos autoplay and chain. */
          const renderFeedMode = () => {
            const feedBarCss = {
              pointerEvents: "none" as const,
              background: "rgba(20,20,22,0.55)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
            }
            let feedWheelAt = 0

            const feedMedia = (i: number, isCurrent: boolean) => {
              const it = flatItems()[i]
              if (!it) return null
              const link = getItemLink(it)
              if (it.type === "video") {
                return (
                  <Box
                    as="video"
                    src={link}
                    controls={isCurrent}
                    autoplay={isCurrent}
                    playsinline
                    muted={!isCurrent}
                    onEnded={() => {
                      if (isCurrent) feedNext()
                    }}
                    css={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      background: "#000",
                      outline: "none",
                    }}
                  />
                )
              }
              if (it.type === "text") {
                const key = `${it.path}/${it.name}`
                const content = textCache()[key]
                if (isCurrent) fetchTextContent(it)
                return (
                  <Box
                    class="mv-feed-text"
                    w="min(720px, 92vw)"
                    maxH="80vh"
                    overflowY="auto"
                    css={{
                      // pan-y re-enables this element's native touch
                      // scrolling inside the touch-action:none stage
                      touchAction: "pan-y",
                      background: "rgba(28,28,30,0.92)",
                      borderRadius: "16px",
                      padding: "20px",
                      color: "rgba(235,235,245,0.92)",
                    }}
                  >
                    <Show
                      when={content !== undefined}
                      fallback={
                        <Center py="$8">
                          <Spinner />
                        </Center>
                      }
                    >
                      <Box
                        as="pre"
                        css={{
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          fontFamily: "$mono",
                          fontSize: "14px",
                          lineHeight: 1.7,
                        }}
                      >
                        {content}
                      </Box>
                    </Show>
                  </Box>
                )
              }
              return (
                <Box
                  as="img"
                  src={link}
                  alt={it.name}
                  draggable={false}
                  decoding="async"
                  css={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    objectFit: "contain",
                    pointerEvents: "none",
                  }}
                />
              )
            }

            const scrubFrom = (clientX: number) => {
              const track = document.querySelector(".mv-feed-track")
              if (!track) return
              const r = track.getBoundingClientRect()
              const frac = Math.max(
                0,
                Math.min(1, (clientX - r.left) / Math.max(1, r.width)),
              )
              const target = Math.round(frac * (len() - 1))
              if (target !== idx()) {
                // a jump must also kill an in-flight settle, or its timer
                // would advance once more from the scrubbed-to index
                feedCancelSettle()
                gotoLightbox(target)
              }
            }

            const toggleChrome = () => {
              if (chromeHidden()) wakeChrome()
              else {
                clearTimeout(chromeTimer)
                chromeTimer = undefined
                setChromeHidden(true)
              }
            }

            // interactive descendants own their touches — the stage must
            // neither drag nor toggle chrome for them (scrubber, video
            // controls, buttons, links). The text panel is drag-owned (its
            // scroll must not page the feed) but a TAP on it still toggles
            // the chrome, classified by "finger moved / panel scrolled".
            const feedOnControl = (
              target: EventTarget | null,
              kind: "drag" | "click",
            ) =>
              !!(target as HTMLElement | null)?.closest(
                kind === "drag"
                  ? "video, .mv-feed-track, .mv-feed-text, button, a"
                  : "video, .mv-feed-track, button, a",
              )
            let feedTouchOnControl = false
            let feedTouchPanel: HTMLElement | null = null
            let feedTouchPanelScroll = 0

            return (
              <Box
                pos="absolute"
                top="0"
                right="0"
                bottom="0"
                left="0"
                zIndex={1}
                bg="#000"
                css={{ touchAction: "none", overscrollBehavior: "none" }}
                onTouchStart={(e: TouchEvent) => {
                  clearTimeout(tapTimer)
                  touchMoved = false
                  feedTouchOnControl = feedOnControl(e.target, "drag")
                  feedTouchPanel =
                    ((e.target as HTMLElement).closest?.(
                      ".mv-feed-text",
                    ) as HTMLElement) || null
                  feedTouchPanelScroll = feedTouchPanel?.scrollTop ?? 0
                  touchStartY = e.touches[0].clientY
                  // remembered for the trailing-click suppression
                  lastTouchClickPt = {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY,
                  }
                  feedLastY = touchStartY
                  feedLastT = performance.now()
                  feedVelocity = 0
                  // no wakeChrome here: a tap toggles the chrome, and waking
                  // on touchstart would immediately re-show what the tap hid
                }}
                onTouchMove={(e: TouchEvent) => {
                  if (e.touches.length !== 1 || feedTouchOnControl) return
                  const y = e.touches[0].clientY
                  // a new move during an in-flight settle TAKES OVER the
                  // animation: freeze it in place and re-base the drag on
                  // top of the frozen position, so the page never snaps
                  // back to rest mid-grab
                  if (feedSettle()) {
                    feedInterruptSettle()
                    touchStartY = y - feedShift()
                    feedLastY = y
                    feedLastT = performance.now()
                    feedVelocity = 0
                    touchMoved = true
                    return
                  }
                  const now = performance.now()
                  const dt = now - feedLastT
                  if (dt > 0) {
                    feedVelocity =
                      feedVelocity * 0.6 + ((y - feedLastY) / dt) * 0.4
                    feedLastY = y
                    feedLastT = now
                  }
                  const dy = y - touchStartY
                  if (Math.abs(dy) > 8) touchMoved = true
                  feedApplyDrag(dy)
                }}
                onTouchEnd={(e: TouchEvent) => {
                  lastTouchAt = Date.now()
                  if (feedTouchOnControl) {
                    // a tap on the text panel (no finger travel, no panel
                    // scroll) still toggles the chrome
                    const movedY = Math.abs(
                      e.changedTouches[0].clientY - touchStartY,
                    )
                    if (
                      feedTouchPanel &&
                      Math.abs(
                        feedTouchPanel.scrollTop - feedTouchPanelScroll,
                      ) < 1 &&
                      movedY < 10
                    )
                      toggleChrome()
                    feedTouchOnControl = false
                    feedTouchPanel = null
                    return
                  }
                  if (touchMoved) {
                    feedDecide()
                    // a page turn counts as activity — bring the bars back
                    // (they may have been hidden by an earlier tap)
                    wakeChrome()
                    return
                  }
                  // tap toggles the chrome (TikTok habit)
                  toggleChrome()
                }}
                onTouchCancel={() => {
                  if (feedTouchOnControl) {
                    feedTouchOnControl = false
                    return
                  }
                  if (touchMoved) feedDecide()
                  else feedSettleTo(0)
                }}
                onPointerDown={(e: PointerEvent) => {
                  if (e.pointerType !== "mouse" || e.button !== 0) return
                  if (feedOnControl(e.target, "drag")) return
                  feedDragPid = e.pointerId
                  touchMoved = false
                  touchStartY = e.clientY
                  feedLastY = e.clientY
                  feedLastT = performance.now()
                  feedVelocity = 0
                  try {
                    ;(e.currentTarget as HTMLElement).setPointerCapture(
                      e.pointerId,
                    )
                  } catch {
                    /* synthetic pointers cannot capture */
                  }
                }}
                onPointerMove={(e: PointerEvent) => {
                  if (feedDragPid !== e.pointerId) return
                  if (feedSettle()) {
                    feedInterruptSettle()
                    touchStartY = e.clientY - feedShift()
                    feedLastY = e.clientY
                    feedLastT = performance.now()
                    feedVelocity = 0
                    touchMoved = true
                    return
                  }
                  const now = performance.now()
                  const dt = now - feedLastT
                  if (dt > 0) {
                    feedVelocity =
                      feedVelocity * 0.6 + ((e.clientY - feedLastY) / dt) * 0.4
                    feedLastY = e.clientY
                    feedLastT = now
                  }
                  const dy = e.clientY - touchStartY
                  if (Math.abs(dy) > 8) touchMoved = true
                  feedApplyDrag(dy)
                }}
                onPointerUp={(e: PointerEvent) => {
                  if (feedDragPid !== e.pointerId) return
                  feedDragPid = -1
                  if (touchMoved) feedDecide()
                }}
                onPointerCancel={(e: PointerEvent) => {
                  if (feedDragPid !== e.pointerId) return
                  feedDragPid = -1
                  feedDecide()
                }}
                onClick={(e: MouseEvent) => {
                  // the compatibility click trailing a touch is owned by the
                  // touchend tap logic — suppressed only near the touch, so
                  // a genuine mouse click elsewhere on a hybrid still works
                  const nearTouch =
                    Date.now() - lastTouchAt <= 500 &&
                    Math.hypot(
                      e.clientX - lastTouchClickPt.x,
                      e.clientY - lastTouchClickPt.y,
                    ) < 44
                  if (nearTouch) return
                  if (feedOnControl(e.target, "click")) return
                  if (!touchMoved) toggleChrome()
                }}
                onWheel={(e: WheelEvent) => {
                  // inside the text panel the wheel scrolls the panel until
                  // it hits its edge; only then does it page the feed
                  const panel = (e.target as HTMLElement).closest(
                    ".mv-feed-text",
                  ) as HTMLElement | null
                  if (panel) {
                    const atTop = panel.scrollTop <= 0
                    const atBottom =
                      panel.scrollTop + panel.clientHeight >=
                      panel.scrollHeight - 1
                    const up = e.deltaY < 0
                    if ((up && !atTop) || (!up && !atBottom)) return
                  }
                  e.preventDefault()
                  // settle FIRST so a snap in progress can't bank momentum
                  // for an immediate second page; the accumulator decays
                  // after 200ms of quiet and its sign picks the direction
                  if (feedSettle()) {
                    feedWheelAcc = 0
                    return
                  }
                  const now = Date.now()
                  if (now - feedWheelAt > 200) feedWheelAcc = 0
                  feedWheelAt = now
                  feedWheelAcc += e.deltaY
                  if (Math.abs(feedWheelAcc) < 60) return
                  const dir = Math.sign(feedWheelAcc)
                  feedWheelAcc = 0
                  if (dir > 0) feedNext()
                  else feedPrev()
                }}
              >
                <For
                  each={[idx() - 1, idx(), idx() + 1].filter(
                    (i) => i >= 0 && i < len(),
                  )}
                >
                  {(i) => (
                    <div
                      class={
                        i === idx()
                          ? "mv-feed-slot mv-feed-cur"
                          : "mv-feed-slot"
                      }
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        display: "flex",
                        "align-items": "center",
                        "justify-content": "center",
                        transform: `translateY(calc(${(i - idx()) * 100}% + ${feedShift()}px))`,
                        transition:
                          feedSettle() && !REDUCED_MOTION
                            ? "transform 0.28s cubic-bezier(0.22,0.68,0.24,1)"
                            : "none",
                      }}
                    >
                      {feedMedia(i, i === idx())}
                    </div>
                  )}
                </For>

                {/* top bar — dark glass: name, download, exit feed, close */}
                <Box
                  class={`mv-chrome mv-chrome-top${chromeHidden() ? " mv-chrome-off" : ""}${motionActive() ? " mv-feed-glass-off" : ""}`}
                  pos="absolute"
                  top="0"
                  left="0"
                  right="0"
                  zIndex={5}
                  css={feedBarCss}
                >
                  <Box
                    display="flex"
                    alignItems="center"
                    gap="$2"
                    px="$3"
                    py="$2_5"
                  >
                    <Text
                      flex={1}
                      size="sm"
                      css={{
                        color: "rgba(235,235,245,0.92)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {item()?.name}
                    </Text>
                    <Show when={item()}>
                      <Box
                        as="a"
                        href={getItemLink(item()!)}
                        download=""
                        target="_blank"
                        rel="noopener"
                        aria-label="Download"
                        flexShrink={0}
                        w="32px"
                        h="32px"
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        rounded="$full"
                        css={{
                          pointerEvents: "auto",
                          color: "rgba(235,235,245,0.92)",
                          background: "rgba(255,255,255,0.12)",
                          "&:hover": { background: "rgba(255,255,255,0.22)" },
                        }}
                        onClick={(e: MouseEvent) => e.stopPropagation()}
                      >
                        <Box as={BsDownload} boxSize="15px" />
                      </Box>
                    </Show>
                    <IconButton
                      aria-label="Exit feed mode"
                      icon={<FiFilm />}
                      variant="ghost"
                      css={{
                        pointerEvents: "auto",
                        color: "rgba(235,235,245,0.92)",
                        background: "rgba(255,255,255,0.12)",
                        "&:hover": { background: "rgba(255,255,255,0.22)" },
                      }}
                      onClick={() => {
                        feedReset()
                        setLbMode("normal")
                      }}
                    />
                    <IconButton
                      aria-label="Close"
                      icon={<BsX />}
                      variant="ghost"
                      size="lg"
                      rounded="$full"
                      css={{
                        pointerEvents: "auto",
                        color: "rgba(235,235,245,0.92)",
                        background: "rgba(255,255,255,0.12)",
                        "&:hover": { background: "rgba(255,255,255,0.22)" },
                      }}
                      onClick={closeLightbox}
                    />
                  </Box>
                </Box>

                {/* bottom bar — counter + scrubber */}
                <Box
                  class={`mv-chrome mv-chrome-bottom${chromeHidden() ? " mv-chrome-off" : ""}${motionActive() ? " mv-feed-glass-off" : ""}`}
                  pos="absolute"
                  bottom="0"
                  left="0"
                  right="0"
                  zIndex={5}
                  css={feedBarCss}
                >
                  <Box px="$3" py="$2_5">
                    <Text
                      size="xs"
                      css={{
                        color: "rgba(235,235,245,0.75)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {idx() + 1} / {len()}
                      <Show when={item()}>
                        {" · "}
                        {formatSize(item()!.size)}
                      </Show>
                    </Text>
                    <div
                      class="mv-feed-track"
                      onPointerDown={(e: PointerEvent) => {
                        e.stopPropagation()
                        // grabbing the scrubber cancels any settle, even a
                        // jump landing on the current index — the grab wins
                        feedCancelSettle()
                        feedScrubbing = true
                        try {
                          ;(e.currentTarget as HTMLElement).setPointerCapture(
                            e.pointerId,
                          )
                        } catch {
                          // synthetic/lost pointer: fall back to a window
                          // release listener so the scrub can't stick
                          const up = () => {
                            feedScrubbing = false
                            window.removeEventListener("pointerup", up)
                            window.removeEventListener("pointercancel", up)
                            if (scrubFallbackCleanup === up)
                              scrubFallbackCleanup = null
                          }
                          // a second failed capture must not orphan the
                          // first fallback's listeners
                          scrubFallbackCleanup?.()
                          scrubFallbackCleanup = up
                          window.addEventListener("pointerup", up)
                          window.addEventListener("pointercancel", up)
                        }
                        scrubFrom(e.clientX)
                      }}
                      onPointerMove={(e: PointerEvent) => {
                        if (feedScrubbing) scrubFrom(e.clientX)
                      }}
                      onPointerUp={() => {
                        feedScrubbing = false
                      }}
                      onPointerCancel={() => {
                        feedScrubbing = false
                      }}
                    >
                      <div class="mv-feed-rail" />
                      <div
                        class="mv-feed-fill"
                        style={{
                          width: `${((idx() + 1) / len()) * 100}%`,
                        }}
                      />
                    </div>
                  </Box>
                </Box>
              </Box>
            )
          }

          return (
            <Box
              pos="fixed"
              top="0"
              right="0"
              bottom="0"
              left="0"
              zIndex={1100}
              css={{ touchAction: "pan-y", overflow: "hidden" }}
            >
              <style>{`
                @keyframes mvInNext  { from { transform: translateX(100%); }  to { transform: translateX(0); } }
                @keyframes mvInPrev  { from { transform: translateX(-100%); } to { transform: translateX(0); } }
                @keyframes mvOutNext { from { transform: translateX(0); }    to { transform: translateX(-100%); } }
                @keyframes mvOutPrev { from { transform: translateX(0); }    to { transform: translateX(100%); } }
                @keyframes mvInOpen  { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
                .mv-in-next  { animation: mvInNext  0.32s cubic-bezier(0.22,0.61,0.36,1); }
                .mv-in-prev  { animation: mvInPrev  0.32s cubic-bezier(0.22,0.61,0.36,1); }
                .mv-out-next { animation: mvOutNext 0.32s cubic-bezier(0.22,0.61,0.36,1) forwards; }
                .mv-out-prev { animation: mvOutPrev 0.32s cubic-bezier(0.22,0.61,0.36,1) forwards; }
                .mv-in-open  { animation: mvInOpen  0.2s ease-out; }
                html, body { overscroll-behavior-x: none !important; }
                @media (prefers-reduced-motion: reduce) {
                  .mv-in-next, .mv-in-prev, .mv-out-next, .mv-out-prev, .mv-in-open { animation: none; }
                }
                /* feed mode scrubber */
                .mv-feed-glass-off {
                  backdrop-filter: none !important;
                  -webkit-backdrop-filter: none !important;
                  background: rgba(20, 20, 22, 0.92) !important;
                }
                .mv-feed-track {
                  position: relative;
                  height: 16px;
                  margin-top: 4px;
                  cursor: pointer;
                  touch-action: none;
                  pointer-events: auto;
                }
                .mv-feed-rail {
                  position: absolute;
                  left: 0; right: 0; top: 50%;
                  transform: translateY(-50%);
                  height: 3px;
                  border-radius: 99px;
                  background: rgba(255,255,255,0.22);
                }
                .mv-feed-fill {
                  position: absolute;
                  left: 0; top: 50%;
                  transform: translateY(-50%);
                  height: 3px;
                  border-radius: 99px;
                  background: #fff;
                }
              `}</style>
              <Show when={lbMode() === "normal"} fallback={renderFeedMode()}>
                {/* backdrop — a whisper of depth instead of flat paper */}
                <Box
                  pos="absolute"
                  top="0"
                  right="0"
                  bottom="0"
                  left="0"
                  css={{ background: MV.stageGrad }}
                />
                {/* media stage — full screen; swipe to browse, tap to close */}
                <Box
                  pos="absolute"
                  top="0"
                  right="0"
                  bottom="0"
                  left="0"
                  zIndex={1}
                  css={{
                    // pan-y: let text scroll vertically; hand horizontal swipes
                    // (browse) to JS and stop the browser's swipe-to-go-back from
                    // hijacking them.
                    overscrollBehavior: "none",
                    touchAction: "pan-y",
                    overflow: "hidden",
                  }}
                  onTouchStart={(e: TouchEvent) => {
                    clearTimeout(tapTimer) // a new touch cancels a pending close
                    touchStartX = e.touches[0].clientX
                    touchStartY = e.touches[0].clientY
                    touchMoved = false
                    touchStartTarget = e.target as HTMLElement | null
                    multiTouch = e.touches.length >= 2
                    touchPanBase = null // created lazily on first real movement
                    pinchStart = null
                    if (multiTouch && canZoom()) {
                      // flush any frame the previous gesture phase queued, so
                      // this baseline reads the latest committed pan/zoom (a
                      // 1→2 or 2→3 contact jump otherwise baselines stale)
                      flushPanRaf()
                      setTouchGesture(true)
                      measureMediaIfStale()
                      const [a, b] = [e.touches[0], e.touches[1]]
                      // media center in client coords, un-zoomed: the visual
                      // center is shifted by the current pan, so subtract it
                      const r = mediaEl?.getBoundingClientRect()
                      const cx = r
                        ? r.left + r.width / 2 - pan().x
                        : window.innerWidth / 2
                      const cy = r
                        ? r.top + r.height / 2 - pan().y
                        : window.innerHeight / 2
                      pinchStart = {
                        d: Math.hypot(
                          a.clientX - b.clientX,
                          a.clientY - b.clientY,
                        ),
                        z: zoomScale(),
                        pan: pan(),
                        mx: (a.clientX + b.clientX) / 2,
                        my: (a.clientY + b.clientY) / 2,
                        cx,
                        cy,
                      }
                      pinchFingers = e.touches.length
                      touchMoved = true
                    }
                  }}
                  onTouchMove={(e: TouchEvent) => {
                    if (pinchStart && e.touches.length >= 2) {
                      // a finger joining or leaving changes the contact set —
                      // re-baseline so the remaining pair doesn't jump. Flush
                      // any pending frame first so the new baseline reflects
                      // the gesture's latest committed state, not the one
                      // before the queued rAF write.
                      if (pinchFingers !== e.touches.length) {
                        flushPanRaf()
                        const [a, b] = [e.touches[0], e.touches[1]]
                        const r = mediaEl?.getBoundingClientRect()
                        pinchStart = {
                          d: Math.hypot(
                            a.clientX - b.clientX,
                            a.clientY - b.clientY,
                          ),
                          z: zoomScale(),
                          pan: pan(),
                          mx: (a.clientX + b.clientX) / 2,
                          my: (a.clientY + b.clientY) / 2,
                          cx: r
                            ? r.left + r.width / 2 - pan().x
                            : window.innerWidth / 2,
                          cy: r
                            ? r.top + r.height / 2 - pan().y
                            : window.innerHeight / 2,
                        }
                        pinchFingers = e.touches.length
                        return
                      }
                      const [a, b] = [e.touches[0], e.touches[1]]
                      const d = Math.hypot(
                        a.clientX - b.clientX,
                        a.clientY - b.clientY,
                      )
                      const mx = (a.clientX + b.clientX) / 2
                      const my = (a.clientY + b.clientY) / 2
                      const z = Math.max(
                        1,
                        Math.min(8, pinchStart.z * (d / pinchStart.d)),
                      )
                      // anchor the content under the fingers' midpoint:
                      // pan' = mid' − C − (mid₀ − C − pan₀)·(z/z₀)
                      const s = z / pinchStart.z
                      scheduleSetPan(
                        clampPan(
                          mx -
                            pinchStart.cx -
                            (pinchStart.mx - pinchStart.cx - pinchStart.pan.x) *
                              s,
                          my -
                            pinchStart.cy -
                            (pinchStart.my - pinchStart.cy - pinchStart.pan.y) *
                              s,
                          z,
                        ),
                        z,
                      )
                      setZoomAnim(false)
                      return
                    }
                    // zoomed: one finger that actually MOVES drags the image.
                    // Created here (not on touchstart) so a stationary tap on a
                    // zoomed image still reaches the double-tap logic below.
                    if (
                      !multiTouch &&
                      !pinchStart &&
                      canZoom() &&
                      zoomScale() > 1.01 &&
                      e.touches.length === 1
                    ) {
                      const dx0 = e.touches[0].clientX - touchStartX
                      const dy0 = e.touches[0].clientY - touchStartY
                      // Euclidean: an 8×8 diagonal is a real move, a slow 9px
                      // axis drift is still close enough to a tap
                      if (Math.hypot(dx0, dy0) > 10) {
                        if (!touchPanBase) {
                          touchPanBase = {
                            x: touchStartX,
                            y: touchStartY,
                            px: pan().x,
                            py: pan().y,
                          }
                          setTouchGesture(true)
                        }
                        scheduleSetPan(
                          clampPan(
                            touchPanBase.px + dx0,
                            touchPanBase.py + dy0,
                            zoomScale(),
                          ),
                        )
                        touchMoved = true
                        return
                      }
                    }
                    const dx = e.touches[0].clientX - touchStartX
                    const dy = e.touches[0].clientY - touchStartY
                    if (Math.abs(dx) > 10 || Math.abs(dy) > 10)
                      touchMoved = true
                  }}
                  onTouchEnd={(e: TouchEvent) => {
                    const allUp = e.touches.length === 0
                    // the tail of a pinch / zoomed drag is never a swipe or tap
                    if (multiTouch || touchPanBase) {
                      if (allUp) {
                        multiTouch = false
                        pinchStart = null
                        pinchFingers = 0
                        touchPanBase = null
                        setTouchGesture(false)
                        snapZoomHome()
                      }
                      return
                    }
                    lastTouchAt = Date.now()
                    const px = e.changedTouches[0].clientX
                    const py = e.changedTouches[0].clientY
                    lastTouchClickPt = { x: px, y: py }
                    const dx = px - touchStartX
                    const dy = py - touchStartY
                    if (canZoom() && !touchMoved) {
                      const now = Date.now()
                      // double-tap toggles zoom at the tapped point
                      if (
                        now - lastTapAt < TAP_WINDOW_MS &&
                        Math.hypot(px - lastTapPt.x, py - lastTapPt.y) < 44
                      ) {
                        clearTimeout(tapTimer)
                        lastTapAt = 0
                        measureMediaIfStale()
                        const p = mediaEl
                          ? localPoint({ clientX: px, clientY: py }, mediaEl)
                          : { x: 0, y: 0 }
                        if (zoomScale() > 1.02) resetZoom()
                        else applyZoom(2.5, p.x, p.y, 0.3)
                        return
                      }
                      lastTapAt = now
                      lastTapPt = { x: px, y: py }
                      clearTimeout(tapTimer)
                      // single tap closes — but only at rest (while zoomed, a
                      // single tap keeps the unadorned view; double-tap resets),
                      // and only after a second tap could still land
                      if (zoomScale() <= 1.02)
                        tapTimer = setTimeout(
                          () => closeLightbox(),
                          TAP_CLOSE_MS,
                        )
                      return
                    }
                    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
                      // horizontal swipe: left = next, right = EXIT (iOS back
                      // semantics — paging backwards is what the ← button and
                      // arrow key are for). On video, ignore swipes that start
                      // on the bottom control bar so the native seek bar can
                      // be dragged instead.
                      if (item()?.type === "video" && startedOnVideoControls())
                        return
                      if (dx > 0) closeLightbox()
                      else lightboxNext()
                    } else if (
                      Math.abs(dy) > 50 &&
                      Math.abs(dy) > Math.abs(dx) &&
                      item()?.type !== "text"
                    ) {
                      // vertical swipe → exit (swipe up/down to close); text is
                      // skipped so it can scroll
                      closeLightbox()
                    }
                  }}
                  onTouchCancel={(e: TouchEvent) => {
                    // a canceled sequence (browser gesture, palm rejection) must
                    // still release the latches — and drop the frame it queued:
                    // applying it after cancellation can strand a near-1× zoom
                    if (e.touches.length === 0) {
                      multiTouch = false
                      pinchStart = null
                      pinchFingers = 0
                      touchPanBase = null
                      setTouchGesture(false)
                      clearTimeout(tapTimer)
                      cancelPanRaf()
                      snapZoomHome()
                    }
                  }}
                  onClick={(e: MouseEvent) => {
                    // tap empty area to close; a swipe sets touchMoved so it
                    // won't also close. The synthetic click trailing a touch is
                    // suppressed — but only near the touch, so a mouse click on
                    // a hybrid device still works — and taps on touch are owned
                    // by onTouchEnd (double-tap needs a delayed close).
                    const nearTouch =
                      Date.now() - lastTouchAt <= 500 &&
                      Math.hypot(
                        e.clientX - lastTouchClickPt.x,
                        e.clientY - lastTouchClickPt.y,
                      ) < 44
                    if (!touchMoved && !nearTouch) closeLightbox()
                  }}
                >
                  <Show when={outgoing()} keyed>
                    {(out) => (
                      <Box
                        class={
                          out.dir === "prev" ? "mv-out-prev" : "mv-out-next"
                        }
                        pos="absolute"
                        top="0"
                        right="0"
                        bottom="0"
                        left="0"
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        zIndex={1}
                        pb="30px"
                        css={{ pointerEvents: "none" }}
                      >
                        {renderMediaItem(out.item, true)}
                      </Box>
                    )}
                  </Show>
                  <For each={[idx()]}>
                    {() => (
                      <Box
                        class={
                          navDir() === "prev"
                            ? "mv-in-prev"
                            : navDir() === "next"
                              ? "mv-in-next"
                              : "mv-in-open"
                        }
                        pos="absolute"
                        top="0"
                        right="0"
                        bottom="0"
                        left="0"
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        pb="30px"
                        zIndex={2}
                      >
                        <Show when={item()}>{renderMediaItem(item()!)}</Show>
                      </Box>
                    )}
                  </For>
                </Box>
                {/* top overlay — slim frosted strip: one line of name+meta,
                  quiet 28px buttons that only reveal on hover */}
                <Box
                  class={`mv-chrome mv-chrome-top${chromeHidden() ? " mv-chrome-off" : ""}${motionActive() ? " mv-glass-off" : ""}`}
                  pos="absolute"
                  top="0"
                  left="0"
                  right="0"
                  zIndex={5}
                  css={{
                    pointerEvents: "none",
                    background: MV.glass,
                    backdropFilter: MV.glassBlur,
                    WebkitBackdropFilter: MV.glassBlur,
                    borderBottom: `1px solid ${MV.hairline}`,
                  }}
                >
                  <Box
                    display="flex"
                    alignItems="center"
                    gap="$1_5"
                    px="$3"
                    py="$1_5"
                  >
                    <Text
                      flex={1}
                      size="sm"
                      color={MV.label}
                      fontWeight="$medium"
                      minW="0"
                      css={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {item()?.name}
                      <Show when={item()}>
                        <Box
                          as="span"
                          color={MV.label3}
                          fontSize="12px"
                          fontWeight="$normal"
                        >
                          {`  ${formatSize(item()!.size)}${formatDate(item()!.modified) ? " · " + formatDate(item()!.modified) : ""}`}
                        </Box>
                      </Show>
                    </Text>
                    <Tooltip label="Feed mode (vertical)" placement="bottom">
                      <IconButton
                        aria-label="Feed mode"
                        icon={<FiFilm />}
                        variant="ghost"
                        size="sm"
                        flexShrink={0}
                        w="28px"
                        h="28px"
                        rounded="$full"
                        color={MV.label2}
                        css={{
                          background: "transparent",
                          "&:hover": { background: "rgba(0,0,0,0.08)" },
                        }}
                        onClick={enterFeed}
                      />
                    </Tooltip>
                    <Show when={item()}>
                      <Box
                        as="a"
                        href={getItemLink(item()!)}
                        download=""
                        target="_blank"
                        rel="noopener"
                        aria-label="Download"
                        flexShrink={0}
                        w="28px"
                        h="28px"
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        rounded="$full"
                        color={MV.label2}
                        css={{
                          pointerEvents: "auto",
                          background: "transparent",
                          "&:hover": { background: "rgba(0,0,0,0.08)" },
                        }}
                        onClick={(e: MouseEvent) => e.stopPropagation()}
                      >
                        <Box as={BsDownload} boxSize="14px" />
                      </Box>
                    </Show>
                    <IconButton
                      aria-label="Close"
                      icon={<BsX />}
                      variant="ghost"
                      size="sm"
                      flexShrink={0}
                      w="28px"
                      h="28px"
                      rounded="$full"
                      color={MV.label2}
                      onClick={closeLightbox}
                      css={{
                        pointerEvents: "auto",
                        background: "transparent",
                        "&:hover": { background: "rgba(0,0,0,0.08)" },
                      }}
                    />
                  </Box>
                </Box>
                {/* bottom overlay — frosted bar with filmstrip, counter + hints
                  (click-through; strip and pill opt back in) */}
                <Box
                  class={`mv-chrome mv-chrome-bottom${chromeHidden() ? " mv-chrome-off" : ""}${motionActive() ? " mv-glass-off" : ""}`}
                  pos="absolute"
                  bottom="0"
                  left="0"
                  right="0"
                  zIndex={5}
                  css={{
                    pointerEvents: "none",
                    background: MV.glass,
                    backdropFilter: MV.glassBlur,
                    WebkitBackdropFilter: MV.glassBlur,
                    borderTop: `1px solid ${MV.hairline}`,
                  }}
                >
                  {/* filmstrip — windowed thumbnails around the current item;
                    click to jump, the active one carries an accent ring */}
                  <Show
                    when={
                      FINE_POINTER &&
                      containerWidth() >= PHONE_W &&
                      flatItems().length > 1
                    }
                  >
                    <Box
                      ref={(el: HTMLDivElement) => {
                        stripRef = el
                      }}
                      display="flex"
                      gap="$1"
                      overflowX="auto"
                      px="$3"
                      pt="$1_5"
                      css={{
                        pointerEvents: "auto",
                        scrollbarWidth: "none",
                        "&::-webkit-scrollbar": { display: "none" },
                        overscrollBehaviorX: "contain",
                      }}
                    >
                      <For each={filmstripWindow()}>
                        {(i) => {
                          const it = flatItems()[i]
                          // video without a server thumbnail shows its first
                          // frame via a metadata-only <video> element
                          const needsVideoFrame =
                            it.type === "video" && !it.thumb
                          const src =
                            it.type === "text" || needsVideoFrame
                              ? ""
                              : it.thumb || getItemLink(it)
                          // class-driven active state: the attribute expression
                          // below re-runs when idx() changes, and Solid's For
                          // REUSES DOM nodes for unchanged items — a css object
                          // baked once per node would freeze the ring in place
                          const cellClass = () =>
                            `mv-fs-cell${i === idx() ? " mv-fs-active" : ""}`
                          // static sizing only (identical for both cell kinds)
                          const cellCss = {
                            height: "36px",
                            width: "48px",
                            objectFit: "cover" as const,
                            borderRadius: "8px",
                            cursor: "pointer",
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: src ? "none" : "rgba(0,0,0,0.05)",
                          }
                          const jump = (e: MouseEvent) => {
                            e.stopPropagation()
                            gotoLightbox(i)
                          }
                          const jumpKeys = (e: KeyboardEvent) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault()
                              gotoLightbox(i)
                            }
                          }
                          return (
                            <Show
                              when={src}
                              fallback={
                                <Show
                                  when={needsVideoFrame}
                                  fallback={
                                    <Box
                                      as="button"
                                      type="button"
                                      class={cellClass()}
                                      data-fs-index={i}
                                      aria-label={it.name}
                                      onClick={jump}
                                      onKeyDown={jumpKeys}
                                      css={cellCss}
                                    >
                                      <Box
                                        as={FiType}
                                        boxSize="14px"
                                        color={MV.dot.text}
                                      />
                                    </Box>
                                  }
                                >
                                  <Box
                                    as="video"
                                    src={getItemLink(it) + "#t=0.1"}
                                    preload="metadata"
                                    muted
                                    playsinline
                                    tabIndex={0}
                                    role="button"
                                    data-fs-index={i}
                                    aria-label={it.name}
                                    onClick={jump}
                                    onKeyDown={jumpKeys}
                                    class={cellClass()}
                                    css={cellCss}
                                  />
                                </Show>
                              }
                            >
                              <Box
                                as="img"
                                src={src}
                                alt=""
                                draggable={false}
                                loading="lazy"
                                decoding="async"
                                tabIndex={0}
                                role="button"
                                class={cellClass()}
                                data-fs-index={i}
                                aria-label={it.name}
                                onClick={jump}
                                onKeyDown={jumpKeys}
                                css={cellCss}
                              />
                            </Show>
                          )
                        }}
                      </For>
                    </Box>
                  </Show>
                  <Box
                    display="flex"
                    alignItems="center"
                    gap="$3"
                    px="$3"
                    py="$1_5"
                  >
                    <Text
                      size="xs"
                      css={{
                        color: MV.label2,
                        whiteSpace: "nowrap",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {idx() + 1} / {len()}
                      <Show when={item()}>
                        {" · "}
                        {formatSize(item()!.size)}
                        <Show when={formatDate(item()!.modified)}>
                          {" · "}
                          {formatDate(item()!.modified)}
                        </Show>
                      </Show>
                    </Text>
                    <Show when={zoomScale() > 1.02}>
                      <Box
                        as="button"
                        onClick={(e: MouseEvent) => {
                          e.stopPropagation()
                          resetZoom()
                        }}
                        css={{
                          pointerEvents: "auto",
                          background: "rgba(0,0,0,0.05)",
                          border: `1px solid ${MV.hairline}`,
                          borderRadius: "999px",
                          padding: "3px 10px",
                          fontSize: "11px",
                          fontWeight: 600,
                          lineHeight: 1.4,
                          color: MV.label2,
                          cursor: "pointer",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {zoomScale().toFixed(1)}×
                      </Box>
                    </Show>
                    <Show when={FINE_POINTER && containerWidth() >= PHONE_W}>
                      <Box
                        flex={1}
                        display="flex"
                        justifyContent="flex-end"
                        gap="$3"
                      >
                        <Text size="xs" css={{ color: MV.label3 }}>
                          <Kbd
                            css={{
                              background: "rgba(0,0,0,0.05)",
                              borderColor: MV.hairline,
                              color: MV.label2,
                            }}
                          >
                            ← →
                          </Kbd>{" "}
                          prev/next
                        </Text>
                        <Text size="xs" css={{ color: MV.label3 }}>
                          <Kbd
                            css={{
                              background: "rgba(0,0,0,0.05)",
                              borderColor: MV.hairline,
                              color: MV.label2,
                            }}
                          >
                            ↑↓ / Esc
                          </Kbd>{" "}
                          close
                        </Text>
                        <Show when={canZoom()}>
                          <Text size="xs" css={{ color: MV.label3 }}>
                            <Kbd
                              css={{
                                background: "rgba(0,0,0,0.05)",
                                borderColor: MV.hairline,
                                color: MV.label2,
                              }}
                            >
                              dbl-click
                            </Kbd>{" "}
                            zoom
                          </Text>
                        </Show>
                      </Box>
                    </Show>
                  </Box>
                </Box>
                {/* wide screens (incl. tablets — tap works there too): left/right
                  arrows to browse; narrow phones swipe instead */}
                <Show when={containerWidth() >= PHONE_W}>
                  <Show when={idx() > 0}>
                    <IconButton
                      aria-label="Previous"
                      class={`mv-chrome${chromeHidden() ? " mv-chrome-off" : ""}${motionActive() ? " mv-glass-off" : ""}`}
                      icon={<BsChevronLeft />}
                      variant="ghost"
                      color={MV.label}
                      size="lg"
                      pos="absolute"
                      left="$3"
                      top="50%"
                      transform="translateY(-50%)"
                      zIndex={6}
                      onClick={(e: MouseEvent) => {
                        e.stopPropagation()
                        lightboxPrev()
                      }}
                      css={{
                        background: "rgba(255,255,255,0.72)",
                        backdropFilter: MV.glassBlur,
                        WebkitBackdropFilter: MV.glassBlur,
                        border: `1px solid ${MV.hairline}`,
                        "&:hover": { background: "rgba(255,255,255,0.95)" },
                      }}
                      rounded="$full"
                    />
                  </Show>
                  <Show when={idx() < len() - 1}>
                    <IconButton
                      aria-label="Next"
                      class={`mv-chrome${chromeHidden() ? " mv-chrome-off" : ""}${motionActive() ? " mv-glass-off" : ""}`}
                      icon={<BsChevronRight />}
                      variant="ghost"
                      color={MV.label}
                      size="lg"
                      pos="absolute"
                      right="$3"
                      top="50%"
                      transform="translateY(-50%)"
                      zIndex={6}
                      onClick={(e: MouseEvent) => {
                        e.stopPropagation()
                        lightboxNext()
                      }}
                      css={{
                        background: "rgba(255,255,255,0.72)",
                        backdropFilter: MV.glassBlur,
                        WebkitBackdropFilter: MV.glassBlur,
                        border: `1px solid ${MV.hairline}`,
                        "&:hover": { background: "rgba(255,255,255,0.95)" },
                      }}
                      rounded="$full"
                    />
                  </Show>
                </Show>
              </Show>
            </Box>
          )
        })()}
      </Show>

      {/* ═══════ Jump Dialog ═══════ */}
      <Show when={showJump()}>
        <Box
          pos="fixed"
          top="0"
          right="0"
          bottom="0"
          left="0"
          zIndex={1200}
          display="flex"
          alignItems="flex-start"
          justifyContent="center"
          pt="20vh"
        >
          <Box
            pos="absolute"
            top="0"
            right="0"
            bottom="0"
            left="0"
            css={{ background: "rgba(0,0,0,0.24)" }}
            onClick={() => {
              setShowJump(false)
              setJumpInput("")
            }}
          />
          <Box
            pos="relative"
            rounded="$xl"
            p="$4"
            w="min(380px, calc(100vw - 32px))"
            css={{
              background: "rgba(255,255,255,0.86)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: `1px solid ${MV.hairline}`,
              boxShadow: MV.shadowPop,
              color: MV.label,
            }}
          >
            <Text size="sm" fontWeight="$bold" color={MV.label} mb="$2">
              Jump to item
            </Text>
            <Input
              ref={jumpInputRef}
              placeholder="Enter number or file name…"
              value={jumpInput()}
              onInput={(e) => setJumpInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  executeJump()
                }
                if (e.key === "Escape") {
                  setShowJump(false)
                  setJumpInput("")
                }
              }}
              size="sm"
              autofocus
              css={{
                background: MV.surface,
                borderColor: MV.hairline,
                color: MV.label,
                "&::placeholder": { color: MV.label3 },
              }}
            />
            <Text size="xs" color={MV.label3} mt="$1">
              Enter to jump, Escape to cancel
            </Text>
          </Box>
        </Box>
      </Show>

      {/* ═══════ Help Dialog ═══════ */}
      <Show when={showHelp()}>
        <Box
          pos="fixed"
          top="0"
          right="0"
          bottom="0"
          left="0"
          zIndex={1200}
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <Box
            pos="absolute"
            top="0"
            right="0"
            bottom="0"
            left="0"
            css={{ background: "rgba(0,0,0,0.24)" }}
            onClick={() => setShowHelp(false)}
          />
          <Box
            pos="relative"
            rounded="$xl"
            p="$5"
            w="min(440px, calc(100vw - 32px))"
            maxH="80vh"
            overflowY="auto"
            css={{
              background: "rgba(255,255,255,0.86)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: `1px solid ${MV.hairline}`,
              boxShadow: MV.shadowPop,
              color: MV.label,
            }}
          >
            <Text size="lg" fontWeight="$bold" color={MV.label} mb="$4">
              Keyboard Shortcuts
            </Text>
            <For
              each={[
                {
                  title: "Navigation",
                  items: [
                    ["← → / h l", "Move left / right"],
                    ["↑ ↓ / k j", "Move up / down"],
                    ["PageUp / PageDown", "Jump by 3 rows"],
                    ["g / Home", "First item"],
                    ["G / End", "Last item"],
                    ["1-9", "Jump to Nth item"],
                  ],
                },
                {
                  title: "Actions",
                  items: [
                    ["Enter", "Open preview"],
                    ["Escape", "Close / clear focus"],
                    ["/", "Jump to item"],
                    ["?", "Toggle help"],
                    ["r", "Refresh"],
                  ],
                },
                {
                  title: "Preview",
                  items: [
                    ["← → / h l", "Previous / next"],
                    ["↑↓ / Esc", "Close preview"],
                    ["+ / − / 0", "Zoom in / out / reset"],
                    ["dbl-click · wheel", "Zoom at point"],
                  ],
                },
              ]}
            >
              {(section) => (
                <Box mb="$4">
                  <Text size="sm" fontWeight="$bold" color={MV.accent} mb="$2">
                    {section.title}
                  </Text>
                  <For each={section.items}>
                    {([keys, desc]) => (
                      <Box
                        display="flex"
                        alignItems="center"
                        mb="$1_5"
                        gap="$3"
                      >
                        <Kbd
                          minW="100px"
                          textAlign="center"
                          fontSize="xs"
                          css={{
                            background: "rgba(0,0,0,0.04)",
                            borderColor: MV.hairline,
                            color: MV.label2,
                          }}
                        >
                          {keys}
                        </Kbd>
                        <Text size="xs" color={MV.label2}>
                          {desc}
                        </Text>
                      </Box>
                    )}
                  </For>
                </Box>
              )}
            </For>
          </Box>
        </Box>
      </Show>
    </Box>
  )
}

export default MediaView
