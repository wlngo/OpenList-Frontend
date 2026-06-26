import {
  createSignal,
  createMemo,
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
  Center,
  Image,
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
} from "solid-icons/bs"
import {
  AiOutlineSearch,
  AiOutlineFolder,
  AiOutlineReload,
} from "solid-icons/ai"
import {
  FiImage,
  FiFilm,
  FiType,
  FiChevronDown,
  FiChevronRight,
} from "solid-icons/fi"
import { FullLoading } from "~/components"
import { useRouter } from "~/hooks"
import { password } from "~/store"
import { ObjType } from "~/types"
import { fsList, handleRespWithoutNotify, ext, pathJoin, notify } from "~/utils"
import { getLinkByDirAndObj } from "~/hooks/useLink"
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

const GROUPS_PER_BATCH = 10

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

  const rawPath = pathname()
  const prefix = rawPath.startsWith("/@s")
    ? rawPath.match(/^\/@s\/@media/)?.[0] || "/@media"
    : "/@media"
  const folderPath = rawPath.slice(prefix.length) || "/"

  /* ─── State ─── */
  const [items, setItems] = createSignal<MediaItem[]>([])
  const [loading, setLoading] = createSignal(true)
  const [scanning, setScanning] = createSignal(false)
  const [scanMsg, setScanMsg] = createSignal("")
  const [search, setSearch] = createSignal("")
  const [recursive, setRecursive] = createSignal(true)
  const [maxDepth, setMaxDepth] = createSignal(3)
  const [focusIndex, setFocusIndex] = createSignal(-1)
  const [lightboxIndex, setLightboxIndex] = createSignal<number | null>(null)
  const [showHelp, setShowHelp] = createSignal(false)
  const [showJump, setShowJump] = createSignal(false)
  const [jumpInput, setJumpInput] = createSignal("")
  const [textCache, setTextCache] = createSignal<Record<string, string>>({})
  const [visibleCount, setVisibleCount] = createSignal(GROUPS_PER_BATCH)

  /* ─── Refs ─── */
  let scrollRef: HTMLDivElement | undefined
  let abortCtrl: AbortController | undefined
  let jumpInputRef: HTMLInputElement | undefined
  let sentinelRef: HTMLDivElement | undefined

  const observeSentinel = (el: HTMLDivElement) => {
    if (sentinelRef) loadMoreObserver?.unobserve(sentinelRef)
    sentinelRef = el
    if (hasMore()) loadMoreObserver?.observe(el)
  }

  /* ─── Computed: filtered flat list ─── */
  const filteredItems = createMemo(() => {
    let result = items()
    const q = search().toLowerCase().trim()
    if (q) result = result.filter((i) => i.name.toLowerCase().includes(q))
    return result
  })

  /* ─── O(1) index lookup map ─── */
  const indexMap = createMemo(() => {
    const map = new Map<MediaItem, number>()
    const flat = filteredItems()
    for (let i = 0; i < flat.length; i++) map.set(flat[i], i)
    return map
  })

  const getIndex = (item: MediaItem) => indexMap().get(item) ?? -1

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
      if (path === folderPath) {
        displayName = folderPath.split("/").pop() || "/"
      } else {
        displayName = path.slice(folderPath.length + 1) || path
      }

      groups.push({ path, displayName, items: groupItems })
    }

    groups.sort((a, b) => a.displayName.localeCompare(b.displayName))
    return groups
  })

  /* ─── Progressive rendering: only show visibleCount groups ─── */
  const visibleGroups = createMemo(() =>
    folderGroups().slice(0, visibleCount()),
  )
  const hasMore = createMemo(() => visibleCount() < folderGroups().length)

  const flatItems = createMemo(() => filteredItems())

  const currentItem = createMemo(() => {
    const idx = lightboxIndex()
    return idx !== null ? flatItems()[idx] : null
  })

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
    depth: number,
    maxD: number,
    signal: AbortSignal,
  ) => {
    if (signal.aborted) return
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

    if (!data?.content) return
    const content = data.content as any[]

    const newItems: MediaItem[] = []
    const subDirs: string[] = []

    for (const obj of content) {
      if (signal.aborted) return
      if (obj.is_dir) {
        subDirs.push(pathJoin(path, obj.name))
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

    if (newItems.length > 0) setItems((prev) => [...prev, ...newItems])

    if (recursive() && depth < maxD) {
      subDirs.sort((a, b) => a.localeCompare(b))
      for (const subDir of subDirs) {
        if (signal.aborted) return
        await fetchFolder(subDir, depth + 1, maxD, signal)
      }
    }
  }

  const startScan = async () => {
    abortCtrl?.abort()
    abortCtrl = new AbortController()
    setItems([])
    setTextCache({})
    setLoading(true)
    setScanning(true)
    setFocusIndex(-1)
    setVisibleCount(GROUPS_PER_BATCH)

    try {
      await fetchFolder(folderPath, 0, maxDepth(), abortCtrl.signal)
    } catch (e) {
      if (!abortCtrl.signal.aborted) console.error("Media scan error:", e)
    } finally {
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

  /* ─── Lazy render: IntersectionObserver for progressive loading ─── */
  let loadMoreObserver: IntersectionObserver | undefined

  onMount(() => {
    loadMoreObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasMore()) {
            setVisibleCount((c) => c + GROUPS_PER_BATCH)
          }
        }
      },
      { rootMargin: "200px" },
    )
  })

  /* ─── Lazy text observer: fetch text when card scrolls into view ─── */
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

  /* ─── Navigation ─── */
  const navigate = (newIndex: number) => {
    const len = flatItems().length
    if (len === 0) return
    const clamped = Math.max(0, Math.min(newIndex, len - 1))
    setFocusIndex(clamped)
    const el = scrollRef?.querySelector(
      `[data-media-card="${clamped}"]`,
    ) as HTMLElement
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }

  const openLightbox = (index: number) => {
    setLightboxIndex(index)
    const item = flatItems()[index]
    if (item?.type === "text") fetchTextContent(item)
  }

  const closeLightbox = () => setLightboxIndex(null)

  const lightboxPrev = () => {
    const idx = lightboxIndex()
    if (idx !== null && idx > 0) {
      const ni = idx - 1
      setLightboxIndex(ni)
      const item = flatItems()[ni]
      if (item?.type === "text") fetchTextContent(item)
    }
  }

  const lightboxNext = () => {
    const idx = lightboxIndex()
    const len = flatItems().length
    if (idx !== null && idx < len - 1) {
      const ni = idx + 1
      setLightboxIndex(ni)
      const item = flatItems()[ni]
      if (item?.type === "text") fetchTextContent(item)
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
        case "a":
        case "h":
          e.preventDefault()
          lightboxPrev()
          return
        case "ArrowRight":
        case "d":
        case "l":
          e.preventDefault()
          lightboxNext()
          return
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
  onMount(() => {
    window.addEventListener("keydown", onKeyDown)
    startScan()
  })
  onCleanup(() => {
    window.removeEventListener("keydown", onKeyDown)
    abortCtrl?.abort()
    loadMoreObserver?.disconnect()
    textObserver?.disconnect()
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
        bg="$neutral2"
        borderBottom="1px solid $neutral6"
        flexShrink={0}
        zIndex={10}
      >
        <Box display="flex" alignItems="center" gap="$2" px="$3" py="$2">
          <IconButton
            aria-label="Back"
            icon={<BsArrowLeft />}
            variant="ghost"
            size="sm"
            onClick={() => to(folderPath === "/" ? "/" : folderPath)}
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
              {folderPath}
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
          <InputGroup size="sm" w="220px" flexShrink={0}>
            <InputLeftElement pointerEvents="none">
              <Box as={AiOutlineSearch} color="$neutral11" />
            </InputLeftElement>
            <Input
              placeholder="Filter files…"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
            />
          </InputGroup>
          <Box flex={1} />
          <Tooltip
            label={`Recursive: ${recursive() ? "ON" : "OFF"} (depth ${maxDepth()}) — double-click to change depth`}
            placement="bottom"
          >
            <Box
              display="flex"
              alignItems="center"
              gap="$1"
              px="$2"
              py="$1"
              rounded="$md"
              cursor="pointer"
              fontSize="xs"
              border="1px solid"
              borderColor={recursive() ? "$success7" : "$neutral6"}
              bg={recursive() ? "$success3" : "transparent"}
              color={recursive() ? "$success11" : "$neutral11"}
              userSelect="none"
              onClick={() => setRecursive((v) => !v)}
              onDblClick={() => setMaxDepth((d) => (d >= 5 ? 1 : d + 1))}
            >
              <Box
                as={recursive() ? FiChevronDown : FiChevronRight}
                boxSize="12px"
              />
              Recursive
              <Show when={recursive()}>
                <Text size="xs" color="$neutral11">
                  D{maxDepth()}
                </Text>
              </Show>
            </Box>
          </Tooltip>
          <Text size="xs" color="$neutral11" flexShrink={0}>
            {flatItems().length} items · {folderGroups().length} folders
            <Show when={hasMore()}> · showing {visibleGroups().length}</Show>
          </Text>
        </Box>
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
      <Box
        ref={scrollRef}
        flex={1}
        overflowY="auto"
        overflowX="hidden"
        px="$3"
        py="$2"
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
            when={visibleGroups().length > 0}
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
            <For each={visibleGroups()}>
              {(group) => (
                <Box mb="$5">
                  {/* ── Folder Header ── */}
                  <Box
                    display="flex"
                    alignItems="center"
                    gap="$2"
                    mb="$2"
                    pb="$1"
                    borderBottom="1px solid $neutral5"
                  >
                    <Box
                      as={AiOutlineFolder}
                      boxSize="$4"
                      color="$primary9"
                      flexShrink={0}
                    />
                    <Text
                      size="sm"
                      fontWeight="$bold"
                      color="$neutral12"
                      flex={1}
                      css={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {group.displayName}
                    </Text>
                    <Badge
                      colorScheme="neutral"
                      variant="subtle"
                      rounded="$full"
                      fontSize="xs"
                    >
                      {group.items.length}
                    </Badge>
                  </Box>

                  {/* ── Text files: full-width content blocks ── */}
                  <For each={group.items.filter((i) => i.type === "text")}>
                    {(item) => {
                      const idx = () => getIndex(item)
                      const focused = () => focusIndex() === idx()
                      const textKey = `${item.path}/${item.name}`
                      const content = () => textCache()[textKey]

                      // Register for lazy text fetch via observer
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
                          rounded="$lg"
                          overflow="hidden"
                          cursor="pointer"
                          border="2px solid"
                          borderColor={focused() ? "$primary8" : "$neutral5"}
                          bg="$neutral2"
                          mb="$3"
                          transition="border-color 0.15s"
                          boxShadow={
                            focused()
                              ? "0 0 0 3px $colors$primary4"
                              : "0 1px 4px $colors$neutral6"
                          }
                          _hover={{ borderColor: "$primary7" }}
                          onClick={() => openLightbox(idx())}
                          onMouseEnter={() => setFocusIndex(idx())}
                        >
                          {/* File name header */}
                          <Box
                            display="flex"
                            alignItems="center"
                            gap="$2"
                            px="$4"
                            py="$2_5"
                            borderBottom="1px solid $neutral5"
                            bg="$neutral3"
                          >
                            <Box
                              as={FiType}
                              boxSize="16px"
                              color="$info9"
                              flexShrink={0}
                            />
                            <Text
                              size="sm"
                              fontWeight="$bold"
                              color="$neutral12"
                              flex={1}
                              css={{
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {item.name}
                            </Text>
                            <Text size="xs" color="$neutral10">
                              {formatSize(item.size)}
                            </Text>
                          </Box>

                          {/* Text content — markdown-body style, fully displayed */}
                          <Box px="$4" py="$3" css={{ userSelect: "text" }}>
                            <Show
                              when={content() !== undefined}
                              fallback={
                                <Box
                                  display="flex"
                                  alignItems="center"
                                  gap="$2"
                                  py="$2"
                                >
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
                                  <Text
                                    size="sm"
                                    color="$neutral9"
                                    fontStyle="italic"
                                  >
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
                    }}
                  </For>

                  {/* ── Media Grid (images, videos, gifs) ── */}
                  <Show when={group.items.some((i) => i.type !== "text")}>
                    <Box
                      css={{
                        display: "grid",
                        "grid-template-columns":
                          "repeat(auto-fill, minmax(180px, 1fr))",
                        gap: "10px",
                      }}
                    >
                      <For each={group.items.filter((i) => i.type !== "text")}>
                        {(item) => {
                          const idx = () => getIndex(item)
                          const focused = () => focusIndex() === idx()
                          const link = () => getItemLink(item)
                          const thumbUrl = () =>
                            item.thumb ||
                            (item.type === "image" || item.type === "gif"
                              ? link()
                              : "")

                          return (
                            <Box
                              data-media-card={idx().toString()}
                              rounded="$lg"
                              overflow="hidden"
                              cursor="pointer"
                              border="2px solid"
                              borderColor={
                                focused() ? "$primary8" : "$neutral6"
                              }
                              bg="$neutral2"
                              transition="border-color 0.15s"
                              boxShadow={
                                focused()
                                  ? "0 0 0 3px $colors$primary4"
                                  : "0 1px 3px $colors$neutral7"
                              }
                              _hover={{ borderColor: "$primary7" }}
                              onClick={() => openLightbox(idx())}
                              onMouseEnter={() => setFocusIndex(idx())}
                            >
                              <Box
                                h="140px"
                                bg="$neutral4"
                                pos="relative"
                                overflow="hidden"
                              >
                                <Show
                                  when={
                                    (item.type === "image" ||
                                      item.type === "gif") &&
                                    thumbUrl()
                                  }
                                  fallback={
                                    <Show
                                      when={item.type === "video"}
                                      fallback={
                                        <Center h="$full">
                                          <TypeIcon type={item.type} />
                                        </Center>
                                      }
                                    >
                                      <Box
                                        as="video"
                                        w="$full"
                                        h="$full"
                                        objectFit="cover"
                                        preload="metadata"
                                        muted
                                        src={link() + "#t=0.5"}
                                      />
                                    </Show>
                                  }
                                >
                                  <Image
                                    src={thumbUrl()}
                                    alt={item.name}
                                    w="$full"
                                    h="$full"
                                    objectFit="cover"
                                    fallback={
                                      <Center h="$full">
                                        <Spinner size="sm" />
                                      </Center>
                                    }
                                  />
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
                                  fontWeight="$medium"
                                  css={{
                                    display: "-webkit-box",
                                    "-webkit-line-clamp": "2",
                                    "-webkit-box-orient": "vertical",
                                    overflow: "hidden",
                                    "word-break": "break-all",
                                    lineHeight: "1.3",
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
                  </Show>
                </Box>
              )}
            </For>

            {/* ── Lazy load sentinel ── */}
            <Show when={hasMore()}>
              <Box ref={observeSentinel} py="$4" textAlign="center">
                <Spinner size="sm" />
                <Text size="xs" color="$neutral11" mt="$1">
                  Loading more… ({visibleGroups().length}/
                  {folderGroups().length} folders)
                </Text>
              </Box>
            </Show>
          </Show>
        </Show>
      </Box>

      {/* ═══════ Bottom Status Bar ═══════ */}
      <Box
        bg="$neutral2"
        borderTop="1px solid $neutral6"
        px="$3"
        py="$1_5"
        display="flex"
        alignItems="center"
        gap="$3"
        flexShrink={0}
        fontSize="xs"
        color="$neutral11"
      >
        <Text>
          {flatItems().length} items · {folderGroups().length} folders
          <Show when={focusIndex() >= 0}> · #{focusIndex() + 1}</Show>
        </Text>
        <Box flex={1} />
        <Kbd>←→↑↓</Kbd> navigate
        <Kbd>Enter</Kbd> open
        <Kbd>/</Kbd> jump
        <Kbd>?</Kbd> help
      </Box>

      {/* ═══════ Lightbox ═══════ */}
      <Show when={lightboxIndex() !== null}>
        {(() => {
          const item = () => currentItem()
          const idx = () => lightboxIndex()!
          const len = () => flatItems().length
          return (
            <Box
              pos="fixed"
              top="0"
              right="0"
              bottom="0"
              left="0"
              zIndex={1100}
              display="flex"
              flexDirection="column"
            >
              <Box
                pos="absolute"
                top="0"
                right="0"
                bottom="0"
                left="0"
                css={{ background: "rgba(0,0,0,0.92)" }}
                onClick={closeLightbox}
              />
              <Box
                pos="relative"
                display="flex"
                alignItems="center"
                gap="$2"
                px="$3"
                py="$2"
                zIndex={1}
              >
                <Text
                  size="sm"
                  color="white"
                  fontWeight="$medium"
                  flex={1}
                  css={{
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {item()?.name}
                </Text>
                <Text size="xs" css={{ color: "rgba(255,255,255,0.5)" }}>
                  {idx() + 1} / {len()}
                </Text>
                <Show when={item()}>
                  <Badge
                    colorScheme="neutral"
                    variant="subtle"
                    rounded="$md"
                    fontSize="xs"
                  >
                    {formatSize(item()!.size)}
                  </Badge>
                </Show>
                <IconButton
                  aria-label="Close"
                  icon={<BsX />}
                  variant="ghost"
                  color="white"
                  size="sm"
                  onClick={closeLightbox}
                  css={{
                    "&:hover": { backgroundColor: "rgba(255,255,255,0.1)" },
                  }}
                />
              </Box>
              <Box
                pos="relative"
                flex={1}
                display="flex"
                alignItems="center"
                justifyContent="center"
                zIndex={1}
                overflow="auto"
                p="$4"
              >
                <Show when={idx() > 0}>
                  <IconButton
                    aria-label="Previous"
                    icon={<BsChevronLeft />}
                    variant="ghost"
                    color="white"
                    size="lg"
                    pos="absolute"
                    left="$2"
                    top="50%"
                    transform="translateY(-50%)"
                    zIndex={2}
                    onClick={(e: MouseEvent) => {
                      e.stopPropagation()
                      lightboxPrev()
                    }}
                    css={{
                      background: "rgba(255,255,255,0.1)",
                      "&:hover": { background: "rgba(255,255,255,0.2)" },
                    }}
                    rounded="$full"
                  />
                </Show>
                <Show when={item()}>
                  {(() => {
                    const it = item()!
                    const link = getItemLink(it)
                    if (it.type === "image" || it.type === "gif") {
                      return (
                        <Image
                          src={link}
                          alt={it.name}
                          maxW="90%"
                          maxH="85vh"
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
                          controls
                          autoplay
                          maxW="90%"
                          maxH="85vh"
                          rounded="$lg"
                          onClick={(e: MouseEvent) => e.stopPropagation()}
                          css={{ outline: "none" }}
                        />
                      )
                    }
                    if (it.type === "text") {
                      const key = `${it.path}/${it.name}`
                      const content = textCache()[key]
                      return (
                        <Box
                          w="min(800px, 90%)"
                          maxH="80vh"
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
                  })()}
                </Show>
                <Show when={idx() < len() - 1}>
                  <IconButton
                    aria-label="Next"
                    icon={<BsChevronRight />}
                    variant="ghost"
                    color="white"
                    size="lg"
                    pos="absolute"
                    right="$2"
                    top="50%"
                    transform="translateY(-50%)"
                    zIndex={2}
                    onClick={(e: MouseEvent) => {
                      e.stopPropagation()
                      lightboxNext()
                    }}
                    css={{
                      background: "rgba(255,255,255,0.1)",
                      "&:hover": { background: "rgba(255,255,255,0.2)" },
                    }}
                    rounded="$full"
                  />
                </Show>
              </Box>
              <Box
                pos="relative"
                display="flex"
                justifyContent="center"
                gap="$4"
                px="$3"
                py="$2"
                zIndex={1}
              >
                <Text size="xs" css={{ color: "rgba(255,255,255,0.4)" }}>
                  <Kbd
                    css={{
                      background: "rgba(255,255,255,0.1)",
                      borderColor: "rgba(255,255,255,0.2)",
                      color: "rgba(255,255,255,0.6)",
                    }}
                  >
                    ← →
                  </Kbd>{" "}
                  prev/next
                </Text>
                <Text size="xs" css={{ color: "rgba(255,255,255,0.4)" }}>
                  <Kbd
                    css={{
                      background: "rgba(255,255,255,0.1)",
                      borderColor: "rgba(255,255,255,0.2)",
                      color: "rgba(255,255,255,0.6)",
                    }}
                  >
                    Esc
                  </Kbd>{" "}
                  close
                </Text>
              </Box>
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
                    ["Esc", "Close preview"],
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
