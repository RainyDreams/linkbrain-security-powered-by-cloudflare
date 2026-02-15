import { reactive } from 'vue';

export type NoticeType = 'success' | 'error' | 'info' | 'warning';

export interface NoticePayload {
    type: NoticeType;
    title: string;
    message?: string;
    hint?: string;
    code?: number | string;
    timeout?: number;
}

export interface NoticeItem extends NoticePayload {
    id: number;
    timeout: number;
    createdAt: number;
}

export const noticeState = reactive<{ items: NoticeItem[] }>({
    items: []
});

let nextId = 1;

const removeNotice = (id: number) => {
    const idx = noticeState.items.findIndex((item) => item.id === id);
    if (idx >= 0) noticeState.items.splice(idx, 1);
};

export const pushNotice = (payload: NoticePayload) => {
    const timeout = payload.timeout ?? (payload.type === 'error' ? 5600 : 3600);
    const id = nextId++;

    const item: NoticeItem = {
        ...payload,
        id,
        timeout,
        createdAt: Date.now()
    };

    noticeState.items.push(item);

    if (timeout > 0) {
        setTimeout(() => removeNotice(id), timeout);
    }

    return id;
};

export const notifySuccess = (title: string, message?: string, hint?: string, timeout?: number) => {
    return pushNotice({ type: 'success', title, message, hint, timeout });
};

export const notifyError = (title: string, message?: string, hint?: string, code?: number | string, timeout?: number) => {
    return pushNotice({ type: 'error', title, message, hint, code, timeout });
};

export const notifyInfo = (title: string, message?: string, hint?: string, timeout?: number) => {
    return pushNotice({ type: 'info', title, message, hint, timeout });
};

export const notifyWarning = (title: string, message?: string, hint?: string, timeout?: number) => {
    return pushNotice({ type: 'warning', title, message, hint, timeout });
};

export const dismissNotice = removeNotice;
