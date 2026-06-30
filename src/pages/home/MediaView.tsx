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
  IconButton,
  Badge,
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
  useColorModeValue,
} from "@hope-ui/solid"
import {
  BsArrowLeft,
  BsX,
  BsChevronLeft,
  BsChevronRight,
  BsQuestionCircle,
} from "solid-icons/bs"
import {
  AiOutlineSearch,
  AiOutlineFolder,
  AiOutlineReload,
} from "solid-icons/ai"
import { FiImage, FiFilm, FiType } from "solid-icons/fi"
import { FullLoading } from "~/components"
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
import { isMobile } from "~/utils/compatibility"
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
const CARD_GAP = 10

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

/* ──────────────────── Component ──────────────────── */

const MediaView = () => {
  const { pathname, isShare, to } = useRouter()

  const glassBg = useColorModeValue(
    "rgba(255,255,255,0.72)",
    "rgba(20,22,26,0.72)",
  )
  const glassBorder = useColorModeValue(
    "rgba(0,0,0,0.06)",
    "rgba(255,255,255,0.08)",
  )

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
  // the item currently sliding out during a prev/next transition (TikTok-style)
  const [outgoing, setOutgoing] = createSignal<{
    item: MediaItem
    dir: "prev" | "next"
  } | null>(null)
  const [showHelp, setShowHelp] = createSignal(false)
  const [showJump, setShowJump] = createSignal(false)
  const [jumpInput, setJumpInput] = createSignal("")
  const [textCache, setTextCache] = createSignal<Record<string, string>>({})
  const [cols, setCols] = createSignal(isMobile ? 2 : 4)
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
  let resizeObserver: ResizeObserver | undefined
  let touchStartX = 0
  let touchStartY = 0
  let touchMoved = false
  let touchStartTarget: HTMLElement | null = null
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
      out.push({ key: `h:${g.path}`, kind: "header", group: g, est: 48 })
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
     while scrolling get measured too (no overlap). */
  const rowResizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver((entries) => {
          const updates: Record<number, number> = {}
          let changed = false
          const prev = measuredHeights()
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
            if (h > 0 && prev[idx] !== h) {
              updates[idx] = h
              changed = true
            }
          }
          if (changed) {
            setMeasuredHeights((p) => ({ ...p, ...updates }))
            virtualizer.measure()
          }
        })
      : undefined

  const recomputeCols = () => {
    const w = scrollRef?.clientWidth ?? 0
    if (w > 0) {
      setContainerWidth(w)
      const gridW = Math.max(0, w - 24) // px=$3 padding
      const minW = isMobile ? 150 : MIN_CARD_W
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

  const fetchFolder = async (path: string, signal: AbortSignal) => {
    if (signal.aborted) return
    const isRoot = path === folderPath()
    setScanMsg(`Scanning: ${path}`)

    const resp = await fsList(path, password(), 1, 0, false)
    if (signal.aborted) return

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
      return
    }
    const content = data.content as any[]

    const newItems: MediaItem[] = []
    const dirs: string[] = []

    for (const obj of content) {
      if (signal.aborted) return
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

    // recursive descent — scan all subfolders so every media file under the
    // path is shown (no depth limit)
    for (const sub of dirs) {
      if (signal.aborted) return
      await fetchFolder(sub, signal)
    }
  }

  const startScan = async () => {
    abortCtrl?.abort()
    abortCtrl = new AbortController()
    scanItems = []
    scanFlushPending = false
    clearTimeout(scanFlushTimer)
    setSubDirs([])
    setItems([])
    setTextCache({})
    setLoading(true)
    setScanning(true)
    setFocusIndex(-1)

    try {
      await fetchFolder(folderPath(), abortCtrl.signal)
    } catch (e) {
      if (!abortCtrl.signal.aborted) console.error("Media scan error:", e)
    } finally {
      // final flush so the last batch isn't held back by the throttle
      clearTimeout(scanFlushTimer)
      scanFlushPending = false
      setItems(scanItems.slice())
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

  const openLightbox = (index: number) => {
    clearTimeout(outTimer)
    setOutgoing(null)
    setNavDir("open")
    setLightboxIndex(index)
    setFocusIndex(index)
    const item = flatItems()[index]
    if (item?.type === "text") fetchTextContent(item)
  }

  const closeLightbox = () => {
    clearTimeout(outTimer)
    setOutgoing(null)
    setLightboxIndex(null)
  }

  const lightboxPrev = () => {
    const idx = lightboxIndex()
    if (idx !== null && idx > 0) {
      const cur = flatItems()[idx]
      const ni = idx - 1
      // snapshot the item being left so it can slide out while the new one
      // slides in (dual-layer vertical page-turn, TikTok-style).
      setOutgoing(cur ? { item: cur, dir: "prev" } : null)
      setNavDir("prev")
      setLightboxIndex(ni)
      clearTimeout(outTimer)
      outTimer = setTimeout(() => setOutgoing(null), 360)
      const item = flatItems()[ni]
      if (item?.type === "text") fetchTextContent(item)
      syncGridTo(ni)
    }
  }

  const lightboxNext = () => {
    const idx = lightboxIndex()
    const len = flatItems().length
    if (idx !== null && idx < len - 1) {
      const cur = flatItems()[idx]
      const ni = idx + 1
      setOutgoing(cur ? { item: cur, dir: "next" } : null)
      setNavDir("next")
      setLightboxIndex(ni)
      clearTimeout(outTimer)
      outTimer = setTimeout(() => setOutgoing(null), 360)
      const item = flatItems()[ni]
      if (item?.type === "text") fetchTextContent(item)
      syncGridTo(ni)
    }
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
  onMount(() => {
    window.addEventListener("keydown", onKeyDown)
    recomputeCols()
    if (scrollRef) {
      resizeObserver = new ResizeObserver(() => recomputeCols())
      resizeObserver.observe(scrollRef)
    }
  })
  onCleanup(() => {
    window.removeEventListener("keydown", onKeyDown)
    abortCtrl?.abort()
    textObserver?.disconnect()
    resizeObserver?.disconnect()
    rowResizeObserver?.disconnect()
    clearTimeout(outTimer)
    clearTimeout(scanFlushTimer)
  })

  /* ─── Helpers ─── */
  const TypeIcon = (props: { type: MediaItem["type"]; size?: string }) => {
    const m = { image: FiImage, video: FiFilm, gif: FiImage, text: FiType }
    const c = {
      image: "$success9",
      video: "$danger9",
      gif: "$warning9",
      text: "$info9",
    }
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
        <Box
          display="flex"
          alignItems="center"
          gap="$2"
          pb="$3"
          borderBottom="1px solid $neutral5"
        >
          <Box
            as={AiOutlineFolder}
            boxSize="$5"
            color="$primary9"
            flexShrink={0}
          />
          <Text
            size="base"
            fontWeight="$semibold"
            color="$neutral12"
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
          <Badge
            colorScheme="neutral"
            variant="subtle"
            rounded="$full"
            fontSize="xs"
          >
            {row.group.items.length}
          </Badge>
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
        <Box
          ref={cardEl}
          data-media-card={idx().toString()}
          rounded="$xl"
          overflow="hidden"
          cursor="pointer"
          border="1px solid"
          borderColor={focused() ? "$primary7" : "$neutral6"}
          bg="$neutral1"
          pb="$3"
          transition="transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease"
          boxShadow={
            focused()
              ? "0 0 0 3px $colors$primary4, 0 8px 22px $colors$neutral6"
              : "none"
          }
          _hover={{
            transform: "translateY(-2px)",
            boxShadow: "0 10px 24px $colors$neutral6",
            borderColor: "$primary6",
          }}
          onClick={() => openLightbox(idx())}
        >
          <Box
            display="flex"
            alignItems="center"
            gap="$2"
            px="$4"
            py="$2_5"
            borderBottom="1px solid $neutral5"
            bg="$neutral3"
          >
            <Box as={FiType} boxSize="16px" color="$info9" flexShrink={0} />
            <Text
              size="sm"
              fontWeight="$bold"
              color="$neutral12"
              flex={1}
              css={{ wordBreak: "break-all", lineHeight: "1.35" }}
            >
              {item.name}
            </Text>
            <Text size="xs" color="$neutral10">
              {formatSize(item.size)}
            </Text>
          </Box>
          <Box px="$4" pt="$3" css={{ userSelect: "text" }}>
            <Show
              when={content() !== undefined}
              fallback={
                <Box display="flex" alignItems="center" gap="$2" py="$2">
                  <Spinner size="sm" />
                  <Text size="xs" color="$neutral10">
                    Loading…
                  </Text>
                </Box>
              }
            >
              <Show
                when={content()}
                fallback={
                  <Text size="sm" color="$neutral9" fontStyle="italic">
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
      )
    }
    // cards row
    return (
      <Box
        css={{
          display: "grid",
          "grid-template-columns": `repeat(${cols()}, 1fr)`,
          gap: "10px",
          paddingBottom: "$3",
        }}
      >
        <For each={row.items}>
          {(item) => {
            const idx = () => getIndex(item)
            const focused = () => focusIndex() === idx()
            const link = () => getItemLink(item)
            const thumbUrl = () => {
              if (item.type === "gif") return link()
              if (item.type === "image") return item.thumb || link()
              if (item.type === "video") return item.thumb
              return ""
            }
            return (
              <Box
                data-media-card={idx().toString()}
                rounded="$xl"
                overflow="hidden"
                cursor="pointer"
                border="1px solid"
                borderColor={focused() ? "$primary7" : "$neutral6"}
                bg="$neutral1"
                transition="transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease"
                boxShadow={
                  focused()
                    ? "0 0 0 3px $colors$primary4, 0 8px 22px $colors$neutral6"
                    : "none"
                }
                _hover={{
                  transform: "translateY(-3px)",
                  boxShadow: "0 12px 26px $colors$neutral6",
                  borderColor: "$primary6",
                }}
                onClick={() => openLightbox(idx())}
              >
                <Box
                  bg="$neutral4"
                  pos="relative"
                  overflow="hidden"
                  css={{ aspectRatio: "4 / 3" }}
                >
                  <Show
                    when={thumbUrl()}
                    fallback={
                      <Center h="$full">
                        <TypeIcon type={item.type} />
                      </Center>
                    }
                  >
                    <Image
                      src={thumbUrl()}
                      alt={item.name}
                      w="$full"
                      h="$full"
                      objectFit="cover"
                      loading="lazy"
                      fallback={
                        <Center h="$full">
                          <Spinner size="sm" />
                        </Center>
                      }
                    />
                    <Show when={item.type === "video"}>
                      <Box
                        pos="absolute"
                        top="0"
                        right="0"
                        bottom="0"
                        left="0"
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        pointerEvents="none"
                      >
                        <Box
                          css={{
                            width: 0,
                            height: 0,
                            borderTop: "13px solid transparent",
                            borderBottom: "13px solid transparent",
                            borderLeft: "20px solid rgba(255,255,255,0.9)",
                            filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.5))",
                          }}
                        />
                      </Box>
                    </Show>
                  </Show>
                  <Box pos="absolute" top="$1" right="$1">
                    <Badge
                      colorScheme={
                        item.type === "image"
                          ? "success"
                          : item.type === "video"
                            ? "danger"
                            : "warning"
                      }
                      variant="solid"
                      rounded="$md"
                      fontSize="xs"
                      textTransform="uppercase"
                    >
                      {item.type}
                    </Badge>
                  </Box>
                </Box>
                <Box p="$2">
                  <Text
                    size="xs"
                    fontWeight="$semibold"
                    color="$neutral12"
                    css={{
                      display: "-webkit-box",
                      "-webkit-line-clamp": "2",
                      "-webkit-box-orient": "vertical",
                      overflow: "hidden",
                      wordBreak: "break-all",
                      lineHeight: "1.35",
                    }}
                  >
                    {item.name}
                  </Text>
                  <Text size="xs" color="$neutral11" mt="2px">
                    {formatSize(item.size)}
                  </Text>
                </Box>
              </Box>
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
      bg="$loContrast"
      zIndex={1000}
      display="flex"
      flexDirection="column"
      overflow="hidden"
    >
      {/* ═══════ Top Bar ═══════ */}
      <Box
        flexShrink={0}
        zIndex={10}
        bg={glassBg()}
        borderBottom={`1px solid ${glassBorder()}`}
        css={{
          backdropFilter: "blur(14px) saturate(160%)",
          WebkitBackdropFilter: "blur(14px) saturate(160%)",
          boxShadow: "0 1px 0 rgba(0,0,0,0.02), 0 6px 20px rgba(0,0,0,0.05)",
        }}
      >
        <Box display="flex" alignItems="center" gap="$2" px="$3" py="$2">
          <IconButton
            aria-label="Back"
            icon={<BsArrowLeft />}
            variant="ghost"
            size="sm"
            onClick={() => to(encodePath(folderPath(), true))}
          />
          <Box flex={1} overflow="hidden">
            <Text
              size="sm"
              fontWeight="$bold"
              css={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              📂 Media View
            </Text>
            <Text
              size="xs"
              color="$neutral11"
              css={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {folderPath()}
            </Text>
          </Box>
          <Show when={scanning()}>
            <Spinner size="sm" color="$primary9" />
          </Show>
          <Tooltip label="Refresh (r)" placement="bottom">
            <IconButton
              aria-label="Refresh"
              icon={<AiOutlineReload />}
              variant="ghost"
              size="sm"
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
              onClick={() => setShowHelp(true)}
            />
          </Tooltip>
        </Box>

        <Box
          display="flex"
          alignItems="center"
          gap="$2"
          px="$3"
          pb="$2"
          flexWrap="wrap"
        >
          <InputGroup size="sm" w={isMobile ? "100%" : "220px"} flexShrink={0}>
            <InputLeftElement pointerEvents="none">
              <Box as={AiOutlineSearch} color="$neutral11" />
            </InputLeftElement>
            <Input
              placeholder="Filter files…"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
            />
          </InputGroup>
          {!isMobile && <Box flex={1} />}
          <Text size="xs" color="$neutral11" flexShrink={0}>
            {flatItems().length} items
            <Show when={subDirs().length > 0}>
              {" · "}
              {subDirs().length} folders
            </Show>
          </Text>
        </Box>
        <Show when={subDirs().length > 0}>
          <Box px="$3" pb="$2" flexShrink={0}>
            <Popover placement="bottom-start">
              {({ onClose }) => (
                <>
                  <PopoverTrigger as={Button} variant="outline" size="sm">
                    <Box as={AiOutlineFolder} boxSize="14px" flexShrink={0} />
                    Folders
                    <Badge colorScheme="neutral" variant="subtle" ml="$1">
                      {subDirs().length}
                    </Badge>
                  </PopoverTrigger>
                  <PopoverContent w="280px">
                    <PopoverBody p="$1" display="flex" flexDirection="column">
                      <Input
                        placeholder="Filter folders…"
                        value={dirFilter()}
                        onInput={(e) => setDirFilter(e.currentTarget.value)}
                        size="sm"
                        mb="$1"
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
                                _hover={{ bg: "$neutral3" }}
                                onClick={() => {
                                  onClose()
                                  setDirFilter("")
                                  scrollToFolder(sub)
                                }}
                              >
                                <Box
                                  as={AiOutlineFolder}
                                  boxSize="14px"
                                  color="$primary9"
                                  flexShrink={0}
                                />
                                <Text
                                  size="sm"
                                  css={{ wordBreak: "break-all" }}
                                >
                                  {name}
                                </Text>
                              </Box>
                            )
                          }}
                        </For>
                        <Show when={filteredSubDirs().length === 0}>
                          <Text size="xs" color="$neutral10" px="$2" py="$2">
                            No folders match
                          </Text>
                        </Show>
                      </Box>
                    </PopoverBody>
                  </PopoverContent>
                </>
              )}
            </Popover>
          </Box>
        </Show>
      </Box>

      {/* ═══════ Scanning Progress ═══════ */}
      <Show when={scanMsg()}>
        <Box px="$3" py="$1" bg="$primary2" flexShrink={0}>
          <Text size="xs" color="$primary11">
            {scanMsg()}… ({items().length} items found)
          </Text>
        </Box>
      </Show>

      {/* ═══════ Main Content ═══════ */}
      <style>{`.mv-grid, .mv-grid * { box-sizing: border-box; }`}</style>
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
                  <Text size="sm" color="$neutral11" mt="$2">
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
                    color="$neutral8"
                    mx="auto"
                    mb="$3"
                  />
                  <Text size="lg" color="$neutral11">
                    {items().length === 0
                      ? "No media files found"
                      : "No files match filter"}
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
                    {renderRow(rows()[vi.index])}
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
          // Render a single media item (image / video / text). `exiting`
          // mutes + pauses video so the outgoing copy doesn't double the audio.
          const renderMediaItem = (it: MediaItem, exiting = false) => {
            const link = getItemLink(it)
            if (it.type === "image" || it.type === "gif") {
              return (
                <Image
                  src={link}
                  alt={it.name}
                  maxW="92%"
                  maxH="90vh"
                  objectFit="contain"
                  rounded="$lg"
                  onClick={(e: MouseEvent) => e.stopPropagation()}
                />
              )
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
                  maxH="90vh"
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
                  maxH="85vh"
                  overflowY="auto"
                  bg="$neutral2"
                  rounded="$lg"
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
                      color="$neutral12"
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
              `}</style>
              {/* backdrop */}
              <Box
                pos="absolute"
                top="0"
                right="0"
                bottom="0"
                left="0"
                css={{ background: "#000" }}
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
                  touchStartX = e.touches[0].clientX
                  touchStartY = e.touches[0].clientY
                  touchMoved = false
                  touchStartTarget = e.target as HTMLElement | null
                }}
                onTouchMove={(e: TouchEvent) => {
                  const dx = e.touches[0].clientX - touchStartX
                  const dy = e.touches[0].clientY - touchStartY
                  if (Math.abs(dx) > 10 || Math.abs(dy) > 10) touchMoved = true
                }}
                onTouchEnd={(e: TouchEvent) => {
                  const dx = e.changedTouches[0].clientX - touchStartX
                  const dy = e.changedTouches[0].clientY - touchStartY
                  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
                    // horizontal swipe → browse (left=prev, right=next). On video,
                    // ignore swipes that start on the bottom control bar so the
                    // native seek bar can be dragged instead.
                    if (item()?.type === "video" && startedOnVideoControls())
                      return
                    if (dx > 0) lightboxPrev()
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
                onClick={() => {
                  // tap empty area to close; a swipe sets touchMoved so it
                  // won't also close
                  if (!touchMoved) closeLightbox()
                }}
              >
                <Show when={outgoing()} keyed>
                  {(out) => (
                    <Box
                      class={out.dir === "prev" ? "mv-out-prev" : "mv-out-next"}
                      pos="absolute"
                      top="0"
                      right="0"
                      bottom="0"
                      left="0"
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      zIndex={1}
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
                      zIndex={2}
                    >
                      <Show when={item()}>{renderMediaItem(item()!)}</Show>
                    </Box>
                  )}
                </For>
              </Box>
              {/* top overlay — filename + close (gradient, click-through) */}
              <Box
                pos="absolute"
                top="0"
                left="0"
                right="0"
                zIndex={5}
                css={{
                  pointerEvents: "none",
                  background:
                    "linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)",
                }}
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
                    color="white"
                    fontWeight="$semibold"
                    css={{
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      textShadow: "0 1px 4px rgba(0,0,0,0.6)",
                    }}
                  >
                    {item()?.name}
                  </Text>
                  <IconButton
                    aria-label="Close"
                    icon={<BsX />}
                    variant="ghost"
                    color="white"
                    size="lg"
                    rounded="$full"
                    onClick={closeLightbox}
                    css={{
                      pointerEvents: "auto",
                      background: "rgba(255,255,255,0.14)",
                      "&:hover": { background: "rgba(255,255,255,0.26)" },
                    }}
                  />
                </Box>
              </Box>
              {/* bottom overlay — counter + hints (gradient, click-through) */}
              <Box
                pos="absolute"
                bottom="0"
                left="0"
                right="0"
                zIndex={5}
                css={{
                  pointerEvents: "none",
                  background:
                    "linear-gradient(to top, rgba(0,0,0,0.6), transparent)",
                }}
              >
                <Box
                  display="flex"
                  alignItems="center"
                  gap="$3"
                  px="$3"
                  py="$2_5"
                >
                  <Text
                    size="xs"
                    css={{
                      color: "rgba(255,255,255,0.75)",
                      textShadow: "0 1px 4px rgba(0,0,0,0.6)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {idx() + 1} / {len()}
                    <Show when={item()}>
                      {" · "}
                      {formatSize(item()!.size)}
                    </Show>
                  </Text>
                  <Show when={!isMobile}>
                    <Box
                      flex={1}
                      display="flex"
                      justifyContent="flex-end"
                      gap="$3"
                    >
                      <Text size="xs" css={{ color: "rgba(255,255,255,0.5)" }}>
                        <Kbd
                          css={{
                            background: "rgba(255,255,255,0.1)",
                            borderColor: "rgba(255,255,255,0.2)",
                            color: "rgba(255,255,255,0.7)",
                          }}
                        >
                          ← →
                        </Kbd>{" "}
                        prev/next
                      </Text>
                      <Text size="xs" css={{ color: "rgba(255,255,255,0.5)" }}>
                        <Kbd
                          css={{
                            background: "rgba(255,255,255,0.1)",
                            borderColor: "rgba(255,255,255,0.2)",
                            color: "rgba(255,255,255,0.7)",
                          }}
                        >
                          ↑↓ / Esc
                        </Kbd>{" "}
                        close
                      </Text>
                    </Box>
                  </Show>
                </Box>
              </Box>
              {/* desktop nav arrows — left/right to browse (no touch on desktop) */}
              <Show when={!isMobile}>
                <Show when={idx() > 0}>
                  <IconButton
                    aria-label="Previous"
                    icon={<BsChevronLeft />}
                    variant="ghost"
                    color="white"
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
                      background: "rgba(255,255,255,0.14)",
                      "&:hover": { background: "rgba(255,255,255,0.26)" },
                    }}
                    rounded="$full"
                  />
                </Show>
                <Show when={idx() < len() - 1}>
                  <IconButton
                    aria-label="Next"
                    icon={<BsChevronRight />}
                    variant="ghost"
                    color="white"
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
                      background: "rgba(255,255,255,0.14)",
                      "&:hover": { background: "rgba(255,255,255,0.26)" },
                    }}
                    rounded="$full"
                  />
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
            css={{ background: "rgba(0,0,0,0.5)" }}
            onClick={() => {
              setShowJump(false)
              setJumpInput("")
            }}
          />
          <Box
            pos="relative"
            bg="$loContrast"
            rounded="$xl"
            p="$4"
            w="380px"
            shadow="$xl"
            border="1px solid $neutral6"
          >
            <Text size="sm" fontWeight="$bold" mb="$2">
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
            />
            <Text size="xs" color="$neutral11" mt="$1">
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
            css={{ background: "rgba(0,0,0,0.5)" }}
            onClick={() => setShowHelp(false)}
          />
          <Box
            pos="relative"
            bg="$loContrast"
            rounded="$xl"
            p="$5"
            w="440px"
            shadow="$xl"
            border="1px solid $neutral6"
            maxH="80vh"
            overflowY="auto"
          >
            <Text size="lg" fontWeight="$bold" mb="$4">
              ⌨️ Keyboard Shortcuts
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
                  ],
                },
              ]}
            >
              {(section) => (
                <Box mb="$4">
                  <Text size="sm" fontWeight="$bold" color="$primary11" mb="$2">
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
                        <Kbd minW="100px" textAlign="center" fontSize="xs">
                          {keys}
                        </Kbd>
                        <Text size="xs" color="$neutral11">
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
