import { AgentSession, SessionExport } from './types';

export type RuntimeMessage =
  | { type: 'GET_SESSION' }
  | { type: 'START_SESSION' }
  | { type: 'BEGIN_NOTE_CAPTURE'; payload?: { tabId?: number; url?: string; title?: string } }
  | { type: 'NEXT_NOTE_CAPTURE_SOURCE' }
  | { type: 'COMMIT_NOTE_BLOCK'; payload?: { id?: string; committedText?: string; sourceUrl?: string; sourceTitle?: string } }
  | { type: 'OPEN_NOTE_REVISION'; payload?: { id?: string } }
  | { type: 'DELETE_NOTE_BLOCK'; payload?: { id?: string } }
  | { type: 'ADD_RANK_CANDIDATE'; payload?: { url?: string; title?: string } }
  | { type: 'REMOVE_RANK_CANDIDATE'; payload?: { id?: string } }
  | { type: 'REORDER_RANK_CANDIDATES'; payload?: { orderedIds?: string[] } }
  | { type: 'FINALIZE_RANK_CANDIDATES' }
  | { type: 'ENTER_DELIVERABLE' }
  | { type: 'COMMIT_DRAFT'; payload?: { committedText?: string } }
  | { type: 'PAUSE_SESSION' }
  | { type: 'RESUME_SESSION' }
  | { type: 'ABORT_SESSION' }
  | { type: 'COMPLETE_SESSION' }
  | { type: 'EXPAND_CONTEXT' }
  | { type: 'CONTENT_STATUS'; payload?: { tabId?: number; url?: string; title?: string } };

export type BroadcastMessage =
  | { type: 'SESSION_UPDATED'; session: AgentSession }
  | { type: 'SHOW_SIDE_TOAST'; message: string; variant?: 'default' | 'success' | 'error' };

export type RuntimeResponse = {
  ok: boolean;
  error?: string;
  session?: AgentSession;
  export?: SessionExport;
  noteId?: string;
};
