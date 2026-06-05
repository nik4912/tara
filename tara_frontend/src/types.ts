export type MessageRole = 'user' | 'tara' | 'error';

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  timestamp: Date;
}
