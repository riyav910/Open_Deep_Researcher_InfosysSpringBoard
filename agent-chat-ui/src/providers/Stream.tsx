import React, {
  createContext,
  useContext,
  ReactNode,
  useState,
  useEffect,
} from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import { type Message } from "@langchain/langgraph-sdk";
import {
  uiMessageReducer,
  isUIMessage,
  isRemoveUIMessage,
  type UIMessage,
  type RemoveUIMessage,
} from "@langchain/langgraph-sdk/react-ui";
import { useQueryState } from "nuqs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LangGraphLogoSVG } from "@/components/icons/langgraph";
import { Label } from "@/components/ui/label";
import { ArrowRight } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import { getApiKey } from "@/lib/api-key";
import { useThreads } from "./Thread";
import { toast } from "sonner";
import { GRAPH_IDS } from "@/lib/graphs";

export type StateType = { messages: Message[]; ui?: UIMessage[] };

const useTypedStream = useStream<
  StateType,
  {
    UpdateType: {
      messages?: Message[] | Message | string;
      ui?: (UIMessage | RemoveUIMessage)[] | UIMessage | RemoveUIMessage;
      context?: Record<string, unknown>;
    };
    CustomEventType: UIMessage | RemoveUIMessage;
  }
>;

type StreamContextType = ReturnType<typeof useTypedStream>;
const StreamContext = createContext<StreamContextType | undefined>(undefined);

async function sleep(ms = 4000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkGraphStatus(
  apiUrl: string,
  apiKey: string | null,
): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/info`, {
      ...(apiKey && {
        headers: {
          "X-Api-Key": apiKey,
        },
      }),
    });

    return res.ok;
  } catch (e) {
    console.error(e);
    return false;
  }
}

const StreamSession = ({
  children,
  apiKey,
  apiUrl,
  assistantId,
}: {
  children: ReactNode;
  apiKey: string | null;
  apiUrl: string;
  assistantId: string;
}) => {
  const [threadId, setThreadId] = useQueryState("threadId");
  const { getThreads, setThreads } = useThreads();
  const streamValue = useTypedStream({
    apiUrl,
    apiKey: apiKey ?? undefined,
    assistantId,
    threadId: threadId ?? null,
    fetchStateHistory: true,
    onCustomEvent: (event, options) => {
      if (isUIMessage(event) || isRemoveUIMessage(event)) {
        options.mutate((prev) => {
          const ui = uiMessageReducer(prev.ui ?? [], event);
          return { ...prev, ui };
        });
      }
    },
    onThreadId: (id) => {
      setThreadId(id);
      // Refetch threads list when thread ID changes.
      // Wait for some seconds before fetching so we're able to get the new thread that was created.
      sleep().then(() => getThreads().then(setThreads).catch(console.error));
    },
  });

  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (
        reason &&
        (String(reason).includes("HTTP 404") ||
          String(reason).includes("not found") ||
          String(reason).includes("Thread with ID"))
      ) {
        console.warn("Caught unhandled 404 thread error. Clearing threadId...", reason);
        setThreadId(null);
        toast.error("The previous conversation thread was not found on this database. Started a new chat.");
        event.preventDefault();
      }
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [setThreadId]);

  useEffect(() => {
    if (streamValue.messages && streamValue.messages.length > 0) {
      console.log("%c=== 🟢 [LANGGRAPH EVENT] Thread Messages Updated ===", "color: #0ea5e9; font-weight: bold; font-size: 11px;");
      console.log(`Current Message Count in Thread: ${streamValue.messages.length}`);
      
      streamValue.messages.forEach((msg, idx) => {
        const type = msg.type;
        const name = msg.name || "";
        const toolCalls = (msg as any).tool_calls || [];
        
        let textSummary = "";
        if (msg.content) {
          if (typeof msg.content === "string") {
            textSummary = msg.content;
          } else if (Array.isArray(msg.content)) {
            textSummary = msg.content
              .map(c => typeof c === "string" ? c : (c as any).text || JSON.stringify(c))
              .join(" ");
          } else {
            textSummary = JSON.stringify(msg.content);
          }
        }
        
        // Clean summary for preview header
        textSummary = textSummary.trim().replace(/\s+/g, ' ');
        if (textSummary.length > 70) {
          textSummary = textSummary.substring(0, 70) + "...";
        }
        
        const headerText = `[Step ${idx + 1}] ${type.toUpperCase()}${name ? ` (${name})` : ""}${textSummary ? ` ➔ "${textSummary}"` : ""}`;
        console.groupCollapsed(`%c${headerText}`, "color: #4b5563; font-weight: 500;");
        console.log("Raw Message:", msg);
        if (toolCalls.length > 0) {
          console.log("%cTool Calls Requested:", "color: #f59e0b; font-weight: bold;", toolCalls);
        }
        if (msg.content) {
          console.log("Full Content Payload:", msg.content);
        }
        console.groupEnd();
      });
      console.log("=========================================================");
    }
  }, [streamValue.messages]);

  useEffect(() => {
    if (streamValue.values) {
      console.log("%c=== 🔄 [LANGGRAPH STATE] State Variables Changed ===", "color: #a855f7; font-weight: bold; font-size: 11px;");
      const filteredState: Record<string, any> = {};
      const keysToTrack = ["research_brief", "final_report", "need_clarification", "question", "verification"];
      keysToTrack.forEach(k => {
        if (streamValue.values && k in streamValue.values) {
          filteredState[k] = (streamValue.values as any)[k];
        }
      });
      if (Object.keys(filteredState).length > 0) {
        console.log("Tracked State Values:", filteredState);
      } else {
        console.log("Full State Dump:", streamValue.values);
      }
      console.log("=========================================================");
    }
  }, [streamValue.values]);

  useEffect(() => {
    if (streamValue.isLoading) {
      console.log("%c⚡ LangGraph Stream: Executing nodes and waiting for response...", "color: #f59e0b; font-weight: bold;");
    } else {
      console.log("%c✅ LangGraph Stream: Execution completed, session idle.", "color: #10b981; font-weight: bold;");
    }
  }, [streamValue.isLoading]);

  useEffect(() => {
    checkGraphStatus(apiUrl, apiKey).then((ok) => {
      if (!ok) {
        toast.error("Failed to connect to LangGraph server", {
          description: () => (
            <p>
              Please ensure your graph is running at <code>{apiUrl}</code> and
              your API key is correctly set (if connecting to a deployed graph).
            </p>
          ),
          duration: 10000,
          richColors: true,
          closeButton: true,
        });
      }
    });
  }, [apiKey, apiUrl]);

  return (
    <StreamContext.Provider value={streamValue}>
      {children}
    </StreamContext.Provider>
  );
};

// Default values for the form
const DEFAULT_API_URL = "http://127.0.0.1:2024";
const DEFAULT_ASSISTANT_ID = "research_agent_full";

export const StreamProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  // Get environment variables
  const envApiUrl: string | undefined = process.env.NEXT_PUBLIC_API_URL;
  const envAssistantId: string | undefined =
    process.env.NEXT_PUBLIC_ASSISTANT_ID;

  // Use URL params with env var fallbacks
  const [apiUrl, setApiUrl] = useQueryState("apiUrl", {
    defaultValue: envApiUrl || "",
  });
  const [assistantId, setAssistantId] = useQueryState("assistantId", {
    defaultValue: envAssistantId || "",
  });

  // For API key, use localStorage with env var fallback
  const [apiKey, _setApiKey] = useState(() => {
    const storedKey = getApiKey();
    return storedKey || "";
  });

  const setApiKey = (key: string) => {
    window.localStorage.setItem("lg:chat:apiKey", key);
    _setApiKey(key);
  };

  // Determine final values to use, prioritizing URL params then env vars
  const fallbackUrl = typeof window !== "undefined" ? `${window.location.origin}/api` : "https://open-deep-researcher-git-main-riya-vermas-projects-f7159b58.vercel.app/api";
  let finalApiUrl = apiUrl || envApiUrl || fallbackUrl;
  if (typeof window !== "undefined" && !finalApiUrl.startsWith("http://") && !finalApiUrl.startsWith("https://")) {
    finalApiUrl = finalApiUrl.startsWith("/")
      ? `${window.location.origin}${finalApiUrl}`
      : `${window.location.origin}/${finalApiUrl}`;
  }
    
    console.log({
      apiUrl,
      envApiUrl,
      finalApiUrl,
      assistantId,
      envAssistantId,
    });
  const finalAssistantId = assistantId || envAssistantId;

  // Show the form if we: don't have an API URL, or don't have an assistant ID
  if (!finalApiUrl || !finalAssistantId) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center p-4">
        <div className="animate-in fade-in-0 zoom-in-95 bg-background flex max-w-3xl flex-col rounded-lg border shadow-lg">
          <div className="mt-14 flex flex-col gap-2 border-b p-6">
            <div className="flex flex-col items-start gap-2">
              <LangGraphLogoSVG className="h-7" />
              <h1 className="text-xl font-semibold tracking-tight">
                Research & Planning
              </h1>
            </div>
            <p className="text-muted-foreground">
              Welcome to Research & Planning! Before you get started, you need to enter
              the URL of the deployment and the assistant / graph ID.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();

              const form = e.target as HTMLFormElement;
              const formData = new FormData(form);
              const apiUrl = formData.get("apiUrl") as string;
              const assistantId = formData.get("assistantId") as string;
              const apiKey = formData.get("apiKey") as string;

              setApiUrl(apiUrl);
              setApiKey(apiKey);
              setAssistantId(assistantId);

              form.reset();
            }}
            className="bg-muted/50 flex flex-col gap-6 p-6"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="apiUrl">
                Deployment URL<span className="text-rose-500">*</span>
              </Label>
              <p className="text-muted-foreground text-sm">
                This is the URL of your LangGraph deployment. Can be a local, or
                production deployment.
              </p>
              <Input
                id="apiUrl"
                name="apiUrl"
                className="bg-background"
                defaultValue={apiUrl || DEFAULT_API_URL}
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="assistantId">
                Assistant / Graph ID<span className="text-rose-500">*</span>
              </Label>
              <p className="text-muted-foreground text-sm">
                This is the ID of the graph (can be the graph name), or
                assistant to fetch threads from, and invoke when actions are
                taken.
              </p>
              <select
                id="assistantId"
                name="assistantId"
                className="bg-background rounded-md border px-3 py-2 text-sm"
                value={assistantId || DEFAULT_ASSISTANT_ID}
                onChange={(event) => setAssistantId(event.target.value)}
                required
              >
                {GRAPH_IDS.map((graph) => (
                  <option
                    key={graph}
                    value={graph}
                  >
                    {graph}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="apiKey">LangSmith API Key</Label>
              <p className="text-muted-foreground text-sm">
                This is <strong>NOT</strong> required if using a local LangGraph
                server. This value is stored in your browser's local storage and
                is only used to authenticate requests sent to your LangGraph
                server.
              </p>
              <PasswordInput
                id="apiKey"
                name="apiKey"
                defaultValue={apiKey ?? ""}
                className="bg-background"
                placeholder="lsv2_pt_..."
              />
            </div>

            <div className="mt-2 flex justify-end">
              <Button
                type="submit"
                size="lg"
              >
                Continue
                <ArrowRight className="size-5" />
              </Button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <StreamSession
      apiKey={apiKey}
      apiUrl={finalApiUrl}
      assistantId={finalAssistantId}
    >
      {children}
    </StreamSession>
  );
};

// Create a custom hook to use the context
export const useStreamContext = (): StreamContextType => {
  const context = useContext(StreamContext);
  if (context === undefined) {
    throw new Error("useStreamContext must be used within a StreamProvider");
  }
  return context;
};

export default StreamContext;
