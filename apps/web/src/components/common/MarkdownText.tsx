import React, { useMemo } from 'react';

type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; lang?: string; text: string }
  | { type: 'blockquote'; text: string }
  | { type: 'hr' };

interface MarkdownTextProps {
  content?: string | null;
  className?: string;
}

const INLINE_PATTERN =
  /(\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|`([^`]+)`|\[(.+?)\]\((https?:\/\/[^\s)]+)\)|\*(?!\*)(.+?)\*(?!\*)|_(?!_)(.+?)_(?!_)|!\[(.*?)\]\((https?:\/\/[^\s)]+)\))/g;

const URL_PATTERN = /(https?:\/\/[^\s<]+)(?=$|\s)/gi;

export default function MarkdownText({ content, className }: MarkdownTextProps) {
  const value = typeof content === 'string' ? content.trim() : '';
  const blocks = useMemo(() => parseMarkdown(value), [value]);
  if (!value) return null;
  return (
    <div className={['markdown-bio', className].filter(Boolean).join(' ')}>
      {blocks.map((block, idx) => renderBlock(block, idx))}
    </div>
  );
}

function parseMarkdown(input: string): Block[] {
  const lines = input.replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: { lang?: string; lines: string[] } | null = null;
  let blockquote: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list && list.items.length) {
      blocks.push({ type: 'list', ordered: list.ordered, items: [...list.items] });
    }
    list = null;
  };
  const flushBlockquote = () => {
    if (blockquote && blockquote.length) {
      blocks.push({ type: 'blockquote', text: blockquote.join('\n') });
    }
    blockquote = null;
  };
  const flushCode = () => {
    if (code) {
      blocks.push({ type: 'code', lang: code.lang, text: code.lines.join('\n') });
    }
    code = null;
  };

  lines.forEach((rawLine) => {
    const line = rawLine.replace(/\s+$/, '');
    if (code) {
      if (line.startsWith('```')) {
        flushCode();
      } else {
        code.lines.push(rawLine);
      }
      return;
    }

    if (line.startsWith('```')) {
      flushParagraph();
      flushList();
      flushBlockquote();
      code = { lang: line.slice(3).trim() || undefined, lines: [] };
      return;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushBlockquote();
      return;
    }

    if (/^[-*_]{3,}$/.test(line.trim())) {
      flushParagraph();
      flushList();
      flushBlockquote();
      blocks.push({ type: 'hr' });
      return;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      flushBlockquote();
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2].trim() });
      return;
    }

    const listMatch = line.match(/^\s*([*+-]|\d+[.)])\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      flushBlockquote();
      const ordered = /^\d/.test(listMatch[1]);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(listMatch[2].trim());
      return;
    }

    const quoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      if (!blockquote) blockquote = [];
      blockquote.push(quoteMatch[1]);
      return;
    }

    if (!paragraph.length) paragraph.push(line.trim());
    else paragraph.push(line.trim());
  });

  flushCode();
  flushParagraph();
  flushList();
  flushBlockquote();

  return blocks;
}

function renderBlock(block: Block, key: number): React.ReactNode {
  switch (block.type) {
    case 'paragraph':
      return (
        <p key={key}>
          {renderInline(block.text, `p-${key}`)}
        </p>
      );
    case 'heading': {
      const level = Math.min(6, Math.max(1, block.level));
      const HeadingTag = `h${level}` as keyof JSX.IntrinsicElements;
      const base =
        level === 1
          ? 'text-xl font-semibold'
          : level === 2
            ? 'text-lg font-semibold'
            : 'text-base font-semibold';
      return (
        <HeadingTag key={key} className={base}>
          {renderInline(block.text, `h-${key}`)}
        </HeadingTag>
      );
    }
    case 'list': {
      const ListTag = (block.ordered ? 'ol' : 'ul') as keyof JSX.IntrinsicElements;
      return (
        <ListTag key={key}>
          {block.items.map((item, idx) => (
            <li key={`${key}-${idx}`}>{renderInline(item, `li-${key}-${idx}`)}</li>
          ))}
        </ListTag>
      );
    }
    case 'code':
      return (
        <pre key={key} className="markdown-code-block">
          <code>{block.text}</code>
        </pre>
      );
    case 'blockquote':
      return (
        <blockquote key={key}>
          {renderInline(block.text, `quote-${key}`)}
        </blockquote>
      );
    case 'hr':
      return <hr key={key} className="markdown-divider" />;
    default:
      return null;
  }
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = new RegExp(INLINE_PATTERN.source, 'g');
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let localKey = 0;
  const makeKey = () => `${keyPrefix}-${localKey++}`;

  const pushText = (segment: string) => {
    if (!segment) return;
    nodes.push(...linkify(segment, makeKey));
  };

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      pushText(text.slice(lastIndex, match.index));
    }

    if (match[2] || match[3]) {
      nodes.push(
        <strong key={makeKey()}>{renderInline(match[2] || match[3], `${keyPrefix}-b${localKey}`)}</strong>
      );
    } else if (match[4]) {
      nodes.push(
        <span key={makeKey()} className="line-through">
          {renderInline(match[4], `${keyPrefix}-s${localKey}`)}
        </span>
      );
    } else if (match[5]) {
      nodes.push(
        <code key={makeKey()} className="markdown-inline-code">
          {match[5]}
        </code>
      );
    } else if (match[6] && match[7]) {
      nodes.push(
        <a key={makeKey()} href={match[7]} target="_blank" rel="noreferrer">
          {match[6]}
        </a>
      );
    } else if (match[8]) {
      nodes.push(
        <em key={makeKey()}>{renderInline(match[8], `${keyPrefix}-i${localKey}`)}</em>
      );
    } else if (match[9]) {
      nodes.push(
        <em key={makeKey()}>{renderInline(match[9], `${keyPrefix}-u${localKey}`)}</em>
      );
    } else if (match[10] && match[11]) {
      nodes.push(
        <img
          key={makeKey()}
          src={match[11]}
          alt={match[10]}
          className="rounded-md max-h-48"
        />
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    pushText(text.slice(lastIndex));
  }

  return nodes;
}

function linkify(text: string, makeKey: () => string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const urlRegex = new RegExp(URL_PATTERN.source, 'gi');
  urlRegex.lastIndex = 0;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <a key={makeKey()} href={match[0]} target="_blank" rel="noreferrer">
        {match[0]}
      </a>
    );
    lastIndex = urlRegex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}
