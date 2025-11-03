import { pool } from '../db.js';

export async function listSpaces(userId) {
  const { rows } = await pool.query(
    'SELECT s.id, s.name, s.avatar_url as "avatarUrl" FROM spaces s JOIN space_members m ON m.space_id=s.id WHERE m.user_id=$1 ORDER BY s.name',
    [userId]
  );
  return rows;
}

export async function listChannels(spaceId) {
  const { rows } = await pool.query('SELECT id, name, COALESCE(type,\'text\') as type FROM channels WHERE space_id=$1 ORDER BY name', [spaceId]);
  return rows.map(r => ({ id: r.id, name: r.name, type: r.type, voidId: spaceId }));
}

export async function getKanbanState(channelId) {
  const { rows: lists } = await pool.query('SELECT id, name, pos FROM kanban_lists WHERE channel_id=$1 ORDER BY pos ASC, created_at ASC', [channelId]);
  const ids = lists.map(l => l.id);
  const itemsMap = new Map();
  if (ids.length > 0) {
    const { rows: items } = await pool.query('SELECT id, list_id, content, pos, done FROM kanban_items WHERE list_id = ANY($1::uuid[]) ORDER BY pos ASC, created_at ASC', [ids]);
    for (const it of items) {
      if (!itemsMap.has(it.list_id)) itemsMap.set(it.list_id, []);
      itemsMap.get(it.list_id).push({ id: it.id, content: it.content, pos: it.pos, done: !!it.done });
    }
  }
  return lists.map(l => ({ id: l.id, name: l.name, pos: l.pos, items: (itemsMap.get(l.id) || []) }));
}

export async function getFormQuestions(channelId) {
  const { rows } = await pool.query('SELECT id, prompt, kind, pos FROM form_questions WHERE channel_id=$1 ORDER BY pos ASC, created_at ASC', [channelId]);
  return rows.map(r => ({ id: r.id, prompt: r.prompt, kind: r.kind || 'text', pos: r.pos }));
}

export async function getBacklog(channelId, userId, limit = 50) {
  const { rows } = await pool.query(
    `SELECT m.id, m.content, m.created_at, m.updated_at, m.author_id, u.name as author_name, u.name_color as author_color
     FROM messages m
     JOIN users u ON u.id = m.author_id
     WHERE m.channel_id = $1
     ORDER BY m.created_at ASC
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
  return rows.map(r => ({
    id: r.id,
    content: r.content,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    authorId: r.author_id,
    authorName: r.author_name,
    authorColor: r.author_color,
    reactions: reactionMap.get(r.id) || {},
    seenByIds: readsMap.get(r.id) || [],
  }));
}

