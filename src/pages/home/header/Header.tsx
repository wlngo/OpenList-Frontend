import {
  HStack,
  IconButton,
  useColorModeValue,
  Image,
  Center,
  Icon,
  Kbd,
  CenterProps,
} from "@hope-ui/solid"
import { changeColor } from "seemly"
import { Show, createMemo } from "solid-js"
import { getMainColor, getSetting, local, objStore, State } from "~/store"
import { BsSearch } from "solid-icons/bs"
import { FiGrid } from "solid-icons/fi"
import { CenterLoading } from "~/components"
import { Container } from "../Container"
import { bus, encodePath } from "~/utils"
import { Layout } from "./layout"
import { isMac } from "~/utils/compatibility"
import { useRouter } from "~/hooks"

export const Header = () => {
  const logos = getSetting("logo").split("\n")
  const logo = useColorModeValue(logos[0], logos.pop())
  const { pathname, to } = useRouter()

  const stickyProps = createMemo<CenterProps>(() => {
    switch (local["position_of_header_navbar"]) {
      case "sticky":
        return { position: "sticky", zIndex: "$sticky", top: 0 }
      default:
        return { position: undefined, zIndex: undefined, top: undefined }
    }
  })

  return (
    <Center
      {...stickyProps}
      bgColor="$background"
      class="header"
      w="$full"
      // shadow="$md"
    >
      <Container>
        <HStack
          px="calc(2% + 0.5rem)"
          py="$2"
          w="$full"
          justifyContent="space-between"
        >
          <HStack class="header-left" h="44px">
            <Image
              src={logo()!}
              h="$full"
              w="auto"
              fallback={<CenterLoading />}
            />
          </HStack>
          <HStack class="header-right" spacing="$2">
            <Show when={objStore.state === State.Folder}>
              <Show when={getSetting("search_index") !== "none"}>
                <HStack
                  bg="$neutral4"
                  w="$32"
                  p="$1"
                  rounded="$md"
                  justifyContent="space-between"
                  border="2px solid transparent"
                  cursor="pointer"
                  color={getMainColor()}
                  bgColor={changeColor(getMainColor(), { alpha: 0.15 })}
                  _hover={{
                    bgColor: changeColor(getMainColor(), { alpha: 0.2 }),
                  }}
                  onClick={() => {
                    bus.emit("tool", "search")
                  }}
                >
                  <Icon as={BsSearch} />
                  <HStack>
                    {isMac ? <Kbd>Cmd</Kbd> : <Kbd>Ctrl</Kbd>}
                    <Kbd>K</Kbd>
                  </HStack>
                </HStack>
              </Show>
              <IconButton
                color={getMainColor()}
                bgColor={changeColor(getMainColor(), { alpha: 0.15 })}
                _hover={{
                  bgColor: changeColor(getMainColor(), { alpha: 0.2 }),
                }}
                aria-label="media view"
                compact
                size="lg"
                icon={<FiGrid />}
                mr="$1"
                onClick={() => {
                  // pathname() is decoded; re-encode so a folder name with a
                  // trailing space / tab / nbsp / # / ? / % survives pushState.
                  // encodeURIComponent (all=true) covers every whitespace &
                  // control char; the URL parser strips raw trailing C0/space.
                  to(`/@media${encodePath(pathname(), true)}`)
                }}
              />
              <Layout />
            </Show>
          </HStack>
        </HStack>
      </Container>
    </Center>
  )
}
