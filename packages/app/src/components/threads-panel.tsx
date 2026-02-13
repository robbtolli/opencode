import { Component, createMemo, createSignal, For, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { extractPromptFromParts } from "@/utils/prompt"
import { base64Encode } from "@opencode-ai/util/encode"
import { Session, UserMessage } from "@opencode-ai/sdk/v2"
import { getOwner } from "solid-js"

type ThreadGroup = {
  userMessage: UserMessage
  promptText: string
  threads: Session[]
  expanded: boolean
}

function promptToString(prompt: ReturnType<typeof extractPromptFromParts>): string {
  if (typeof prompt === "string") return prompt
  if (Array.isArray(prompt)) {
    return prompt
      .filter((part) => part.type === "text")
      .map((part) => part.content)
      .join("")
  }
  return ""
}

export const ThreadsPanel: Component = () => {
  const params = useParams()
  const navigate = useNavigate()
  const language = useLanguage()

  // Check if we have access to sync context (only available in directory routes)
  let sync: ReturnType<typeof useSync> | undefined
  let sdk: ReturnType<typeof useSDK> | undefined

  try {
    sync = useSync()
    sdk = useSDK()
  } catch (e) {
    // Context not available, we're outside of a directory route
  }

  const currentSessionID = () => params.id

  const rootSession = createMemo(() => {
    if (!sync) return undefined
    const id = currentSessionID()
    if (!id) return undefined
    let current = sync.session.get(id)
    if (!current) return undefined
    // Navigate up to root session
    while (current.parentID) {
      const parent = sync.session.get(current.parentID)
      if (!parent) break
      current = parent
    }
    return current
  })

  const [expandedMessages, setExpandedMessages] = createSignal<Set<string>>(new Set())

  const threadGroups = createMemo(() => {
    if (!sync || !sdk) return []
    const root = rootSession()
    if (!root) return []

    const rootMessages = (sync.data.message?.[root.id] ?? []).filter((m) => m.role === "user") as UserMessage[]
    const allSessions = sync.data.session ?? []

    const groups: ThreadGroup[] = []
    for (const um of rootMessages) {
      const parts = sync.data.part?.[um.id] ?? []
      const prompt = extractPromptFromParts(parts, { directory: sdk.directory })
      const promptText = promptToString(prompt)
      const threads = allSessions.filter(
        (s) => s.parentID === root.id && (s as any).threadMessageID === um.id,
      ) as Session[]
      const expanded = expandedMessages().has(um.id)
      groups.push({ userMessage: um, promptText, threads, expanded })
    }
    return groups
  })

  const toggleExpanded = (messageID: string) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev)
      if (next.has(messageID)) {
        next.delete(messageID)
      } else {
        next.add(messageID)
      }
      return next
    })
  }

  const startThread = async (sessionID: string, messageID: string) => {
    if (!sdk) return
    try {
      const res = await sdk.client.session.thread({ sessionID, messageID })
      if (res.data?.id) {
        const slug = base64Encode(sdk.directory)
        navigate(`/${slug}/session/${res.data.id}`)
      }
    } catch (error) {
      console.error("Failed to create thread:", error)
    }
  }

  // Show a message if context is not available
  if (!sync || !sdk) {
    return (
      <div class="flex flex-col size-full overflow-hidden bg-surface-base">
        <div class="flex-1 overflow-y-auto no-scrollbar p-2">
          <div class="text-center text-text-weak text-13-regular mt-4">Open a session to view threads</div>
        </div>
      </div>
    )
  }

  return (
    <div class="flex flex-col size-full overflow-hidden bg-surface-base">
      <div class="flex-1 overflow-y-auto no-scrollbar p-2">
        <Show when={threadGroups().length === 0}>
          <div class="text-center text-text-weak text-13-regular mt-4">
            {language.t("thread.panel.empty", { default: "No messages to thread from" })}
          </div>
        </Show>
        <For each={threadGroups()}>
          {(group) => (
            <div class="mb-2">
              <div
                class="flex items-center gap-2 py-2 px-2 rounded-sm hover:bg-surface-hover cursor-pointer"
                onClick={() => toggleExpanded(group.userMessage.id)}
              >
                <IconButton
                  icon={group.expanded ? "chevron-down" : "chevron-right"}
                  variant="ghost"
                  size="small"
                  class="size-4"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleExpanded(group.userMessage.id)
                  }}
                  aria-label={group.expanded ? "Collapse" : "Expand"}
                />
                <div class="flex-1 min-w-0 truncate text-13-regular text-text-base">
                  {group.promptText || "(empty)"}
                </div>
                <div class="shrink-0 text-text-weak text-11">
                  {group.threads.length > 0 ? `${group.threads.length}` : ""}
                </div>
              </div>

              <Show when={group.expanded}>
                <div class="ml-6 border-l border-border-weak-base pl-3 mt-1">
                  <Show when={group.threads.length > 0}>
                    <For each={group.threads}>
                      {(thread) => (
                        <div
                          class="flex items-center gap-2 py-1 px-2 rounded-sm hover:bg-surface-hover cursor-pointer text-13-regular"
                          classList={{
                            "bg-surface-selected": currentSessionID() === thread.id,
                          }}
                          onClick={() => {
                            if (!sdk) return
                            const slug = base64Encode(sdk.directory)
                            navigate(`/${slug}/session/${thread.id}`)
                          }}
                        >
                          <span class="truncate flex-1 text-text-base">{thread.title ?? thread.id.slice(0, 12)}</span>
                          <span class="shrink-0 text-text-weak text-11">
                            {new Date(thread.time?.created ?? Date.now()).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                      )}
                    </For>
                  </Show>
                  <Show when={group.threads.length === 0}>
                    <button
                      class="text-12-regular text-text-weak hover:text-text-base py-1 px-2"
                      onClick={() => startThread(rootSession()!.id, group.userMessage.id)}
                    >
                      + {language.t("thread.panel.start", { default: "Start a thread" })}
                    </button>
                  </Show>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
