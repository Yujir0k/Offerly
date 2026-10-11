export type ChatMessage = {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
  sender: string;
  clientId?: string;
  task?: import("./conversation-types").EmployerTask;
};
export type Conversation = {
  demonstration?: boolean;
  id: string;
  name: string;
  subtitle: string;
  avatar: string | null;
  grade: string | null;
  updatedAt: string;
  unread: number;
  lastMessage: string;
  canWrite: boolean;
  context: { title: string; kind: "invitation" | "application" }[];
};
export type ChatThread = {
  conversation: Conversation;
  messages: ChatMessage[];
  hasOlder: boolean;
  otherReadThrough: string;
};
