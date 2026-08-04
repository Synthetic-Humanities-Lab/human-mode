import { AgentSession, Phase, SessionState, isPdfUrl } from '../shared';

export function shouldBlockPdfNavigation(session: AgentSession | null, url: string): boolean {
  if (!session || session.sessionState !== SessionState.ACTIVE) return false;
  if (session.phase !== Phase.RETRIEVAL && session.phase !== Phase.INSPECTION) return false;
  return isPdfUrl(url);
}
