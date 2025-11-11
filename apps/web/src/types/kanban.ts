export type KanbanItem = {
  id: string;
  content: string;
  pos: number;
  done?: boolean;
  tagLabel?: string | null;
  tagColor?: string | null;
};

export type KanbanList = {
  id: string;
  name: string;
  pos: number;
  items: KanbanItem[];
};

export type KanbanTag = {
  id: string;
  label: string;
  color?: string | null;
  pos?: number;
};
