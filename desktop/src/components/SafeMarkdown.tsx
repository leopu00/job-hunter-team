import { Fragment, type CSSProperties, type ReactNode } from "react";
import type { Block, Inline, ParsedMarkdown } from "../lib/safe-markdown";

/**
 * A parsed document as React text nodes. Everything the document says reaches the page as the CHILD TEXT of a plain
 * element: no HTML string is ever built, no attribute carries the document's words, no element has a `src` or an
 * `href`. A link is its label and its address shown as text; an image was already reduced to its alternative text.
 */
function renderInline(list: Inline[]): ReactNode {
  return list.map((node, index) => {
    switch (node.kind) {
      case "text":
        return <Fragment key={index}>{node.text}</Fragment>;
      case "strong":
        return <strong key={index}>{renderInline(node.children)}</strong>;
      case "emphasis":
        return <em key={index}>{renderInline(node.children)}</em>;
      case "code":
        return <code key={index}>{node.text}</code>;
      case "link":
        return (
          <span key={index} className="docmd__link">
            {renderInline(node.label)}
            {node.address && <span className="docmd__address"> ({node.address})</span>}
          </span>
        );
    }
  });
}

function levelOf(level: number): CSSProperties {
  return { "--level": level } as CSSProperties;
}

function renderBlocks(blocks: Block[]): ReactNode[] {
  const out: ReactNode[] = [];
  let run: Extract<Block, { kind: "item" }>[] = [];
  const flushList = (key: number) => {
    if (run.length === 0) return;
    const ordered = run[0].ordered;
    const items = run.map((item, i) => (
      <li key={i} style={levelOf(item.level)} data-marker={item.ordered ? item.marker : undefined}>
        {renderInline(item.children)}
      </li>
    ));
    out.push(ordered ? <ol key={`l${key}`} className="docmd__list docmd__list--ordered">{items}</ol> : <ul key={`l${key}`} className="docmd__list">{items}</ul>);
    run = [];
  };
  blocks.forEach((block, index) => {
    if (block.kind === "item") {
      if (run.length > 0 && run[0].ordered !== block.ordered) flushList(index);
      run.push(block);
      return;
    }
    flushList(index);
    switch (block.kind) {
      case "heading": {
        const Tag = (`h${Math.min(block.level + 2, 6)}`) as "h3" | "h4" | "h5" | "h6";
        out.push(<Tag key={index} className={`docmd__heading docmd__heading--${block.level}`}>{renderInline(block.children)}</Tag>);
        break;
      }
      case "paragraph":
        out.push(<p key={index}>{renderInline(block.children)}</p>);
        break;
      case "quote":
        out.push(<blockquote key={index} style={levelOf(block.level)}>{renderInline(block.children)}</blockquote>);
        break;
      case "code":
        out.push(<pre key={index}><code>{block.lines.join("\n")}</code></pre>);
        break;
      case "rule":
        out.push(<hr key={index} />);
        break;
    }
  });
  flushList(blocks.length);
  return out;
}

export default function SafeMarkdown({ parsed }: { parsed: ParsedMarkdown }) {
  return <div className="docmd">{renderBlocks(parsed.blocks)}</div>;
}
