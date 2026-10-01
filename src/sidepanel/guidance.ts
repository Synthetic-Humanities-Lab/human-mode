import { escapeHtml, makeId, parseCustomTaskBank, parseTaskBankSettings, RuntimeMessage, RuntimeResponse, TaskBankItem, TaskBankSettings } from '../shared';
import { tutorialTask } from './copy';
import { triggerDownload } from './export';

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export function initGuidance(beforeOpen: () => void, notify: (text: string, variant: 'success' | 'error') => void): void {
  const settingsDialog = el<HTMLDialogElement>('settingsDialog');
  const settingsForm = el<HTMLFormElement>('settingsForm');
  const taskList = el('customTaskList');
  const settingsMessage = el('settingsMessage');
  let tasks: TaskBankItem[] = [];

  el('openSettingsBtn').addEventListener('click', () => void openSettings());
  el('closeSettingsBtn').addEventListener('click', () => settingsDialog.close());

  el('addCustomTaskBtn').addEventListener('click', () => {
    readTaskFields();
    tasks.push({ id: makeId('custom'), requesterQuestion: '', workOrder: '', searchQuery: '' });
    renderTasks();
    taskList.querySelector<HTMLTextAreaElement>('.custom-task:last-child textarea')?.focus();
  });
  taskList.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-remove-task]');
    if (!button) return;
    readTaskFields();
    tasks.splice(Number(button.dataset.removeTask), 1);
    renderTasks();
    el('addCustomTaskBtn').focus();
  });
  settingsForm.addEventListener('change', event => {
    if ((event.target as HTMLInputElement).name !== 'taskSource') return;
    taskList.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach(field => { field.required = useCustomTasks(); });
    if (useCustomTasks() && !tasks.length) el('addCustomTaskBtn').click();
  });
  settingsForm.addEventListener('submit', async event => {
    event.preventDefault();
    const saveButton = el<HTMLButtonElement>('saveSettingsBtn');
    saveButton.disabled = true;
    try {
      readTaskFields();
      if (!useCustomTasks()) tasks = tasks.filter(task => task.requesterQuestion.trim() || task.workOrder.trim());
      const settings = parseTaskBankSettings({ useCustomTasks: useCustomTasks(), tasks });
      const response = await request({ type: 'SAVE_TASK_BANK_SETTINGS', payload: settings });
      if (!response.ok) throw new Error(response.error || 'Could not save settings');
      settingsDialog.close();
      notify('Settings saved for your next session', 'success');
    } catch (error) {
      settingsMessage.textContent = messageFrom(error);
      settingsMessage.classList.add('error');
    } finally { saveButton.disabled = false; }
  });
  el<HTMLInputElement>('importTaskBank').addEventListener('change', async event => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 1_000_000) throw new Error('Choose a JSON file smaller than 1 MB');
      const imported = parseCustomTaskBank(JSON.parse(await file.text()));
      if (!imported.length) throw new Error('The file contains no tasks');
      readTaskFields();
      const merged = [...tasks.filter(task => task.requesterQuestion.trim() || task.workOrder.trim()), ...imported.map(task => ({ ...task, id: makeId('custom') }))];
      tasks = parseCustomTaskBank(merged);
      el<HTMLInputElement>('customTaskSource').checked = true;
      renderTasks();
      settingsMessage.textContent = `Added ${imported.length} request${imported.length === 1 ? '' : 's'} · Save Settings to use this bank`;
      settingsMessage.classList.remove('error');
    } catch (error) {
      settingsMessage.textContent = messageFrom(error);
      settingsMessage.classList.add('error');
    } finally { input.value = ''; }
  });
  el('downloadTaskTemplateBtn').addEventListener('click', () => {
    triggerDownload(new Blob([JSON.stringify([{ requesterQuestion: tutorialTask.requesterQuestion, workOrder: tutorialTask.workOrder }], null, 2)], { type: 'application/json' }), 'human-mode-task-template.json');
  });

  async function openSettings(): Promise<void> {
    beforeOpen();
    settingsDialog.showModal();
    settingsMessage.textContent = 'Loading your task bank…';
    settingsMessage.classList.remove('error');
    settingsForm.inert = true;
    let loaded = false;
    try {
      const response = await request({ type: 'GET_TASK_BANK_SETTINGS' });
      if (!response.ok || !response.settings) throw new Error(response.error || 'Could not load settings');
      applySettings(response.settings);
      settingsMessage.textContent = '';
      loaded = true;
    } catch (error) {
      settingsMessage.textContent = messageFrom(error);
      settingsMessage.classList.add('error');
    } finally { settingsForm.inert = !loaded; }
  }

  function applySettings(settings: TaskBankSettings): void {
    tasks = settings.tasks.map(task => ({ ...task }));
    settingsForm.querySelector<HTMLInputElement>(`[name="taskSource"][value="${settings.useCustomTasks ? 'custom' : 'builtIn'}"]`)!.checked = true;
    renderTasks();
  }

  function useCustomTasks(): boolean {
    return settingsForm.querySelector<HTMLInputElement>('[name="taskSource"][value="custom"]')!.checked;
  }

  function readTaskFields(): void {
    tasks = [...taskList.querySelectorAll<HTMLElement>('.custom-task')].map((card, index) => {
      const requesterQuestion = card.querySelector<HTMLTextAreaElement>('[name="requesterQuestion"]')!.value;
      return {
        id: tasks[index]!.id,
        requesterQuestion,
        workOrder: card.querySelector<HTMLTextAreaElement>('[name="workOrder"]')!.value,
        searchQuery: requesterQuestion
      };
    });
  }

  function renderTasks(): void {
    taskList.innerHTML = tasks.length ? tasks.map((task, index) => `
      <article class="custom-task">
        <div class="custom-task-heading"><strong>Request ${index + 1}</strong><button type="button" class="secondary" data-remove-task="${index}" aria-label="Remove request ${index + 1}">Remove</button></div>
        <div class="custom-field-label"><label for="question-${index}">Requester Question</label></div>
        <textarea id="question-${index}" name="requesterQuestion" rows="2" maxlength="2000" ${useCustomTasks() ? 'required' : ''} placeholder="What does the requester want to know?">${escapeHtml(task.requesterQuestion)}</textarea>
        <div class="custom-field-label"><label for="order-${index}">Operator Work Order</label></div>
        <textarea id="order-${index}" name="workOrder" rows="3" maxlength="4000" ${useCustomTasks() ? 'required' : ''} placeholder="Define the research and the answer to produce">${escapeHtml(task.workOrder)}</textarea>
      </article>`).join('') : '<div class="bank-empty">Add a request to build your own task bank</div>';
    el<HTMLButtonElement>('addCustomTaskBtn').disabled = tasks.length >= 100;
  }


}

async function request(message: RuntimeMessage): Promise<RuntimeResponse> {
  const response = await chrome.runtime.sendMessage(message) as RuntimeResponse | undefined;
  if (!response) throw new Error('The extension did not respond. Reload Human Mode and try again.');
  return response;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not complete this action';
}
