import React, { useRef, useEffect, useState, useMemo } from "react";
import { useSessionStore } from "../../store/useSessionStore";
import {
  Terminal,
  User,
  Bot,
  Wrench,
  Send,
  ShieldCheck,
  XCircle,
  CheckCircle,
  AlertCircle,
  StopCircle,
  Settings2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { api } from "../../lib/api";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ConversationTimelineItem, ApprovalRequest } from "../../types";

export const ChatTimeline: React.FC = () => {
  const {
    activeExecution,
    activeBackend,
    sessionId,
    sendMessage,
    workingDirectory,
    backends,
    mergeDelta,
  } = useSessionStore();

  const items = useMemo(() => {
    const raw = activeExecution?.conversation?.items || [];
    if (raw.length === 0) return raw;

    const merged: typeof raw = [];
    for (const item of raw) {
      const rawToolCall = getToolCall(item);
      if (rawToolCall && !shouldShowToolCall(rawToolCall)) continue;

      if (isAssistantResponseItem(item)) {
        const response = buildAssistantResponse(item);
        const prev = merged[merged.length - 1];
        const prevResponse = getAssistantResponse(prev);

        if (prev && prevResponse && prev.executionId === item.executionId) {
          merged[merged.length - 1] = {
            ...prev,
            id: item.id,
            content: appendText(prev.content, item.content),
            timestamp: item.timestamp,
            eventSequence: item.eventSequence,
            metadata: {
              ...prev.metadata,
              assistantResponse: {
                thinking: appendText(prevResponse.thinking, response.thinking),
                result: appendText(prevResponse.result, response.result),
                final: prevResponse.final || response.final,
              },
              final: prevResponse.final || response.final || undefined,
            },
          };
          continue;
        }

        merged.push({
          ...item,
          metadata: {
            ...item.metadata,
            assistantResponse: response,
          },
        });
        continue;
      }

      merged.push(item);
    }
    return merged;
  }, [activeExecution]);
  const parentRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");

  // Virtualizer for high-performance long lists
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100, // Rough estimate, will auto-measure
    overscan: 5,
  });

  useEffect(() => {
    if (items.length > 0) {
      rowVirtualizer.scrollToIndex(items.length - 1);
    }
  }, [items.length, rowVirtualizer]);

  const currentBackend = backends.find((b) => b.backend === activeBackend);
  const isCircuitOpen = currentBackend?.status === "circuit_open";
  const isRunning =
    activeExecution?.conversation.state === "running" ||
    activeExecution?.conversation.state === "queued";

  const handleSend = () => {
    if (!input.trim() || !sessionId || isCircuitOpen || isRunning) return;

    // Optimistic UI update
    if (activeExecution) {
      mergeDelta({
        type: "app_delta",
        sessionId,
        revision: undefined,
        delta: {
          type: "conversation_delta",
          executionId: activeExecution.executionId,
          item: {
            id: `optimistic-${Date.now()}`,
            role: "user",
            content: input,
            timestamp: Date.now(),
            executionId: activeExecution.executionId,
            eventSequence: -1, // Custom marker to avoid dupes or identify optimistic
          },
        },
      });
    }

    sendMessage({
      type: "execute",
      sessionId,
      prompt: input,
      backend: activeBackend,
      workingDirectory: workingDirectory || undefined,
      approvals: { shell: "ask", fileOutside: "ask", network: "ask" },
    });

    setInput("");
  };

  const handleInterrupt = () => {
    if (activeExecution?.executionId) {
      sendMessage({
        type: "interrupt",
        executionId: activeExecution.executionId,
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleApprove = (requestId: string, approved: boolean) => {
    if (!activeExecution) return;
    sendMessage({
      type: "approval_decision",
      executionId: activeExecution.executionId,
      requestId,
      decision: approved ? "approve" : "deny",
      approved,
    });
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 border-r border-iota-border bg-white relative">
      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto custom-scrollbar p-6"
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {items.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-iota-text/40 space-y-3">
              <Terminal size={48} strokeWidth={1} />
              <p className="text-sm">Start a conversation to see the trace.</p>
            </div>
          ) : (
            rowVirtualizer.getVirtualItems().map((virtualItem) => {
              const item = items[virtualItem.index];
              return (
                <div
                  key={item.id}
                  data-index={virtualItem.index}
                  ref={rowVirtualizer.measureElement}
                  className="absolute top-0 left-0 w-full"
                  style={{
                    transform: `translateY(${virtualItem.start}px)`,
                    paddingBottom: "24px",
                  }}
                >
                  <MessageItem item={item} onApprove={handleApprove} />
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Enhanced Input Area */}
      <div className="p-4 border-t border-iota-border bg-gray-50/50 space-y-3">
        {isCircuitOpen && (
          <div className="max-w-[34rem] mx-auto flex items-center justify-between text-red-600 bg-red-50 p-3 rounded-lg border border-red-100 text-xs font-medium">
            <div className="flex items-center space-x-2">
              <AlertCircle size={14} />
              <span>Backend circuit breaker is open.</span>
            </div>
            <button
              onClick={() => {
                api
                  .resetCircuitBreaker(activeBackend)
                  .catch((e) => console.error("Reset failed", e));
              }}
              className="text-[10px] underline uppercase tracking-widest font-bold hover:text-red-800"
            >
              Try Reset
            </button>
          </div>
        )}

        <div className="max-w-[34rem] mx-auto relative group">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isCircuitOpen || isRunning}
            className="w-full bg-white border border-iota-border rounded-xl px-4 py-3 pr-24 focus:outline-none focus:ring-2 focus:ring-iota-accent/20 focus:border-iota-accent min-h-[80px] max-h-[300px] resize-none transition-all duration-200 shadow-sm group-hover:shadow-md text-sm disabled:opacity-50 disabled:bg-gray-50"
            placeholder={
              isCircuitOpen
                ? "Backend unavailable..."
                : isRunning
                  ? "Waiting for engine..."
                  : "Type your prompt here..."
            }
          ></textarea>

          <div className="absolute bottom-3 right-3 flex items-center space-x-2">
            {isRunning && (
              <button
                onClick={handleInterrupt}
                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                title="Interrupt Execution"
              >
                <StopCircle size={20} />
              </button>
            )}
            <button
              onClick={handleSend}
              disabled={!input.trim() || isCircuitOpen || isRunning}
              className="p-2 bg-iota-accent text-white rounded-lg hover:bg-iota-accent/90 transition-all duration-200 transform hover:scale-105 shadow-lg shadow-iota-accent/20 disabled:opacity-30 disabled:transform-none disabled:shadow-none"
            >
              <Send size={18} />
            </button>
          </div>
        </div>

        <div className="max-w-[34rem] mx-auto mt-2 flex items-center justify-between text-[10px] text-iota-text/40 uppercase tracking-widest font-bold px-1">
          <div className="flex items-center space-x-3">
            <span>⏎ send</span>
            <span>⇧⏎ newline</span>
          </div>
          <span className="flex items-center truncate max-w-[200px]">
            <Terminal size={10} className="mr-1" />
            {workingDirectory}
          </span>
        </div>
      </div>
    </div>
  );
};

type ToolCallView = {
  name: string;
  arguments?: Record<string, unknown>;
};

type AssistantResponseView = {
  thinking: string;
  result: string;
  final?: boolean;
};

function getMetadata(item: ConversationTimelineItem | undefined) {
  return item?.metadata as Record<string, unknown> | undefined;
}

function getToolCall(item: ConversationTimelineItem): ToolCallView | undefined {
  return getMetadata(item)?.toolCall as ToolCallView | undefined;
}

function getAssistantResponse(
  item: ConversationTimelineItem | undefined,
): AssistantResponseView | undefined {
  return getMetadata(item)?.assistantResponse as
    | AssistantResponseView
    | undefined;
}

function isAssistantResponseItem(item: ConversationTimelineItem): boolean {
  if (item.role !== "assistant") return false;
  const metadata = getMetadata(item);
  if (metadata?.approval || metadata?.toolCall) return false;
  return true;
}

function buildAssistantResponse(
  item: ConversationTimelineItem,
): AssistantResponseView {
  const metadata = getMetadata(item);
  if (metadata?.thinking) {
    return { thinking: item.content.trim(), result: "" };
  }

  const parsed = parseAssistantContent(item.content);
  return {
    thinking: parsed.thinking,
    result: parsed.result,
    final: Boolean(metadata?.final),
  };
}

function parseAssistantContent(content: string): AssistantResponseView {
  let thinking = "";
  let result = content;

  const appendThinking = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) thinking = appendText(thinking, trimmed);
  };

  result = result.replace(
    /<think>([\s\S]*?)(?:<\/think>|$)/gi,
    (_full, body) => {
      appendThinking(String(body));
      return "";
    },
  );

  result = result.replace(
    /<details>([\s\S]*?)(?:<\/details>|$)/gi,
    (_full, body) => {
      const details = String(body).replace(
        /<summary>([\s\S]*?)<\/summary>/gi,
        "**$1**\n\n",
      );
      appendThinking(details);
      return "";
    },
  );

  return {
    thinking: thinking.trim(),
    result: stripAssistantResultDecorators(result).trim(),
  };
}

function stripAssistantResultDecorators(value: string): string {
  return value
    .replace(/^\s*(?:#{1,6}\s*)?(?:最终结果|final result)\s*[:：-]?\s*/i, "")
    .replace(/^\s*Model Information\s*$/i, "")
    .trim();
}

function appendText(
  current: string | undefined,
  next: string | undefined,
): string {
  const left = current?.trim() ?? "";
  const right = next?.trim() ?? "";
  if (!left) return right;
  if (!right) return left;
  return `${left}\n\n${right}`;
}
const MarkdownContent: React.FC<{ content: string }> = ({ content }) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    rehypePlugins={[rehypeRaw]}
    components={{
      code({
        inline,
        className,
        children,
        ...props
      }: {
        inline?: boolean;
        className?: string;
        children?: React.ReactNode;
      }) {
        const match = /language-(\w+)/.exec(className || "");
        return !inline && match ? (
          <div className="my-4 rounded-lg overflow-hidden border border-white/10 shadow-lg bg-gray-900">
            <div className="bg-gray-800 px-4 py-1.5 flex justify-between items-center">
              <span className="text-[10px] font-bold text-gray-400 uppercase">
                {match[1]}
              </span>
            </div>
            <SyntaxHighlighter
              style={oneDark}
              language={match[1]}
              PreTag="div"
              customStyle={{
                margin: 0,
                padding: "1rem",
                fontSize: "12px",
                background: "transparent",
              }}
              {...props}
            >
              {String(children).replace(/\n$/, "")}
            </SyntaxHighlighter>
          </div>
        ) : (
          <code
            className="bg-black/10 px-1.5 py-0.5 rounded font-mono text-[0.9em]"
            {...props}
          >
            {children}
          </code>
        );
      },
      p: ({ children }) => (
        <p className="mb-4 last:mb-0 leading-relaxed">{children}</p>
      ),
    }}
  >
    {content}
  </ReactMarkdown>
);
const MessageItem: React.FC<{
  item: ConversationTimelineItem;
  onApprove: (id: string, approved: boolean) => void;
}> = ({ item, onApprove }) => {
  const isUser = item.role === "user";
  const isTool = item.role === "tool";
  const metadata = getMetadata(item);
  const isThinking = Boolean(metadata?.thinking);
  const rawToolCall = getToolCall(item);
  const toolCall = shouldShowToolCall(rawToolCall) ? rawToolCall : undefined;
  const approval = metadata?.approval as ApprovalRequest | undefined;
  const isDecisionOnly =
    !!approval?.status &&
    !approval?.command &&
    !approval?.path &&
    !approval?.reason;

  const assistantResponse = getAssistantResponse(item);
  const thinkingContent = isThinking
    ? item.content
    : (assistantResponse?.thinking ?? "");
  const resultContent = assistantResponse?.result ?? item.content;

  return (
    <div
      className={`flex gap-3 max-w-[34rem] mx-auto ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm border ${
          isUser
            ? "bg-white text-iota-text border-gray-200"
            : isTool
              ? "bg-amber-50 text-amber-600 border-amber-100"
              : isThinking
                ? "bg-purple-50 text-purple-500 border-purple-100"
                : "bg-iota-accent text-white border-iota-accent"
        }`}
      >
        {isUser ? (
          <User size={16} />
        ) : isTool ? (
          <Wrench size={16} />
        ) : isThinking ? (
          <Settings2 size={16} />
        ) : (
          <Bot size={16} />
        )}
      </div>

      <div
        className={`flex flex-col min-w-0 ${isUser ? "items-end" : "items-start"}`}
      >
        <div
          className={`max-w-full rounded-xl px-4 py-3 shadow-sm border ${
            isUser
              ? "bg-iota-accent text-white border-iota-accent"
              : isThinking
                ? "bg-purple-50/50 border-purple-100 text-purple-700 italic"
                : toolCall
                  ? "bg-amber-50/50 border-amber-100 text-amber-800"
                  : "bg-gray-50/50 border-iota-border text-iota-text"
          }`}
        >
          {isThinking && (
            <div className="text-[10px] font-bold uppercase tracking-wider text-purple-400 mb-1">
              Thinking
            </div>
          )}
          {toolCall ? (
            <div className="text-sm">
              <div className="flex items-center space-x-2 mb-1">
                <Wrench size={12} />
                <span className="font-mono font-bold text-xs">
                  {toolCall.name}
                </span>
              </div>
              {toolCall.arguments &&
                Object.keys(toolCall.arguments).length > 0 && (
                  <pre className="text-[11px] bg-black/5 rounded p-2 mt-1 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(toolCall.arguments, null, 2)}
                  </pre>
                )}
            </div>
          ) : approval && !isDecisionOnly ? (
            <ApprovalCard approval={approval} onApprove={onApprove} />
          ) : (
            <div className="flex flex-col gap-3 min-w-[16rem] max-w-[30rem]">
              {/* Extracted Thinking Area */}
              {thinkingContent && (
                <section className="border-l-2 border-purple-200 pl-3 py-1 text-purple-800">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-purple-400 mb-1.5 flex items-center">
                    <Settings2 size={12} className="mr-1" />
                    思考区
                  </div>
                  <div className="markdown-content text-xs leading-relaxed opacity-85 italic">
                    <MarkdownContent content={thinkingContent} />
                  </div>
                </section>
              )}

              {/* Final Result Area */}
              {resultContent && (
                <section className="markdown-content text-sm leading-relaxed overflow-hidden">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-iota-accent mb-1.5 flex items-center">
                    <Bot size={12} className="mr-1" />
                    最终结果
                  </div>
                  <MarkdownContent content={resultContent} />
                </section>
              )}
            </div>
          )}
        </div>
        <div className="text-[10px] mt-1 text-iota-text/40 font-bold tracking-wider px-1">
          {new Date(item.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
};

function shouldShowToolCall(
  toolCall: { name: string; arguments?: Record<string, unknown> } | undefined,
): boolean {
  if (!toolCall) return false;
  if (toolCall.name !== "unknown") return true;
  return Object.keys(toolCall.arguments ?? {}).length > 0;
}
const ApprovalCard: React.FC<{
  approval: ApprovalRequest;
  onApprove: (id: string, approved: boolean) => void;
}> = ({ approval, onApprove }) => {
  const [localDecision, setLocalDecision] = useState<{
    id: string;
    decision: "approved" | "denied";
  } | null>(null);
  const decision =
    localDecision?.id === approval.id
      ? localDecision.decision
      : approval.status || null;

  const handleAction = (approved: boolean) => {
    setLocalDecision({
      id: approval.id,
      decision: approved ? "approved" : "denied",
    });
    onApprove(approval.id, approved);
  };

  const isRedacted = (val?: string) =>
    val === "[REDACTED]" || val === "SECRET REDACTED";

  return (
    <div className="w-80 space-y-4">
      <div className="flex items-center space-x-2 text-iota-heading font-bold">
        <ShieldCheck size={20} className="text-amber-500" />
        <span className="text-sm uppercase tracking-tight">
          Security Approval Required
        </span>
      </div>

      <div className="bg-white/50 rounded-lg p-3 border border-amber-100 space-y-2">
        <div className="text-[10px] font-bold text-iota-text/40 uppercase">
          Action Type
        </div>
        <div className="text-xs font-mono font-bold text-amber-700 bg-amber-50 px-2 py-1 rounded inline-block">
          {approval.type}
        </div>

        {approval.command && (
          <>
            <div className="text-[10px] font-bold text-iota-text/40 uppercase mt-3">
              Command
            </div>
            <code
              className={`block p-2 rounded text-[10px] font-mono whitespace-pre-wrap ${
                isRedacted(approval.command)
                  ? "bg-amber-50 text-amber-700 italic"
                  : "bg-gray-900 text-gray-100"
              }`}
            >
              {approval.command}
            </code>
          </>
        )}

        {approval.path && (
          <>
            <div className="text-[10px] font-bold text-iota-text/40 uppercase mt-3">
              Path
            </div>
            <code
              className={`block p-2 rounded text-[10px] font-mono ${
                isRedacted(approval.path)
                  ? "bg-amber-50 text-amber-700 italic"
                  : "bg-gray-100 text-gray-100"
              }`}
            >
              {approval.path}
            </code>
          </>
        )}
      </div>

      <div className="flex space-x-2">
        {decision ? (
          <div
            className={`flex-1 py-2 rounded-lg flex items-center justify-center space-x-2 font-bold text-sm ${
              decision === "approved"
                ? "bg-green-100 text-green-700"
                : "bg-red-100 text-red-700"
            }`}
          >
            {decision === "approved" ? (
              <CheckCircle size={16} />
            ) : (
              <XCircle size={16} />
            )}
            <span>{decision === "approved" ? "Approved" : "Denied"}</span>
          </div>
        ) : (
          <>
            <button
              onClick={() => handleAction(false)}
              className="flex-1 py-2 bg-white border border-red-200 text-red-600 rounded-lg text-sm font-bold hover:bg-red-50"
            >
              Deny
            </button>
            <button
              onClick={() => handleAction(true)}
              className="flex-1 py-2 bg-iota-accent text-white rounded-lg text-sm font-bold hover:bg-iota-accent/90 shadow-lg"
            >
              Approve
            </button>
          </>
        )}
      </div>
    </div>
  );
};
