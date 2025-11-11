import { pool } from '../db.js';

export async function listSpaces(userId) {
  const { rows } = await pool.query(
    'SELECT s.id, s.name, s.avatar_url as "avatarUrl", s.home_channel_id as "homeChannelId" FROM spaces s JOIN space_members m ON m.space_id=s.id WHERE m.user_id=$1 ORDER BY s.name',
    [userId]
  );
  return rows;
}

export async function listChannels(spaceId) {
  const { rows } = await pool.query("SELECT id, name, COALESCE(type,'text') as type, linked_gallery_id FROM channels WHERE space_id=$1 ORDER BY name", [spaceId]);
  return rows.map(r => ({ id: r.id, name: r.name, type: r.type, linkedGalleryId: r.linked_gallery_id || null, voidId: spaceId, spaceId }));
}

export async function getKanbanState(channelId) {
  const { rows: lists } = await pool.query('SELECT id, name, pos FROM kanban_lists WHERE channel_id=$1 ORDER BY pos ASC, created_at ASC', [channelId]);
  const ids = lists.map(l => l.id);
  const itemsMap = new Map();
  if (ids.length > 0) {
    const { rows: items } = await pool.query(
      'SELECT id, list_id, content, pos, done, tag_label, tag_color FROM kanban_items WHERE list_id = ANY($1::uuid[]) ORDER BY pos ASC, created_at ASC',
      [ids]
    );
    for (const it of items) {
      if (!itemsMap.has(it.list_id)) itemsMap.set(it.list_id, []);
      itemsMap.get(it.list_id).push({
        id: it.id,
        content: it.content,
        pos: it.pos,
        done: !!it.done,
        tagLabel: it.tag_label || null,
        tagColor: it.tag_color || null,
      });
    }
  }
  const { rows: tags } = await pool.query(
    'SELECT id, label, color, pos FROM kanban_channel_tags WHERE channel_id=$1 ORDER BY pos ASC, created_at ASC',
    [channelId]
  );
  return {
    lists: lists.map(l => ({ id: l.id, name: l.name, pos: l.pos, items: (itemsMap.get(l.id) || []) })),
    tags: tags.map(t => ({ id: t.id, label: t.label, color: t.color || null, pos: t.pos })),
  };
}

export async function getFormQuestions(channelId) {
  const { rows } = await pool.query('SELECT id, prompt, kind, pos, locked FROM form_questions WHERE channel_id=$1 ORDER BY pos ASC, created_at ASC', [channelId]);
  return rows.map(r => ({ id: r.id, prompt: r.prompt, kind: r.kind || 'text', pos: r.pos, locked: !!r.locked }));
}

export async function getBacklog(channelId, userId, limit = 50) {
  // Fetch the most recent messages first, then return them in chronological order
  const { rows } = await pool.query(
    `SELECT m.id, m.content, m.is_spoiler, m.created_at, m.updated_at, m.author_id, m.reply_to, u.name as author_name, u.name_color as author_color
     FROM messages m
     JOIN users u ON u.id = m.author_id
     WHERE m.channel_id = $1
     ORDER BY m.created_at DESC
     LIMIT $2`,
    [channelId, limit]
  );
  const ids = rows.map(r => r.id);
  const reactionMap = new Map();
  if (ids.length > 0) {
    const { rows: rxs } = await pool.query(
      `SELECT message_id, reaction, COUNT(*)::int as count, BOOL_OR(user_id = $2) as mine
       FROM message_reactions
       WHERE message_id = ANY($1::uuid[])
       GROUP BY message_id, reaction`,
      [ids, userId]
    );
    for (const r of rxs) {
      if (!reactionMap.has(r.message_id)) reactionMap.set(r.message_id, {});
      reactionMap.get(r.message_id)[r.reaction] = { count: Number(r.count || 0), mine: !!r.mine };
    }
  }
  const readsMap = new Map();
  // Map for reply previews
  const replyMap = new Map();
  if (ids.length > 0) {
    const { rows: reads } = await pool.query(
      `SELECT message_id, user_id FROM message_reads WHERE message_id = ANY($1::uuid[])`,
      [ids]
    );
    for (const r of reads) {
      if (!readsMap.has(r.message_id)) readsMap.set(r.message_id, []);
      readsMap.get(r.message_id).push(r.user_id);
    }
  }
  // Load attachments for all messages
  const attsMap = new Map();
  if (ids.length > 0) {
    const { rows: atts } = await pool.query(
      `SELECT message_id, url, content_type as "contentType", name, size_bytes as size
       FROM message_attachments
       WHERE message_id = ANY($1::uuid[])`,
      [ids]
    );
    for (const a of atts) {
      if (!attsMap.has(a.message_id)) attsMap.set(a.message_id, []);
      attsMap.get(a.message_id).push({ url: a.url, contentType: a.contentType, name: a.name, size: a.size });
    }
  }
  // Load reply previews
  const replyIds = rows.map(r => r.reply_to).filter(Boolean);
  if (replyIds.length > 0) {
    const { rows: rpre } = await pool.query(
      `SELECT m.id, m.content, m.author_id, u.name as author_name, u.name_color as author_color
       FROM messages m JOIN users u ON u.id=m.author_id
       WHERE m.id = ANY($1::uuid[])`,
      [replyIds]
    );
    for (const r of rpre) replyMap.set(r.id, { id: r.id, authorId: r.author_id, authorName: r.author_name, authorColor: r.author_color, content: r.content });
  }

  const ordered = rows.slice().reverse();
  return ordered.map(r => ({
    id: r.id,
    content: r.content,
    spoiler: !!r.is_spoiler,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    authorId: r.author_id,
    authorName: r.author_name,
    authorColor: r.author_color,
    reactions: reactionMap.get(r.id) || {},
    seenByIds: readsMap.get(r.id) || [],
    replyTo: r.reply_to ? replyMap.get(r.reply_to) || null : null,
    attachments: attsMap.get(r.id) || [],
  }));
}
