"use client";

import React, { useMemo } from "react";
import DOMPurify from "isomorphic-dompurify";

interface RichPolicyRendererProps {
  content: string;
  className?: string;
}

const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "strong",
    "em",
    "u",
    "del",
    "ul",
    "ol",
    "li",
    "blockquote",
    "hr",
    "br",
    "a",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  ALLOWED_ATTR: [
    "href",
    "name",
    "target",
    "rel",
    "colspan",
    "rowspan",
    "align",
  ],
  ALLOWED_URI_REGEXP:
    /^(?:(?:(?:f|ht)tps?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
};

export const RichPolicyRenderer: React.FC<RichPolicyRendererProps> = ({
  content,
  className = "",
}) => {
  if (!content) {
    return (
      <p className="text-slate-400 text-xs italic">
        No document content provided.
      </p>
    );
  }

  // If content contains HTML tags from the visual WYSIWYG editor, render safely with DOMPurify
  const isHtml =
    /<\/?(h[1-6]|p|div|ul|ol|li|blockquote|table|strong|em|u|del|a|hr|br)[^>]*>/i.test(
      content,
    );

  const cleanHtml = useMemo(() => {
    if (!isHtml) return "";
    return DOMPurify.sanitize(content, DOMPURIFY_CONFIG);
  }, [content, isHtml]);

  if (isHtml) {
    return (
      <div
        className={`prose prose-slate max-w-none prose-headings:font-bold prose-headings:text-slate-900 prose-h1:text-2xl sm:prose-h1:text-3xl prose-h2:text-xl prose-h3:text-base prose-p:text-xs sm:prose-p:text-sm prose-p:leading-relaxed prose-li:text-xs sm:prose-li:text-sm prose-a:text-[#23055c] prose-a:font-bold prose-blockquote:border-l-4 prose-blockquote:border-[#23055c] prose-blockquote:bg-purple-50/50 prose-blockquote:rounded-r-xl prose-blockquote:py-1 prose-blockquote:pl-4 ${className}`}
        dangerouslySetInnerHTML={{ __html: cleanHtml }}
      />
    );
  }

  // Parse markdown into blocks
  const parseBlocks = (text: string) => {
    const lines = text.split("\n");
    const blocks: React.ReactNode[] = [];
    let i = 0;

    const renderInline = (str: string): React.ReactNode[] => {
      // Inline parser for bold, italic, code, links, strikethrough
      // Replace tokens with React elements
      const tokens: React.ReactNode[] = [];
      let remaining = str;
      let key = 0;

      while (remaining.length > 0) {
        // Match link [text](url)
        const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
        if (linkMatch) {
          tokens.push(
            <a
              key={key++}
              href={linkMatch[2]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#23055c] underline font-bold hover:text-purple-800"
            >
              {linkMatch[1]}
            </a>,
          );
          remaining = remaining.slice(linkMatch[0].length);
          continue;
        }

        // Match bold **text** or __text__
        const boldMatch = remaining.match(/^(\*\*|__)(.*?)\1/);
        if (boldMatch) {
          tokens.push(
            <strong key={key++} className="font-bold text-slate-900">
              {renderInline(boldMatch[2])}
            </strong>,
          );
          remaining = remaining.slice(boldMatch[0].length);
          continue;
        }

        // Match italic *text* or _text_
        const italicMatch = remaining.match(/^(\*|_)(.*?)\1/);
        if (
          italicMatch &&
          !remaining.startsWith("**") &&
          !remaining.startsWith("__")
        ) {
          tokens.push(
            <em key={key++} className="italic text-slate-800">
              {renderInline(italicMatch[2])}
            </em>,
          );
          remaining = remaining.slice(italicMatch[0].length);
          continue;
        }

        // Match strikethrough ~~text~~
        const strikeMatch = remaining.match(/^~~(.*?)~~/);
        if (strikeMatch) {
          tokens.push(
            <del key={key++} className="line-through text-slate-400">
              {renderInline(strikeMatch[1])}
            </del>,
          );
          remaining = remaining.slice(strikeMatch[0].length);
          continue;
        }

        // Match inline code `code`
        const codeMatch = remaining.match(/^`([^`]+)`/);
        if (codeMatch) {
          tokens.push(
            <code
              key={key++}
              className="px-1.5 py-0.5 rounded bg-slate-100 text-purple-900 font-mono text-[11px] border border-slate-200"
            >
              {codeMatch[1]}
            </code>,
          );
          remaining = remaining.slice(codeMatch[0].length);
          continue;
        }

        // Normal text up to the next potential delimiter
        const nextSpecial = remaining.search(/(\*\*|__|\*|_|~~|`|\[)/);
        if (nextSpecial === -1) {
          tokens.push(remaining);
          break;
        } else if (nextSpecial === 0) {
          // If special character did not match rules, consume one char
          tokens.push(remaining[0]);
          remaining = remaining.slice(1);
        } else {
          tokens.push(remaining.slice(0, nextSpecial));
          remaining = remaining.slice(nextSpecial);
        }
      }

      return tokens;
    };

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Empty line
      if (!trimmed) {
        i++;
        continue;
      }

      // Horizontal Rule: --- or ***
      if (/^(\-{3,}|\*{3,})$/.test(trimmed)) {
        blocks.push(
          <hr key={`hr-${i}`} className="my-6 border-t border-slate-200" />,
        );
        i++;
        continue;
      }

      // Heading 1: #
      if (trimmed.startsWith("# ")) {
        blocks.push(
          <h1
            key={`h1-${i}`}
            className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mt-6 mb-3 pb-2 border-b border-slate-100"
          >
            {renderInline(trimmed.slice(2))}
          </h1>,
        );
        i++;
        continue;
      }

      // Heading 2: ##
      if (trimmed.startsWith("## ")) {
        blocks.push(
          <h2
            key={`h2-${i}`}
            className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight mt-5 mb-2.5"
          >
            {renderInline(trimmed.slice(3))}
          </h2>,
        );
        i++;
        continue;
      }

      // Heading 3: ###
      if (trimmed.startsWith("### ")) {
        blocks.push(
          <h3
            key={`h3-${i}`}
            className="text-sm sm:text-base font-bold text-slate-800 tracking-tight mt-4 mb-2"
          >
            {renderInline(trimmed.slice(4))}
          </h3>,
        );
        i++;
        continue;
      }

      // Blockquote / Alert: >
      if (trimmed.startsWith(">")) {
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith(">")) {
          quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
          i++;
        }
        const isAlert = quoteLines[0]?.startsWith("[!");
        let alertType = "NOTE";
        let cleanLines = quoteLines;
        if (isAlert) {
          const match = quoteLines[0].match(/^\[!([A-Z]+)\]/);
          if (match) {
            alertType = match[1];
            cleanLines = [
              quoteLines[0].replace(/^\[![A-Z]+\]\s?/, ""),
              ...quoteLines.slice(1),
            ].filter(Boolean);
          }
        }

        blocks.push(
          <blockquote
            key={`quote-${i}`}
            className={`my-4 pl-4 py-2 border-l-4 rounded-r-xl text-xs sm:text-sm leading-relaxed ${
              alertType === "IMPORTANT" || alertType === "WARNING"
                ? "border-amber-500 bg-amber-50/70 text-amber-900"
                : alertType === "CAUTION"
                  ? "border-rose-500 bg-rose-50/70 text-rose-900"
                  : "border-[#23055c] bg-purple-50/50 text-slate-700"
            }`}
          >
            {cleanLines.map((ql, qIdx) => (
              <p key={qIdx} className={qIdx > 0 ? "mt-1" : ""}>
                {renderInline(ql)}
              </p>
            ))}
          </blockquote>,
        );
        continue;
      }

      // Unordered List: - or *
      if (/^[-*]\s+/.test(trimmed)) {
        const listItems: string[] = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
          listItems.push(lines[i].trim().replace(/^[-*]\s+/, ""));
          i++;
        }
        blocks.push(
          <ul
            key={`ul-${i}`}
            className="my-3 space-y-1.5 pl-5 list-disc text-xs sm:text-sm text-slate-700 leading-relaxed"
          >
            {listItems.map((item, itemIdx) => (
              <li key={itemIdx}>{renderInline(item)}</li>
            ))}
          </ul>,
        );
        continue;
      }

      // Ordered List: 1. 2. ...
      if (/^\d+\.\s+/.test(trimmed)) {
        const listItems: string[] = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          listItems.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
          i++;
        }
        blocks.push(
          <ol
            key={`ol-${i}`}
            className="my-3 space-y-1.5 pl-5 list-decimal text-xs sm:text-sm text-slate-700 leading-relaxed font-medium"
          >
            {listItems.map((item, itemIdx) => (
              <li key={itemIdx}>{renderInline(item)}</li>
            ))}
          </ol>,
        );
        continue;
      }

      // Table: lines containing |
      if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
        const tableLines: string[] = [];
        while (
          i < lines.length &&
          lines[i].trim().startsWith("|") &&
          lines[i].trim().endsWith("|")
        ) {
          tableLines.push(lines[i].trim());
          i++;
        }

        if (tableLines.length >= 2) {
          const headers = tableLines[0]
            .split("|")
            .slice(1, -1)
            .map((c) => c.trim());
          const rows = tableLines
            .slice(2) // skip separator row |---|---|
            .map((row) =>
              row
                .split("|")
                .slice(1, -1)
                .map((c) => c.trim()),
            );

          blocks.push(
            <div
              key={`table-${i}`}
              className="my-4 overflow-x-auto rounded-xl border border-slate-200"
            >
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {headers.map((h, hIdx) => (
                      <th
                        key={hIdx}
                        className="px-3.5 py-2.5 font-bold text-slate-800"
                      >
                        {renderInline(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r, rIdx) => (
                    <tr key={rIdx} className="hover:bg-slate-50/50">
                      {r.map((cell, cIdx) => (
                        <td key={cIdx} className="px-3.5 py-2 text-slate-600">
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>,
          );
          continue;
        }
      }

      // Regular Paragraph
      const paragraphLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !lines[i].trim().startsWith("#") &&
        !lines[i].trim().startsWith(">") &&
        !/^[-*]\s+/.test(lines[i].trim()) &&
        !/^\d+\.\s+/.test(lines[i].trim()) &&
        !lines[i].trim().startsWith("|") &&
        !/^(\-{3,}|\*{3,})$/.test(lines[i].trim())
      ) {
        paragraphLines.push(lines[i].trim());
        i++;
      }

      if (paragraphLines.length > 0) {
        blocks.push(
          <p
            key={`p-${i}`}
            className="my-2.5 text-xs sm:text-sm text-slate-700 leading-relaxed"
          >
            {renderInline(paragraphLines.join(" "))}
          </p>,
        );
      }
    }

    return blocks;
  };

  return <div className={`space-y-1 ${className}`}>{parseBlocks(content)}</div>;
};
